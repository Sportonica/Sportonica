-- A refunded booking gives its court slot back.
--
-- Before: court_booking_slot_state() said "booked" whenever payment_status
-- was paid or partial, whatever the state. A venue marking a paid booking
-- "Refunded" changes only the state, so the slot stayed blocked and nobody
-- else could book it.
--
-- Same function as live (RUN_ME_advance_payment.sql) with one line added
-- first. The no-overlap constraint is rebuilt so its index uses the new
-- rule; this only frees slots, so the rebuild can't find a new clash.
-- Safe to re-run.

create or replace function public.court_booking_slot_state(
  p_state text, p_payment_status text, p_source text, p_created_at timestamptz
) returns text language sql immutable as $$
  select case
    when p_state = 'refunded' then 'free'
    when p_payment_status in ('paid', 'partial') then 'booked'
    when p_state in ('confirmed','checked_in','played','paid') then 'booked'
    when p_source in ('walk_in','phone') and p_state = 'confirmed' then 'booked'
    else 'free'
  end
$$;

alter table public.court_bookings
  drop constraint if exists court_bookings_no_overlap;

alter table public.court_bookings
  add constraint court_bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (
    public.court_booking_slot_state(state, payment_status, source, created_at) = 'booked'
  );
