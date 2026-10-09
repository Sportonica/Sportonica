"use client";

import { useState } from "react";

export default function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="cp-copy" onClick={async () => {
      try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code is on screen to read out */ }
    }}>
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
