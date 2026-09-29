"use client";

import { useState, useTransition } from "react";
import { Check, Lock, ShieldAlert, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteMyAccount } from "@/lib/auth/deleteAccount";
import { changePassword as changePasswordAction } from "@/lib/auth/password";
import { isActionError } from "@/lib/actionError";
import { PASSWORD_MIN } from "@/lib/validation/password";

const PASSWORD_ERRORS: Record<string, string> = {
  WRONG_PASSWORD: "That's not your current password.",
  SAME_PASSWORD: "Choose a password you haven't used before.",
  WEAK_PASSWORD: `Password needs at least ${PASSWORD_MIN} characters.`,
  RATE_LIMITED: "Too many attempts. Wait a few minutes and try again.",
  REAUTH_REQUIRED: "For your security, sign in again before changing your password.",
  SIGNED_OUT: "You've been signed out. Sign in again to continue.",
  UNAVAILABLE: "Couldn't update your password. Please try again.",
};

export default function SecuritySettings({ name, hasPassword }: { name: string; hasPassword: boolean }) {
  const [pending, startTransition] = useTransition();

  // ── Change password ──
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwCode, setPwCode] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  function changePassword() {
    setPwMsg(null);
    setPwCode(null);
    if (hasPassword && !current) { setPwMsg("Enter your current password."); return; }
    if (pw.length < PASSWORD_MIN) { setPwMsg(`Password needs at least ${PASSWORD_MIN} characters.`); return; }
    if (pw !== confirm) { setPwMsg("Those passwords don't match."); return; }
    startTransition(async () => {
      const res = await changePasswordAction(current, pw);
      if (isActionError(res)) {
        setPwCode(res.message);
        setPwMsg(PASSWORD_ERRORS[res.message] ?? PASSWORD_ERRORS.UNAVAILABLE);
        return;
      }
      setCurrent(""); setPw(""); setConfirm("");
      setPwOk(true);
      setTimeout(() => setPwOk(false), 2200);
    });
  }

  async function signInAgain() {
    try { await createClient().auth.signOut({ scope: "local" }); } catch { /* leaving regardless */ }
    window.location.href = "/login?redirect=/profile/security";
  }

  // ── Delete account ──
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setDelErr(null);
    const res = await deleteMyAccount();
    if (res.ok) {
      try { await createClient().auth.signOut({ scope: "global" }); } catch { /* leaving regardless */ }
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* private mode */ }
      window.location.href = "/";
      return;
    }
    setDeleting(false);
    setArmed(false);
    setDelErr(res.message);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Change password */}
      <div className="pf-card">
        <h2 className="pf-card-t"><Lock size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Password</h2>
        <p style={{ fontSize: 12.5, color: "var(--pf-dim)", marginTop: -4, marginBottom: 16 }}>
          Sets a password you can use to sign in with your email. It&apos;s handy even if you normally
          use Google or your phone number. Changing it signs you out on your other devices.
        </p>

        {hasPassword && (
          <Field label="Current password">
            <input className="pf-in" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        )}

        <Field label="New password">
          <input className="pf-in" type="password" autoComplete="new-password"
            value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <input className="pf-in" type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePassword()} />
        </Field>

        {pwMsg && (
          <div role="alert" style={{ color: "#ef4444", fontSize: 12.5, marginTop: 10 }}>
            {pwMsg}
            {pwCode === "REAUTH_REQUIRED" && (
              <>
                {" "}
                <button type="button" onClick={signInAgain}
                  style={{ background: "none", border: 0, padding: 0, color: "#006241", fontWeight: 600, cursor: "pointer", font: "inherit" }}>
                  Sign in again
                </button>
              </>
            )}
            {pwCode === "WRONG_PASSWORD" && (
              <>
                {" "}
                <a href="/forgot-password" style={{ color: "#006241", fontWeight: 600 }}>Forgot it?</a>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button className="pf-btn" onClick={changePassword} disabled={pending || !pw || !confirm}>
            {pwOk ? <><Check size={15} /> Password updated</> : pending ? "Saving…" : "Update password"}
          </button>
        </div>
      </div>

      {/* Danger zone — deliberately last, well below "Update password" */}
      <div className="pf-danger-card">
        <h2 className="pf-card-t">
          <ShieldAlert size={16} aria-hidden /> Delete Account
        </h2>
        <p>
          Permanently removes your Sportonica account and personal data, {name}. Upcoming bookings
          are cancelled; a few records (payments, past bookings) are kept without your name for
          legal and accounting reasons. This can&apos;t be undone.{" "}
          <a href="/account-deletion" target="_blank" rel="noopener" style={{ color: "#dc2626", fontWeight: 600 }}>
            See what gets deleted
          </a>.
        </p>

        {delErr && (
          <div role="alert" style={{ color: "#dc2626", fontSize: 12.5, margin: "0 0 12px", lineHeight: 1.5 }}>
            {delErr}
          </div>
        )}

        {!armed ? (
          <button type="button" className="pf-danger-btn" onClick={() => { setDelErr(null); setArmed(true); }}>
            Delete Account
          </button>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="pf-danger-btn"
              style={{ background: "#dc2626", borderColor: "#dc2626", color: "#fff" }}
              onClick={deleteAccount}
              disabled={deleting}
            >
              {deleting
                ? <><Loader2 size={15} className="pf-spin" /> Deleting…</>
                : "Yes, delete my account"}
            </button>
            <button type="button" className="pf-danger-btn" onClick={() => setArmed(false)} disabled={deleting}>
              Cancel
            </button>
          </div>
        )}
      </div>

      <style>{`
        .pf-in {
          width: 100%; box-sizing: border-box;
          background: transparent; border: 1px solid var(--pf-hair);
          border-radius: 10px; padding: 13px 14px; color: inherit;
          font-family: inherit; font-size: 14px;
        }
        .pf-in:focus { outline: none; border-color: #006241; box-shadow: 0 0 0 3px rgba(0,98,65,0.12); }
        .pf-spin { animation: pf-spin 0.8s linear infinite; }
        @keyframes pf-spin { to { transform: rotate(1turn); } }
        @media (prefers-reduced-motion: reduce) { .pf-spin { animation-duration: 1.6s; } }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--pf-dim)", marginBottom: 7 }}>{label}</label>
      {children}
    </div>
  );
}
