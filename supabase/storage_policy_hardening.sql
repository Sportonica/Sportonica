-- ================================================================
-- Storage policy hardening (security audit, 2026-09-29)
--
-- Live policies on storage.objects (read 2026-09-29) had three problems:
--
--  1. LISTING (SECRETS_EXPOSURE): seven SELECT policies of the form
--     `bucket_id = '<bucket>'` for role public let anyone with the
--     publishable key call storage.list() and enumerate every file in
--     venue-photos, avatars, tournament-banners, team-logos, host-qr
--     (hosts' personal payment QRs), payment-qr and tournament-qr —
--     plus every user/venue id, since those are the folder names.
--     Public buckets serve /object/public/... WITHOUT consulting RLS, so
--     image URLs keep working with these gone.
--
--  2. DELETE ANYONE'S FILES (ACCESS_CONTROL): "avatars auth delete" and
--     "venue photos auth delete" allowed ANY authenticated user —
--     including the anonymous session the tournament Register tab
--     creates — to delete any avatar or any venue's photos. The app
--     never deletes these with a user session (account deletion uses the
--     service role; removeVenuePhoto only edits venues.photos), so they
--     are dropped, not narrowed.
--
--  3. UPLOAD INTO ANYONE'S FOLDER (FILE_UPLOADS): "avatars auth upload"
--     and "venue photos auth upload" only checked the bucket. Now an
--     avatar must go in your own <uid>/ folder (as uploadAvatar() does)
--     and a venue photo in a <venue_id>/ folder of a venue you can
--     manage (as uploadVenuePhoto() checks with has_venue_access).
--
-- Private buckets (payment-proofs, game-payment-proofs) and the other
-- owner-scoped INSERT policies are unchanged.
-- Safe to re-run. Rollback at the bottom.
-- ================================================================

-- ── 1. no anonymous listing of public buckets ───────────────────
drop policy if exists "avatars public read"        on storage.objects;
drop policy if exists "venue photos public read"   on storage.objects;
drop policy if exists "host_qr_read"               on storage.objects;
drop policy if exists "qr_read"                    on storage.objects;
drop policy if exists "team_logos_read"            on storage.objects;
drop policy if exists "tournament_banner_read"     on storage.objects;
drop policy if exists "tournament_qr_read"         on storage.objects;

-- ── 2. no deleting other people's files ─────────────────────────
drop policy if exists "avatars auth delete"        on storage.objects;
drop policy if exists "venue photos auth delete"   on storage.objects;

-- ── 3. uploads only into your own folder / your venue's folder ──
drop policy if exists "avatars auth upload"        on storage.objects;
create policy "avatars owner upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists "venue photos auth upload"   on storage.objects;
create policy "venue photos manager upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'venue-photos'
    and case
      when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.has_venue_access(((storage.foldername(name))[1])::uuid, 'manager')
      else false
    end
  );

-- ── Verify (run after) ──────────────────────────────────────────
-- select policyname, cmd from pg_policies
--  where schemaname = 'storage' and tablename = 'objects' order by cmd, policyname;
-- Expect: no SELECT policy whose qual is only `bucket_id = '<public bucket>'`;
-- no DELETE policy on avatars / venue-photos; "avatars owner upload" and
-- "venue photos manager upload" present.

-- ── Rollback (only if something breaks) ─────────────────────────
-- create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');
-- create policy "venue photos public read" on storage.objects for select using (bucket_id = 'venue-photos');
-- create policy "host_qr_read" on storage.objects for select using (bucket_id = 'host-qr');
-- create policy "qr_read" on storage.objects for select using (bucket_id = 'payment-qr');
-- create policy "team_logos_read" on storage.objects for select using (bucket_id = 'team-logos');
-- create policy "tournament_banner_read" on storage.objects for select using (bucket_id = 'tournament-banners');
-- create policy "tournament_qr_read" on storage.objects for select using (bucket_id = 'tournament-qr');
-- (The delete and open-upload policies should NOT be restored.)
