-- ================================================================
-- Database access hardening — STEP 2 of 2 (security audit,
-- DATABASE_ACCESS, 2026-09-29). Run ONLY after branch fix/security-audit
-- is deployed to production: the old code reads these tables with
-- select("*"), which fails once a column is hidden. Step 1
-- (database_access_step1_functions.sql) must already have run.
--
-- Hides, from anon/authenticated:
--   tournament_teams: club_address, contact_person_name, contact_phone,
--                     contact_email, manager_email
--   games:            host_phone, host_qr_path
--   profiles:         bio, city   (phone stays hidden, from SEC-02b)
-- A column added to any of these tables later must be granted
-- explicitly (see src/lib/*/columns.ts).
-- Safe to re-run.
-- ================================================================

-- ── helper: grant select on every column of a table except some ─
create or replace function pg_temp.grant_select_except(p_table text, p_hidden text[])
returns void language plpgsql as $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table
     and column_name <> all (p_hidden);
  execute format('revoke select on public.%I from anon, authenticated', p_table);
  execute format('grant select (%s) on public.%I to anon, authenticated', v_cols, p_table);
end;
$$;

select pg_temp.grant_select_except('tournament_teams',
  array['club_address', 'contact_person_name', 'contact_phone', 'contact_email', 'manager_email']);
select pg_temp.grant_select_except('games', array['host_phone', 'host_qr_path']);
select pg_temp.grant_select_except('profiles', array['phone', 'bio', 'city']);

-- ── Verify (run after) ──────────────────────────────────────────
-- select policyname from pg_policies where tablename = 'notifications' and cmd = 'INSERT';     -- 0 rows
-- select has_column_privilege('anon', 'public.tournament_teams', 'contact_email', 'select');    -- false
-- select has_column_privilege('anon', 'public.tournament_teams', 'manager_phone', 'select');    -- true
-- select has_column_privilege('anon', 'public.games', 'host_phone', 'select');                  -- false
-- select has_column_privilege('anon', 'public.profiles', 'bio', 'select');                      -- false
-- select has_column_privilege('anon', 'public.profiles', 'avatar_url', 'select');               -- true

-- ── Rollback (only if something breaks) ─────────────────────────
-- grant select on public.tournament_teams, public.games to anon, authenticated;
-- select pg_temp... not needed: to re-show bio/city run
--   grant select (bio, city) on public.profiles to anon, authenticated;
-- The notifications insert policy should NOT be restored (the app no longer needs it).
