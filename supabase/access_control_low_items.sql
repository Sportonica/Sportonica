-- ================================================================
-- LOW items left over from the security audit (ACCESS_CONTROL §6 and
-- AUTH_MIDDLEWARE §6, 2026-09-30)
--
--  1. squad_members — a group creator could add ANY user to their group
--     without that user agreeing. Fixed separately by squad_invites.sql:
--     the owner sends an invite and the player joins only by accepting it.
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
--  6. are_blocked(a, b) — anyone could ask whether two other users had
--     blocked each other. It now answers only when the caller is one of
--     the two (every policy that uses it already calls it that way:
--     direct_messages insert, friend_requests insert).
--
--  7. get_tournament_player_stats / get_tournament_cricket_stats — returned
--     stats for draft and pending-approval tournaments to anyone who knew
--     the id. They now apply the same visibility rule as the tournaments
--     table itself.
--
-- Like the earlier write guards, the triggers only restrict direct API
-- writes (current_user = authenticated / anon). SECURITY DEFINER functions
-- and triggers (game groups, join-request approval, invites) run as
-- the owner and are unaffected. Safe to re-run.
-- ================================================================

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

-- ── 6. are_blocked: only for the two people involved ────────────
create or replace function public.are_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.uid() in (a, b), false) and exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- ── 7. tournament stats: same visibility as the tournament ──────
create or replace function public.tournament_visible_to_caller(p_tournament_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and (t.status not in ('draft', 'pending_approval')
           or public.has_venue_access(t.venue_id)
           or public.is_tournament_organizer(t)
           or public.is_super_admin())
  );
$$;
revoke execute on function public.tournament_visible_to_caller(uuid) from public;
grant execute on function public.tournament_visible_to_caller(uuid) to anon, authenticated;

create or replace function public.get_tournament_player_stats(p_tournament_id uuid)
returns table(team_player_id uuid, player_name text, team_id uuid, team_name text, goals bigint, assists bigint, yellow_cards bigint, red_cards bigint, mom_count bigint)
language sql stable security definer set search_path = public as $$
  select
    tp.id as team_player_id,
    coalesce(p.full_name, p.name, p.username, tp.guest_name, 'Player') as player_name,
    tt.id as team_id,
    tt.name as team_name,
    coalesce(sum(s.goals), 0) as goals,
    coalesce(sum(s.assists), 0) as assists,
    coalesce(sum(s.yellow_cards), 0) as yellow_cards,
    coalesce(sum(s.red_card::int), 0) as red_cards,
    coalesce(count(*) filter (where s.is_mom), 0) as mom_count
  from public.tournament_team_players tp
  join public.tournament_teams tt on tt.id = tp.team_id
  left join public.profiles p on p.id = tp.user_id
  left join public.tournament_match_player_stats s on s.team_player_id = tp.id
  where tt.tournament_id = p_tournament_id and tt.status = 'confirmed'
    and public.tournament_visible_to_caller(p_tournament_id)
  group by tp.id, p.full_name, p.name, p.username, tp.guest_name, tt.id, tt.name
  having coalesce(sum(s.goals), 0) + coalesce(sum(s.assists), 0)
    + coalesce(sum(s.yellow_cards), 0) + coalesce(sum(s.red_card::int), 0) > 0
  order by goals desc, assists desc, player_name asc;
$$;

create or replace function public.get_tournament_cricket_stats(p_tournament_id uuid)
returns table(team_player_id uuid, player_name text, team_id uuid, team_name text, runs bigint, balls_faced bigint, fours bigint, sixes bigint, wickets bigint, overs_bowled numeric, catches bigint, mom_count bigint)
language sql stable security definer set search_path = public as $$
  select
    tp.id, coalesce(pr.full_name, pr.name, pr.username, tp.guest_name, 'Player') as player_name,
    t.id, t.name,
    sum(s.runs), sum(s.balls_faced), sum(s.fours), sum(s.sixes),
    sum(s.wickets), sum(s.overs_bowled), sum(s.catches),
    sum(case when s.is_mom then 1 else 0 end)
  from public.tournament_cricket_player_stats s
  join public.tournament_team_players tp on tp.id = s.team_player_id
  join public.tournament_teams t on t.id = tp.team_id
  left join public.profiles pr on pr.id = tp.user_id
  join public.tournament_matches m on m.id = s.match_id
  where m.tournament_id = p_tournament_id
    and public.tournament_visible_to_caller(p_tournament_id)
  group by tp.id, player_name, t.id, t.name
  order by sum(s.runs) desc, sum(s.wickets) desc;
$$;
