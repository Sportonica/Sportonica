-- ────────────────────────────────────────────────────────────────
-- Knockout stage from qualifiers the organizer picks.
--
-- generate_knockout_from_groups() takes the top N of every group by the
-- standings and only once every group match has a result. Organizers
-- also need to choose: a team withdraws, a result is under protest, the
-- event runs out of time before the last group match, or they decide a
-- third-placed team goes through. This takes the qualifiers from them:
--
--   p_picks: {"A": [winner, runner-up, ...], "B": [...], ...}
--
-- each group's list in finishing order (as the organizer decides it).
-- The bracket is built the same way as from the standings
-- (knockout_from_groups_fix.sql):
--   * two from each of an even number of groups (2, 4, 8): the crossover,
--     A1 v B2, C1 v D2, B1 v A2, D1 v C2;
--   * anything else, including uneven picks: seeded by place (every
--     group's 1st, then every 2nd starting one group later, ...) and the
--     standard seeded draw.
-- Unplayed group matches are allowed: that is the organizer's call.
--
-- Apply once in the Supabase SQL editor, after knockout_from_groups_fix.sql.
-- Idempotent.
-- ────────────────────────────────────────────────────────────────

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
    -- seeded by place, each lower place starting one group later; a
    -- group that sends fewer teams is skipped at the places it has none
    for v_rank in 1..v_max loop
      for v_g in 1..v_k loop
        v_id := v_q[((v_g - 1 + v_rank - 1) % v_k) + 1][v_rank];
        if v_id is not null then v_advancing := v_advancing || v_id; end if;
      end loop;
    end loop;
    perform public.build_knockout_bracket(p_tournament_id, v_advancing);
  end if;

  return v_t;
end;
$$;
revoke all on function public.generate_knockout_from_picks(uuid, jsonb) from public, anon;
grant execute on function public.generate_knockout_from_picks(uuid, jsonb) to authenticated;
