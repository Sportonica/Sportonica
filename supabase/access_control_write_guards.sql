-- ================================================================
-- Write-policy hardening (security audit — ACCESS_CONTROL, 2026-09-29)
--
-- Postgres UPDATE policies without a column restriction let the owner of
-- a row change ANY column of it. Verified live with test accounts:
--
--  1. tournament_teams_update_captain — a captain set their own team
--     pending → confirmed (skipping payment + organizer approval), moved
--     the team into a different tournament, and set its seed. The app
--     never edits teams directly (every edit goes through a SECURITY
--     DEFINER function: update_team_details, update_team_name, …), so the
--     policy is dropped.
--
--  2. friend_requests "addressee decides" — the addressee rewrote
--     requester_id to a third user and accepted, forcing a friendship,
--     then opened a DM with them. Now the two parties can't change and
--     status can only become accepted/declined.
--
--  3. bookings — a player set their own booking to payment_status =
--     'paid'. payment_status is only set by the payment functions
--     (submit_payment / review_payment, which run as the owner). Direct
--     API writes may still insert a 'confirmed' booking (that's how joining
--     an event works) and cancel their own, but can't touch payment_status
--     or move a booking to another event/user.
--
-- The triggers only restrict direct API writes (current_user = the
-- authenticated/anon role); SECURITY DEFINER functions run as the owner
-- and are unaffected. Safe to re-run.
-- ================================================================

-- ── 1. teams: no direct captain edits ───────────────────────────
drop policy if exists tournament_teams_update_captain on public.tournament_teams;

-- ── 2. friend requests: parties fixed, status only ──────────────
create or replace function public.guard_friend_request_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.requester_id is distinct from old.requester_id
       or new.addressee_id is distinct from old.addressee_id then
      raise exception 'FRIEND_REQUEST_PARTIES_IMMUTABLE';
    end if;
    if new.status is distinct from old.status
       and new.status not in ('accepted', 'declined') then
      raise exception 'FRIEND_REQUEST_INVALID_STATUS';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_friend_request_update on public.friend_requests;
create trigger guard_friend_request_update
  before update on public.friend_requests
  for each row execute function public.guard_friend_request_update();

-- ── 3. bookings: players can't mark themselves paid ─────────────
create or replace function public.guard_booking_write()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.payment_status in ('paid', 'pending_verification') then
        raise exception 'BOOKING_PAYMENT_STATUS_NOT_EDITABLE';
      end if;
    else
      if new.payment_status is distinct from old.payment_status then
        raise exception 'BOOKING_PAYMENT_STATUS_NOT_EDITABLE';
      end if;
      if new.user_id is distinct from old.user_id
         or new.event_id is distinct from old.event_id then
        raise exception 'BOOKING_NOT_MOVABLE';
      end if;
      if new.status is distinct from old.status and new.status <> 'cancelled' then
        raise exception 'BOOKING_STATUS_NOT_EDITABLE';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_booking_write on public.bookings;
create trigger guard_booking_write
  before insert or update on public.bookings
  for each row execute function public.guard_booking_write();
