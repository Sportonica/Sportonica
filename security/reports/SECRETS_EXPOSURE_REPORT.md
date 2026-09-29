# SECRETS_EXPOSURE Security Report

## Status: PASS (after fixes) — was MEDIUM

One real exposure (anonymous listing of public storage buckets) — fixed and verified live on 2026-09-29. No leaked secrets anywhere in code or git history.

## Findings

### Storage buckets are listable by anyone — MEDIUM
With only the publishable key (which every visitor has), `storage.from(bucket).list()` enumerates the contents of every **public** bucket:

| Bucket | Anonymous listing |
|---|---|
| venue-photos, avatars, tournament-banners, team-logos | yes — top level and inside folders |
| host-qr | **yes** — hosts' personal eSewa/Khalti payment QR images |
| payment-qr, tournament-qr | yes |
| payment-proofs, game-payment-proofs (private) | no (0 items) — correct |
| `listBuckets()` | 0 visible — correct |

Folder names are user IDs / venue IDs, so this is also a user-ID enumeration. Public buckets serve files by URL without any list/SELECT permission, so the listing permission is not needed by the app (`deleteAccount.ts` lists with the service role).

### `android/app/google-services.json` is committed — LOW
Tracked on `main` (subtree) and `android`. It holds the Firebase **client** API key (`AIzaSy…`, project `sportonica-3ee6e`) and no OAuth clients. Firebase client keys are designed to ship inside the app, so this is not a secret leak, but the key should be restricted in Google Cloud Console (Android app + SHA-1 restriction, and only the APIs FCM needs).

### Server-only modules are guarded by convention only — LOW
`src/lib/supabase/admin.ts`, `src/lib/security/abuse.ts`, `src/lib/phone/codes.ts`, `src/lib/phone/ownership.ts` carry a "SERVER ONLY" comment but no `import "server-only"` guard. Today every importer is a `"use server"` file or a route handler (checked). If one were imported into a client component, Next would **not** inline the service key (only `NEXT_PUBLIC_*` vars reach the browser) — it would just fail — so the risk is a broken build, not a leak.

### `.env.example` doesn't list `FIREBASE_SERVICE_ACCOUNT` — LOW (docs)
Used by `src/lib/push/fcm.ts`; missing from `.env.example`, so a new deploy could silently lack push.

## What's at risk

- Anyone can download the full list of files in public buckets, including every host's personal payment QR code (which often shows the owner's name and wallet number), and collect every user/venue ID that has uploaded something.
- Nothing in this category exposes a credential.

## What's already secure

- **No secrets in any branch or in history.** `git log --all -G` for Stripe keys, AWS keys, Supabase `sb_secret_` / service-role JWTs, Brevo keys, PEM private keys, Postgres URLs with passwords, GitHub tokens: zero commits ever. Same for `main`, `changes`, `android`, `ios` current trees.
- **`.env*` is git-ignored** (`.gitignore:34`); only `.env.example` is tracked and it contains placeholders only. `RUN_ME*.sql`, `/backups/` and `*.pem` are ignored too.
- **Public env vars are public:** `NEXT_PUBLIC_SUPABASE_ANON_KEY` is an `sb_publishable_` key; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are public by design. The service-role key, Brevo key, Turnstile secret and Firebase service account are read only in server code.
- **No hardcoded credentials.** `scripts/seed-demo-account.mjs` generates a random password.
- **Nothing sensitive is served.** On a production build: `/.env*`, `/.git/config`, `/package.json`, `/next.config.ts`, `*.sql`, `/scripts/*`, `/.next/BUILD_ID`, `google-services.json` → 404; `/backups/`, `/db/`, `/uploads/`, `/static/`, `/icons/`, `/sports/` → 404 (no directory listing). `public/` holds only images, the manifest, the service worker, a geojson and Capacitor's `index.html` loading screen.
- **No source maps** in the production build (`productionBrowserSourceMaps` not set; 0 `.map` files).
- **Live site:** `/.env`, `/.env.local`, `/.env.production`, `/.env.example`, `/.git/config`, `/.git/HEAD` → 404 on https://www.sportonica.com. Further probes were answered by **Vercel Security Checkpoint** (403 "verifying your browser") after a short burst — bot protection is active on production, so the rest were confirmed against the local production build (Vercel serves the same output).

## Recommendations

1. Remove anonymous list (SELECT) access on `storage.objects` for the public buckets; keep public URL downloads working. (MEDIUM)
2. Restrict the Firebase Android API key in Google Cloud Console. (LOW, manual)
3. Add `import "server-only"` to the four server-only modules. (LOW)
4. Document `FIREBASE_SERVICE_ACCOUNT` in `.env.example`. (LOW)

## Verification (2026-09-29)

Storage policy fix (`supabase/storage_policy_hardening.sql`, run on the live project) — same test before/after, temporary users deleted afterwards:

| Check | Before | After |
|---|---|---|
| Anonymous `list()` across the 7 public buckets | 37 items | **0** |
| Own avatar / team logo / banner / host-QR upload | ok | ok |
| Public URL of each upload | 200 | 200 |
| Upload into another user's avatar folder | ALLOWED | **blocked** |
| Delete another user's avatar | ALLOWED | **blocked** |
| Upload a venue photo for a venue you don't manage | ALLOWED | **blocked** |

The upload/delete holes are cross-referenced in ACCESS_CONTROL and FILE_UPLOADS; they were fixed here because they live in the same policy table.

Code (branch `fix/security-audit`, not yet merged):
- `import "server-only"` added to the four server-only modules; a deliberate import of `@/lib/supabase/admin` from a client component now fails `next build` ("You're importing a module that depends on server-only"). Reverted after the test.
- `.env.example` now documents `FIREBASE_SERVICE_ACCOUNT` and `PUSH_WEBHOOK_SECRET` (the only env vars the code read that weren't listed).

Live scan — vibe-check `check.py` against https://www.sportonica.com (80 read-only requests):
- PASS: no sensitive files served (20 paths: `.env*`, `.git`, dumps, keys, logs)
- PASS: no directory listing (12 common folders)
- PASS: no public source maps (15 scripts and their `.map`)

Tools: `gitleaks` and `semgrep` are not installed (`brew install gitleaks semgrep`); the git-history secret scan above was done with `git log --all -G` instead.

Still manual: restrict the Firebase Android API key (see plan).
