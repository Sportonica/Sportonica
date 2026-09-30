# RATE_LIMITING Fix Plan

## Changes

- `src/lib/mail/contactActions.ts` — CAPTCHA (`captchaPassed`), `underRateLimit("contact-ip", …, 5, 1h)`, length caps (name 100, email 200, subject 150, message 5000).
- `src/app/(legal)/contact/page.tsx` — Turnstile token via `useCaptcha()`, `maxLength` on inputs.
- `src/lib/security/abuse.ts` — `clientIp()` prefers `x-vercel-forwarded-for` / `x-real-ip`.

## New files

None.

## Verification goals

- [x] Login, registration and password reset are rate limited (Supabase; our limiter for phone flows)
- [x] Limit triggers after N attempts (Supabase: 429 at ~39/IP; contact form: 6th/h refused)
- [x] Limiter keys on a non-spoofable client IP (Vercel-set headers)
- [~] Rate-limited requests return 429 — Supabase yes; server actions return a RATE_LIMITED result (framework limitation)
- [ ] Supabase CAPTCHA enabled (owner: finish Turnstile rollout)

## Manual verification (for the human)

- Finish Turnstile: create the widget, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` in Vercel, redeploy, then Supabase → Auth → Attack Protection → CAPTCHA (Turnstile, same secret).
- Send one real message through /contact after deploy and confirm it arrives.
