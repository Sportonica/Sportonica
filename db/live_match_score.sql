-- ────────────────────────────────────────────────────────────────
-- Live match scores: lets an organizer post the running score of a
-- match while it's being played (FixturesTab "Start match" / +1 /
-- "Update live score"), so the home page and tournament page show it
-- from kick-off to full-time.
--
-- record_match_result() can't do this: it always marks the match
-- completed and pushes the winner into the next round. This only
-- sets status = 'live' plus the score, with no winner and no bracket
-- propagation. Full-time still goes through record_match_result().
--
-- Apply once in the Supabase SQL editor. Idempotent.
-- ────────────────────────────────────────────────────────────────

create or replace function public.update_live_score(
  p_match_id uuid,
  p_score_a int,
  p_score_b int
)
returns public.tournament_matches
language plpgsql security definer set search_path = public as $$
declare
  v_before public.tournament_matches;
  v_match public.tournament_matches;
  v_t public.tournaments;
begin
  select * into v_match from public.tournament_matches where id = p_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  v_before := v_match;
  select * into v_t from public.tournaments where id = v_match.tournament_id;
  if not (
    public.is_tournament_organizer(v_t) or public.has_venue_access(v_t.venue_id, 'manager') or public.is_super_admin()
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if v_match.team_a_id is null or v_match.team_b_id is null then raise exception 'TEAMS_NOT_SET'; end if;
  -- A decided or cancelled match is corrected via record_match_result
  -- ("Update score"), not reopened as live.
  if v_match.status in ('completed', 'walkover', 'cancelled') then raise exception 'INVALID_TRANSITION'; end if;
  if p_score_a is null or p_score_b is null then raise exception 'SCORES_REQUIRED'; end if;
  if p_score_a < 0 or p_score_b < 0 then raise exception 'INVALID_SCORE'; end if;

  update public.tournament_matches
    set status = 'live', score_a = p_score_a, score_b = p_score_b,
        score_a_et = null, score_b_et = null, score_a_pens = null, score_b_pens = null,
        winner_team_id = null
    where id = p_match_id returning * into v_match;

  insert into public.tournament_match_audit (match_id, tournament_id, changed_by, change_type, old_value, new_value)
  values (v_match.id, v_match.tournament_id, auth.uid(), 'result', to_jsonb(v_before), to_jsonb(v_match));

  return v_match;
end;
$$;
revoke all on function public.update_live_score(uuid,int,int) from public, anon;
grant execute on function public.update_live_score(uuid,int,int) to authenticated;
