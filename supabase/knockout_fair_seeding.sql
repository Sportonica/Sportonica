-- ────────────────────────────────────────────────────────────────
-- Knockout draws that are not the 2/4/8-group crossover: fair seeds and
-- no group rematch in the first round.
--
-- When the qualifiers do not fit the crossover (two from each of an even
-- number of groups making a full bracket), both generate_knockout_from_groups()
-- and generate_knockout_from_picks() seeded the qualifiers by place in
-- group-letter order and used the standard seeded draw. With 6 groups:
--   * top 2 (12 teams): the byes went to the winners of A-D for their
--     letters, and F1 met F2 in the first round (seed 6 v seed 11);
--   * 6 winners + 2 runners-up (8 teams): a winner could meet the
--     runner-up of its own group in the quarterfinals.
-- Now, in that case:
--   1. within each place (all the winners, then all the runners-up, ...)
--      the better record is seeded higher: points, goal difference,
--      goals scored (tournament_standings over all group matches), group
--      order on a tie; so the best winners get the byes;
--   2. a first-round pair from one group swaps its lower team with the
--      nearest other pair's lower team, when that leaves both pairs from
--      different groups.
-- The crossover itself is unchanged.
--
-- Apply once in the Supabase SQL editor, after knockout_from_groups_fix.sql
-- and knockout_from_picks.sql. Idempotent.
-- ────────────────────────────────────────────────────────────────

-- First-round pairs (slots 1+2, 3+4, ...) with both teams from one group:
-- swap the lower team (the second slot) with the nearest pair's lower team
-- when both pairs then have teams from different groups. Byes are left alone.
create or replace function public.knockout_slots_apart(p_slots uuid[])
returns uuid[]
language plpgsql stable set search_path = public as $$
declare
  v uuid[] := p_slots;
  v_pairs int := coalesce(array_length(p_slots, 1), 0) / 2;
  p int;
  q int;
  d int;
  v_side int;
  v_tmp uuid;
  v_done boolean;
begin
  for p in 1..v_pairs loop
    if v[2 * p - 1] is null or v[2 * p] is null then continue; end if;
    if (select group_name from tournament_teams where id = v[2 * p - 1])
       is distinct from (select group_name from tournament_teams where id = v[2 * p]) then continue; end if;
    v_done := false;
    for d in 1..v_pairs loop
      for v_side in 0..1 loop
        q := case when v_side = 0 then p + d else p - d end;
        if q < 1 or q > v_pairs or v[2 * q - 1] is null or v[2 * q] is null then continue; end if;
        if (select group_name from tournament_teams where id = v[2 * p - 1]) is distinct from (select group_name from tournament_teams where id = v[2 * q])
           and (select group_name from tournament_teams where id = v[2 * q - 1]) is distinct from (select group_name from tournament_teams where id = v[2 * p]) then
          v_tmp := v[2 * p]; v[2 * p] := v[2 * q]; v[2 * q] := v_tmp;
          v_done := true;
          exit;
        end if;
      end loop;
      exit when v_done;
    end loop;
  end loop;
  return v;
end;
$$;
revoke all on function public.knockout_slots_apart(uuid[]) from public, anon, authenticated;

-- p_q[group][place]: the qualifiers (null where a group sends fewer).
-- Seeds every place in turn, the better record first, then draws them
-- with the standard seeded draw kept free of first-round group rematches.
create or replace function public.build_knockout_by_place(p_tournament_id uuid, p_q uuid[][])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_k int := coalesce(array_length(p_q, 1), 0);
  v_places int := coalesce(array_length(p_q, 2), 0);
  v_rank int;
  v_tier uuid[];
  v_seeds uuid[] := '{}';
begin
  for v_rank in 1..v_places loop
    select array_agg(x.id order by s.points desc nulls last, s.goal_diff desc nulls last, s.goals_for desc nulls last, x.g)
      into v_tier
    from (select p_q[g][v_rank] as id, g from generate_series(1, v_k) g) x
    left join public.tournament_standings(p_tournament_id) s on s.team_id = x.id
    where x.id is not null;
    v_seeds := v_seeds || coalesce(v_tier, '{}');
  end loop;
  perform public.build_knockout_from_slots(p_tournament_id, public.knockout_slots_apart(public.knockout_seed_slots(v_seeds)));
end;
$$;
revoke all on function public.build_knockout_by_place(uuid, uuid[]) from public, anon, authenticated;

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
    -- Seeded by place, the better record first within each place, and
    -- no two teams from one group in the first round (build_knockout_by_place).
    perform public.build_knockout_by_place(p_tournament_id, v_q);
  end if;

  return v_t;
end;
$$;
revoke all on function public.generate_knockout_from_groups(uuid,int) from public, anon;
grant execute on function public.generate_knockout_from_groups(uuid,int) to authenticated;

create or replace function public.generate_knockout_from_picks(p_tournament_id uuid, p_picks jsonb)
returns public.tournaments
language plpgsql security definer set search_path = public as $$
declare
  v_t public.tournaments;
  v_groups text[];
  v_k int;
  v_max int := 0;
  v_min int := null;
  v_len int;
  v_g int;
  v_rank int;
  v_n int := 0;
  v_pow int := 1;
  v_id uuid;
  v_seen uuid[] := '{}';
  v_q uuid[][];
  v_top uuid[] := '{}';
  v_bottom uuid[] := '{}';
  v_advancing uuid[] := '{}';
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
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournament_id and stage = 'knockout') then
    raise exception 'ALREADY_GENERATED';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'object' then raise exception 'INVALID_PICKS'; end if;

  -- groups that send at least one team, in name order
  select array_agg(k order by k) into v_groups
  from jsonb_each(p_picks) e(k, v)
  where jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0;
  v_k := coalesce(array_length(v_groups, 1), 0);
  if v_k = 0 then raise exception 'NOT_ENOUGH_TEAMS'; end if;

  for v_g in 1..v_k loop
    v_len := jsonb_array_length(p_picks -> v_groups[v_g]);
    v_max := greatest(v_max, v_len);
    v_min := least(coalesce(v_min, v_len), v_len);
  end loop;
  v_q := array_fill(null::uuid, array[v_k, v_max]);

  -- every pick: a confirmed team of this tournament, in that group, once
  for v_g in 1..v_k loop
    for v_rank in 1..jsonb_array_length(p_picks -> v_groups[v_g]) loop
      begin
        v_id := (p_picks -> v_groups[v_g] ->> (v_rank - 1))::uuid;
      exception when others then raise exception 'INVALID_PICKS';
      end;
      if v_id is null or v_id = any(v_seen) then raise exception 'INVALID_PICKS'; end if;
      if not exists (
        select 1 from public.tournament_teams
        where id = v_id and tournament_id = p_tournament_id and status = 'confirmed' and group_name = v_groups[v_g]
      ) then
        raise exception 'INVALID_PICKS';
      end if;
      v_seen := v_seen || v_id;
      v_q[v_g][v_rank] := v_id;
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n < 2 then raise exception 'NOT_ENOUGH_TEAMS'; end if;

  while v_pow < v_n loop v_pow := v_pow * 2; end loop;

  if v_min = 2 and v_max = 2 and v_k % 2 = 0 and v_pow = v_n then
    -- the crossover: X1 v Y2 in the top half, Y1 v X2 in the bottom half
    v_g := 1;
    while v_g < v_k loop
      v_top := v_top || v_q[v_g][1] || v_q[v_g + 1][2];
      v_bottom := v_bottom || v_q[v_g + 1][1] || v_q[v_g][2];
      v_g := v_g + 2;
    end loop;
    perform public.build_knockout_from_slots(p_tournament_id, v_top || v_bottom);
  else
    -- seeded by place, the better record first within each place, and no
    -- two teams from one group in the first round (build_knockout_by_place)
    perform public.build_knockout_by_place(p_tournament_id, v_q);
  end if;

  return v_t;
end;
$$;
revoke all on function public.generate_knockout_from_picks(uuid, jsonb) from public, anon;
grant execute on function public.generate_knockout_from_picks(uuid, jsonb) to authenticated;
