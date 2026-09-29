-- Organizer chooses the team captain (feature request, 2026-09-29).
--
-- 1. create_walkin_team no longer makes the first member the captain.
--    A member becomes captain only if the organizer ticked them
--    ({"captain": true} in p_members); otherwise the team has no captain.
--    Patches the LIVE definition in place (plain text replace), so it
--    can't bring back an older copy of the function from the repo.
--
-- 2. set_team_captain(p_team_player_id): the tournament owner/organizer,
--    a manager of the host venue, or a super admin makes that roster
--    member captain; the previous captain becomes a regular player.
--    Substitutes can't be made captain (it would change squad counts).
--
-- Safe to re-run.

do $$
declare
  fn_oid oid;
  old_def text;
  new_def text;
begin
  for fn_oid in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_walkin_team'
  loop
    old_def := pg_get_functiondef(fn_oid);
    new_def := replace(old_def,
      'case when i = 0 then ''captain'' else ''player'' end',
      'case when coalesce((v_member->>''captain'')::boolean, false) then ''captain'' else ''player'' end');
    if new_def = old_def and strpos(old_def, 'v_member->>''captain''') = 0 then
      raise exception 'create_walkin_team: expected text not found, nothing changed';
    end if;
    if new_def <> old_def then
      execute new_def;
    end if;
  end loop;
end;
$$;

create or replace function public.set_team_captain(p_team_player_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_player public.tournament_team_players;
  v_team public.tournament_teams;
  v_t public.tournaments;
begin
  select * into v_player from public.tournament_team_players where id = p_team_player_id;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
  select * into v_team from public.tournament_teams where id = v_player.team_id;
  select * into v_t from public.tournaments where id = v_team.tournament_id;

  if auth.uid() is null or not (
       coalesce(v_t.owner_id = auth.uid(), false)
       or public.is_super_admin()
       or coalesce(public.is_tournament_organizer(v_t), false)
       or (v_t.venue_id is not null and coalesce(public.has_venue_access(v_t.venue_id, 'manager'), false))
     ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_player.role = 'substitute' then raise exception 'SUBSTITUTE_CANNOT_BE_CAPTAIN'; end if;
  if v_player.role = 'captain' then return; end if;

  update public.tournament_team_players
     set role = 'player'
   where team_id = v_player.team_id and role = 'captain';

  update public.tournament_team_players
     set role = 'captain'
   where id = p_team_player_id;
end;
$$;
revoke all on function public.set_team_captain(uuid) from public, anon;
grant execute on function public.set_team_captain(uuid) to authenticated;
