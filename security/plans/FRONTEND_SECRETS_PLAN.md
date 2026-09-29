# FRONTEND_SECRETS Fix Plan

## Changes

None needed. (The `server-only` guard on secret-holding modules was added under SECRETS_EXPOSURE.)

## New files

None.

## Verification goals

- [x] No secret keys in any frontend file (source, production build, live bundles)
- [x] Sensitive API calls go through server code (email, push, CAPTCHA verification, Supabase admin)
- [x] Only publishable/public keys are in client-side code
- [x] No `NEXT_PUBLIC_*` var holds a secret
- [x] Production does not serve `.js.map` files

## Manual verification (for the human)

- None required. Optionally: DevTools → Sources on the live site, search for `service_role`, `sb_secret`, `private_key` — should find nothing.
