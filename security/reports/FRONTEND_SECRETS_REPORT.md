# FRONTEND_SECRETS Security Report

## Status: PASS

Nothing secret reaches the browser — checked in the source, in a local production build, and in the JavaScript production actually serves.

## Findings

- **Public env vars are public by design.** Only four `NEXT_PUBLIC_*` vars exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a Supabase `sb_publishable_` key), `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **Production build** (`next build`, 75 files in `.next/static`): no match for `sb_secret_`, `service_role`, Brevo `xkeysib-`, PEM private keys / `"private_key"`, AWS `AKIA…`, Stripe `sk_live_`/`sk_test_`, Postgres URLs, or the names of the server secrets. The **actual values** of `SUPABASE_SERVICE_ROLE_KEY` and `BREVO_API_KEY` from `.env.local` appear in **0** bundles; the publishable key and project URL appear, as expected.
- **Live site** (https://www.sportonica.com, 20 JS files referenced by `/`, `/login`, `/tournaments`): no secret patterns, no `sourceMappingURL`.
- **Source maps:** not emitted (`productionBrowserSourceMaps` unset; 0 `.map` files) and none served live (vibe-check scan: 15 scripts + `.map` checked).
- **Browser → third parties:** no client component calls an external API with credentials. The browser talks to Supabase (publishable key + the user's own session) and Cloudflare Turnstile (public site key); fonts and map tiles are plain public assets. Secret-bearing calls — Brevo email, Firebase Cloud Messaging, Turnstile siteverify, Supabase admin — run only in server code.
- `public/sw.js`, `public/manifest.webmanifest`: no keys or tokens.

## What's at risk

Nothing identified.

## What's already secure

Everything above; plus, since SECRETS_EXPOSURE, the four modules that hold server secrets import `server-only`, so importing one from a client component fails the build (tested).

## Recommendations

- Keep new secrets server-only and never prefixed `NEXT_PUBLIC_`; keep `productionBrowserSourceMaps` off.
- If Supabase session cookies ever need to be unreadable by JS, that's a larger change (server-only auth) — the CSP from SEC-06 is the current mitigation.

## Verification (2026-09-29)

All checks above were run on 2026-09-29; no fixes were needed in this category.
