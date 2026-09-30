# PAYMENT_WEBHOOKS Security Report

## Status: N/A for Stripe — manual payment flow reviewed: PASS (after fix)

## Findings

**No Stripe (or any payment provider webhook).** Payments are manual: the player pays an eSewa / Khalti / bank QR and uploads a screenshot; a super admin (`review_payment`) or the tournament host (`verify_tournament_payment`) / Play Together host (`verify_play_together_payment`) approves it. The only webhook in the app is `POST /api/push` (Supabase database webhook → push notifications), authenticated with a shared secret compared in constant time.

Reviewed the equivalent risks for this flow — "can someone approve or fake a payment?":

| Function | Who may call it | Result |
|---|---|---|
| `review_payment` | super admin only (`is_super_admin()`) | PASS |
| `verify_tournament_payment` | organizer / venue manager / super admin | PASS |
| `verify_play_together_payment`, `mark_contribution_collected`, `approve_join_request`, `cancel_play_together_game` | game host | was fail-open on NULL (latent) → fixed |
| `submit_payment`, `confirm_free_booking` | the booking's owner / team captain | **was fail-open on NULL for walk-in teams → fixed** |
| `bookings.payment_status` | only the payment functions | direct writes blocked (ACCESS_CONTROL) |
| Payment proofs bucket | private; owner / super admin / tournament organizer read | PASS (SECRETS_EXPOSURE) |

**Fail-open NULL checks (part 2):** `if v_team.captain_id <> auth.uid() then raise` (and `v_host`, `v_game.host_id`, `v_row.user_id` variants, 15 occurrences) — when the left side is NULL the check passes. Walk-in teams have no captain. **Proven:** an unrelated user confirmed another organizer's pending walk-in team registration via `confirm_free_booking()`. Fixed by rewriting the live checks to `is distinct from auth.uid()` (`supabase/access_control_null_checks_2.sql`).

Idempotency: approvals are status transitions (`PENDING_VERIFICATION → APPROVED/REJECTED`) recorded with `reviewed_by` and an audit log row; re-approving an approved payment is a no-op state change.

## What's at risk

Before the fix: anyone signed in could confirm a walk-in team's free registration they had nothing to do with.

## What's already secure

Only admins/hosts can approve money; players can't mark themselves paid; proofs are private.

## Recommendations

1. NULL-safe owner checks. **Done.**
2. If an online gateway (Khalti/eSewa API, Stripe) is added later: verify its signature on every callback, store processed event ids, and handle failure/refund events.

## Verification (2026-09-29/30)

| Check | Before | After |
|---|---|---|
| Stranger confirms someone's walk-in registration | **confirmed** | blocked (`NOT_YOUR_BOOKING`), stays pending |
| Stranger submits a payment claim for it | — | blocked, 0 payment rows |
| Captain confirms own free registration | works | works |
