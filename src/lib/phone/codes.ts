// SERVER ONLY — uses the service-role key. One-time SMS codes for phone
// verification (SEC-03), kept hashed in public.phone_codes
// (supabase/phone_verification.sql on the `changes` branch).

import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { sendSms } from "./sms";

export type CodePurpose = "signup" | "verify";

const CODE_TTL_S = 10 * 60;
const MAX_ATTEMPTS = 5;

// Keyed so a leaked table alone can't be brute-forced back to codes.
function hashCode(id: string, code: string): string {
  return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(`${id}:${code}`).digest("hex");
}

// Issues a fresh code (older unused ones for the same number and purpose
// stop working) and texts it. False if it couldn't be sent.
export async function issueCode(phone: string, purpose: CodePurpose, userId: string | null): Promise<boolean> {
  const admin = createServiceClient();
  await admin.from("phone_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("phone", phone).eq("purpose", purpose).is("consumed_at", null);

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const id = crypto.randomUUID();
  const { error } = await admin.from("phone_codes").insert({
    id,
    phone,
    purpose,
    user_id: userId,
    code_hash: hashCode(id, code),
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  });
  if (error) {
    console.error("[phone-codes] insert failed:", error.message);
    return false;
  }
  return sendSms(phone, `${code} is your Sportonica verification code. It expires in 10 minutes. Don't share it with anyone.`);
}

export type CodeCheck = "ok" | "wrong" | "expired";

// Checks (and on success uses up) the latest code for this number and
// purpose. For "verify" the code must also belong to `userId`, so one
// account can't finish a verification another account started.
export async function checkCode(
  phone: string,
  purpose: CodePurpose,
  code: string,
  userId: string | null,
): Promise<CodeCheck> {
  const admin = createServiceClient();
  let q = admin.from("phone_codes")
    .select("id, code_hash, attempts, expires_at, user_id")
    .eq("phone", phone).eq("purpose", purpose).is("consumed_at", null)
    .order("created_at", { ascending: false }).limit(1);
  if (userId) q = q.eq("user_id", userId);
  const { data: row } = await q.maybeSingle();

  if (!row || new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MAX_ATTEMPTS) {
    return "expired";
  }

  const expected = Buffer.from(row.code_hash, "hex");
  const given = Buffer.from(hashCode(row.id, code.trim()), "hex");
  if (!/^\d{6}$/.test(code.trim()) || !timingSafeEqual(expected, given)) {
    const attempts = row.attempts + 1;
    await admin.from("phone_codes")
      .update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { consumed_at: new Date().toISOString() } : {}) })
      .eq("id", row.id);
    return attempts >= MAX_ATTEMPTS ? "expired" : "wrong";
  }

  // Consume atomically: only one request can flip consumed_at.
  const { data: used } = await admin.from("phone_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id).is("consumed_at", null)
    .select("id");
  return used?.length ? "ok" : "expired";
}
