# DATABASE_ACCESS Security Report

## Status: MEDIUM remaining until step 2 is run — was HIGH

The HIGH finding (anyone can write into anyone's notifications) is fixed and verified live. Column-level exposure of personal data is fixed in code; hiding the columns in the database (step 2) must wait until that code is deployed.

## Findings

Method: every table and view the API exposes (60, listed with the service key — the anon key can't read the schema) was read with (a) only the publishable key, (b) a brand-new signed-in account, (c) an anonymous Register-tab session; plus two catalog queries run by the owner in the SQL editor (RLS flags, always-true policies, views, definer functions).

### 1. Anyone could put notifications into anyone's bell — HIGH (fixed)
`notifications` had `"notifications insert" … for insert to authenticated with check (true)` (`supabase/notifications_insert_policy_fix.sql`). "Authenticated" includes the anonymous session any visitor gets from a tournament Register tab. **Proven**: an anonymous session inserted a row with its own title/body into another (test) user's notifications. `push_on_notification()` turns such rows into phone push alerts — a ready phishing channel ("Payment approved — pay here: …").

Related bug: `src/lib/mail/notify.ts` (commit 5e62e34, 2026-09-14) switched every write to an `emit_notification()` RPC whose SQL was "handed off separately" and **never created** — the function doesn't exist live, so ~17 kinds of in-app notification (payment approved/rejected, game published, organizer decisions …) have been failing silently since then, while the blanket policy it was meant to replace stayed in place.

### 2. Tournament team contact details readable by anyone — MEDIUM (fixed in code; DB step 2 pending)
`tournament_teams` is readable by the public key (128 of 130 teams) including `manager_email`, `contact_phone`, `contact_email`, `contact_person_name`, `club_address` — fields the site only shows to organizers and the team itself (`canManageTournament()` comment: "manager-only detail"). Manager/coach **name + phone** are also public, but that is by choice (shown on the public Teams tab) and stays.

### 3. Game hosts' phone and payment QR readable by anyone — MEDIUM (fixed in code; DB step 2 pending)
`games.host_phone` and `games.host_qr_path` are readable by the public key; the play-together page only shows them to players who have joined (`paymentInfoVisible`).

### 4. Private profiles' bio/city and stats readable — LOW (stats fixed; bio/city step 2 pending)
Profiles marked `is_public = false` still exposed `bio` and `city` through the API, and their game stats through the `player_stats` / `player_sports` views. (No private profiles exist yet, so nothing leaked in practice.)

### 5. Views that bypass RLS — LOW (fixed where it mattered)
Seven views run as their owner (no `security_invoker`), created in the dashboard and **not in the repo**: `event_players`, `events_full`, `events_with_counts`, `player_sports`, `player_stats`, `squad_poll_results`, `squads_with_counts`.
- `player_stats`, `player_sports`: every profile including private ones → now filtered.
- `squad_poll_results`: poll options and vote counts for **every squad** although polls are members-only elsewhere → now members only.
- The other four only show public listings, counts, or attendee name/avatar (shown on event pages) — left as is.

### 6. Other observations — LOW / INFO
- `events` has three duplicate always-true read policies (`Anyone can read events`, `Events are viewable by everyone`, `events_public_read`). Harmless; cleanup.
- Always-true SELECT on `courts`, `court_hours`, `court_availability_pings`, `pricing_rules`, `venues`, `payment_methods`, `platform_settings` (only `commission_rate`), `squads`, `squad_members`, `user_keys` (public keys by design), `profiles` (rows; sensitive columns handled by column grants) — all public-by-design catalog data.
- ~150 `SECURITY DEFINER` functions are executable by `anon`. Whether each checks the caller is covered in AUTH_MIDDLEWARE / ACCESS_CONTROL; spot checks (`find_user_by_email`, `find_user_for_staff_invite`, the three new functions) refuse correctly.

## What's at risk

- (1) Targeted phishing of any user through the app's own notification bell and push, from a throwaway session — no account needed.
- (2) Bulk scraping of registrants' emails, phone numbers and club addresses for every tournament.
- (3) Scraping every Play Together host's personal phone and wallet QR.
- (4) A user who marks their profile private still has bio/city/stats readable.

## What's already secure

- **RLS is enabled on every table** in `public` (catalog query returned no table without RLS).
- The public key cannot read the API schema ("Secret API key required").
- Signing in reveals **no extra rows** — a new account and an anonymous session see exactly what the public key sees on all 60 tables/views.
- Payments, bookings, court bookings, commissions, ledger, payouts, messages, conversations, notifications, push tokens, friend requests, walk-in roster (`tournament_team_players`, incl. guest phones), match audit, staff and managers: 0 rows to the public key and to other users.
- `profiles.phone` hidden (SEC-02b), `phone_codes` / `rate_limit_hits` denied to anon.
- Email-lookup RPCs refuse unauthenticated callers.

## Recommendations

1. Drop the notifications insert policy; write notifications server-side with the service role after the action's own checks. **Done.**
2. Hide team contact columns, game host payment columns and profile bio/city from anon/authenticated; serve them through checked functions. **Code done; step 2 SQL after deploy.**
3. Filter `player_stats`, `player_sports`, `squad_poll_results`. **Done.**
4. Commit the dashboard-created view definitions to the repo (now in `supabase/database_access_views.sql`).
5. Drop the two duplicate `events` read policies. (LOW)

## Verification (2026-09-29)

| Check | Result |
|---|---|
| Anonymous session inserts a notification for another user | before: **landed** → after: **blocked** |
| Service-role notification insert (new `notify.ts` path) | ok |
| `team_private_contacts` — organizer / captain / outsider / no login | contacts / contacts / nothing / denied |
| `game_host_payment_info` — outsider on a real game / no login | nothing / denied |
| `profile_about` — public profile, no login | returns bio/city |
| `player_stats` for a private profile — anonymous / other user / owner | 0 / 0 / 1 |
| `squad_poll_results` — anonymous / non-member / member | 0 / 0 / 1 (vote counted) |
| Production build of the new code: tournament page, Teams tab, play-together list + game page, `/p/<user>` + OG image | all 200; public profile still shows city via `profile_about` |

All tests used temporary accounts/rows, deleted afterwards. **Pending:** step 2 (column hiding) and its re-probe, after `fix/security-audit` is deployed.
