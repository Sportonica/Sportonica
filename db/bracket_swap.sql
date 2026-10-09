-- ────────────────────────────────────────────────────────────────
-- Bracket swap: let the organizer decide which matches meet next.
--
-- The bracket rule is fixed: in a knockout round, matches 1 and 2
-- feed match 1 of the next round, 3 and 4 feed match 2, and so on to
-- the Final (the order is the next_match_id / next_match_slot links).
-- Once a bracket existed there was no way to change those pairings,
-- so an organizer who wanted, say, India v Australia and England v
-- Canada to meet in the same semifinal was stuck with whatever the
-- links said.
--
-- swap_bracket_slots(a, b) swaps two matches of the same knockout
-- round: each takes the other's next-round slot, and a winner already
-- through moves with its match. It is refused once either next-round
-- match has started (live, or has a result), so no played match is
-- ever rewired. Every changed match gets an audit row.
--
-- The Fixtures tab calls it from the up/down arrows on a knockout
-- match. Apply once in the Supabase SQL editor. Idempotent.
-- ────────────────────────────────────────────────────────────────

create or replace function public.swap_bracket_slots(p_match_id uuid, p_other_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a public.tournament_matches;
  v_b public.tournament_matches;
  v_t public.tournaments;
  v_snap jsonb;
  v_after public.tournament_matches;
  v_id uuid;
begin
  if p_match_id = p_other_match_id then raise exception 'SAME_MATCH'; end if;
  -- Lock in a fixed order so two swaps can't deadlock each other.
  perform 1 from public.tournament_matches where id in (p_match_id, p_other_match_id) order by id for update;
  select * into v_a from public.tournament_matches where id = p_match_id;
  select * into v_b from public.tournament_matches where id = p_other_match_id;
  if v_a.id is null or v_b.id is null then raise exception 'MATCH_NOT_FOUND'; end if;

  select * into v_t from public.tournaments where id = v_a.tournament_id;
  if not (
    public.is_tournament_organizer(v_t) or public.has_venue_access(v_t.venue_id, 'manager') or public.is_super_admin()
  ) then
    raise exception 'FORBIDDEN';
  end if;
  if v_b.tournament_id <> v_a.tournament_id or v_a.stage <> 'knockout' or v_b.stage <> 'knockout'
     or v_a.round <> v_b.round or v_a.round_label <> v_b.round_label then
    raise exception 'NOT_SAME_ROUND';
  end if;
  if v_a.next_match_id is null or v_b.next_match_id is null then raise exception 'NOT_LINKED'; end if;

  -- Both next-round matches locked too, and neither may have started.
  perform 1 from public.tournament_matches where id in (v_a.next_match_id, v_b.next_match_id) order by id for update;
  if exists (
    select 1 from public.tournament_matches
    where id in (v_a.next_match_id, v_b.next_match_id)
      and (status in ('live','completed','walkover') or winner_team_id is not null)
  ) then
    raise exception 'NEXT_ROUND_STARTED';
  end if;

  -- Snapshot every row this touches for the audit.
  select jsonb_object_agg(m.id::text, to_jsonb(m)) into v_snap from public.tournament_matches m
    where m.id in (v_a.id, v_b.id, v_a.next_match_id, v_b.next_match_id);

  -- Take each winner out of the slot it went to (only if it is still
  -- the one sitting there; a team placed by hand is left alone).
  if v_a.winner_team_id is not null then
    update public.tournament_matches set
        team_a_id = case when v_a.next_match_slot = 'a' and team_a_id = v_a.winner_team_id then null else team_a_id end,
        team_b_id = case when v_a.next_match_slot = 'b' and team_b_id = v_a.winner_team_id then null else team_b_id end
      where id = v_a.next_match_id;
  end if;
  if v_b.winner_team_id is not null then
    update public.tournament_matches set
        team_a_id = case when v_b.next_match_slot = 'a' and team_a_id = v_b.winner_team_id then null else team_a_id end,
        team_b_id = case when v_b.next_match_slot = 'b' and team_b_id = v_b.winner_team_id then null else team_b_id end
      where id = v_b.next_match_id;
  end if;

  -- Swap the links.
  update public.tournament_matches set next_match_id = v_b.next_match_id, next_match_slot = v_b.next_match_slot where id = v_a.id;
  update public.tournament_matches set next_match_id = v_a.next_match_id, next_match_slot = v_a.next_match_slot where id = v_b.id;

  -- Put each winner into its new slot, if that slot is free.
  if v_a.winner_team_id is not null then
    update public.tournament_matches set
        team_a_id = case when v_b.next_match_slot = 'a' and team_a_id is null then v_a.winner_team_id else team_a_id end,
        team_b_id = case when v_b.next_match_slot = 'b' and team_b_id is null then v_a.winner_team_id else team_b_id end
      where id = v_b.next_match_id;
  end if;
  if v_b.winner_team_id is not null then
    update public.tournament_matches set
        team_a_id = case when v_a.next_match_slot = 'a' and team_a_id is null then v_b.winner_team_id else team_a_id end,
        team_b_id = case when v_a.next_match_slot = 'b' and team_b_id is null then v_b.winner_team_id else team_b_id end
      where id = v_a.next_match_id;
  end if;

  for v_id in select distinct x from unnest(array[v_a.id, v_b.id, v_a.next_match_id, v_b.next_match_id]) x loop
    select * into v_after from public.tournament_matches where id = v_id;
    if v_snap -> v_id::text is distinct from to_jsonb(v_after) then
      insert into public.tournament_match_audit (match_id, tournament_id, changed_by, change_type, old_value, new_value)
      values (v_id, v_after.tournament_id, auth.uid(), 'teams', v_snap -> v_id::text, to_jsonb(v_after));
    end if;
  end loop;

  return jsonb_build_object('tournament_id', v_a.tournament_id);
end;
$$;
revoke all on function public.swap_bracket_slots(uuid, uuid) from public, anon;
grant execute on function public.swap_bracket_slots(uuid, uuid) to authenticated;
