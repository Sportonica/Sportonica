# RATE_LIMITING Security Report

## Status: PASS (after fix) — was MEDIUM

## Findings

| Endpoint | Limit | Where |
|---|---|---|
| Email login (`/auth/v1/token`) | Supabase per-IP limit — **tested live: 429 `over_request_rate_limit` on the 39th wrong password** | Supabase (browser calls it directly) |
| Email signup, forgot password, resend | Supabase per-IP / email-sending limits | Supabase |
| Phone login (`signInWithPhone`) | 20 / IP / 15 min, 10 / phone / 15 min + CAPTCHA | our limiter (SEC-04) |
| Phone signup (`signUpWithPhone`) | 5 / IP / h, 6 / phone / h + CAPTCHA (+ SMS code once SMS is on) | our limiter |
| Current-password check (`changePassword`) | 10 / user / 15 min | our limiter |
| SMS codes (`sendMyPhoneCode`, signup) | 3 / phone / 15 min, 5 / user / h, 10 / IP / h; 5 attempts per code | our limiter (SEC-03) |
| **Contact form (`submitContactForm`)** | **none — was MEDIUM** → now 5 / IP / h + CAPTCHA + length caps | fixed |

**Contact form (fixed):** an unauthenticated server action that emails `info@sportonica.com` via Brevo with no limit, no CAPTCHA and no length cap. A script could flood the inbox and, more importantly, exhaust the **shared Brevo sending quota** that booking confirmations and password resets depend on.

**Supabase CAPTCHA:** the live 400 responses were "invalid credentials", not CAPTCHA errors — Supabase's CAPTCHA setting is **not enabled yet** (last step of the SEC-04 rollout: Turnstile keys in Vercel, then Attack Protection → CAPTCHA in Supabase).

**IP spoofing:** our limiter keys on `clientIp()`. Vercel overwrites `X-Forwarded-For`, so it wasn't spoofable in production; it now prefers the Vercel-only `x-vercel-forwarded-for` / `x-real-ip` and keeps XFF only as a fallback. Supabase uses its own view of the client IP.

**Response codes:** Supabase returns 429. Our server actions return a friendly `RATE_LIMITED` message in the action result (server actions always answer 200 with a payload), not an HTTP 429.

## What's at risk

Before the fix: email quota exhaustion via the contact form (breaking password resets and confirmations) and inbox flooding.

## What's already secure

Every auth path is limited, either by Supabase or by our DB-backed limiter; SMS/code flows are limited per phone, user and IP.

## Recommendations

1. Contact form: CAPTCHA + 5/IP/h + length caps. **Done.**
2. Finish the Turnstile rollout (keys in Vercel, then Supabase CAPTCHA) — adds CAPTCHA to email login/signup/reset.
3. Optionally tighten Supabase's auth rate limits in the dashboard (Auth → Rate Limits).

## Verification (2026-09-29)

- Live: 40 wrong-password logins from one IP → 429 from attempt 39.
- Contact form on a production build (Turnstile test keys, Brevo disabled so nothing was emailed): submissions 1–5 sent, **6–7 refused** ("wait an hour"); server logged exactly 5 messages. Test counters removed afterwards.
