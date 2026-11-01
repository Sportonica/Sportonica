-- ────────────────────────────────────────────────────────────────
-- The two helpers the group-to-knockout generators call, on their own.
--
-- generate_knockout_from_groups() and generate_knockout_from_picks() on
-- the live database fail with "function ... does not exist": these two,
-- from knockout_from_groups_fix.sql, are missing there. That file also
-- replaces build_knockout_bracket() and generate_knockout_from_groups(),
-- which knockout_fair_seeding.sql may have replaced since, so this adds
-- only the missing functions and changes nothing that already exists.
--
-- Apply once in the Supabase SQL editor. Safe to re-run.
-- ────────────────────────────────────────────────────────────────

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

revoke all on function public.knockout_seed_slots(uuid[]) from public, anon, authenticated;

-- Both rows should say true.
select p.name, to_regprocedure(p.sig) is not null as present
from (values
  ('knockout_seed_slots', 'public.knockout_seed_slots(uuid[])'),
  ('build_knockout_from_slots', 'public.build_knockout_from_slots(uuid, uuid[])')
) as p(name, sig);
