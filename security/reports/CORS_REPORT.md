# CORS Security Report

## Status: PASS (with one host default overridden; confirm after deploy)

## Findings

- **App code** sets no CORS headers anywhere (`src`, `next.config.ts`, `vercel.json`) — Next.js doesn't add any, so dynamic routes are same-origin only.
- **Live responses** to `Origin: https://evil.example` (2026-09-29):

| Request | Access-Control-* returned |
|---|---|
| `GET /` | none |
| `GET/OPTIONS /api/push` | none |
| `GET /p/<user>/opengraph-image` | none |
| `GET /tournaments` (prerendered, served from Vercel's cache) | `Access-Control-Allow-Origin: *` |
| `OPTIONS /` | `Access-Control-Allow-Origin: *`, `Allow-Methods: OPTIONS, GET, HEAD` |

  The `*` comes from **Vercel's default** for cached/static responses, not the app. It never comes with `Access-Control-Allow-Credentials`, so browsers don't attach cookies; the content is public. WARN-level per the checklist ("a host default nobody chose").
- **Supabase API** (`*.supabase.co`) reflects any Origin but sends no `Allow-Credentials` and authenticates with headers (apikey / Bearer), not cookies — a foreign page can only read what its own key permits, same as calling the API directly. Managed by Supabase; not configurable; PASS.
- No origin is reflected by our app; no `null` origin allowed; no wildcard + credentials anywhere.

## What's at risk

Nothing material: only public, uncredentialed content was readable cross-origin.

## What's already secure

No app-level CORS, so every dynamic/authenticated route is same-origin; Supabase auth never rides on cookies cross-origin.

## Recommendations

1. Replace the host's `*` with our own origin (`Access-Control-Allow-Origin: <NEXT_PUBLIC_SITE_URL>`, constant, no credentials) on every response. **Done** in `next.config.ts`; confirm on production after deploy that Vercel's cached pages no longer send `*`.

## Verification (2026-09-29)

Production build locally: `/`, `/tournaments`, `/api/push` return `Access-Control-Allow-Origin: <site origin>` for a foreign Origin — no `*`, no reflection, no credentials. **Pending:** re-check `/tournaments` on www.sportonica.com after deploy.
