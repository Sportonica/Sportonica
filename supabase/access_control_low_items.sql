-- ================================================================
-- LOW items left over from the security audit (ACCESS_CONTROL §6 and
-- AUTH_MIDDLEWARE §6, 2026-09-30)
--
--  1. squad_members — a group creator could add ANY user to their group
--     without that user agreeing. Now a creator can only add someone
--     directly if the two are already friends; anyone else joins by
--     themselves, through an invite link, or by a join request.
--
--  2. squad_polls — a poll's creator could move their poll into another
--     group (rewrite squad_id). The group and creator are now fixed.
--
--  3. events — a venue owner could create or edit an event naming another
--     user as host (host_id). The host must now be the caller, and can't
--     be changed afterwards. Super admins are exempt.
--
--  4. get_player_scorecard — returned career totals for profiles marked
--     private. Now returns zeros unless the profile is public or it's
--     your own.
--
--  5. Duplicate policies on bookings / events / profiles / notifications —
--     exact copies (same command, roles and conditions) are dropped,
--     keeping one. Access doesn't change.
--
-- Like the earlier write guards, the triggers only restrict direct API
-- writes (current_user = authenticated / anon). SECURITY DEFINER functions
-- and triggers (game groups, join-request approval, invite links) run as
-- the owner and are unaffected. Safe to re-run.
-- ================================================================

-- ── 1. group members: no adding strangers ───────────────────────
create or replace function public.guard_squad_member_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.user_id is distinct from auth.uid() then
    if not exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.addressee_id = new.user_id)
          or (f.requester_id = new.user_id and f.addressee_id = auth.uid()))
    ) then
      raise exception 'SQUAD_ADD_FRIENDS_ONLY';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_squad_member_insert on public.squad_members;
create trigger guard_squad_member_insert
  before insert on public.squad_members
  for each row execute function public.guard_squad_member_insert();

-- ── 2. polls: can't be moved to another group ───────────────────
create or replace function public.guard_squad_poll_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.squad_id is distinct from old.squad_id
       or new.creator_id is distinct from old.creator_id then
      raise exception 'POLL_NOT_MOVABLE';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_squad_poll_update on public.squad_polls;
create trigger guard_squad_poll_update
  before update on public.squad_polls
  for each row execute function public.guard_squad_poll_update();

-- ── 3. events: the host is whoever creates it ───────────────────
create or replace function public.guard_event_host()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_super_admin() then
    if tg_op = 'INSERT' then
      if new.host_id is distinct from auth.uid() then
        raise exception 'EVENT_HOST_MUST_BE_SELF';
      end if;
    elsif new.host_id is distinct from old.host_id then
      raise exception 'EVENT_HOST_NOT_EDITABLE';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_event_host on public.events;
create trigger guard_event_host
  before insert or update on public.events
  for each row execute function public.guard_event_host();

-- ── 4. scorecard respects private profiles ──────────────────────
create or replace function public.get_player_scorecard(p_user_id uuid)
returns table (
  goals              bigint,
  matches_played     bigint,
  tournaments_played bigint,
  mom_count          bigint
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(s.goals), 0)                          as goals,
    count(distinct s.match_id)                         as matches_played,
    count(distinct tt.tournament_id)                   as tournaments_played,
    count(*) filter (where s.is_mom)                   as mom_count
  from public.tournament_match_player_stats s
  join public.tournament_team_players tp on tp.id = s.team_player_id
  join public.tournament_teams tt on tt.id = tp.team_id
  where tp.user_id = p_user_id
    and (
      p_user_id = auth.uid()
      or exists (select 1 from public.profiles p
                 where p.id = p_user_id and p.is_public is true)
    );
$$;
grant execute on function public.get_player_scorecard(uuid) to authenticated, anon;

-- ── 5. drop exact-duplicate policies ────────────────────────────
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from (
      select schemaname, tablename, policyname,
             row_number() over (
               partition by tablename, cmd, permissive, roles::text,
                            coalesce(qual, ''), coalesce(with_check, '')
               order by policyname
             ) as n
      from pg_policies
      where schemaname = 'public'
        and tablename in ('bookings', 'events', 'profiles', 'notifications')
    ) d
    where n > 1
  loop
    raise notice 'dropping duplicate policy % on %', r.policyname, r.tablename;
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end;
$$;
