# CORS Fix Plan

## Changes

- `next.config.ts` — `Access-Control-Allow-Origin: <NEXT_PUBLIC_SITE_URL>` on every route (constant, not reflected, no credentials), overriding Vercel's `*` on cached pages.

## New files

None.

## Verification goals

- [x] No app route reflects the request Origin
- [x] No wildcard origin set by the app; no credentials with any origin
- [x] Allowed methods: only what Next/Vercel serve (GET/HEAD/OPTIONS on static; server actions are same-origin POST)
- [ ] After deploy: `curl -sI -H "Origin: https://evil.example" https://www.sportonica.com/tournaments` shows our origin, not `*`

## Manual verification (for the human)

- After deploy, run the curl above. If Vercel still sends `*` on cached pages, it's public content without credentials — acceptable; note it in the summary.
