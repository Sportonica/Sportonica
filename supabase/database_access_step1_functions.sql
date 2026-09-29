-- ================================================================
-- Database access hardening (security audit — DATABASE_ACCESS,
-- 2026-09-29). Pairs with branch fix/security-audit on main: STEP 1 of 2 —
-- safe to run now: adds the three lookup functions and drops the open
-- notifications insert policy. STEP 2 (database_access_step2_hide_columns.sql)
-- hides the columns and must wait until fix/security-audit is deployed,
-- because the current production code still selects those tables with "*".
--
--  1. notifications: drop the `with check (true)` insert policy. Any
--     signed-in user — including the anonymous session the tournament
--     Register tab creates — could put any title/body into anyone's bell,
--     and push_on_notification() turns that into a phone push. The app
--     now writes notifications with the service role after its own
--     checks (src/lib/mail/notify.ts, src/lib/play/hostActions.ts).
--     (The emit_notification() RPC notify.ts used to call was never
--     created, so those writes were silently failing anyway.)
--
--  2. tournament_teams: hide the contact details the site never shows
--     publicly — club_address, contact_person_name, contact_phone,
--     contact_email, manager_email — from anon/authenticated. Organizers,
--     venue managers, super admins and the team itself read them through
--     team_private_contacts(). manager/coach name + phone stay public
--     (shown on the public Teams tab by choice).
--
--  3. games: hide host_phone and host_qr_path; game_host_payment_info()
--     returns them to the host, super admins, and players who have joined
--     (the same statuses the page already used).
--
--  4. profiles: hide bio and city; profile_about() returns them for public
--     profiles, the owner and super admins. Name/avatar/username/sports
--     stay readable so rosters, friends and cards still work.
--
-- Safe to re-run. Rollback notes at the bottom.
-- ================================================================

-- ── 1. notifications: no user-session inserts ───────────────────
drop policy if exists "notifications insert" on public.notifications;

-- ── 2. tournament_teams ─────────────────────────────────────────

create or replace function public.team_private_contacts(p_team_ids uuid[])
returns table (id uuid, club_address text, contact_person_name text,
               contact_phone text, contact_email text, manager_email text)
language sql stable security definer set search_path = public as $$
  select tt.id, tt.club_address, tt.contact_person_name,
         tt.contact_phone, tt.contact_email, tt.manager_email
    from public.tournament_teams tt
    join public.tournaments t on t.id = tt.tournament_id
   where tt.id = any (p_team_ids)
     and auth.uid() is not null
     and (
       tt.captain_id = auth.uid()
       or tt.created_by = auth.uid()
       or t.owner_id = auth.uid()
       or public.is_super_admin()
       or public.is_tournament_organizer(t)
       or (t.venue_id is not null and public.has_venue_access(t.venue_id, 'manager'))
     );
$$;
revoke all on function public.team_private_contacts(uuid[]) from public, anon;
grant execute on function public.team_private_contacts(uuid[]) to authenticated;

-- ── 3. games ────────────────────────────────────────────────────

create or replace function public.game_host_payment_info(p_game_id uuid)
returns table (host_phone text, host_qr_path text)
language sql stable security definer set search_path = public as $$
  select g.host_phone, g.host_qr_path
    from public.games g
   where g.id = p_game_id
     and auth.uid() is not null
     and (
       g.host_id = auth.uid()
       or public.is_super_admin()
       or exists (
         select 1 from public.game_players gp
          where gp.game_id = g.id and gp.user_id = auth.uid()
            and gp.status in ('payment_pending', 'payment_verification_pending', 'joined', 'payment_rejected')
       )
     );
$$;
revoke all on function public.game_host_payment_info(uuid) from public, anon;
grant execute on function public.game_host_payment_info(uuid) to authenticated;

-- ── 4. profiles: bio / city ─────────────────────────────────────

create or replace function public.profile_about(p_user_id uuid)
returns table (bio text, city text)
language sql stable security definer set search_path = public as $$
  select p.bio, p.city
    from public.profiles p
   where p.id = p_user_id
     and (p.is_public or p.id = auth.uid() or public.is_super_admin());
$$;
revoke all on function public.profile_about(uuid) from public;
grant execute on function public.profile_about(uuid) to anon, authenticated;

