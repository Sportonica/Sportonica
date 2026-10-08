-- ────────────────────────────────────────────────────────────────
-- Knockout stage from groups: cross the groups over, and let the
-- organizer run it.
--
-- What went wrong: generate_knockout_from_groups() collected the
-- qualifiers group by group (A1, A2, B1, B2, ...) and handed that list
-- straight to build_knockout_bracket(), which pairs neighbours. So
-- the first knockout round was A1 v A2 and B1 v B2: two teams that
-- had just played each other in the group met again at once, and a
-- group winner got no reward for winning. It also only allowed venue
-- managers and super admins, not the tournament's own organizer, so
-- the app never offered it.
--
-- Now:
--   1. Two qualifiers per group and an even number of groups (the
--      usual case: 2, 4, 8 groups) uses the World Cup crossover. Each
--      winner plays the runner-up of its paired group, and the two
--      winners of a pair are put in opposite halves, so they can only
--      meet in the final:
--        4 groups -> QF1 A1 v B2, QF2 C1 v D2, QF3 B1 v A2, QF4 D1 v C2
--                    SF1 = QF1 v QF2, SF2 = QF3 v QF4
--   2. Any other shape lists the qualifiers by finishing place (every
--      group winner, then every runner-up, ...). Byes go to group
--      winners first and no first-round match is between group mates.
--   3. Qualifiers are ranked by the standings' own order (points, then
--      difference, then scored), not points, wins, name.
--   4. The tournament organizer may run it, like every other fixture
--      generator.
--
-- Apply once in the Supabase SQL editor, after tournaments.sql.
-- Idempotent.
-- ────────────────────────────────────────────────────────────────

create or replace function public.generate_knockout_from_groups(p_tournament_id uuid, p_advance_per_group int default 2)
returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare
  v_t public.tournaments;
  v_groups text[];
  v_k int;
  v_rank int;
  v_g int;
  v_n int;
  v_pow int := 1;
  v_advancing uuid[] := '{}';
  v_top uuid[] := '{}';
  v_bottom uuid[] := '{}';
  v_q uuid[][];
  v_row record;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (
    public.is_tournament_organizer(v_t) or public.has_venue_access(v_t.venue_id, 'manager') or public.is_super_admin()
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if v_t.format <> 'group_knockout' then raise exception 'WRONG_FORMAT'; end if;
  if v_t.status <> 'live' then raise exception 'INVALID_TRANSITION'; end if;
  if p_advance_per_group < 1 then raise exception 'INVALID_ADVANCE_COUNT'; end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id and stage = 'knockout') then
    raise exception 'ALREADY_GENERATED';
  end if;
  if exists (
    select 1 from public.tournament_matches
    where tournament_id = p_tournament_id and stage = 'group' and status not in ('completed','walkover','cancelled')
  ) then
    raise exception 'GROUP_STAGE_INCOMPLETE';
  end if;

  select array_agg(g order by g) into v_groups from (
    select distinct group_name as g from public.tournament_teams
    where tournament_id = p_tournament_id and status = 'confirmed' and group_name is not null
  ) s;
  v_k := coalesce(array_length(v_groups, 1), 0);
  if v_k = 0 then raise exception 'TEAMS_NOT_GROUPED'; end if;

  -- v_q[group][place]: the team that finished there.
  v_q := array_fill(null::uuid, array[v_k, p_advance_per_group]);
  for v_g in 1..v_k loop
    v_rank := 0;
    for v_row in
      select s.team_id from public.tournament_standings(p_tournament_id, v_groups[v_g]) s
      limit p_advance_per_group
    loop
      v_rank := v_rank + 1;
      v_q[v_g][v_rank] := v_row.team_id;
    end loop;
    if v_rank < p_advance_per_group then raise exception 'NOT_ENOUGH_TEAMS'; end if;
  end loop;

  v_n := v_k * p_advance_per_group;
  while v_pow < v_n loop v_pow := v_pow * 2; end loop;

  if p_advance_per_group = 2 and v_k % 2 = 0 and v_pow = v_n then
    -- Groups paired (A,B), (C,D), ...: X1 v Y2 in the top half,
    -- Y1 v X2 in the bottom half. build_knockout_bracket() pairs
    -- neighbours, and neighbouring pairs meet in the next round.
    v_g := 1;
    while v_g < v_k loop
      v_top := v_top || v_q[v_g][1] || v_q[v_g + 1][2];
      v_bottom := v_bottom || v_q[v_g + 1][1] || v_q[v_g][2];
      v_g := v_g + 2;
    end loop;
    v_advancing := v_top || v_bottom;
  else
    for v_rank in 1..p_advance_per_group loop
      for v_g in 1..v_k loop
        v_advancing := v_advancing || v_q[v_g][v_rank];
      end loop;
    end loop;
  end if;

  perform public.build_knockout_bracket(p_tournament_id, v_advancing);

  return v_t;
end;
$$;
revoke all on function public.generate_knockout_from_groups(uuid,int) from public, anon;
grant execute on function public.generate_knockout_from_groups(uuid,int) to authenticated;
