"use client";

import { useState, useTransition } from "react";
import { Printer, Mail, Check } from "lucide-react";
import { isActionError } from "@/lib/actionError";
import { emailMyReceipt } from "@/lib/payments/actions";

// Only ever rendered for a court-booking row, which page.tsx always
// renders as a plain div, never a Link — so there's no parent navigation
// to guard against here (a wrapping stopPropagation would just cancel
// the print link's own click before the browser could follow it).
export default function ReceiptActions({ bookingId }: { bookingId: string }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  function email() {
    if (pending || sent) return;
    setFailed(false);
    startTransition(async () => {
      const res = await emailMyReceipt(bookingId);
      if (isActionError(res)) setFailed(true);
      else setSent(true);
    });
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 4 }}>
      <a
        href={`/profile/payments/${bookingId}/receipt`}
        target="_blank"
        rel="noopener noreferrer"
        title="Print or save as PDF"
        aria-label="Print or save receipt as PDF"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 8, color: "var(--pf-faint)",
          background: "rgba(128,128,128,0.12)",
        }}
      >
        <Printer size={14} />
      </a>
      <button
        type="button"
        onClick={email}
        disabled={pending}
        title={failed ? "Couldn't send. Tap to retry." : sent ? "Sent" : "Email me a copy"}
        aria-label={sent ? "Receipt emailed" : "Email me a copy of this receipt"}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 8, border: "none",
          cursor: pending ? "default" : "pointer",
          color: failed ? "#c0392b" : sent ? "#006241" : "var(--pf-faint)",
          background: "rgba(128,128,128,0.12)",
        }}
      >
        {sent ? <Check size={14} /> : <Mail size={14} />}
      </button>
    </div>
  );
}
