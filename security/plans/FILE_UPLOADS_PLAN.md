# FILE_UPLOADS Fix Plan

## Changes

- `supabase/storage_upload_limits.sql` — `allowed_mime_types` (jpeg/png/webp/gif) and `file_size_limit` 5 MB on all nine buckets. **Run 2026-09-30.**
- `src/lib/security/imageBytes.ts` (new) — `sniffImageType`, `isRealImage`, `IMAGE_EXT`.
- `src/lib/profile/actions.ts`, `src/lib/payments/actions.ts`, `src/lib/payments/adminActions.ts`, `src/lib/playTogether/actions.ts` (2), `src/lib/tournaments/actions.ts` (3) — magic-byte check after the size check.
- `src/lib/admin/actions.ts` — venue photo: 5 MB limit, magic-byte type, extension and content type from the detected type.

## New files

- `src/lib/security/imageBytes.ts`, `supabase/storage_upload_limits.sql`

## Verification goals

- [x] File type validated by magic bytes, not extension or declared type
- [x] Files named server-side (id folder + timestamp + detected extension)
- [x] Stored on a separate domain (Supabase Storage)
- [x] Size limits enforced server-side and at the bucket (covers direct API uploads)
- [x] Legit uploads still work (avatar end-to-end)

## Manual verification (for the human)

- After deploy: upload a venue photo, a team logo and a payment screenshot once each.
