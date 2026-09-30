-- ================================================================
-- GROUP INVITES (security audit follow-up, ACCESS_CONTROL §6, 2026-09-30)
--
-- A group owner used to be able to add ANY user straight into their
-- group (policy members_creator_add), without that user agreeing.
-- Now the owner sends an invite, the player gets a notification, and
-- they're only added once they accept it on the group page.
--
--  • invite_to_squad(squad, user)       — owner only
--  • respond_squad_invite(invite, bool) — the invited player only
--  • squad_invites is read-only through the API; both functions above
--    are the only way to write to it.
--  • members_creator_add is dropped: through the API you can only add
--    yourself (members_join). Game groups and join-request approval add
--    members from SECURITY DEFINER triggers and are unaffected.
--
-- Deploy the app change (src/lib/squads/actions.ts inviteMember) right
-- after running this — the old "Add" button stops working once this runs.
-- Safe to re-run. Run AFTER game_groups.sql and notifications.sql.
-- ================================================================

create table if not exists public.squad_invites (
  id         uuid primary key default gen_random_uuid(),
  squad_id   uuid not null references public.squads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (squad_id, user_id)
);

create index if not exists squad_invites_user_idx
  on public.squad_invites (user_id, status);

alter table public.squad_invites enable row level security;

revoke all on public.squad_invites from anon, authenticated;
grant select on public.squad_invites to authenticated;

drop policy if exists "see own invites or as owner" on public.squad_invites;
create policy "see own invites or as owner"
  on public.squad_invites for select to authenticated using (
    user_id = auth.uid()
    or exists (select 1 from public.squads s
               where s.id = squad_invites.squad_id and s.creator_id = auth.uid())
  );

-- ── Owner invites a player ──────────────────────────────────────
create or replace function public.invite_to_squad(p_squad_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_squad  public.squads;
  v_status text;
  v_who    text;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_squad from public.squads where id = p_squad_id;
  if v_squad.id is null or v_squad.creator_id is distinct from v_me then
    raise exception 'FORBIDDEN';
  end if;

  -- Same answer whether the player doesn't exist or has blocked the
  -- owner (or the other way round), so an invite can't be used to find
  -- out about a block.
  if p_user_id = v_me
     or not exists (select 1 from public.profiles where id = p_user_id)
     or exists (select 1 from public.blocked_users
                where (blocker_id = v_me and blocked_id = p_user_id)
                   or (blocker_id = p_user_id and blocked_id = v_me)) then
    raise exception 'SQUAD_INVITE_NOT_ALLOWED';
  end if;

  if exists (select 1 from public.squad_members
             where squad_id = p_squad_id and user_id = p_user_id) then
    raise exception 'SQUAD_ALREADY_MEMBER';
  end if;

  select status into v_status from public.squad_invites
   where squad_id = p_squad_id and user_id = p_user_id;
  -- Already asked: don't notify again. A player who said no isn't asked
  -- twice — they can still join by themselves.
  if v_status = 'pending' then return; end if;
  if v_status = 'declined' then raise exception 'SQUAD_INVITE_DECLINED'; end if;

  insert into public.squad_invites (squad_id, user_id, invited_by)
  values (p_squad_id, p_user_id, v_me)
  on conflict (squad_id, user_id)
  do update set status = 'pending', invited_by = excluded.invited_by, created_at = now();

  select coalesce(full_name, 'Someone') into v_who from public.profiles where id = v_me;

  insert into public.notifications (user_id, kind, title, body, actor_id, squad_id)
  values (
    p_user_id, 'event',
    coalesce(v_who, 'Someone') || ' invited you to join ' || v_squad.name,
    'Open the group to accept or decline.',
    v_me, p_squad_id
  );
end;
$$;
revoke execute on function public.invite_to_squad(uuid, uuid) from public, anon;
grant execute on function public.invite_to_squad(uuid, uuid) to authenticated;

-- ── The invited player accepts or declines ──────────────────────
create or replace function public.respond_squad_invite(p_invite_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me     uuid := auth.uid();
  v_invite public.squad_invites;
  v_squad  public.squads;
  v_count  integer;
  v_who    text;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;

  select * into v_invite from public.squad_invites
   where id = p_invite_id and user_id = v_me and status = 'pending'
   for update;
  if v_invite.id is null then raise exception 'SQUAD_INVITE_NOT_FOUND'; end if;

  if not coalesce(p_accept, false) then
    update public.squad_invites set status = 'declined' where id = v_invite.id;
    return;
  end if;

  select * into v_squad from public.squads where id = v_invite.squad_id;
  select count(*) into v_count from public.squad_members where squad_id = v_squad.id;
  if v_squad.cap is not null and v_count >= v_squad.cap then
    raise exception 'SQUAD_FULL';
  end if;

  insert into public.squad_members (squad_id, user_id, role)
  values (v_squad.id, v_me, 'member')
  on conflict do nothing;

  update public.squad_invites set status = 'accepted' where id = v_invite.id;

  select coalesce(full_name, 'Someone') into v_who from public.profiles where id = v_me;
  insert into public.notifications (user_id, kind, title, body, actor_id, squad_id)
  values (
    v_squad.creator_id, 'event',
    coalesce(v_who, 'Someone') || ' joined ' || v_squad.name,
    'They accepted your invite.',
    v_me, v_squad.id
  );
end;
$$;
revoke execute on function public.respond_squad_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_squad_invite(uuid, boolean) to authenticated;

-- ── Nobody can be added directly any more ───────────────────────
-- members_join (user_id = auth.uid()) still lets you add yourself.
drop policy if exists members_creator_add on public.squad_members;

-- ── Verify (run after) ──────────────────────────────────────────
-- select policyname from pg_policies where tablename = 'squad_members' and cmd = 'INSERT';  -- members_join only
-- select has_function_privilege('anon', 'public.invite_to_squad(uuid, uuid)', 'execute');    -- false
