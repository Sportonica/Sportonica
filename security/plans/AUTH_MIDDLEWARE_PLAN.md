# AUTH_MIDDLEWARE Fix Plan

## Changes

- `supabase/auth_hardening.sql` §1 — replace `partnerships_update` with `partnerships_vendor_update` (vendor/super admin: active or revoked) and `partnerships_organizer_withdraw` (organizer: revoked only); trigger `guard_partnership_parties` makes organizer_id/vendor_id immutable for user sessions. **Run 2026-09-29.**
- `supabase/auth_hardening.sql` §2 — `revoke execute … from public, anon, authenticated` on the nine internal helpers. **Run 2026-09-29.**
- No app code change needed: server actions and route handlers already check the caller.

## New files

- `supabase/auth_hardening.sql` (on `changes`)

## Verification goals

- [x] Every server action that returns or modifies user data checks the caller first (175/175 exit early without a user; the rest are public reads through RLS or public-by-design auth flows)
- [x] Admin/platform actions verify the role in the database and refuse others (FORBIDDEN)
- [x] Route handlers: protected ones return 401/403 (push webhook, team sheet); the rest are public by design
- [x] Privileged areas are gated in `proxy.ts` before the page runs
- [x] No RPC that changes state can be called without a caller check (9 helpers now denied to anon and authenticated; 0 fixtures created by the attack)
- [x] Public RPCs that legitimately run as the visitor still work (`court_busy_slots`, `expire_stale_play_together_requests`)
- [x] An organizer cannot activate their own partnership; the vendor still can
- [ ] (LOW, optional) `get_player_scorecard` respects `is_public`; `are_blocked` limited to the two users

## Manual verification (for the human)

- As an organizer: generate fixtures and record a match result in a real tournament's Control Center — confirms the guarded functions still reach the locked helpers.
- As a venue owner: accept a partnership invite on `/admin/partnerships`.
