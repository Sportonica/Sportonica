# Security Audit Summary

Date: 2026-09-29 – 2026-09-30
Scope: Sportonica web app (Next.js on Vercel, https://www.sportonica.com), Supabase project `ohbdahztfsjztihmenrj` (database, auth, storage), per the vibe-check AI-CHECKLIST (17 categories).
Method: code review + live, read-only checks against production + attacks with temporary accounts/rows against the live database (all deleted afterwards) + production builds driven in headless Chrome.

## Results

"Before" is the state when the category was examined; "After" is after its fixes (database fixes are already live; code fixes are on branch `fix/security-audit`, not yet deployed).

| # | Category | Before | After | Report | Plan |
|---|----------|--------|-------|--------|------|
| 1 | SECRETS_EXPOSURE | MEDIUM | PASS | [report](reports/SECRETS_EXPOSURE_REPORT.md) | [plan](plans/SECRETS_EXPOSURE_PLAN.md) |
| 2 | DATABASE_ACCESS | HIGH | MEDIUM until step 2 is run, then PASS | [report](reports/DATABASE_ACCESS_REPORT.md) | [plan](plans/DATABASE_ACCESS_PLAN.md) |
| 3 | AUTH_MIDDLEWARE | **CRITICAL** | PASS | [report](reports/AUTH_MIDDLEWARE_REPORT.md) | [plan](plans/AUTH_MIDDLEWARE_PLAN.md) |
| 4 | ACCESS_CONTROL | HIGH | PASS | [report](reports/ACCESS_CONTROL_REPORT.md) | [plan](plans/ACCESS_CONTROL_PLAN.md) |
| 5 | FRONTEND_SECRETS | PASS | PASS | [report](reports/FRONTEND_SECRETS_REPORT.md) | [plan](plans/FRONTEND_SECRETS_PLAN.md) |
| 6 | SSRF | MEDIUM | PASS | [report](reports/SSRF_REPORT.md) | [plan](plans/SSRF_PLAN.md) |
| 7 | CSRF | LOW | PASS | [report](reports/CSRF_REPORT.md) | [plan](plans/CSRF_PLAN.md) |
| 8 | SECURITY_HEADERS | MEDIUM | LOW until `fix/vibe-check-strict` is deployed, then PASS | [report](reports/SECURITY_HEADERS_REPORT.md) | [plan](plans/SECURITY_HEADERS_PLAN.md) |
| 9 | CORS | LOW | PASS (confirm after deploy) | [report](reports/CORS_REPORT.md) | [plan](plans/CORS_PLAN.md) |
| 10 | RATE_LIMITING | MEDIUM | PASS | [report](reports/RATE_LIMITING_REPORT.md) | [plan](plans/RATE_LIMITING_PLAN.md) |
| 11 | SQL_INJECTION | LOW | PASS | [report](reports/SQL_INJECTION_REPORT.md) | [plan](plans/SQL_INJECTION_PLAN.md) |
| 12 | XSS | PASS | PASS | [report](reports/XSS_REPORT.md) | [plan](plans/XSS_PLAN.md) |
| 13 | PAYMENT_WEBHOOKS | N/A (no Stripe); manual flow HIGH | PASS | [report](reports/PAYMENT_WEBHOOKS_REPORT.md) | [plan](plans/PAYMENT_WEBHOOKS_PLAN.md) |
| 14 | FILE_UPLOADS | MEDIUM | PASS | [report](reports/FILE_UPLOADS_REPORT.md) | [plan](plans/FILE_UPLOADS_PLAN.md) |
| 15 | ERROR_HANDLING | LOW | PASS | [report](reports/ERROR_HANDLING_REPORT.md) | [plan](plans/ERROR_HANDLING_PLAN.md) |
| 16 | PASSWORD_HASHING | N/A (Supabase Auth, bcrypt) | N/A | [report](reports/PASSWORD_HASHING_REPORT.md) | [plan](plans/PASSWORD_HASHING_PLAN.md) |
| 17 | DEPENDENCIES | **CRITICAL** | PASS | [report](reports/DEPENDENCIES_REPORT.md) | [plan](plans/DEPENDENCIES_PLAN.md) |

## Critical issues

Both CRITICAL items are resolved:

1. **Anyone, without logging in, could rewrite any tournament's fixtures and results** (AUTH_MIDDLEWARE). Nine internal `SECURITY DEFINER` helpers (`build_round_robin`, `propagate_match_winner`, `reset_downstream_from`, …) were executable by `anon` through the public API. Proven with no login on a test tournament. **Fixed live** (EXECUTE revoked; attack now denied, 0 fixtures created).
2. **Next.js 16.2.9 had two critical unauthenticated RCE advisories and a proxy-bypass advisory** (DEPENDENCIES). **Fixed in code** (16.3.7, 0 production vulnerabilities) — **takes effect when `fix/security-audit` is deployed.**

Other high-impact findings, all fixed and verified: fake notifications/push to any user from a throwaway session; organizers self-approving partnerships with any venue; captains self-confirming paid registrations; strangers editing or confirming walk-in teams (NULL-comparison permission checks, 21 occurrences); users deleting others' avatars/venue photos; bulk-readable team contact details and host phone numbers; blind SSRF via avatar URLs; unlimited uploads of any file type; an unthrottled contact form burning the email quota.

## Where the fixes are

- **Database / storage — already live** (run 2026-09-29/30, each verified with before/after tests): storage policy hardening, notifications policy + lookup functions, view filters, partnership policies, helper-function EXECUTE revokes, NULL-safe checks (2 parts), write guards on teams/friend requests/bookings, bucket upload limits. SQL on branch `docs/security-audit` (off `changes`).
- **App code — not yet deployed:** branch `fix/security-audit` (off `main`), 11 commits.
- **Separate feature done during the audit:** organizer chooses the team captain — PRs #63 (app) and #62 (SQL, already live).

## Live scan (vibe-check `check.py`)

Before (2026-09-29, production): **2 failed, 2 warnings, 16 passed** — FAIL script-src `'unsafe-inline'`, FAIL HSTS without includeSubDomains; WARN img-src broad, WARN static-file headers (not reproducible on re-check).
Re-scan 2026-09-30 (production, still without the audit branch): **2 failed, 3 warnings, 16 passed** — same two FAILs, plus WARN `X-Powered-By: Next.js`.
Local production build of `fix/vibe-check-strict`: **0 failed, 0 warnings, 18 passed** (HSTS is skipped on localhost; the header carries `includeSubDomains`).
**Re-run after deploy** and record the counts here. Note the scanner's ~80 requests trip Vercel's bot challenge for that IP for a while.

## Remaining manual verification

**Deploy order**
1. Merge and deploy `fix/security-audit`, then `fix/vibe-check-strict` (nonce CSP, tighter img-src; stacked on it).
2. Then run `supabase/database_access_step2_hide_columns.sql` (hides team contact / host payment / profile bio-city columns; must not run before the deploy).
3. Finish the Turnstile rollout: create the widget, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` in Vercel, redeploy, **then** Supabase → Auth → Attack Protection → CAPTCHA.

**After deploy — spot checks**
- Organizer: Control Center registrations and printable team sheet still show contact details; add and edit a walk-in team; generate fixtures; record a result.
- Player: join a paid Play Together game and see the host's phone/QR; register a team; accept a friend request; upload an avatar and a payment screenshot; send one message via /contact.
- Venue owner: accept a partnership invite; upload a venue photo.
- Super admin: approve a pending payment; confirm a notification arrives.
- `curl -sI https://www.sportonica.com | grep -i strict-transport` shows `includeSubDomains`; `curl -sI -H "Origin: https://evil.example" https://www.sportonica.com/tournaments` shows our origin, not `*`.
- DevTools → Cookies: `sb-…-auth-token` is Secure + SameSite=Lax.
- Re-run the vibe-check scan and update the counts above.

**Account settings (owner)**
- Google Cloud Console: restrict the Firebase Android API key (package + SHA-1, FCM APIs only).
- Supabase Auth: consider min password length 8 and leaked-password protection.
- Consider Dependabot security updates on the repo.

**Follow-up 2026-09-30 (not yet live)**
- CSP nonce + listed image hosts: branch `fix/vibe-check-strict`.
- LOW access-control items: `supabase/access_control_low_items.sql` (run `access_control_low_items_inspect.sql` first; `are_blocked` and the draft-tournament stats functions still need their live definitions).

**Accepted / LOW, not fixed**
- `@capacitor/cli` → `uuid` moderate advisory (local build tool only).
- LOW items listed in ACCESS_CONTROL (squad member add consent, poll move, event host impersonation, duplicate policies) and AUTH_MIDDLEWARE (`get_player_scorecard` ignores private profiles, `are_blocked` open).

> This audit covers the common failure classes; before scaling with real user data, a professional penetration test is still recommended.
