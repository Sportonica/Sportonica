-- Fail-open permission checks (security audit - ACCESS_CONTROL, 2026-09-29).
-- `if not (x = auth.uid() or ...)` passes silently when x is NULL (a walk-in
-- team with no captain, or a tournament at its own venue). This rewrites the
-- live definitions so those checks fail closed. Safe to re-run.
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
       and (strpos(p.prosrc, 'v_team.captain_id = auth.uid() or v_is_admin') > 0
         or strpos(p.prosrc, 'v_vendor_id = auth.uid() or public.is_super_admin()') > 0)
  loop
    old_def := pg_get_functiondef(fn_oid);
    new_def := replace(old_def,
      'if not (v_team.captain_id = auth.uid() or v_is_admin)',
      'if not (coalesce(v_team.captain_id = auth.uid(), false) or coalesce(v_is_admin, false))');
    new_def := replace(new_def,
      'if not (v_vendor_id = auth.uid() or public.is_super_admin())',
      'if not (coalesce(v_vendor_id = auth.uid(), false) or public.is_super_admin())');
    if new_def <> old_def then
      execute new_def;
    end if;
  end loop;
end;
$$;
