-- One match's own rules, changed after it was set up for scoring (the
-- wrong over count, wickets for an 8-a-side game, the wrong preset).
-- A contest freezes the competition's rules when it opens; this is the
-- one way to change them afterwards. The app replays every event under
-- the new rules first and refuses if any would no longer be possible,
-- then stores the rules and the rebuilt snapshot together here.
-- Run once in the Supabase SQL editor (after db/sports_intelligence.sql).

create or replace function public.si_set_contest_rules(
  p_contest_id uuid, p_expected_seq int, p_rules jsonb,
  p_status text, p_state jsonb, p_summary jsonb, p_lines jsonb, p_mirror jsonb
)
returns public.si_contests
language plpgsql security definer set search_path = public as $$
declare v_c public.si_contests;
begin
  select * into v_c from public.si_contests where id = p_contest_id for update;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;
  if not public.si_can_score(v_c.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p_expected_seq is distinct from v_c.last_seq then raise exception 'SEQ_CONFLICT'; end if;
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'INVALID_RULES'; end if;
  update public.si_contests set rules = p_rules where id = p_contest_id returning * into v_c;
  return public.si_write_snapshot(v_c, p_status, p_state, p_summary, p_lines, p_mirror, v_c.last_seq);
end;
$$;
revoke all on function public.si_set_contest_rules(uuid, int, jsonb, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.si_set_contest_rules(uuid, int, jsonb, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
