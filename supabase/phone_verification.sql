-- ================================================================
-- SEC-03: phone numbers must be verified before they count
--
-- Until now any 10-digit number could be put on a profile (phone
-- signup, profile edit, or a direct PATCH), and
-- claim_guest_tournament_entries() handed every walk-in roster entry
-- with that number to whoever held it — 436 unclaimed entries at the
-- time of writing. This adds:
--
--   1. profiles.phone_verified_at — set only by the server (service
--      role) after a correct SMS code. Any change of phone made with an
--      end-user JWT clears it, and such a JWT can never set it.
--   2. phone_codes — hashed one-time codes, service role only.
--   3. user_id_for_email() — service-role lookup used to free a number.
--   4. claim_guest_tournament_entries() — matches only a verified
--      phone, or a confirmed, real (non-synthetic) email.
--
-- Pairs with src/lib/phone/* on main. Run before or after deploying;
-- the app writes phone_verified_at only once an SMS provider is set.
-- Safe to re-run.
-- ================================================================

-- ── 1. verified flag + guard ────────────────────────────────────
alter table public.profiles add column if not exists phone_verified_at timestamptz;

-- Not granted to anon/authenticated (SEC-02b grants profiles columns
-- one by one); the owner reads it through get_my_profile().

create or replace function public.guard_profile_phone_verified()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Auth server, service role, SQL editor: no end-user JWT.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.phone_verified_at := null;
  elsif new.phone is distinct from old.phone then
    new.phone_verified_at := null;
  else
    new.phone_verified_at := old.phone_verified_at;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_phone_verified on public.profiles;
create trigger guard_profile_phone_verified
  before insert or update on public.profiles
  for each row execute function public.guard_profile_phone_verified();

-- ── 2. one-time codes ───────────────────────────────────────────
create table if not exists public.phone_codes (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null,                 -- 10 digits
  purpose     text not null check (purpose in ('signup', 'verify')),
  user_id     uuid references auth.users (id) on delete cascade,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists phone_codes_lookup
  on public.phone_codes (phone, purpose, created_at desc);

alter table public.phone_codes enable row level security;
revoke all on public.phone_codes from anon, authenticated;

-- ── 3. number lookup for takeovers ──────────────────────────────
-- Lets the server find the phone-signup account sitting on a number's
-- internal address (<digits>@phone.sportonica.com), so a verified owner
-- can take the number over. The admin API has no lookup by email.
create or replace function public.user_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke all on function public.user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.user_id_for_email(text) to service_role;

-- ── 4. claims need a verified phone / confirmed real email ──────
create or replace function public.claim_guest_tournament_entries()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_email text;
  v_count int;
begin
  select
    case when au.phone_confirmed_at is not null then au.phone end,
    case when au.email_confirmed_at is not null
          and au.email not ilike '%@phone.sportonica.com' then au.email end
    into v_phone, v_email
    from auth.users au where au.id = auth.uid();

  if v_phone is null or length(trim(v_phone)) = 0 then
    select phone into v_phone from public.profiles
     where id = auth.uid() and phone_verified_at is not null;
  end if;

  update public.tournament_team_players
  set user_id = auth.uid()
  where user_id is null
    and (
      (v_phone is not null and guest_phone is not null
        and right(regexp_replace(guest_phone, '\D', '', 'g'), 10) = right(regexp_replace(v_phone, '\D', '', 'g'), 10)
        and length(regexp_replace(guest_phone, '\D', '', 'g')) >= 7)
      or (v_email is not null and guest_email is not null and lower(trim(guest_email)) = lower(trim(v_email)))
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.claim_guest_tournament_entries() to authenticated;

-- ── Verify (run after) ──────────────────────────────────────────
-- select has_table_privilege('authenticated', 'public.phone_codes', 'select');            -- false
-- select has_column_privilege('authenticated', 'public.profiles', 'phone_verified_at', 'select'); -- false
-- select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'guard_profile_phone_verified';
-- select has_function_privilege('authenticated', 'public.user_id_for_email(text)', 'execute');   -- false
-- select count(*) from public.profiles where phone_verified_at is not null;              -- 0 at first
