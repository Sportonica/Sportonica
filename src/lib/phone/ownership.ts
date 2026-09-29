// SERVER ONLY — uses the service-role key. Who holds a phone number, and
// moving it to whoever proves they own it (SEC-03). A number verified by
// SMS beats one that was only typed in: the unverified holder loses it.
// A number another account has already verified is never taken over
// here; that needs support.

import { createServiceClient } from "@/lib/supabase/admin";

export const syntheticEmailForPhone = (digits: string) => `${digits}@phone.sportonica.com`;

export type Holder = "free" | "unverified" | "verified";

export async function numberHolder(phone: string, exceptUserId: string | null): Promise<Holder> {
  const admin = createServiceClient();
  let q = admin.from("profiles").select("id, phone_verified_at").eq("phone", phone);
  if (exceptUserId) q = q.neq("id", exceptUserId);
  const { data, error } = await q;
  if (error) throw error;
  if (data?.some((p) => p.phone_verified_at)) return "verified";
  return data?.length ? "unverified" : "free";
}

// Takes the number off every other (unverified) profile, and moves a
// phone-signup account's internal address out of the way so the number
// can be signed up with. That account can then only sign in with a
// different, verified number of its own, or through support.
export async function releaseNumber(phone: string, exceptUserId: string | null): Promise<void> {
  const admin = createServiceClient();
  let q = admin.from("profiles").update({ phone: null }).eq("phone", phone).is("phone_verified_at", null);
  if (exceptUserId) q = q.neq("id", exceptUserId);
  const { error } = await q;
  if (error) throw error;

  const { data: holderId, error: lookupError } = await admin.rpc("user_id_for_email", {
    p_email: syntheticEmailForPhone(phone),
  });
  if (lookupError) throw lookupError;
  if (holderId && holderId !== exceptUserId) {
    const { error: renameError } = await admin.auth.admin.updateUserById(String(holderId), {
      email: `released-${holderId}@phone.sportonica.com`,
      email_confirm: true,
    });
    if (renameError) throw renameError;
    console.info("[phone] released synthetic address from", holderId);
  }
}

export async function markVerified(userId: string, phone: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("profiles")
    .update({ phone, phone_verified_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}
