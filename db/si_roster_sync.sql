-- ── keep an open match's roster in step with the team ───────────
-- A contest copies both teams' players into context when it is opened.
-- Walk-in teams often add players after the first ball, and those
-- players could then never bat or bowl. Adding or editing a team player
-- now updates every unfinished contest of that team: new players are
-- appended, edited ones (name, jersey, position) changed in place.
-- Removed players stay in the contest: the event log may name them.

create or replace function public.si_sync_contest_player(p_tp public.tournament_team_players)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry jsonb;
  v_c record;
  v_side text;
  v_players jsonb;
begin
  select jsonb_build_object(
    'id', p_tp.id,
    'name', coalesce(pr.full_name, pr.name, pr.username, p_tp.guest_name, 'Player'),
    'number', p_tp.jersey_number,
    'userId', p_tp.user_id,
    'position', p_tp.position
  ) into v_entry
  from (select 1) one
  left join public.profiles pr on pr.id = p_tp.user_id;

  for v_c in
    select id, context from public.si_contests
    where match_id is not null
      and status not in ('completed', 'abandoned', 'cancelled')
      and p_tp.team_id::text in (context #>> '{sides,a,teamId}', context #>> '{sides,b,teamId}')
    for update
  loop
    foreach v_side in array array['a', 'b'] loop
      continue when v_c.context #>> array['sides', v_side, 'teamId'] is distinct from p_tp.team_id::text;
      v_players := coalesce(v_c.context #> array['sides', v_side, 'players'], '[]'::jsonb);
      if exists (select 1 from jsonb_array_elements(v_players) e where e->>'id' = p_tp.id::text) then
        select jsonb_agg(case when e->>'id' = p_tp.id::text then v_entry else e end order by ord)
          into v_players
          from jsonb_array_elements(v_players) with ordinality t(e, ord);
      else
        v_players := v_players || jsonb_build_array(v_entry);
      end if;
      v_c.context := jsonb_set(v_c.context, array['sides', v_side, 'players'], v_players);
    end loop;
    update public.si_contests set context = v_c.context where id = v_c.id;
  end loop;
end;
$$;
revoke all on function public.si_sync_contest_player(public.tournament_team_players) from public, anon, authenticated;

create or replace function public.si_team_player_synced()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.si_sync_contest_player(new);
  return new;
end;
$$;

drop trigger if exists si_team_player_sync on public.tournament_team_players;
create trigger si_team_player_sync
  after insert or update of user_id, guest_name, jersey_number, position on public.tournament_team_players
  for each row execute function public.si_team_player_synced();

-- backfill: matches already being scored pick up everyone added since
do $$
declare tp public.tournament_team_players;
begin
  for tp in
    select * from public.tournament_team_players t
    where exists (
      select 1 from public.si_contests c
      where c.match_id is not null
        and c.status not in ('completed', 'abandoned', 'cancelled')
        and t.team_id::text in (c.context #>> '{sides,a,teamId}', c.context #>> '{sides,b,teamId}')
    )
    order by t.joined_at
  loop
    perform public.si_sync_contest_player(tp);
  end loop;
end;
$$;
