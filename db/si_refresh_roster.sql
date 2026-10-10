-- Re-syncs a contest's frozen rosters and rules with the teams' current
-- players and the tournament's saved scoring rules (for example after a
-- cricket squad is raised to 10 or the innings is set to 10 overs).
-- Same permission check as scoring. Run once in the Supabase SQL editor.
drop function if exists public.si_refresh_roster(uuid, jsonb);
create or replace function public.si_refresh_roster(p_contest_id uuid, p_context jsonb, p_rules jsonb default null)
returns public.si_contests
language plpgsql security definer set search_path = public as $$
declare v_c public.si_contests;
begin
  select * into v_c from public.si_contests where id = p_contest_id for update;
  if not found then raise exception 'CONTEST_NOT_FOUND'; end if;
  if not public.si_can_score(v_c.tournament_id) then raise exception 'FORBIDDEN'; end if;
  if p_context is null or jsonb_typeof(p_context) <> 'object' then raise exception 'INVALID_CONTEXT'; end if;
  update public.si_contests
    set context = p_context, rules = coalesce(p_rules, rules)
    where id = p_contest_id returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.si_refresh_roster(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.si_refresh_roster(uuid, jsonb, jsonb) to authenticated;
