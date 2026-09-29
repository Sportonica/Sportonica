"use client";

import { useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { Lock, AtSign, User, MessageSquare } from "lucide-react";
import GoogleButton from "@/components/GoogleButton";
import AppleButton from "@/components/AppleButton";
import BackButton from "@/components/nav/BackButton";
import AuthCard from "@/components/auth/AuthCard";
import AuthInput from "@/components/auth/AuthInput";
import ConsentCheckbox from "@/components/auth/ConsentCheckbox";
import IdentityBadge from "@/components/auth/IdentityBadge";
import PasswordStrength from "@/components/auth/PasswordStrength";
import SubmitButton from "@/components/auth/SubmitButton";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  normalizeEmail, normalizePhone, isValidEmail, isValidLocalPhone, looksLikeEmail, PHONE_ERROR,
} from "@/lib/validation/identity";
import { PASSWORD_MIN } from "@/lib/validation/password";
import { safeRedirect } from "@/lib/validation/redirect";
import { signUpWithPhone } from "@/lib/auth/actions";
import { isActionError } from "@/lib/actionError";
import { useCaptcha, CAPTCHA_FAILED } from "@/lib/captcha/useCaptcha";

type Role = "player" | "venue_owner";

const BAD_IDENTIFIER = "Enter a valid email address or a 10-digit mobile number.";

function friendlySignupError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("captcha")) return CAPTCHA_FAILED;
  if (m.includes("rate limit")) return "Too many sign-up attempts. Wait a while and try again.";
  if (m.includes("phone_taken") || (m.includes("phone") && m.includes("already"))) {
    return "An account with this phone number already exists.";
  }
  if (m.includes("phone_invalid")) return PHONE_ERROR;
  if (m.includes("email_invalid")) return "Please enter a valid email address.";
  if (
    m.includes("already registered") || m.includes("already exists") ||
    m.includes("user already") || m.includes("email_exists") || m.includes("duplicate")
  ) {
    return "An account with this email already exists.";
  }
  if (m.includes("password")) return "Password needs at least 6 characters.";
  return "Something went wrong creating your account. Please try again.";
}

function SignupInner() {
  const sb = createClient();
  const router = useRouter();
  const { captchaRef, getToken } = useCaptcha();
  // null = the CAPTCHA couldn't produce a token (script blocked, timed out).
  const captchaToken = () => getToken().catch(() => null);
  const params = useSearchParams();
  const redirect = params.get("redirect");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<Role>("player");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [consentErr, setConsentErr] = useState(false);
  // Phone signup with SMS set up: the number a code was texted to, and
  // the code typed back. Editing the number starts over.
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const codeStep = codeFor !== null && isValidLocalPhone(identifier.trim()) && normalizePhone(identifier.trim()) === codeFor;

  const identifierValid = useMemo(() => {
    const id = identifier.trim();
    if (!id) return false;
    return looksLikeEmail(id) ? isValidEmail(id) : isValidLocalPhone(id);
  }, [identifier]);
  const confirmValid = confirm.length > 0 && confirm === password && password.length >= PASSWORD_MIN;

  function afterAuth() {
    if (redirect) router.push(safeRedirect(redirect));
    else router.push(role === "venue_owner" ? "/admin" : "/discover");
    router.refresh();
  }

  // First call (no code) texts a code when SMS is set up; with the code it
  // creates the account. Without SMS it creates the account straight away.
  async function phoneSignup(id: string, withCode?: string) {
    setLoading(true); setErr(null); setNote(null);
    const signupToken = await captchaToken();
    if (signupToken === null) { setErr(CAPTCHA_FAILED); setLoading(false); return; }
    const res = await signUpWithPhone({
      name: name.trim(), phone: id, password, role, captchaToken: signupToken, code: withCode,
    });
    if (isActionError(res)) { setErr(res.message); setLoading(false); return; }
    if ("codeSent" in res) {
      setCodeFor(normalizePhone(id));
      setCode("");
      setNote(`We texted a 6-digit code to ${normalizePhone(id)}. Enter it below to finish.`);
      setLoading(false);
      return;
    }
    const { error } = await sb.auth.signInWithPassword({
      email: res.email,
      password,
      options: { captchaToken: (await captchaToken()) ?? undefined },
    });
    if (error) { setErr("Account created. Please sign in."); router.push("/login"); return; }
    afterAuth();
  }

  async function signup() {
    const id = identifier.trim();
    if (!name.trim() || !id || !password) { setErr("Fill in every field to continue."); return; }
    if (password.length < PASSWORD_MIN) { setErr("Password needs at least 6 characters."); return; }
    if (password !== confirm) { setErr("Those passwords don't match."); return; }
    if (!agreed) {
      setConsentErr(true);
      setErr("Please agree to the Terms and conditions and Privacy policy to continue.");
      return;
    }

    if (!looksLikeEmail(id)) {
      if (!isValidLocalPhone(id)) { setErr(BAD_IDENTIFIER); return; }
      if (codeStep && !/^\d{6}$/.test(code.trim())) { setErr("Enter the 6-digit code we texted you."); return; }
      await phoneSignup(id, codeStep ? code.trim() : undefined);
      return;
    }

    if (!isValidEmail(id)) { setErr(BAD_IDENTIFIER); return; }
    setLoading(true); setErr(null); setNote(null);
    const token = await captchaToken();
    if (token === null) { setErr(CAPTCHA_FAILED); setLoading(false); return; }
    const { data, error } = await sb.auth.signUp({
      email: normalizeEmail(id),
      password,
      options: { data: { full_name: name.trim(), role }, captchaToken: token },
    });
    if (error) { setErr(friendlySignupError(error.message)); setLoading(false); return; }
    if (!data.session) {
      setNote("Almost there. Check your email to confirm your account, then sign in.");
      setLoading(false);
      return;
    }
    afterAuth();
  }

  return (
    <div className="auth">
      <BackButton className="auth-navback" iconSize={17} />
      <div className="auth-stage">
        <Link href="/" className="auth-brand" aria-label="Sportonica, go to the home page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/mark.png" alt="" className="auth-brand-mark" />
          <div className="auth-brand-name">Sportonica</div>
        </Link>
        <div className="auth-tagline">
          <h2>Find. Book. <em>Play.</em></h2>
          <p>Join as a player to host and find matches, or list your venue and start taking bookings today.</p>
        </div>
        <div className="auth-foot">NEPAL · SINCE 2026</div>
      </div>

      <div className="auth-form-wrap">
        <AuthCard>
          <h1>Create your account</h1>
          <p className="sub">One minute, then you&apos;re in.</p>

          <div className="auth-field" style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--dim)", marginBottom: 8 }}>I want to</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <RoleCard active={role === "player"} onClick={() => setRole("player")} title="Play" desc="Host & join games" />
              <RoleCard active={role === "venue_owner"} onClick={() => setRole("venue_owner")} title="List a venue" desc="Take bookings" />
            </div>
          </div>

          <AuthInput
            label="Full name"
            value={name}
            onChange={setName}
            icon={<User size={16} />}
            autoComplete="name"
            valid={name.trim().length >= 2}
            onEnter={signup}
          />
          <AuthInput
            label="Mobile number or email"
            value={identifier}
            onChange={setIdentifier}
            icon={<AtSign size={17} />}
            autoComplete="username"
            inputMode="email"
            right={<IdentityBadge value={identifier} />}
            valid={identifierValid}
            onEnter={signup}
          />
          <AuthInput
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            icon={<Lock size={16} />}
            autoComplete="new-password"
            onEnter={signup}
          />
          <PasswordStrength value={password} />
          <AuthInput
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            type="password"
            icon={<Lock size={16} />}
            autoComplete="new-password"
            valid={confirmValid}
            onEnter={signup}
          />

          {codeStep && (
            <>
              <AuthInput
                label="6-digit code"
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                icon={<MessageSquare size={16} />}
                autoComplete="one-time-code"
                inputMode="numeric"
                valid={/^\d{6}$/.test(code)}
                onEnter={signup}
              />
              <button
                type="button"
                className="auth-resend"
                disabled={loading}
                onClick={() => phoneSignup(identifier.trim())}
              >
                Send a new code
              </button>
            </>
          )}

          {err && <div className="auth-error">{err}</div>}
          {note && <div className="auth-note">{note}</div>}

          <ConsentCheckbox
            checked={agreed}
            error={consentErr}
            onChange={(v) => { setAgreed(v); if (v) setConsentErr(false); }}
          />

          <div ref={captchaRef} className="auth-captcha" />
          <SubmitButton loading={loading} onClick={signup}>
            {codeStep ? "Verify and create account" : "Create account"}
          </SubmitButton>

          <div className="auth-or"><span>or</span></div>
          <GoogleButton
            next={safeRedirect(redirect)}
            label="Sign up with Google"
            guard={() => {
              if (!agreed) {
                setConsentErr(true);
                setErr("Please agree to the Terms and conditions and Privacy policy to continue.");
                return false;
              }
              return true;
            }}
          />
          <div style={{ height: 10 }} />
          <AppleButton
            next={safeRedirect(redirect)}
            label="Sign up with Apple"
            guard={() => {
              if (!agreed) {
                setConsentErr(true);
                setErr("Please agree to the Terms and conditions and Privacy policy to continue.");
                return false;
              }
              return true;
            }}
          />

          <div className="auth-alt">
            Already have an account?{" "}
            <Link href={redirect ? `/login?redirect=${encodeURIComponent(safeRedirect(redirect))}` : "/login"}>Sign in</Link>
          </div>
        </AuthCard>
      </div>
    </div>
  );
}

function RoleCard({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button type="button" onClick={onClick}
      style={{
        textAlign: "left", cursor: "pointer",
        background: active ? "rgba(10,143,95,0.14)" : "color-mix(in srgb, var(--text) 5%, transparent)",
        border: `1px solid ${active ? "rgba(10,143,95,0.5)" : "var(--line-2)"}`,
        borderRadius: 12, padding: "12px 13px",
        transition: "all 0.3s cubic-bezier(0.22,1,0.36,1)",
        color: "inherit", fontFamily: "inherit",
      }}>
      <div style={{ fontWeight: 700, fontSize: 14, color: active ? "var(--sodium-2)" : "var(--text)" }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>{desc}</div>
    </button>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="auth" />}>
      <SignupInner />
    </Suspense>
  );
}
