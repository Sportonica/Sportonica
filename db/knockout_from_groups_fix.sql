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
--   2. Any other shape seeds the qualifiers by finishing place (every
--      group winner, then every runner-up starting one group later,
--      ...) and places them with the standard seeded draw: byes go to
--      group winners and the top seeds are spread across the halves.
--   3. Qualifiers are ranked by the standings' own order (points, then
--      difference, then scored), not points, wins, name.
--   4. The tournament organizer may run it, like every other fixture
--      generator.
--   5. build_knockout_bracket() (every generator uses it) paired
--      seeds in order: 1 v 2 and 3 v 4 in round one, so the two best
--      teams knocked each other out at once, and with byes the bye
--      teams met each other next. It now uses the standard seeded
--      draw (8 teams: 1 v 8, 4 v 5, 2 v 7, 3 v 6), the same as a World
--      Cup bracket: seeds 1 and 2 can only meet in the Final.
--
-- Apply once in the Supabase SQL editor, after tournaments.sql and
-- tournament_late_reg_refixture.sql.
-- Idempotent.
-- ────────────────────────────────────────────────────────────────

-- The standard seeded draw for a list of seeds: slot order for a
-- bracket of the next power of two, null where a bye goes. 8 seeds ->
-- 1 8 4 5 2 7 3 6: seeds 1 and 2 can only meet in the Final, 1-4 only
-- in the semifinals, and byes go to the top seeds, each one facing a
-- real winner next.
create or replace function public.knockout_seed_slots(p_team_ids uuid[])
returns uuid[]
language plpgsql immutable as $$
declare
  v_n int := coalesce(array_length(p_team_ids, 1), 0);
  v_order int[] := array[1];
  v_next int[];
  v_len int;
  v_x int;
  v_slots uuid[] := '{}';
begin
  if v_n < 2 then raise exception 'NOT_ENOUGH_TEAMS'; end if;
  while array_length(v_order, 1) < v_n loop
    v_len := array_length(v_order, 1);
    v_next := '{}';
    foreach v_x in array v_order loop
      v_next := v_next || v_x || (2 * v_len + 1 - v_x);
    end loop;
    v_order := v_next;
  end loop;
  foreach v_x in array v_order loop
    v_slots := v_slots || (case when v_x <= v_n then p_team_ids[v_x] end);
  end loop;
  return v_slots;
end;
$$;

-- Builds a bracket from slots in draw order (length a power of two):
-- slots 1 and 2 are match 1, 3 and 4 match 2, ...; a null slot is a
-- bye for the other team. Neighbouring matches meet in the next round,
-- all the way to the Final.
create or replace function public.build_knockout_from_slots(p_tournament_id uuid, p_slots uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_size int := coalesce(array_length(p_slots, 1), 0);
  v_rounds int := 0;
  v_pow int := 1;
  v_cur_ids uuid[] := '{}';
  v_next_ids uuid[];
  v_round int;
  v_i int;
  v_a uuid;
  v_b uuid;
  v_match_id uuid;
  v_label text;
  v_bye record;
begin
  while v_pow < v_size loop v_pow := v_pow * 2; v_rounds := v_rounds + 1; end loop;
  if v_size < 2 or v_pow <> v_size then raise exception 'NOT_ENOUGH_TEAMS'; end if;

  v_label := public.tournament_round_label(1, v_rounds);
  for v_i in 1..v_size / 2 loop
    v_a := coalesce(p_slots[2 * v_i - 1], p_slots[2 * v_i]);
    v_b := case when p_slots[2 * v_i - 1] is null then null else p_slots[2 * v_i] end;
    if v_a is null then raise exception 'NOT_ENOUGH_TEAMS'; end if;
    if v_b is null then
      insert into public.tournament_matches (tournament_id, stage, round, round_label, team_a_id, status, winner_team_id)
      values (p_tournament_id, 'knockout', 1, v_label, v_a, 'completed', v_a)
      returning id into v_match_id;
    else
      insert into public.tournament_matches (tournament_id, stage, round, round_label, team_a_id, team_b_id, status)
      values (p_tournament_id, 'knockout', 1, v_label, v_a, v_b, 'unscheduled')
      returning id into v_match_id;
    end if;
    v_cur_ids := v_cur_ids || v_match_id;
  end loop;

  for v_round in 2..v_rounds loop
    v_next_ids := '{}';
    v_label := public.tournament_round_label(v_round, v_rounds);
    for v_i in 1..array_length(v_cur_ids, 1) / 2 loop
      insert into public.tournament_matches (tournament_id, stage, round, round_label, status)
      values (p_tournament_id, 'knockout', v_round, v_label, 'unscheduled')
      returning id into v_match_id;
      v_next_ids := v_next_ids || v_match_id;
      update public.tournament_matches set next_match_id = v_match_id, next_match_slot = 'a' where id = v_cur_ids[2 * v_i - 1];
      update public.tournament_matches set next_match_id = v_match_id, next_match_slot = 'b' where id = v_cur_ids[2 * v_i];
    end loop;
    v_cur_ids := v_next_ids;
  end loop;

  for v_bye in
    select id, team_a_id from public.tournament_matches
    where tournament_id = p_tournament_id and stage = 'knockout' and round = 1 and status = 'completed' and team_b_id is null
  loop
    perform public.propagate_match_winner(v_bye.id, v_bye.team_a_id);
  end loop;
end;
$$;
revoke all on function public.build_knockout_from_slots(uuid, uuid[]) from public, anon, authenticated;

-- Same signature as before (generate_knockout_bracket and
-- regenerate_tournament_fixtures call it with a seeded list): now the
-- standard seeded draw instead of pairing seeds 1 v 2, 3 v 4.
create or replace function public.build_knockout_bracket(p_tournament_id uuid, p_team_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.build_knockout_from_slots(p_tournament_id, public.knockout_seed_slots(p_team_ids));
end;
$$;
revoke all on function public.build_knockout_bracket(uuid, uuid[]) from public, anon, authenticated;

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
    perform public.build_knockout_from_slots(p_tournament_id, v_top || v_bottom);
  else
    -- Seeded by finishing place (every winner, then every runner-up,
    -- each lower place starting one group later: A1 B1 C1, B2 C2 A2)
    -- and placed with the standard seeded draw.
    for v_rank in 1..p_advance_per_group loop
      for v_g in 1..v_k loop
        v_advancing := v_advancing || v_q[((v_g - 1 + v_rank - 1) % v_k) + 1][v_rank];
      end loop;
    end loop;
    perform public.build_knockout_bracket(p_tournament_id, v_advancing);
  end if;

  return v_t;
end;
$$;
revoke all on function public.generate_knockout_from_groups(uuid,int) from public, anon;
grant execute on function public.generate_knockout_from_groups(uuid,int) to authenticated;
