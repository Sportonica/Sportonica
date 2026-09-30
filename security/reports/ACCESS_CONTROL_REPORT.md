# ACCESS_CONTROL Security Report

## Status: PASS (after fixes) — was HIGH

Four IDOR-class problems at the database layer, all fixed and verified live on 2026-09-29: fail-open NULL checks in six functions, and three over-broad UPDATE policies (team self-confirm/move, forced friendships, self-marked payments). Plus the storage and partnership holes already covered in SECRETS_EXPOSURE and AUTH_MIDDLEWARE.

## Findings

Method: (1) an unrelated signed-in "attacker" called **every** RPC that takes a tournament / team / match / player / category id (55 functions) against a temporary "victim" tournament, comparing a hash of all the victim's rows before and after each call; (2) every write policy (`pg_policies` for INSERT/UPDATE/DELETE/ALL) was reviewed and the risky ones exercised with test accounts; (3) server actions using the service role were checked for ownership.

### 1. Permission checks that fail open on NULL — HIGH (fixed)
Six `SECURITY DEFINER` functions guarded with `if not (x = auth.uid() or …) then raise`. When `x` is NULL the whole condition is NULL, `IF NULL` doesn't raise, and the check passes:
- `update_team_details`, `set_team_player_jersey_number`, `set_team_player_position`, `add_team_guest_player`, `remove_team_guest_player` — `v_team.captain_id` is NULL on **walk-in teams** (created by organizers, no captain). **Proven**: an unrelated user changed a walk-in team's details, a player's jersey number and position; add/remove guest player were only stopped by the roster being locked.
- `set_venue_booking_status` — `v_vendor_id` is NULL for tournaments at their **own venue**. **Proven**: an unrelated user flipped `venue_booking_status`, which also sends the owner a notification that looks like it came from a venue.

### 2. Captains could confirm their own team and move it — HIGH (fixed)
`tournament_teams_update_captain` (`using/with check captain_id = auth.uid()`) allowed any column. **Proven**: a captain set their team `pending → confirmed` (skipping payment and organizer approval), moved it into a different tournament, and set its seed / `is_walkin`.

### 3. Forced friendships — MEDIUM (fixed)
`friend_requests` "addressee decides" allowed any column. **Proven**: the addressee rewrote `requester_id` to an unrelated third user and accepted — a friendship the third user never asked for — and then opened a DM with them (`conversations` requires friendship).

### 4. Players could mark their own booking paid — MEDIUM (fixed)
`bookings` "Users can cancel their own booking" allowed any column. **Proven**: a player set `payment_status = 'paid'` on their own booking; the payment functions are the only thing meant to set it.

### 5. Reviewed and fine
- **53 of 55 id-taking RPCs** refused the attacker with FORBIDDEN (after the NULL fix: all 55, except `register_team`, which is legitimately open during registration).
- Write policies scoped correctly: blocks, favourites, push tokens, user keys, conversation reads, notifications (own), squads/polls/members (creator/member), venue staff/courts/hours/pricing/blocks/payouts (`has_venue_access`), payments/payment methods/commissions/reports/platform settings (super admin), DMs (sender + participant + not blocked).
- Venue owners **cannot** self-verify — `verification_status` is already guarded by a trigger (`VENUE_FIELD_NOT_EDITABLE`).
- Service-role server actions: `updateHostedGame` checks the host; `deleteMyAccount` is self-only; phone sign-in/up take no resource ids; `availability.ts` reads only slot times.
- Cross-referenced (fixed in other categories): storage upload/delete into other users' folders (SECRETS_EXPOSURE), organizer self-approving partnerships (AUTH_MIDDLEWARE), private contact columns (DATABASE_ACCESS).

### 6. LOW, not fixed
- `squad_members` "members_creator_add": a squad creator can add any user without their consent.
- `squad_polls` "polls_close": a poll creator could move their poll into another squad.
- `events_owner_write`: a venue owner can create an event naming another user as host.
- Duplicate policies on `bookings`, `events`, `profiles`, `notifications` (tidy-up).

### 7. Second NULL pattern (found under PAYMENT_WEBHOOKS)
`if x <> auth.uid() then raise` fails open the same way — 15 occurrences (captain/host/player checks). Proven: a stranger confirmed another organizer's walk-in registration via `confirm_free_booking`. Fixed in `supabase/access_control_null_checks_2.sql` (`is distinct from`). See PAYMENT_WEBHOOKS_REPORT.

## What's at risk (before the fixes)

Anyone signed in (including a throwaway anonymous session) could edit any walk-in team and its players; captains could get into a paid tournament without paying; users could force friendships and DMs on strangers; players could mark event bookings as paid.

## What's already secure

Ownership is enforced in the database for every table that holds user data, and in every tournament RPC for teams with a captain; guard triggers already protected profile roles/trust and venue verification.

## Recommendations

1. Make permission checks NULL-safe (`coalesce(…, false)`). **Done** (`supabase/access_control_null_checks.sql`).
2. Drop `tournament_teams_update_captain`; add guard triggers on `friend_requests` and `bookings`. **Done** (`supabase/access_control_write_guards.sql`).
3. Going forward: write checks as `if x is distinct from auth.uid() and not is_admin then raise` — `is distinct from` treats NULL safely.
4. Tidy the LOW items and duplicate policies.

## Verification (2026-09-29)

| Attack (unrelated user / owner of the row) | Before | After |
|---|---|---|
| Edit a walk-in team's details, jersey, position; add/remove guest | changed data | **FORBIDDEN** |
| Flip an own-venue tournament's venue booking status | changed data | **FORBIDDEN** |
| Captain sets own team confirmed / moves it | allowed | **0 rows** (policy gone) |
| Addressee rewrites requester + accepts | forced friendship | **FRIEND_REQUEST_PARTIES_IMMUTABLE** |
| Player sets own booking paid / inserts it paid | allowed | **BOOKING_PAYMENT_STATUS_NOT_EDITABLE** |
| Legit: captain edits own team; organizer edits walk-in team | — | works |
| Legit: addressee accepts; player joins and cancels an event | — | works |
| 55 id-taking tournament RPCs as an unrelated user | 6 changed data | **0 changed** |

All tests used temporary accounts and rows, deleted afterwards.
