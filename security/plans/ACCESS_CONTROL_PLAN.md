# ACCESS_CONTROL Fix Plan

## Changes

- `supabase/access_control_null_checks.sql` — rewrites the live definitions of the six functions so `if not (x = auth.uid() or …)` becomes `if not (coalesce(x = auth.uid(), false) or …)`. **Run 2026-09-29.**
- `supabase/access_control_write_guards.sql` — drop `tournament_teams_update_captain`; `guard_friend_request_update` (parties immutable, status accepted/declined only); `guard_booking_write` (direct API writes can't set `payment_status`, move a booking, or change status other than to cancelled). **Run 2026-09-29.**
- No app code change: the app never edits `tournament_teams` directly, only changes `friend_requests.status`, and inserts bookings as `confirmed` (still allowed).

## New files

- `supabase/access_control_null_checks.sql`, `supabase/access_control_write_guards.sql` (on `changes`)

## Verification goals

- [x] Every RPC taking a tournament/team/match/player/category id refuses an unrelated user (55/55; `register_team` open by design)
- [x] Ownership check is separate from authentication (a signed-in stranger is refused with FORBIDDEN)
- [x] Write policies can't be used to change ownership or status columns (team, friend request, booking)
- [x] Legitimate owners still succeed (captain, organizer, addressee, player join/cancel)
- [ ] (LOW) squad member add consent, poll move, event host impersonation, duplicate-policy cleanup

## Manual verification (for the human)

- Organizer: add a walk-in team and edit it in the Control Center.
- Captain: edit your team's details and a player's jersey number on the Register tab.
- Accept a friend request in the app.
- Pay for a tournament registration and approve it as super admin — confirms the payment functions still set payment status.
