-- Permanently deletes a cancelled or draft tournament. Super admin only.
-- A live, published, or completed tournament is refused. Dependent rows
-- (teams, matches, contests) go through their ON DELETE CASCADE keys.
-- payments.tournament_registration_id is ON DELETE RESTRICT, so the
-- payment rows of this tournament's teams are deleted first (the same
-- thing the admin delete-team function does). Any other foreign key
-- without a cascade makes this fail with FK_BLOCKED and nothing is
-- deleted. Run once in the Supabase SQL editor (replaces the earlier version).
create or replace function public.delete_tournament(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.is_super_admin() then raise exception 'FORBIDDEN'; end if;
  select status::text into v_status from public.tournaments where id = p_id for update;
  if not found then raise exception 'TOURNAMENT_NOT_FOUND'; end if;
  if v_status not in ('cancelled', 'draft') then
    raise exception 'ONLY_CANCELLED_OR_DRAFT';
  end if;
  begin
    delete from public.payments
      where tournament_registration_id in (select id from public.tournament_teams where tournament_id = p_id);
    delete from public.tournaments where id = p_id;
  exception when foreign_key_violation then
    raise exception 'FK_BLOCKED';
  end;
end;
$$;
revoke all on function public.delete_tournament(uuid) from public, anon;
grant execute on function public.delete_tournament(uuid) to authenticated;
