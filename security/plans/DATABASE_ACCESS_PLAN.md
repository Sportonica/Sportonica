# DATABASE_ACCESS Fix Plan

## Changes

- `src/lib/mail/notify.ts` — write notifications with the service role (`createServiceClient()`), dropping the never-deployed `emit_notification()` RPC; `import "server-only"`.
- `src/lib/play/hostActions.ts` — reschedule notifications via the service role (host check already above).
- `src/lib/tournaments/actions.ts` — `listTournamentTeams` / `getMyTeamForTournament` select `TEAM_PUBLIC_COLUMNS` and merge `team_private_contacts()`.
- `src/lib/playTogether/queries.ts` — select `GAME_PUBLIC_COLUMNS` instead of `*`.
- `src/app/play-together/[gameId]/page.tsx` — host phone/QR from `game_host_payment_info()`.
- `src/lib/playTogether/types.ts` — `host_phone` / `host_qr_path` optional (not selected any more).
- `src/lib/profile/columns.ts` — drop `bio`, `city` from `PUBLIC_PROFILE_COLUMNS`.
- `src/lib/profile/queries.ts` — `getProfileByUsername(Anon)` merge `profile_about()`.

## New files

- `src/lib/tournaments/columns.ts`, `src/lib/playTogether/columns.ts`
- `supabase/database_access_step1_functions.sql` — drop notifications insert policy; `team_private_contacts`, `game_host_payment_info`, `profile_about` (run 2026-09-29)
- `supabase/database_access_views.sql` — filtered `player_stats`, `player_sports`, `squad_poll_results` (run 2026-09-29)
- `supabase/database_access_step2_hide_columns.sql` — column grants (run AFTER deploy)

## Verification goals

- [x] Every table has RLS enabled
- [x] No always-true policy grants more than public-by-design catalog data (notifications insert removed)
- [x] An anonymous session cannot insert a notification for another user
- [x] Notifications written by the app (service role) still land
- [x] Signed-in / anonymous sessions see no more rows than the public key on any table
- [x] `team_private_contacts` returns contacts only to organizer / captain (and venue managers, super admins); nothing to outsiders; denied without login
- [x] `game_host_payment_info` returns nothing to outsiders; denied without login
- [x] Private profiles' stats hidden from others, visible to the owner
- [x] Squad poll results visible to members only
- [x] New code builds and the touched pages render (200) with the current schema
- [ ] After deploy + step 2: public key cannot read `tournament_teams.contact_email` etc., `games.host_phone`/`host_qr_path`, `profiles.bio`/`city`; `manager_phone`/`coach_phone`, avatars, names still readable
- [ ] After deploy + step 2: organizer Control Center + team sheet still show contacts; Register tab shows own team's contacts; joined player sees host phone/QR; public profile shows bio/city

## Manual verification (for the human)

- Merge + deploy `fix/security-audit`, then run `supabase/database_access_step2_hide_columns.sql`.
- As an organizer, open a tournament's Control Center → Registrations and the printable team sheet: contact phone/email/address visible.
- As a player who joined a paid Play Together game: host's phone and QR visible on the game page.
- Check a notification arrives (e.g. approve a test payment) — confirms the new write path in production.
