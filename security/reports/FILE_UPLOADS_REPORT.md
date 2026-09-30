# FILE_UPLOADS Security Report

## Status: PASS (after fixes) — was MEDIUM

## Findings

Nine upload paths, all into Supabase Storage: avatars, venue photos, team logos, tournament banners, tournament QR, host QR, platform payment QR, payment proofs, game payment proofs.

| Check | Before | After |
|---|---|---|
| Separate domain | ✅ `*.supabase.co`, not our origin | ✅ |
| Server-generated names | ✅ `<uid or venue id>/<timestamp>.<ext>` — except venue photos took the **extension from the uploader's file name** | ✅ extension from detected type everywhere |
| Type validation | ⚠️ browser-reported `file.type` only (spoofable); **venue photos: none** | ✅ magic-byte check (`src/lib/security/imageBytes.ts`) must match an allowed type and the declared type |
| Size limit (server) | ✅ 5 MB in the actions (body limit 6 MB); **venue photos: none** | ✅ 5 MB everywhere |
| Bucket limits (applies to direct API uploads) | ❌ **no allowed types, no size limit on all 9 buckets** | ✅ JPEG/PNG/WebP/GIF, 5 MB |

**Direct storage API bypass (MEDIUM, fixed):** the storage INSERT policies let any session — including the anonymous one the Register tab creates — upload into its own folder, skipping the app's checks entirely. **Proven:** an anonymous session uploaded an `.html` file and a 12 MB file to the public `team-logos` bucket. Supabase already served the HTML as `text/plain` with `CSP: default-src 'none'; sandbox` (so no phishing page), but any file type/size could be hosted with a public link, and one person could fill the project's storage quota.

Also in place from earlier categories: upload into another user's folder and deleting others' files are blocked (SECRETS_EXPOSURE); images are shrunk client-side before upload (#61).

## What's at risk

Before: free public hosting of arbitrary files on our Supabase project, storage-quota exhaustion, and fake "images" reaching the app.

## What's already secure

Separate storage domain, private buckets for payment proofs, server-generated names, owner-folder upload policies.

## Recommendations

1. Bucket allowed types + 5 MB limit. **Done** (`supabase/storage_upload_limits.sql`).
2. Magic-byte validation in every upload action; venue photos get type/size checks and a type-derived extension. **Done.**

## Verification (2026-09-30)

| Test | Result |
|---|---|
| Anonymous session uploads `text/html` via storage API | blocked (`mime type text/html is not supported`) |
| … 12 MB file declared `image/png` | blocked (`exceeded the maximum allowed size`) |
| … SVG (`image/svg+xml`) | blocked |
| … real PNG | allowed |
| Magic bytes: real JPEG/PNG/WebP/GIF | recognised; HTML renamed `.jpg` → rejected |
| App (production build): HTML disguised as `.png` as avatar | "That file isn't a real JPG, PNG or WebP image.", 0 files stored |
| App: real 4.4 MB photo as avatar | stored as 46 KB `image/webp` |
