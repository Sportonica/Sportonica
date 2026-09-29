"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { actionError, type ActionError } from "@/lib/actionError";
import { isValidLocalPhone, normalizePhone } from "@/lib/validation/identity";
import { captchaPassed, clientIp, underRateLimit } from "@/lib/security/abuse";
import { smsEnabled } from "@/lib/phone/sms";
import { checkCode, issueCode } from "@/lib/phone/codes";
import { markVerified, numberHolder, releaseNumber, syntheticEmailForPhone } from "@/lib/phone/ownership";

// syntheticEmailForPhone(): the internal e-mail of a phone-only account.
// The user never sees or types it. A dedicated subdomain keeps it from
// ever colliding with a real address. Deterministic, so the login page
// can sign a phone-signup account in directly without any lookup.

// Phone login for accounts whose email ISN'T the synthetic one (an email
// signup that later added a phone, or a phone-signup that changed its
// number). The login page tries the synthetic address first and only
// falls back here. The phone -> email lookup and the password sign-in
// both happen server-side, so the email never reaches the browser —
// email_for_phone() is service-role only for exactly that reason. The
// session lands in cookies; the caller does a full navigation to pick
// it up.
//
// Supabase sees this sign-in coming from Vercel, not the visitor, so its
// per-IP limit can't tell attackers apart — hence our own limits (SEC-04).
export async function signInWithPhone(
  phone: string,
  password: string,
  captchaToken?: string,
): Promise<{ role: string | null } | ActionError> {
  if (!isValidLocalPhone(phone) || !password) return actionError("BAD_CREDENTIALS");
  const digits = normalizePhone(phone);

  if (
    !(await underRateLimit("phone-login-ip", await clientIp(), 20, 15 * 60)) ||
    !(await underRateLimit("phone-login-phone", digits, 10, 15 * 60))
  ) {
    return actionError("RATE_LIMITED");
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return actionError("UNAVAILABLE");
  }
  const { data: email, error: lookupError } = await admin.rpc("email_for_phone", { p_phone: digits });
  if (lookupError) return actionError("UNAVAILABLE");
  // The page already tried the synthetic address with this password —
  // don't burn a second attempt on the same account.
  if (!email || email === syntheticEmailForPhone(digits)) return actionError("BAD_CREDENTIALS");

  const sb = await createClient();
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email),
    password,
    options: { captchaToken },
  });
  if (error) {
    if (error.code === "captcha_failed") return actionError("CAPTCHA_FAILED");
    // Codes only — the account's email still never reaches the browser.
    if (error.code === "email_not_confirmed") return actionError("EMAIL_NOT_CONFIRMED");
    if (error.status === 429) return actionError("RATE_LIMITED");
    return actionError("BAD_CREDENTIALS");
  }

  return { role: (data.user?.user_metadata?.role as string | undefined) ?? null };
}

// Phone-only signup. Supabase's own phone provider needs an SMS gateway
// (OTP) which isn't set up — so we create the account through the admin
// API with a synthetic, pre-confirmed e-mail and stash the real phone in
// user metadata. The handle_new_user() trigger
// (supabase/identity_validation.sql) copies it onto profiles.phone
// and enforces the 10-digit format + UNIQUE constraint. The client then
// signs in with password to get a real session.
//
// The admin API skips Supabase's own signup rate limit and CAPTCHA, so
// both are enforced here instead (SEC-04).
//
// Once SMS is set up (SEC-03) it takes two calls: the first, without
// `code`, texts a code and returns { codeSent }; the second, with the
// code, creates the account with the number already verified. An
// unverified account sitting on the number loses it; a verified one
// keeps it and the signup is refused.
export async function signUpWithPhone(input: {
  name: string;
  phone: string;
  password: string;
  role: "player" | "venue_owner";
  captchaToken?: string;
  code?: string;
}): Promise<{ email: string } | { codeSent: true } | ActionError> {
  const name = input.name.trim();
  if (!name) return actionError("Enter your name.");
  if (!isValidLocalPhone(input.phone)) {
    return actionError("Phone number must contain exactly 10 digits.");
  }
  if (input.password.length < 6) {
    return actionError("Password needs at least 6 characters.");
  }
  const role = input.role === "venue_owner" ? "venue_owner" : "player";
  const digits = normalizePhone(input.phone);
  const email = syntheticEmailForPhone(digits);

  if (!(await captchaPassed(input.captchaToken))) {
    return actionError("Couldn't confirm you're not a bot. Refresh the page and try again.");
  }
  if (
    !(await underRateLimit("phone-signup-ip", await clientIp(), 5, 60 * 60)) ||
    !(await underRateLimit("phone-signup-phone", digits, 6, 60 * 60))
  ) {
    return actionError("Too many sign-up attempts. Wait a while and try again.");
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return actionError("Phone signup isn't available right now. Please use email.");
  }

  const TAKEN = "An account with this phone number already exists. Sign in instead.";
  const verifying = smsEnabled();
  if (verifying) {
    let holder;
    try {
      holder = await numberHolder(digits, null);
    } catch {
      return actionError("Phone signup isn't available right now. Please use email.");
    }
    if (holder === "verified") return actionError(TAKEN);

    if (!input.code) {
      if (!(await underRateLimit("sms-phone", digits, 3, 15 * 60))) {
        return actionError("Too many codes sent to this number. Wait 15 minutes and try again.");
      }
      if (!(await issueCode(digits, "signup", null))) {
        return actionError("Couldn't send the code. Check the number and try again.");
      }
      return { codeSent: true };
    }

    const result = await checkCode(digits, "signup", input.code, null);
    if (result === "wrong") return actionError("That code isn't right. Check the SMS and try again.");
    if (result === "expired") return actionError("That code has expired. Tap \"Send a new code\" to get another.");

    try {
      await releaseNumber(digits, null);
    } catch (e) {
      console.error("[signUpWithPhone] release failed:", (e as { message?: string })?.message ?? e);
      return actionError("Could not create your account. Please try again.");
    }
  } else {
    // Friendly pre-check; the DB UNIQUE index is the real guard against a race.
    const { data: existing } = await admin
      .from("profiles").select("id").eq("phone", digits).maybeSingle();
    if (existing) return actionError(TAKEN);
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: name, phone: digits, role },
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("phone_taken") || m.includes("already been registered") || m.includes("duplicate")) {
      return actionError(TAKEN);
    }
    if (m.includes("phone_invalid")) {
      return actionError("Phone number must contain exactly 10 digits.");
    }
    console.error("[signUpWithPhone]", error.message);
    return actionError("Could not create your account. Please try again.");
  }

  if (verifying && created.user) {
    try {
      await markVerified(created.user.id, digits);
    } catch (e) {
      // The account exists; it will be asked to verify at next sign-in.
      console.error("[signUpWithPhone] mark verified failed:", (e as { message?: string })?.message ?? e);
    }
  }

  return { email };
}

// Self-serve account deletion lives in ./deleteAccount.ts — it needs a
// re-authentication + confirmation flow and a richer result type, so it is
// kept separate from these auth helpers.
