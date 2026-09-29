"use client";

import { useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { Lock, AtSign } from "lucide-react";
import GoogleButton from "@/components/GoogleButton";
import AppleButton from "@/components/AppleButton";
import BackButton from "@/components/nav/BackButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthInput from "@/components/auth/AuthInput";
import IdentityBadge from "@/components/auth/IdentityBadge";
import SubmitButton from "@/components/auth/SubmitButton";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  normalizeEmail, normalizePhone, isValidEmail, isValidLocalPhone, looksLikeEmail,
} from "@/lib/validation/identity";
import { safeRedirect } from "@/lib/validation/redirect";
import { signInWithPhone } from "@/lib/auth/actions";
import { phoneVerificationNeeded } from "@/lib/phone/actions";
import { isActionError } from "@/lib/actionError";
import { useCaptcha, CaptchaError, CAPTCHA_FAILED } from "@/lib/captcha/useCaptcha";

// Shown for a wrong account OR wrong password alike, so an attacker can't
// tell "no such account" from "wrong password" (spec §21).
const BAD_CREDENTIALS = "The email/phone number or password is incorrect.";
const BAD_IDENTIFIER = "Enter a valid email address or a 10-digit mobile number.";
const NOT_CONFIRMED = "Confirm your email before signing in. Check your inbox (and spam) for the link we sent.";
const RATE_LIMITED = "Too many attempts. Wait a few minutes, then try again.";
const NETWORK = "Couldn't reach Sportonica. Check your connection and try again.";
const UNAVAILABLE = "Sign-in isn't working right now. Please try again in a moment.";

// /auth/callback sends failed Google/Apple sign-ins back with ?error=.
const CALLBACK_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Pick a way to sign in to continue.",
  missing_code: "That sign-in didn't complete. Please try again.",
  signin_failed: "That sign-in link didn't work. It may have expired or been opened in a different browser. Please try again.",
};

// Only email_not_confirmed (which Supabase returns after the password
// checks out) gets its own message; everything else stays BAD_CREDENTIALS.
function messageFor(error: AuthError): string {
  if (isAuthRetryableFetchError(error)) return NETWORK;
  if (error.code === "email_not_confirmed") return NOT_CONFIRMED;
  if (error.code === "captcha_failed") return CAPTCHA_FAILED;
  if (error.status === 429) return RATE_LIMITED;
  if (error.status && error.status >= 500) return UNAVAILABLE;
  return BAD_CREDENTIALS;
}

const ACTION_MESSAGES: Record<string, string> = {
  EMAIL_NOT_CONFIRMED: NOT_CONFIRMED,
  RATE_LIMITED,
  UNAVAILABLE,
  CAPTCHA_FAILED,
};

function LoginInner() {
  const sb = createClient();
  const router = useRouter();
  const { captchaRef, getToken } = useCaptcha();
  const params = useSearchParams();
  const redirect = params.get("redirect");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(() => CALLBACK_ERRORS[params.get("error") ?? ""] ?? null);
  const [loading, setLoading] = useState(false);
  // Email awaiting confirmation: offers the resend button under the error.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "sending" | "sent">("idle");

  const identifierValid = useMemo(() => {
    const id = identifier.trim();
    if (!id) return false;
    return looksLikeEmail(id) ? isValidEmail(id) : isValidLocalPhone(id);
  }, [identifier]);

  async function login() {
    if (loading) return;   // Enter while a sign-in is already in flight
    const id = identifier.trim();
    setUnconfirmed(null); setResend("idle");
    if (!id || !password) { setErr("Enter your mobile number or email, and your password."); return; }

    const target = (role: unknown) =>
      redirect ? safeRedirect(redirect) : role === "venue_owner" || role === "admin" ? "/admin" : "/discover";

    let signInEmail: string;
    if (looksLikeEmail(id)) {
      if (!isValidEmail(id)) { setErr(BAD_IDENTIFIER); return; }
      signInEmail = normalizeEmail(id);
    } else {
      if (!isValidLocalPhone(id)) { setErr(BAD_IDENTIFIER); return; }
      // Phone-signup accounts use a deterministic internal address.
      signInEmail = `${normalizePhone(id)}@phone.sportonica.com`;
    }

    setLoading(true); setErr(null);
    let navigating = false;
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: signInEmail,
        password,
        options: { captchaToken: await getToken() },
      });
      if (!error) {
        navigating = true;
        let dest = target(data.user?.user_metadata?.role);
        // Phone-signup accounts from before SMS codes confirm their number
        // first (SEC-03). A failed check shouldn't block signing in.
        if (!looksLikeEmail(id) && (await phoneVerificationNeeded().catch(() => false))) {
          dest = `/profile/verify-phone?redirect=${encodeURIComponent(dest)}`;
        }
        router.push(dest);
        router.refresh();
        return;
      }

      const message = messageFor(error);
      // Only wrong credentials on the synthetic phone address fall through
      // to the server lookup; a network/rate-limit failure would just repeat.
      if (looksLikeEmail(id) || message !== BAD_CREDENTIALS) {
        setErr(message);
        if (message === NOT_CONFIRMED) setUnconfirmed(signInEmail);
        return;
      }

      // A phone that belongs to an account with a real email: resolved and
      // signed in server-side so that email is never sent to the browser.
      const res = await signInWithPhone(id, password, await getToken());
      if (!isActionError(res)) {
        navigating = true;
        // Session was set as cookies by the server — a full load makes the
        // in-memory auth client pick it up.
        window.location.assign(target(res.role));
        return;
      }
      setErr(ACTION_MESSAGES[res.message] ?? BAD_CREDENTIALS);
    } catch (e) {
      setErr(e instanceof CaptchaError ? CAPTCHA_FAILED : NETWORK);
    } finally {
      if (!navigating) setLoading(false);
    }
  }

  async function resendConfirmation() {
    if (!unconfirmed || resend !== "idle") return;
    setResend("sending");
    const captchaToken = await getToken().catch(() => undefined);
    const { error } = await sb.auth.resend({ type: "signup", email: unconfirmed, options: { captchaToken } }).catch(
      () => ({ error: { status: 0 } as AuthError }),
    );
    if (error) {
      setResend("idle");
      setErr(error.status === 429
        ? "We just sent one. Wait a minute before asking for another."
        : "Couldn't send the email. Please try again.");
      return;
    }
    setResend("sent");
    setErr(null);
  }

  // The brand lockup doubles as a link home. Rendered in the left
  // atmosphere panel on desktop, and again above the card on mobile
  // (where that panel is hidden) so there's always a way back home.
  const brandHome = (
    <Link href="/" className="auth-brand" aria-label="Sportonica, go to the home page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/mark.png" alt="" className="auth-brand-mark" />
      <div className="auth-brand-name">Sportonica</div>
    </Link>
  );

  return (
    <div className="auth">
      <BackButton className="auth-navback" iconSize={17} />
      <div className="auth-stage">
        {brandHome}
        <div className="auth-tagline">
          <h2>The game&apos;s already on. <em>Come find it.</em></h2>
          <p>Book courts, host matches, and fill your ground, all from one place.</p>
        </div>
        <div className="auth-foot">NEPAL · SINCE 2026</div>
      </div>

      <div className="auth-form-wrap">
        <div className="auth-brand-mobile">{brandHome}</div>
        <AuthCard>
          <h1>Welcome back</h1>
          <p className="sub">Sign in to keep playing.</p>

          <AuthInput
            label="Mobile number or email"
            value={identifier}
            onChange={setIdentifier}
            icon={<AtSign size={17} />}
            autoComplete="username"
            inputMode="email"
            right={<IdentityBadge value={identifier} />}
            valid={identifierValid}
            onEnter={login}
          />
          <AuthInput
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            icon={<Lock size={16} />}
            autoComplete="current-password"
            onEnter={login}
          />

          <div className="auth-forgot">
            <Link
              href={
                looksLikeEmail(identifier)
                  ? `/forgot-password?email=${encodeURIComponent(identifier.trim())}`
                  : "/forgot-password"
              }
            >
              Forgot password?
            </Link>
          </div>

          {err && <div className="auth-error" role="alert">{err}</div>}
          {unconfirmed && resend !== "sent" && (
            <button
              type="button"
              className="auth-resend"
              onClick={resendConfirmation}
              disabled={resend === "sending"}
            >
              {resend === "sending" ? "Sending…" : "Resend confirmation email"}
            </button>
          )}
          {resend === "sent" && (
            <div className="auth-note" role="status">
              Sent. Check your inbox for the new confirmation link, then sign in.
            </div>
          )}

          <div ref={captchaRef} className="auth-captcha" />
          <SubmitButton loading={loading} onClick={login}>Sign in</SubmitButton>

          <div className="auth-or"><span>or</span></div>
          <GoogleButton next={safeRedirect(redirect)} label="Sign in with Google" />
          <div style={{ height: 10 }} />
          <AppleButton next={safeRedirect(redirect)} label="Sign in with Apple" />

          <div className="auth-alt">
            New here?{" "}
            <Link href={redirect ? `/signup?redirect=${encodeURIComponent(safeRedirect(redirect))}` : "/signup"}>
              Create an account
            </Link>
          </div>
        </AuthCard>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth" />}>
      <LoginInner />
    </Suspense>
  );
}
