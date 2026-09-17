"use client";

import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { createClient } from "@/lib/supabase/client";
import { safeRedirect } from "@/lib/validation/redirect";

// Apple's own glyph — required by their Human Interface Guidelines
// whenever a button says "Sign in with Apple".
function AppleMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size * (1.23)} viewBox="0 0 814 1000" aria-hidden fill="#ffffff">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-163.9-39.5c-76.4 0-103.5 40.8-165.9 40.8s-105.8-57-155.5-127.9C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 76.1-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 2.6.6 6.8 1.3 11 1.3 45.4 0 102.5-30.4 138.1-71.6z"/>
    </svg>
  );
}

export default function AppleButton({
  next = "/discover",
  label = "Continue with Apple",
  guard,
}: { next?: string; label?: string; guard?: () => boolean }) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn() {
    if (guard && !guard()) return;
    const safeNext = safeRedirect(next);
    setPending(true); setErr(null);
    // Same sessionStorage fallback GoogleButton.tsx relies on — the
    // ?next= query param doesn't reliably survive the full
    // Apple → Supabase → app round trip either.
    try {
      if (safeNext && safeNext !== "/discover") sessionStorage.setItem("post-login-redirect", safeNext);
    } catch { /* private mode / storage disabled — falls back to /discover, not fatal */ }
    const sb = createClient();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    });
    if (error) { setErr(error.message); setPending(false); return; }
    if (!data?.url) return;
    // Same reasoning as GoogleButton.tsx: Apple's OAuth page can't be
    // driven from inside the app's own embedded WebView, so this opens
    // in the system browser on native and CapacitorBridge.tsx catches
    // the app reopening via the Universal/App Link once it's done.
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: data.url });
    } else {
      window.location.href = data.url;
    }
  }

  return (
    <>
      <button type="button" className="ap-btn" onClick={signIn} disabled={pending}>
        <AppleMark />
        {pending ? "Opening Apple…" : label}
      </button>
      {err && <p className="ap-err">{err}</p>}

      <style>{`
        .ap-btn {
          width: 100%; display: inline-flex; align-items: center; justify-content: center;
          gap: 10px; padding: 13px 18px; border-radius: 13px; cursor: pointer;
          background: #000000; color: #ffffff; border: 1px solid rgba(255,255,255,0.12);
          font-family: inherit; font-size: 14.5px; font-weight: 600;
          box-shadow: 0 6px 20px -10px rgba(0,0,0,0.5);
          transition: transform .2s cubic-bezier(.22,1,.36,1), box-shadow .2s;
        }
        .ap-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 30px -10px rgba(0,0,0,.55); }
        .ap-btn:disabled { opacity: .65; cursor: default; }
        .ap-err { color: #ef4444; font-size: 12.5px; margin: 8px 0 0; }
      `}</style>
    </>
  );
}
