-- ================================================================
-- Authorization hardening (security audit — AUTH_MIDDLEWARE,
-- 2026-09-29). Safe to run now; safe to re-run.
--
-- 1. partnerships: an organizer could activate their OWN invite.
--    partnerships_update allowed `organizer_id = auth.uid() OR
--    vendor_id = auth.uid()` for any change, so the organizer could set
--    status = 'active' without the venue owner ever accepting. An active
--    partnership is what is_tournament_organizer() uses to let an
--    organizer run tournaments at that vendor's venues — so any organizer
--    could attach themselves to any venue. (Verified live with test
--    accounts before this fix.)
--
--    Now: the vendor (or a super admin) decides — accept or revoke; the
--    organizer can only withdraw (status 'revoked') their own row, and
--    neither side can re-point the row at someone else.
-- ================================================================

drop policy if exists partnerships_update on public.partnerships;
drop policy if exists partnerships_vendor_update on public.partnerships;
drop policy if exists partnerships_organizer_withdraw on public.partnerships;

create policy partnerships_vendor_update on public.partnerships for update
  using (vendor_id = auth.uid() or public.is_super_admin())
  with check (
    (vendor_id = auth.uid() or public.is_super_admin())
    and status in ('active', 'revoked')
  );

create policy partnerships_organizer_withdraw on public.partnerships for update
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid() and status = 'revoked');

-- Neither side may move a partnership to different people.
create or replace function public.guard_partnership_parties()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.organizer_id is distinct from old.organizer_id
          or new.vendor_id is distinct from old.vendor_id) then
    raise exception 'PARTNERSHIP_PARTIES_IMMUTABLE';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_partnership_parties on public.partnerships;
create trigger guard_partnership_parties
  before update on public.partnerships
  for each row execute function public.guard_partnership_parties();

-- ── Verify ──────────────────────────────────────────────────────
-- select policyname, cmd, qual, with_check from pg_policies where tablename = 'partnerships';

-- ================================================================
-- 2. Internal helper functions were callable by ANYONE (CRITICAL)
--
-- These SECURITY DEFINER helpers never check the caller — they're meant
-- to be called only from guarded functions (generate_*_fixtures,
-- record_match_result, review_payment, confirm_free_booking, …) or
-- pg_cron. But Postgres grants EXECUTE to PUBLIC by default, so they were
-- also callable straight from the public API. Verified live with no
-- login: build_round_robin created fixtures in a (test) tournament,
-- propagate_match_winner advanced a chosen winner, reset_downstream_from
-- wiped downstream results. Tournament ids are public, so anyone could
-- rewrite any bracket.
--
-- Every caller of these is itself SECURITY DEFINER (runs as the owner)
-- or pg_cron (runs as postgres), so revoking from the API roles breaks
-- nothing. expire_stale_play_together_requests() stays callable: the game
-- page runs it as the visitor, and it only expires what's already due.
-- ================================================================
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'build_knockout_bracket', 'build_round_robin',
         'propagate_match_winner', 'reset_downstream_from',
         'finalize_play_together_game', 'maybe_publish_hosted_event',
         'expire_stale_court_holds',
         'auto_close_expired_tournament_registrations',
         'send_due_play_together_reminders'
       )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ── Verify ──────────────────────────────────────────────────────
-- select p.proname, has_function_privilege('anon', p.oid, 'execute') anon,
--        has_function_privilege('authenticated', p.oid, 'execute') authed
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname in ('build_round_robin','propagate_match_winner','reset_downstream_from');
