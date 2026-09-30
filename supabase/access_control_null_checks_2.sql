-- Fail-open permission checks, part 2 (security audit, 2026-09-29).
-- `if x <> auth.uid() then raise` passes silently when x is NULL, e.g.
-- tournament_teams.captain_id on a walk-in team. Verified live: an
-- unrelated user confirmed someone else's walk-in team registration via
-- confirm_free_booking(). `is distinct from` is identical for real values
-- and treats NULL as "not you", so the check raises. Every occurrence of
-- these exact strings in the repo is inside `if ... then raise` (checked).
-- Patches the live definitions in place. Safe to re-run.
do $$
declare
  fn_oid oid;
  old_def text;
  new_def text;
begin
  for fn_oid in
    select p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and (strpos(p.prosrc, 'v_team.captain_id <> auth.uid() then') > 0
         or strpos(p.prosrc, 'v_host <> auth.uid() then') > 0
         or strpos(p.prosrc, 'v_game.host_id <> auth.uid() then') > 0
         or strpos(p.prosrc, 'v_row.user_id <> auth.uid() then') > 0)
  loop
    old_def := pg_get_functiondef(fn_oid);
    new_def := replace(old_def, 'v_team.captain_id <> auth.uid() then', 'v_team.captain_id is distinct from auth.uid() then');
    new_def := replace(new_def, 'v_host <> auth.uid() then', 'v_host is distinct from auth.uid() then');
    new_def := replace(new_def, 'v_game.host_id <> auth.uid() then', 'v_game.host_id is distinct from auth.uid() then');
    new_def := replace(new_def, 'v_row.user_id <> auth.uid() then', 'v_row.user_id is distinct from auth.uid() then');
    if new_def <> old_def then
      execute new_def;
    end if;
  end loop;
end;
$$;
