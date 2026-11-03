-- ================================================================
-- TOURNAMENT ADMIN EDITS (2026-11-03): four things an organiser could
-- not change after registration.
--   1. admin_update_team_profile: club, address, contact person, phone,
--      email and logo. update_team_details() requires every field, so
--      walk-in teams with no club on file could never be edited.
--   2. set_team_group: move a team to another group any time.
--      set_team_seed() only works while registration is closed.
--   3. set_team_player_role: switch a roster member between player and
--      substitute, with the same squad limits as adding one.
--   4. update_ / delete_tournament_announcement.
-- Each one: the tournament's organiser, a manager of its venue, or a
-- super admin. Nothing existing is changed. Safe to re-run.
-- ================================================================

create or replace function public.admin_can_edit_tournament(p_tournament_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_t public.tournaments;
begin
  select * into v_t from public.tournaments where id = p_tournament_id;
  if not found then return false; end if;
  return auth.uid() is not null and (
    coalesce(v_t.owner_id = auth.uid(), false)
    or coalesce(public.is_tournament_organizer(v_t), false)
    or (v_t.venue_id is not null and coalesce(public.has_venue_access(v_t.venue_id, 'manager'), false))
    or public.is_super_admin()
  );
end;
$$;
revoke all on function public.admin_can_edit_tournament(uuid) from public, anon;
grant execute on function public.admin_can_edit_tournament(uuid) to authenticated;

-- ── 1. team profile: only the keys sent change; "" clears one ───────
create or replace function public.admin_update_team_profile(p_team_id uuid, p jsonb)
returns public.tournament_teams
language plpgsql security definer set search_path = public as $$
declare v_team public.tournament_teams;
begin
  select * into v_team from public.tournament_teams where id = p_team_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if not public.admin_can_edit_tournament(v_team.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'INVALID_TEAM_PROFILE'; end if;

  update public.tournament_teams set
    club_name           = case when p ? 'club_name'           then nullif(trim(p->>'club_name'), '')           else club_name end,
    club_address        = case when p ? 'club_address'        then nullif(trim(p->>'club_address'), '')        else club_address end,
    contact_person_name = case when p ? 'contact_person_name' then nullif(trim(p->>'contact_person_name'), '') else contact_person_name end,
    contact_phone       = case when p ? 'contact_phone'       then nullif(trim(p->>'contact_phone'), '')       else contact_phone end,
    contact_email       = case when p ? 'contact_email'       then nullif(trim(p->>'contact_email'), '')       else contact_email end,
    logo_url            = case when p ? 'logo_url'            then nullif(trim(p->>'logo_url'), '')            else logo_url end
  where id = p_team_id
  returning * into v_team;
  return v_team;
end;
$$;
revoke all on function public.admin_update_team_profile(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_team_profile(uuid, jsonb) to authenticated;

-- ── 2. group: any time; fixtures already made keep their own group ──
create or replace function public.set_team_group(p_team_id uuid, p_group_name text)
returns public.tournament_teams
language plpgsql security definer set search_path = public as $$
declare
  v_team public.tournament_teams;
  v_group text := nullif(trim(coalesce(p_group_name, '')), '');
begin
  select * into v_team from public.tournament_teams where id = p_team_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if not public.admin_can_edit_tournament(v_team.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if v_group is not null and length(v_group) > 40 then raise exception 'GROUP_NAME_TOO_LONG'; end if;

  update public.tournament_teams set group_name = v_group where id = p_team_id returning * into v_team;
  return v_team;
end;
$$;
revoke all on function public.set_team_group(uuid, text) from public, anon;
grant execute on function public.set_team_group(uuid, text) to authenticated;

-- ── 3. player <-> substitute ────────────────────────────────────────
create or replace function public.set_team_player_role(p_team_player_id uuid, p_role text)
returns public.tournament_team_players
language plpgsql security definer set search_path = public as $$
declare
  v_row public.tournament_team_players;
  v_team public.tournament_teams;
  v_t public.tournaments;
  v_players int;
  v_subs int;
begin
  if p_role not in ('player', 'substitute') then raise exception 'INVALID_ROLE'; end if;
  select * into v_row from public.tournament_team_players where id = p_team_player_id for update;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;
  select * into v_team from public.tournament_teams where id = v_row.team_id for update;
  if not public.admin_can_edit_tournament(v_team.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if v_row.role = 'captain' then raise exception 'CAPTAIN_ROLE_LOCKED'; end if;
  if v_row.role = p_role then return v_row; end if;

  select * into v_t from public.tournaments where id = v_team.tournament_id;
  select count(*) filter (where role <> 'substitute'), count(*) filter (where role = 'substitute')
    into v_players, v_subs
    from public.tournament_team_players where team_id = v_row.team_id;
  if p_role = 'substitute' and v_subs >= v_t.substitute_limit then raise exception 'SUBSTITUTE_LIMIT_REACHED'; end if;
  if p_role = 'player' and v_players >= v_t.max_players_per_team then raise exception 'ROSTER_FULL'; end if;

  update public.tournament_team_players set role = p_role where id = p_team_player_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_team_player_role(uuid, text) from public, anon;
grant execute on function public.set_team_player_role(uuid, text) to authenticated;

-- ── 4. announcements: edit or delete (no new notification is sent) ──
create or replace function public.update_tournament_announcement(p_id uuid, p_title text, p_body text default null)
returns public.tournament_announcements
language plpgsql security definer set search_path = public as $$
declare v_row public.tournament_announcements;
begin
  if p_title is null or length(trim(p_title)) = 0 then raise exception 'TITLE_REQUIRED'; end if;
  select * into v_row from public.tournament_announcements where id = p_id for update;
  if not found then raise exception 'ANNOUNCEMENT_MISSING'; end if;
  if not public.admin_can_edit_tournament(v_row.tournament_id) then raise exception 'FORBIDDEN'; end if;

  update public.tournament_announcements
     set title = trim(p_title), body = nullif(trim(coalesce(p_body, '')), '')
   where id = p_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.update_tournament_announcement(uuid, text, text) from public, anon;
grant execute on function public.update_tournament_announcement(uuid, text, text) to authenticated;

create or replace function public.delete_tournament_announcement(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row public.tournament_announcements;
begin
  select * into v_row from public.tournament_announcements where id = p_id for update;
  if not found then raise exception 'ANNOUNCEMENT_MISSING'; end if;
  if not public.admin_can_edit_tournament(v_row.tournament_id) then raise exception 'FORBIDDEN'; end if;
  delete from public.tournament_announcements where id = p_id;
end;
$$;
revoke all on function public.delete_tournament_announcement(uuid) from public, anon;
grant execute on function public.delete_tournament_announcement(uuid) to authenticated;

-- ── DONE ─────────────────────────────────────────────────────────
