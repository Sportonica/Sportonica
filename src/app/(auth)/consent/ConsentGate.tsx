"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthCard from "@/components/auth/AuthCard";
import ConsentCheckbox from "@/components/auth/ConsentCheckbox";
import SubmitButton from "@/components/auth/SubmitButton";
import { createClient } from "@/lib/supabase/client";
import { recordConsent } from "@/lib/auth/consentActions";
import { forgetPushToken } from "@/lib/push/client";
import { isActionError } from "@/lib/actionError";
import { SIGNUP_CONSENT_COOKIE } from "@/lib/auth/consent";

type Mode = "recorded" | "signup" | "ask";

export default function ConsentGate({ next, mode }: { next: string; mode: Mode }) {
  const sb = createClient();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [consentErr, setConsentErr] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode !== "ask");
  const started = useRef(false);

  // The proxy reads the record from the access token, so get a new one
  // before leaving, or it would send us straight back here.
  const proceed = useCallback(async () => {
    document.cookie = `${SIGNUP_CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    await sb.auth.refreshSession();
    router.replace(next);
    router.refresh();
  }, [sb, router, next]);

  const persist = useCallback(async (source: "signup" | "prompt") => {
    const res = await recordConsent(source);
    if (isActionError(res)) { setErr(res.message); setLoading(false); return; }
    await proceed();
  }, [proceed]);

  function save(source: "signup" | "prompt") {
    setLoading(true); setErr(null);
    persist(source);
  }

  useEffect(() => {
    if (started.current || mode === "ask") return;
    started.current = true;
    if (mode === "recorded") { proceed(); return; }
    recordConsent("signup").then((res) => {
      if (isActionError(res)) { setErr(res.message); setLoading(false); return; }
      return proceed();
    });
  }, [mode, proceed]);

  function submit() {
    if (!agreed) {
      setConsentErr(true);
      setErr("Please confirm you're 18 or older and agree to the Terms and conditions and Privacy policy to continue.");
      return;
    }
    save("prompt");
  }

  async function signOut() {
    await forgetPushToken();
    await sb.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="auth">
      <div className="auth-stage">
        <Link href="/" className="auth-brand" aria-label="Sportonica, go to the home page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/mark.png" alt="" className="auth-brand-mark" />
          <div className="auth-brand-name">Sportonica</div>
        </Link>
        <div className="auth-tagline">
          <h2>One quick <em>thing.</em></h2>
          <p>Sportonica is for players aged 18 and over. We&apos;ve also updated our Terms and Privacy policy.</p>
        </div>
        <div className="auth-foot">NEPAL · SINCE 2026</div>
      </div>

      <div className="auth-form-wrap">
        <AuthCard>
          {mode === "ask" ? (
            <>
              <h1>Before you continue</h1>
              <p className="sub">
                Please confirm your age and that you agree to how Sportonica works. You only need to do this once.
              </p>

              <ConsentCheckbox
                checked={agreed}
                error={consentErr}
                onChange={(v) => { setAgreed(v); if (v) { setConsentErr(false); setErr(null); } }}
              />

              {err && <div className="auth-error">{err}</div>}

              <SubmitButton loading={loading} onClick={submit}>Continue</SubmitButton>

              <div className="auth-alt">
                Not for you? <button type="button" className="auth-link-btn" onClick={signOut}>Sign out</button>
                {" · "}
                <Link href="/account-deletion">Delete my account</Link>
              </div>
            </>
          ) : (
            <>
              <h1>One moment…</h1>
              <p className="sub">Getting your account ready.</p>
              {err && (
                <>
                  <div className="auth-error">{err}</div>
                  <SubmitButton loading={loading} onClick={() => save("signup")}>Try again</SubmitButton>
                </>
              )}
            </>
          )}
        </AuthCard>
      </div>
    </div>
  );
}
