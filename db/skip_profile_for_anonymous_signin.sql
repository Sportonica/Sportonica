-- ────────────────────────────────────────────────────────────────
-- Fix: anonymous sign-ins (TournamentRegisterTab's signInAnonymously(),
-- fired on mount for any logged-out visitor who opens a tournament's
-- Register tab) create a real auth.users row. handle_new_user() then
-- unconditionally inserts a matching profiles row defaulted to
-- role = 'player' with a blank name/phone — a drive-by page view, not
-- a signup, ends up counted as a "player" everywhere profiles is read
-- (including /platform/users).
--
-- This supersedes handle_new_user() from supabase/identity_validation.sql
-- (see git history — that file has since moved to the sportonica-changes
-- repo) with exactly one change: bail out before the insert when
-- new.is_anonymous is true. Anonymous sessions still get created and
-- auth.uid() still works for register_team() etc. — they just no longer
-- get a profiles row, matching how the app already treats them
-- everywhere else (authCache.ts, proxy.ts, deleteAccount.ts all filter
-- is_anonymous out already).
--
-- REVIEW BEFORE RUNNING. Apply once in the Supabase SQL editor against
-- production. Idempotent (create-or-replace).
--
-- This only prevents NEW ghost rows. Existing ones (profiles with no
-- full_name/name/username/phone, role='player') can be found with:
--   select p.id, p.role, p.full_name, p.phone
--     from public.profiles p
--     join auth.users u on u.id = p.id
--    where u.is_anonymous;
-- and cleaned up separately once confirmed safe to delete.
-- ────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text;
  v_phone text;
begin
  if new.is_anonymous then
    return new;
  end if;

  v_role := coalesce(new.raw_user_meta_data->>'role', 'player');
  if v_role not in ('player', 'venue_owner') then
    v_role := 'player';
  end if;

  if new.email is not null and not public.is_valid_email(lower(new.email)) then
    raise exception 'EMAIL_INVALID';
  end if;

  v_phone := public.normalize_phone(new.raw_user_meta_data->>'phone');
  if v_phone is not null then
    if length(v_phone) <> 10 then
      raise exception 'PHONE_INVALID';
    end if;
    if exists (select 1 from public.profiles where phone = v_phone) then
      raise exception 'PHONE_TAKEN';
    end if;
  end if;

  insert into public.profiles (id, full_name, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    v_role,
    v_phone
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
