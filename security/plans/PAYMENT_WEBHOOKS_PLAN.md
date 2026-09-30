# PAYMENT_WEBHOOKS Fix Plan

## Changes

- `supabase/access_control_null_checks_2.sql` — rewrites `x <> auth.uid() then raise` to `x is distinct from auth.uid() then raise` in the live definitions (captain / host / player checks). **Run 2026-09-30.**

## New files

- `supabase/access_control_null_checks_2.sql`

## Verification goals

- [x] (Stripe) N/A — no payment provider webhook exists
- [x] Only super admin / host / organizer can approve a payment
- [x] Owner checks fail closed on NULL (walk-in teams)
- [x] Players can't set their own payment status

## Manual verification (for the human)

- Approve one real pending payment as super admin after deploy.
