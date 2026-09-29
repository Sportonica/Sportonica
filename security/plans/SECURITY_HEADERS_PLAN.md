# SECURITY_HEADERS Fix Plan

## Changes

- `next.config.ts` — HSTS `max-age=63072000; includeSubDomains` (no preload).

## New files

None.

## Verification goals

- [x] All five headers present on every response, including static assets (live: page, chunk, images, manifest, sw.js; GET and HEAD)
- [x] Headers set in one global place (`next.config.ts` `/:path*`), which the host applies to static files too
- [x] CSP declares default-src, script-src, object-src 'none', base-uri, form-action, frame-ancestors
- [ ] No 'unsafe-inline' in script-src — **accepted by the owner** (nonces would disable page caching)
- [x] HSTS max-age ≥ 31536000 with includeSubDomains
- [x] App works with the CSP enforced (checked in SEC-06: no violations on core pages)

## Manual verification (for the human)

- After deploy: `curl -sI https://www.sportonica.com | grep -i strict-transport` shows `includeSubDomains`.
- Before ever pointing a subdomain at a non-HTTPS service, remember browsers will refuse plain HTTP there.
