"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { actionError, type ActionError } from "@/lib/actionError";
import { isValidLocalPhone, normalizePhone } from "@/lib/validation/identity";

// Internal e-mail synthesised for a phone-only account. The user never
// sees or types it. A dedicated subdomain keeps it from ever colliding
// with a real address. Deterministic, so the login page can sign a
// phone-signup account in directly without any lookup.
function syntheticEmailForPhone(digits: string): string {
  return `${digits}@phone.sportonica.com`;
}

// Phone login for accounts whose email ISN'T the synthetic one (an email
// signup that later added a phone, or a phone-signup that changed its
// number). The login page tries the synthetic address first and only
// falls back here. The phone -> email lookup and the password sign-in
// both happen server-side, so the email never reaches the browser —
// email_for_phone() is service-role only for exactly that reason. The
// session lands in cookies; the caller does a full navigation to pick
// it up.
export async function signInWithPhone(
  phone: string,
  password: string,
): Promise<{ role: string | null } | ActionError> {
  if (!isValidLocalPhone(phone) || !password) return actionError("BAD_CREDENTIALS");
  const digits = normalizePhone(phone);

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
  const { data, error } = await sb.auth.signInWithPassword({ email: String(email), password });
  if (error) {
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
export async function signUpWithPhone(input: {
  name: string;
  phone: string;
  password: string;
  role: "player" | "venue_owner";
}): Promise<{ email: string } | ActionError> {
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

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return actionError("Phone signup isn't available right now. Please use email.");
  }

  // Friendly pre-check; the DB UNIQUE index is the real guard against a race.
  const { data: existing } = await admin
    .from("profiles").select("id").eq("phone", digits).maybeSingle();
  if (existing) return actionError("An account with this phone number already exists.");

  const { error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: name, phone: digits, role },
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("phone_taken") || m.includes("already been registered") || m.includes("duplicate")) {
      return actionError("An account with this phone number already exists.");
    }
    if (m.includes("phone_invalid")) {
      return actionError("Phone number must contain exactly 10 digits.");
    }
    console.error("[signUpWithPhone]", error.message);
    return actionError("Could not create your account. Please try again.");
  }

  return { email };
}

// Self-serve account deletion lives in ./deleteAccount.ts — it needs a
// re-authentication + confirmation flow and a richer result type, so it is
// kept separate from these auth helpers.
