"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { actionError, type ActionError } from "@/lib/actionError";
import { isValidLocalPhone, normalizePhone } from "@/lib/validation/identity";
import { clientIp, underRateLimit } from "@/lib/security/abuse";
import { smsEnabled } from "./sms";
import { checkCode, issueCode } from "./codes";
import { markVerified, numberHolder, releaseNumber } from "./ownership";

// Verifying a phone number on a signed-in account (SEC-03): profile
// edits and the /verify-phone step after sign-in. Phone *signup* has
// its own code step in src/lib/auth/actions.ts.
//
// Error codes: UNAUTHORIZED, UNAVAILABLE, BAD_PHONE, TAKEN, RATE_LIMITED,
// SEND_FAILED, WRONG_CODE, CODE_EXPIRED.

async function signedInUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user: user && !user.is_anonymous ? user : null };
}

export async function sendMyPhoneCode(phone: string): Promise<{ sent: true } | ActionError> {
  const { user } = await signedInUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!smsEnabled()) return actionError("UNAVAILABLE");
  if (!isValidLocalPhone(phone)) return actionError("BAD_PHONE");
  const digits = normalizePhone(phone);

  if (
    !(await underRateLimit("sms-user", user.id, 5, 60 * 60)) ||
    !(await underRateLimit("sms-phone", digits, 3, 15 * 60)) ||
    !(await underRateLimit("sms-ip", await clientIp(), 10, 60 * 60))
  ) {
    return actionError("RATE_LIMITED");
  }
  if ((await numberHolder(digits, user.id)) === "verified") return actionError("TAKEN");

  return (await issueCode(digits, "verify", user.id)) ? { sent: true } : actionError("SEND_FAILED");
}

export async function confirmMyPhone(
  phone: string,
  code: string,
): Promise<{ claimed: number } | ActionError> {
  const { sb, user } = await signedInUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!smsEnabled()) return actionError("UNAVAILABLE");
  if (!isValidLocalPhone(phone)) return actionError("BAD_PHONE");
  const digits = normalizePhone(phone);

  if (!(await underRateLimit("code-check-user", user.id, 10, 15 * 60))) return actionError("RATE_LIMITED");

  const result = await checkCode(digits, "verify", code, user.id);
  if (result === "wrong") return actionError("WRONG_CODE");
  if (result === "expired") return actionError("CODE_EXPIRED");

  try {
    if ((await numberHolder(digits, user.id)) === "verified") return actionError("TAKEN");
    await releaseNumber(digits, user.id);
    await markVerified(user.id, digits);
  } catch (e) {
    console.error("[confirmMyPhone]", (e as { message?: string })?.message ?? e);
    return actionError("UNAVAILABLE");
  }

  // Walk-in tournament entries under this number are theirs now.
  const { data: claimed } = await sb.rpc("claim_guest_tournament_entries");
  revalidatePath("/profile");
  return { claimed: Number(claimed ?? 0) };
}

// Whether to send this account to /verify-phone after signing in: only
// phone-signup accounts (they sign in with the number) that haven't
// verified yet, and only once SMS is actually set up.
export async function phoneVerificationNeeded(): Promise<boolean> {
  if (!smsEnabled()) return false;
  const { sb, user } = await signedInUser();
  if (!user?.email?.endsWith("@phone.sportonica.com")) return false;
  const { data } = await sb.rpc("get_my_profile").maybeSingle();
  const profile = data as { phone_verified_at?: string | null } | null;
  return !!profile && !profile.phone_verified_at;
}
