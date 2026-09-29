# AUTH_MIDDLEWARE Security Report

## Status: PASS (after fixes) — was CRITICAL

Two authorization holes at the database layer — one CRITICAL, one HIGH — both fixed and verified live on 2026-09-29. The Next.js layer (server actions, route handlers, proxy gates) was already sound.

## Findings

This app has three kinds of "route": Next.js route handlers, server actions (each exported `"use server"` function is a public POST endpoint), and Supabase RPCs (every function in `public` is callable with the publishable key unless EXECUTE is revoked). All three were inventoried.

### 1. Internal database helpers callable by anyone, no login — CRITICAL (fixed)
A catalog query for `SECURITY DEFINER` functions whose body never references the caller (`auth.uid()`, `is_super_admin()`, venue/organizer/squad checks) found 23; 20 were executable by `anon`. Nine of those change state and are meant to be called only from guarded functions or pg_cron:

`build_knockout_bracket`, `build_round_robin`, `propagate_match_winner`, `reset_downstream_from`, `finalize_play_together_game`, `maybe_publish_hosted_event`, `expire_stale_court_holds`, `auto_close_expired_tournament_registrations`, `send_due_play_together_reminders`

Postgres grants EXECUTE to PUBLIC by default, so they were also callable straight from the API. **Proven with no login** on a temporary tournament: `build_round_robin` created fixtures, `propagate_match_winner` set a winner, `reset_downstream_from` wiped downstream results. Tournament ids are public — anyone could rewrite any live bracket.

### 2. Organizers could approve their own venue partnership — HIGH (fixed)
`partnerships_update` allowed `organizer_id = auth.uid() OR vendor_id = auth.uid()` for any change, so an organizer could set their own invite to `active` without the venue owner accepting. `is_tournament_organizer()` treats an active partnership as permission to run tournaments at that vendor's venues. **Proven** with test accounts.

### 3. Server actions — PASS
208 exported server actions in 24 files, classified automatically then reviewed:
- 175 look up the caller and **all 175 exit early** when there's no user (one flagged by the script, `deleteMyAccount`, checked by hand — it does).
- Admin-only actions check the role in the database: all 11 in `src/lib/platform/actions.ts` and all 11 in `src/lib/payments/adminActions.ts` go through `requireSuperAdmin()` (`is_super_admin()` RPC, not user_metadata); venue actions use `has_venue_access`; organizer approval goes through `approve_organizer_request`, which returns FORBIDDEN to a plain user and to a pending organizer approving themselves (tested).
- 33 don't check the caller explicitly: `signInWithPhone` / `signUpWithPhone` (public by design; CAPTCHA + rate limits from SEC-04), `resetPassword` (checks via `canResetPassword()`), and public reads (standings, stats, public rosters, slots, pricing, listings). Every one of these uses the caller's own Supabase session, so RLS applies — and DATABASE_ACCESS showed other users / anonymous callers get 0 rows from payments, bookings, rosters etc. None uses the service role without a check.

### 4. Route handlers — PASS
| Route | Protection |
|---|---|
| `POST /api/push` | shared secret, constant-time compare, 401 otherwise |
| `GET /auth/callback` | public by design (OAuth / reset return), `next` clamped by `safeRedirect` |
| `GET /organize/tournaments/[id]/teams/sheet` | `canManageTournament()` → 403 |
| `GET /p/[username]/story` | public profiles only |
| `GET /tournaments/[id]/story`, `/fixtures-card` | `getTournament()` reads with the visitor's session, so drafts are hidden by RLS |

### 5. Proxy gates — PASS
`src/proxy.ts` gates `/profile`, `/welcome`, `/my-games`, `/organize` (real user), `/admin` (owner/admin/super_admin from the database) and `/platform` (super_admin from the database) before any page code runs; public pages refresh the session (P-01).

### 6. Remaining LOW items (not fixed)
- `get_player_scorecard(p_user_id)` returns stats for private profiles.
- `are_blocked(a, b)` lets anyone ask whether two users have blocked each other.
- Public read RPCs (`get_tournament_player_stats` etc.) don't check the tournament is published; drafts have random ids, so low risk.

## What's at risk

- (1) Anyone on the internet could corrupt any tournament's fixtures and results.
- (2) Any organizer could attach themselves to any venue and run tournaments there without the owner's consent.

## What's already secure

Every server action that needs a user refuses without one; admin roles are checked against the database, never user_metadata; the push webhook is authenticated; the proxy gates privileged areas before rendering; the role-change guard trigger (SEC-01) even blocks role changes attempted with the service role.

## Recommendations

1. Revoke EXECUTE on internal helpers from `public, anon, authenticated`. **Done.**
2. Split the partnerships update policy: vendor accepts/revokes, organizer can only withdraw; parties immutable. **Done.**
3. Going forward: `alter default privileges in schema public revoke execute on functions from public, anon;` so new functions start locked, and grant explicitly. (Needs care — policies call helper functions; do it with a full grant list.)
4. Make `get_player_scorecard` respect `is_public`; restrict `are_blocked` to the two users involved. (LOW)

## Verification (2026-09-29)

| Check | Before | After |
|---|---|---|
| No-login `build_round_robin` on a temp tournament | created fixtures | **denied** |
| No-login `propagate_match_winner`, `reset_downstream_from` | ran | **denied** |
| All 9 helpers, no login and signed-in | callable | **denied** (0 matches created) |
| `court_busy_slots` (uses a locked helper internally) | works | works |
| `expire_stale_play_together_requests` (game page) | works | works |
| Organizer activates own partnership invite | **allowed** | blocked |
| Organizer withdraws own invite / vendor accepts or declines | — | allowed |
| Vendor re-points invite to another organizer | — | blocked (`PARTNERSHIP_PARTIES_IMMUTABLE`) |
| Plain user / pending organizer calls `approve_organizer_request` | FORBIDDEN | FORBIDDEN |

All tests used temporary accounts and rows, deleted afterwards.
