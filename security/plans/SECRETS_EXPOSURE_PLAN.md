# SECRETS_EXPOSURE Fix Plan

## Changes

- `supabase/storage_policy_hardening.sql` (new, `changes` branch) — drop/replace the `storage.objects` SELECT policies that let `anon`/`public` list the public buckets (venue-photos, avatars, tournament-banners, team-logos, host-qr, payment-qr, tournament-qr). Public-URL downloads don't use RLS, so they keep working. Exact statements depend on the live policy names (read first with the query in *Manual verification*).
- `src/lib/supabase/admin.ts`, `src/lib/security/abuse.ts`, `src/lib/phone/codes.ts`, `src/lib/phone/ownership.ts` — add `import "server-only"` so importing them from client code fails the build.
- `package.json` / `package-lock.json` — add the `server-only` package (published by the React team, used by Next's docs).
- `.env.example` — document `FIREBASE_SERVICE_ACCOUNT` with a placeholder.

## New files

- `supabase/storage_policy_hardening.sql` (on `changes`).

## Verification goals

- [x] `git ls-files .env*` returns only `.env.example`
- [x] Secret-pattern scan of all branches and full history returns nothing
- [x] No `NEXT_PUBLIC_*` var holds a secret (publishable key, URLs, Turnstile site key only)
- [x] `.env.example` has placeholders only and lists every env var the code reads
- [x] `/.env`, `/.git/config`, `*.sql`, `/backups/` return 404 on the production build; no directory listing
- [x] Anonymous `storage.from(<public bucket>).list()` returns 0 items for every bucket
- [x] A public image URL from each public bucket still loads (200) anonymously
- [x] The app's own uploads (avatar, team logo) still work after the policy change
- [x] Importing a server-only module into a client component fails `next build`

## Manual verification (for the human)

- ~~Share the storage policy list and run `storage_policy_hardening.sql`~~ — done 2026-09-29.
- Google Cloud Console → APIs & Services → Credentials → the `AIzaSy…` key for project `sportonica-3ee6e`: restrict to Android apps (package `com.sportonica.app` + release SHA-1) and to the Firebase APIs FCM uses.
- Confirm `FIREBASE_SERVICE_ACCOUNT` is set in Vercel if push notifications are live.
