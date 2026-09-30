# SECURITY_HEADERS Security Report

## Status: LOW (accepted) — HSTS fixed; `'unsafe-inline'` in script-src is a documented decision

## Findings

Headers come from `next.config.ts` (`headers()` on `/:path*`, added in SEC-06 / PR #60); `vercel.json` only sets content types for `.well-known` files. Live responses from https://www.sportonica.com were checked on a page, a JS chunk, images, the manifest and the service worker (GET and HEAD) — all carry the full set, so the host serves static files with the same headers.

| Header | Live value | Verdict |
|---|---|---|
| Content-Security-Policy | see below | PASS except script-src |
| Strict-Transport-Security | `max-age=63072000` | **was FAIL** (no includeSubDomains) → fixed |
| X-Frame-Options | `DENY` | PASS |
| X-Content-Type-Options | `nosniff` | PASS |
| Referrer-Policy | `strict-origin-when-cross-origin` | PASS |
| Permissions-Policy | camera/mic/payment/usb off, geolocation self | PASS |
| HTTP → HTTPS | 308 | PASS |

**CSP, directive by directive:** `default-src 'self'` ✓ · `object-src 'none'` ✓ · `base-uri 'self'` ✓ · `form-action 'self'` ✓ · `frame-ancestors 'none'` ✓ · `connect-src` self + Supabase (https/wss) + Turnstile ✓ · `frame-src` Turnstile only ✓ · `style-src` self + inline + Google Fonts + unpkg (inline styles tolerated) ✓ · `img-src 'self' data: blob: https:` — broad, but venue photos can be added by URL from any site (LOW) · **`script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com`** — `'unsafe-inline'` means an injected inline script would run.

**Why 'unsafe-inline' stays (owner's decision, 2026-09-29):** Next.js injects inline scripts on every page; the only strict alternative is a per-request nonce, which forces every page to render dynamically (Next's CSP guide) and would drop the 120 s cache on `/` and `/tournaments`. The experimental SRI/hash mode doesn't cover Next's inline scripts. XSS exposure is otherwise low (React escapes output; see XSS category).

**HSTS subdomains:** every `*.sportonica.com` (including random names) resolves to Vercel and is served over HTTPS; plain HTTP returns 308 to HTTPS; email is Google Workspace (MX `smtp.google.com`). `includeSubDomains` added; `preload` deliberately not added.

vibe-check scan (production, before the fix): 2 FAIL (script-src, HSTS), 2 WARN (img-src broad; static-file headers — no longer reproducible: GET and HEAD on chunks both return nosniff + HSTS), 16 PASS.

## What's at risk

With `'unsafe-inline'`, the CSP doesn't stop an inline script injected through an XSS bug; it still stops loading scripts from other origins, framing, plugins, `<base>` and form hijacking, and sending data to non-allowlisted hosts.

## What's already secure

Everything else in the table; headers apply to every route including static assets.

## Recommendations

1. HSTS `includeSubDomains`. **Done.**
2. Keep the policy list in `next.config.ts` current when adding third-party scripts/APIs.
3. Revisit nonces if the cached pages ever become dynamic anyway.

## Verification (2026-09-29)

Production build: `Strict-Transport-Security: max-age=63072000; includeSubDomains` on `/`, a `/_next/static` chunk and `/icons/mark.png`. Live re-scan pending deploy of `fix/security-audit`.
