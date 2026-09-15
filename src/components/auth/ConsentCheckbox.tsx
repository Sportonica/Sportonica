"use client";

import Link from "next/link";

export default function ConsentCheckbox({
  checked, onChange, error,
}: { checked: boolean; onChange: (v: boolean) => void; error?: boolean }) {
  return (
    <label className={`auth-consent ${error ? "err" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="auth-consent-box" aria-hidden />
      <span className="auth-consent-text">
        By signing up you agree to our{" "}
        <Link href="/terms" target="_blank" rel="noopener noreferrer">Terms and conditions</Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</Link>.
      </span>
    </label>
  );
}
