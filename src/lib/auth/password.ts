"use server";

import { createClient } from "@/lib/supabase/server";
import { createAnonClient } from "@/lib/supabase/anonServer";
import { actionError, type ActionError } from "@/lib/actionError";
import { PASSWORD_MIN } from "@/lib/validation/password";
import { underRateLimit } from "@/lib/security/abuse";

// Password changes go through the server so they can't be done with a
// session alone (SEC-05). A stolen session cookie shouldn't be enough to
// lock the real owner out: changing a password needs the current one, or
// (for Google/Apple-only accounts, which have none) a sign-in from the
// last few minutes. Resetting needs a session that came from a reset link.
// Either way every other device is signed out afterwards.

const RECENT_SIGN_IN_S = 10 * 60;
// Reset links themselves last an hour; this is how long after clicking
// one the form stays usable.
const RESET_WINDOW_S = 30 * 60;
// Ways of signing in that prove control of the inbox (or phone). A
// reset-link session is stamped "otp" (verified 2026-09-29); "recovery"
// is kept in case GoTrue labels the PKCE path that way.
const INBOX_PROOF = new Set(["recovery", "otp", "magiclink"]);

type AmrEntry = { method: string; timestamp: number };

// Read from the verified access token, never from the unverified session
// object — the amr claim is what records *how* and *when* they signed in.
async function signInMethods(sb: Awaited<ReturnType<typeof createClient>>): Promise<AmrEntry[] | null> {
  const { data, error } = await sb.auth.getClaims();
  if (error || !data?.claims) return null;
  const amr = data.claims.amr;
  if (!Array.isArray(amr)) return [];
  return amr.filter(
    (e): e is AmrEntry => typeof e === "object" && e !== null && typeof e.timestamp === "number",
  );
}

const now = () => Math.floor(Date.now() / 1000);

function updateFailed(error: { code?: string; message: string }): ActionError {
  if (error.code === "same_password") return actionError("SAME_PASSWORD");
  if (error.code === "weak_password") return actionError("WEAK_PASSWORD");
  // "Secure password change" in the Supabase dashboard can demand this
  // for sessions older than a day, whatever we checked here.
  if (error.code === "reauthentication_needed") return actionError("REAUTH_REQUIRED");
  console.error("[password] update failed:", error.message);
  return actionError("UNAVAILABLE");
}

export async function changePassword(
  current: string,
  next: string,
  captchaToken?: string,
): Promise<{ ok: true } | ActionError> {
  if (next.length < PASSWORD_MIN) return actionError("WEAK_PASSWORD");

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return actionError("SIGNED_OUT");

  // Email and phone signups both sign in with a password on an "email"
  // identity; Google/Apple-only accounts have no password to check.
  const hasPassword = !!user.email && !!user.identities?.some((i) => i.provider === "email");

  if (hasPassword) {
    if (!current) return actionError("WRONG_PASSWORD");
    // The check below is a password sign-in from our server, which
    // Supabase's per-IP limit can't attribute to this visitor (SEC-04).
    if (!(await underRateLimit("password-check-user", user.id, 10, 15 * 60))) {
      return actionError("RATE_LIMITED");
    }
    // Check it on a throwaway client so the cookie session isn't touched,
    // then revoke the session that check created.
    const probe = createAnonClient();
    const { data, error } = await probe.auth.signInWithPassword({
      email: user.email!,
      password: current,
      options: { captchaToken },
    });
    if (error) {
      if (error.code === "captcha_failed") return actionError("CAPTCHA_FAILED");
      if (error.status === 429) return actionError("RATE_LIMITED");
      return actionError("WRONG_PASSWORD");
    }
    if (data.user?.id !== user.id) return actionError("WRONG_PASSWORD");
    await probe.auth.signOut({ scope: "local" });
  } else {
    const amr = await signInMethods(sb);
    if (!amr?.some((e) => e.timestamp >= now() - RECENT_SIGN_IN_S)) {
      return actionError("REAUTH_REQUIRED");
    }
  }

  const { error } = await sb.auth.updateUser({ password: next });
  if (error) return updateFailed(error);

  await sb.auth.signOut({ scope: "others" });
  return { ok: true };
}

// Whether the current session came from a reset link recently enough to
// set a new password with it. The reset page asks before showing the form.
export async function canResetPassword(): Promise<boolean> {
  const sb = await createClient();
  const amr = await signInMethods(sb);
  return !!amr?.some((e) => INBOX_PROOF.has(e.method) && e.timestamp >= now() - RESET_WINDOW_S);
}

export async function resetPassword(next: string): Promise<{ ok: true } | ActionError> {
  if (next.length < PASSWORD_MIN) return actionError("WEAK_PASSWORD");
  if (!(await canResetPassword())) return actionError("LINK_EXPIRED");

  const sb = await createClient();
  const { error } = await sb.auth.updateUser({ password: next });
  if (error) return updateFailed(error);

  // Whoever else might be holding a session is the reason for many resets.
  await sb.auth.signOut({ scope: "others" });
  return { ok: true };
}
