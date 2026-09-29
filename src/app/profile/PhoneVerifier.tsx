"use client";

import { useState, useTransition } from "react";
import { BadgeCheck } from "lucide-react";
import { sendMyPhoneCode, confirmMyPhone } from "@/lib/phone/actions";
import { isActionError } from "@/lib/actionError";
import { isValidLocalPhone } from "@/lib/validation/identity";

// Adding or changing a phone number with an SMS code (SEC-03). Used on
// Edit profile and the /profile/verify-phone step after sign-in.

const ERRORS: Record<string, string> = {
  BAD_PHONE: "Enter a 10-digit mobile number.",
  TAKEN: "This number is already verified on another account. Contact info@sportonica.com if it's yours.",
  RATE_LIMITED: "Too many codes requested. Wait 15 minutes and try again.",
  SEND_FAILED: "Couldn't send the code. Check the number and try again.",
  WRONG_CODE: "That code isn't right. Check the SMS and try again.",
  CODE_EXPIRED: "That code has expired. Send a new one.",
  UNAUTHORIZED: "You've been signed out. Sign in again to continue.",
  UNAVAILABLE: "Phone verification isn't available right now. Please try again later.",
};

export default function PhoneVerifier({
  initialPhone,
  verified,
  onVerified,
}: {
  initialPhone: string | null;
  verified: boolean;
  onVerified?: (claimed: number) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [verifiedPhone, setVerifiedPhone] = useState(verified ? initialPhone : null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isVerified = !!phone && phone === verifiedPhone;
  const codeStep = !isVerified && sentTo === phone;

  function send() {
    setMsg(null);
    if (!isValidLocalPhone(phone)) { setMsg({ ok: false, text: ERRORS.BAD_PHONE }); return; }
    startTransition(async () => {
      const res = await sendMyPhoneCode(phone);
      if (isActionError(res)) { setMsg({ ok: false, text: ERRORS[res.message] ?? ERRORS.UNAVAILABLE }); return; }
      setSentTo(phone);
      setCode("");
      setMsg({ ok: true, text: `We texted a 6-digit code to ${phone}.` });
    });
  }

  function confirm() {
    setMsg(null);
    if (!/^\d{6}$/.test(code)) { setMsg({ ok: false, text: "Enter the 6-digit code we texted you." }); return; }
    startTransition(async () => {
      const res = await confirmMyPhone(phone, code);
      if (isActionError(res)) { setMsg({ ok: false, text: ERRORS[res.message] ?? ERRORS.UNAVAILABLE }); return; }
      setVerifiedPhone(phone);
      setSentTo(null);
      setMsg({
        ok: true,
        text: res.claimed > 0
          ? `Number verified. ${res.claimed} tournament ${res.claimed === 1 ? "entry was" : "entries were"} added to your profile.`
          : "Number verified.",
      });
      onVerified?.(res.claimed);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="pf-in" type="tel" inputMode="numeric" maxLength={10} autoComplete="tel-national"
          value={phone}
          onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setMsg(null); }}
          placeholder="98XXXXXXXX"
          style={{ flex: 1 }}
        />
        {isVerified ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "#006241", whiteSpace: "nowrap" }}>
            <BadgeCheck size={16} /> Verified
          </span>
        ) : (
          <button type="button" className="pf-btn ghost" onClick={send} disabled={pending || !isValidLocalPhone(phone)}
            style={{ whiteSpace: "nowrap" }}>
            {codeStep ? "Resend code" : "Send code"}
          </button>
        )}
      </div>

      {codeStep && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            className="pf-in" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            placeholder="6-digit code"
            aria-label="6-digit code"
            style={{ flex: 1 }}
          />
          <button type="button" className="pf-btn" onClick={confirm} disabled={pending || code.length !== 6}>
            {pending ? "Checking…" : "Verify"}
          </button>
        </div>
      )}

      {msg && (
        <div role={msg.ok ? "status" : "alert"}
          style={{ color: msg.ok ? "var(--pf-dim)" : "#ef4444", fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
          {msg.text}
        </div>
      )}
      {!isVerified && !codeStep && !msg && (
        <div style={{ color: "var(--pf-dim)", fontSize: 12, marginTop: 6 }}>
          Used for phone login and to link walk-in tournament entries to you. We&apos;ll text a code to confirm it&apos;s yours.
        </div>
      )}
    </div>
  );
}
