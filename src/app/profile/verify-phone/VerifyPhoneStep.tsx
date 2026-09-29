"use client";

import { useState } from "react";
import PhoneVerifier from "../PhoneVerifier";

export default function VerifyPhoneStep({ phone, next }: { phone: string | null; next: string }) {
  const [done, setDone] = useState(false);

  return (
    <div className="pf-card">
      <p style={{ fontSize: 13.5, color: "var(--pf-dim)", marginTop: 0, marginBottom: 16, lineHeight: 1.55 }}>
        You sign in with your phone number, so we need to check it&apos;s yours. We&apos;ll text you a
        6-digit code. Until it&apos;s confirmed, walk-in tournament entries under your number can&apos;t
        be added to your profile.
      </p>
      <PhoneVerifier initialPhone={phone} verified={false} onVerified={() => setDone(true)} />
      {done && (
        <div style={{ marginTop: 16 }}>
          {/* Full load so the header picks up anything newly claimed. */}
          <a className="pf-btn" href={next}>Continue</a>
        </div>
      )}
    </div>
  );
}
