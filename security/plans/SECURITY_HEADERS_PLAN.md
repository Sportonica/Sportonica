# SECURITY_HEADERS Fix Plan

## Changes

- `next.config.ts` — HSTS `max-age=63072000; includeSubDomains` (no preload).

Follow-up 2026-09-30 (branch `fix/vibe-check-strict`, on top of `fix/security-audit`; the owner asked for every scan check to pass):

- `src/lib/security/csp.ts` (new), `src/proxy.ts` — CSP with a per-request nonce instead of `'unsafe-inline'` in `script-src`.
- `src/app/layout.tsx` — every page rendered per request (`dynamic = 'force-dynamic'`); a prerendered page can't carry a nonce. `src/app/page.tsx` and `src/app/tournaments/page.tsx` keep their 2-minute cache at the data level (`unstable_cache`).
- `img-src` lists the hosts in use (Supabase Storage, Google avatars, Carto tiles a–d, unpkg) instead of any `https:` site; the venue "Paste URL" photo option is removed (all 7 live venue photos are uploads).
- `next.config.ts` — `poweredByHeader: false`. `vercel.json` — `nosniff` + HSTS on every path, for files the host serves directly.

## New files

None.

## Verification goals

- [x] All five headers present on every response, including static assets (live: page, chunk, images, manifest, sw.js; GET and HEAD)
- [x] Headers set in one global place (`next.config.ts` `/:path*`), which the host applies to static files too
- [x] CSP declares default-src, script-src, object-src 'none', base-uri, form-action, frame-ancestors
- [x] No 'unsafe-inline' in script-src — done on `fix/vibe-check-strict` with nonces (local production build: 0 CSP violations on 14 pages in headless Chrome; scanner 0 failed / 0 warnings). **Takes effect when deployed.** Cost: pages are no longer served from the edge cache.
- [x] HSTS max-age ≥ 31536000 with includeSubDomains
- [x] App works with the CSP enforced (checked in SEC-06: no violations on core pages)

## Manual verification (for the human)

- After deploying `fix/vibe-check-strict`: sign in and click through booking, a tournament's Control Center, the map on /discover and an upload — DevTools console should show no "Content Security Policy" errors. Signed-in pages and the Turnstile widget could not be exercised locally.
- Re-run the scanner against production and confirm the static-file check passes (the earlier warning came from Vercel's bot challenge answering the scanner, which could not be re-checked from here).

- After deploy: `curl -sI https://www.sportonica.com | grep -i strict-transport` shows `includeSubDomains`.
- Before ever pointing a subdomain at a non-HTTPS service, remember browsers will refuse plain HTTP there.
