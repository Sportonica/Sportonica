"use client";

import { useCallback, useEffect, useRef } from "react";

// Cloudflare Turnstile, run invisibly (SEC-04). Supabase's CAPTCHA setting
// makes every sign-in, signup, anonymous sign-in, reset and resend carry a
// token, and each token works once — so callers ask for a fresh one right
// before each auth call. Real visitors almost never see a challenge; if
// Cloudflare wants one, it appears where the caller renders `captchaRef`.
//
// With no site key configured, getToken() resolves undefined and auth
// calls go out without a token, which is what Supabase expects while its
// CAPTCHA setting is off.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TOKEN_TIMEOUT_MS = 30_000;

type Turnstile = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window { turnstile?: Turnstile }
}

let scriptPromise: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => { scriptPromise = null; reject(new Error("turnstile failed to load")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export class CaptchaError extends Error {}

// `warm` = load the widget on mount; pass false where a token may never
// be needed, and it loads on the first getToken() instead.
export function useCaptcha(warm = true) {
  const captchaRef = useRef<HTMLDivElement>(null);
  const widget = useRef<Promise<{ id: string; host: HTMLElement }> | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  const settle = (token: string | null) => {
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    if (token) p.resolve(token);
    else p.reject(new CaptchaError("captcha failed"));
  };

  const ensureWidget = useCallback((): Promise<string> => {
    widget.current ??= loadTurnstile().then((ts) => {
      if (!captchaRef.current) throw new CaptchaError("captcha container missing");
      // A fresh host per widget: Turnstile refuses a second render into
      // the same element, which a remount (or React's dev double-mount)
      // would otherwise hit before the old widget's removal lands.
      const host = document.createElement("div");
      captchaRef.current.appendChild(host);
      const id = ts.render(host, {
        sitekey: SITE_KEY,
        execution: "execute",
        appearance: "interaction-only",
        callback: (t: string) => settle(t),
        "error-callback": () => settle(null),
        "expired-callback": () => settle(null),
        "timeout-callback": () => settle(null),
      });
      if (!id) { host.remove(); throw new CaptchaError("captcha render failed"); }
      return { id, host };
    });
    const w = widget.current;
    w.catch(() => { if (widget.current === w) widget.current = null; });
    return w.then((x) => x.id);
  }, []);

  // Warm up on mount so the first token doesn't wait on the script.
  useEffect(() => {
    if (!SITE_KEY || !warm) return;
    ensureWidget().catch(() => { /* retried on first getToken() */ });
  }, [ensureWidget, warm]);

  useEffect(() => () => {
    const w = widget.current;
    widget.current = null;
    w?.then(({ id, host }) => { window.turnstile?.remove(id); host.remove(); }).catch(() => {});
  }, []);

  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!SITE_KEY) return undefined;
    let id: string;
    try {
      id = await ensureWidget();
    } catch {
      throw new CaptchaError("captcha unavailable");
    }
    settle(null);   // a request still waiting is superseded
    return new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => settle(null), TOKEN_TIMEOUT_MS);
      pending.current = {
        resolve: (tok) => { clearTimeout(t); resolve(tok); },
        reject: (e) => { clearTimeout(t); reject(e); },
      };
      window.turnstile!.reset(id);
      window.turnstile!.execute(id);
    });
  }, [ensureWidget]);

  return { captchaRef, getToken };
}

export const CAPTCHA_FAILED = "Couldn't confirm you're not a bot. Refresh the page and try again.";
