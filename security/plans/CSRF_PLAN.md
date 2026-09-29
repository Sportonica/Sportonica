# CSRF Fix Plan

## Changes

- `src/lib/supabase/cookieOptions.ts` (new) — `{ secure: NODE_ENV === "production", sameSite: "lax" }`.
- `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts` — pass it as `cookieOptions`.

## New files

- `src/lib/supabase/cookieOptions.ts`

## Verification goals

- [x] Session cookies have SameSite=Lax
- [x] State-changing endpoints reject cross-origin requests (server actions: origin check; API: header auth)
- [x] No GET route changes state (beyond an idempotent expiry sweep)
- [x] Every auth cookie has Secure and SameSite (HttpOnly impossible by design — documented)
- [x] A cross-origin POST to a state-changing endpoint fails

## Manual verification (for the human)

- After deploy: DevTools → Application → Cookies on www.sportonica.com — `sb-…-auth-token` shows Secure ✓ and SameSite Lax.
