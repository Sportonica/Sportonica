-- Upload limits on every storage bucket (security audit - FILE_UPLOADS,
-- 2026-09-30). The buckets had no allowed types and no size limit, so any
-- signed-in session (even an anonymous one) could use the storage API
-- directly - skipping the app's checks - to upload any file of any size
-- into its own folder and get a public link (verified: an .html file and a
-- 12 MB file both went into team-logos). Supabase enforces these limits on
-- every upload, including direct API calls. Existing files are untouched.
-- Safe to re-run.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
       file_size_limit = 5242880
 where id in ('venue-photos', 'avatars', 'payment-qr', 'payment-proofs', 'host-qr',
              'game-payment-proofs', 'tournament-banners', 'tournament-qr', 'team-logos');

select id, allowed_mime_types, file_size_limit from storage.buckets order by id;
