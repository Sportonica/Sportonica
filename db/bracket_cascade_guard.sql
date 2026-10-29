-- ================================================================
-- Bracket cascade guard (2026-10-29)
--
-- On 2026-10-04 an organiser re-saved an unchanged result in a
-- completed tournament, and that wiped the R16, QF, SF and final.
-- record_match_result() decided whether to cascade by comparing the new
-- winner with whoever sat in the next match's slot. Teams had been moved
-- by hand the day before, so the slot held a different team, the
-- "change" looked real, and reset_downstream_from() cleared every later
-- round.
--
-- Two fixes:
--   1. record_match_result() only cascades when the winner actually
--      changes (old winner_team_id vs new). A re-save with the same
--      winner never touches later rounds, even if the slot was edited
--      by hand. It still fills an empty slot, same as before.
--   2. reset_downstream_from() refuses on a completed tournament
--      (TOURNAMENT_COMPLETED) unless a super admin is calling. This
--      covers every caller: record_match_result, record_cricket_result
--      and update_match_teams.
--
-- Bodies are otherwise the same as supabase/tournaments.sql on the
-- `changes` branch. Before running, check the live copies still match
-- that file (both rows should say true):
--
--   select 'reset_downstream_from' as fn,
--          md5(prosrc) = 'ec06b87861c7cc7251a9519610e4debc' as matches_repo
--     from pg_proc where oid = 'public.reset_downstream_from(uuid)'::regprocedure
--   union all
--   select 'record_match_result',
--          md5(prosrc) = '178e42a233d60cdb6d849f7932ff4eff'
--     from pg_proc
--    where oid = 'public.record_match_result(uuid,int,int,uuid,int,int,int,int,boolean)'::regprocedure;
--
-- Safe to run now; safe to re-run.
-- ================================================================

create or replace function public.reset_downstream_from(p_match_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_match public.tournament_matches; v_next public.tournament_matches; v_status text;
begin
  select * into v_match from public.tournament_matches where id = p_match_id;
  if not found or v_match.next_match_id is null then return; end if;

  -- A finished tournament's bracket is the record of what happened.
  -- Only a super admin may unwind it.
  select status into v_status from public.tournaments where id = v_match.tournament_id;
  if v_status = 'completed' and not public.is_super_admin() then
    raise exception 'TOURNAMENT_COMPLETED';
  end if;

  select * into v_next from public.tournament_matches where id = v_match.next_match_id;
  if not found then return; end if;

  -- Recurse first — if v_next had itself already advanced a winner
  -- further down the tree, that has to be unwound before v_next's own
  -- team slot changes underneath it.
  perform public.reset_downstream_from(v_next.id);

  if v_match.next_match_slot = 'a' then
    update public.tournament_matches set team_a_id = null where id = v_next.id;
  else
    update public.tournament_matches set team_b_id = null where id = v_next.id;
  end if;

  update public.tournament_matches set
      status = 'unscheduled', score_a = null, score_b = null,
      score_a_et = null, score_b_et = null, score_a_pens = null, score_b_pens = null,
      winner_team_id = null
    where id = v_next.id;
end;
$$;

create or replace function public.record_match_result(
  p_match_id uuid,
  p_score_a int default null,
  p_score_b int default null,
  p_winner_team_id uuid default null,
  p_score_a_et int default null,
  p_score_b_et int default null,
  p_score_a_pens int default null,
  p_score_b_pens int default null,
  p_confirm_cascade boolean default false
)
returns public.tournament_matches
language plpgsql security definer set search_path = public as $$
declare
  v_before public.tournament_matches;
  v_match public.tournament_matches;
  v_t public.tournaments;
  v_winner uuid;
  v_current_next_team uuid;
  v_winner_changed boolean;
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
  if v_match.status = 'cancelled' then raise exception 'INVALID_TRANSITION'; end if;

  if p_winner_team_id is not null then
    if p_winner_team_id not in (v_match.team_a_id, v_match.team_b_id) then raise exception 'INVALID_WINNER'; end if;
    v_winner := p_winner_team_id;
  else
    if p_score_a is null or p_score_b is null then raise exception 'SCORES_REQUIRED'; end if;

    if p_score_a <> p_score_b then
      v_winner := case when p_score_a > p_score_b then v_match.team_a_id else v_match.team_b_id end;
    elsif p_score_a_et is not null and p_score_b_et is not null and p_score_a_et <> p_score_b_et then
      v_winner := case when p_score_a_et > p_score_b_et then v_match.team_a_id else v_match.team_b_id end;
    elsif p_score_a_pens is not null and p_score_b_pens is not null and p_score_a_pens <> p_score_b_pens then
      v_winner := case when p_score_a_pens > p_score_b_pens then v_match.team_a_id else v_match.team_b_id end;
    else
      v_winner := null;
    end if;

    if v_winner is null and v_t.format <> 'league' and v_match.stage <> 'group' then
      raise exception 'KNOCKOUT_CANNOT_DRAW';
    end if;
  end if;

  -- Diff check, before touching anything. The question is whether this
  -- result changes who advanced, so compare against the match's own old
  -- winner, not the next match's slot (that may have been edited by
  -- hand). Same winner: nothing to cascade, at most fill an empty slot.
  v_winner_changed := v_before.winner_team_id is distinct from v_winner;

  if v_winner is not null and v_match.next_match_id is not null then
    select (case when v_match.next_match_slot = 'a' then team_a_id else team_b_id end)
      into v_current_next_team
      from public.tournament_matches where id = v_match.next_match_id;

    if v_winner_changed and v_current_next_team is not null and v_current_next_team is distinct from v_winner
       and not p_confirm_cascade then
      raise exception 'CASCADE_CONFIRMATION_REQUIRED';
    end if;
  end if;

  if p_winner_team_id is not null then
    update public.tournament_matches
      set status = 'walkover', winner_team_id = v_winner,
          score_a = null, score_b = null, score_a_et = null, score_b_et = null, score_a_pens = null, score_b_pens = null
      where id = p_match_id returning * into v_match;
  else
    update public.tournament_matches
      set status = 'completed', score_a = p_score_a, score_b = p_score_b,
          score_a_et = p_score_a_et, score_b_et = p_score_b_et,
          score_a_pens = p_score_a_pens, score_b_pens = p_score_b_pens,
          winner_team_id = v_winner
      where id = p_match_id returning * into v_match;
  end if;

  insert into public.tournament_match_audit (match_id, tournament_id, changed_by, change_type, old_value, new_value)
  values (v_match.id, v_match.tournament_id, auth.uid(), 'result', to_jsonb(v_before), to_jsonb(v_match));

  if v_winner is not null and v_match.next_match_id is not null and v_current_next_team is distinct from v_winner
     and (v_winner_changed or v_current_next_team is null) then
    if v_current_next_team is not null then
      perform public.reset_downstream_from(p_match_id);
    end if;
    perform public.propagate_match_winner(p_match_id, v_winner);
  end if;

  return v_match;
end;
$$;
grant execute on function public.record_match_result(uuid,int,int,uuid,int,int,int,int,boolean) to authenticated;
