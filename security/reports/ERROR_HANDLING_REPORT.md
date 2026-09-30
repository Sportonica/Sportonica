# ERROR_HANDLING Security Report

## Status: PASS (after fix) — was LOW

## Findings

- **Error pages / debug endpoints (live scan):** vibe-check against https://www.sportonica.com — error pages don't leak internals; none of 21 debug/API-docs paths (Swagger, ReDoc, OpenAPI, GraphQL playground, Actuator, phpinfo, server-status, Werkzeug console, …) exist. `X-Powered-By` not sent.
- **Framework:** production Next.js replaces thrown server errors with a digest; `src/app/error.tsx` and `not-found.tsx` are branded and show no details. Debug mode is off in production (Vercel `NODE_ENV=production`).
- **Route handlers:** `/api/push` returns `Unauthorized` / small JSON only; the team sheet returns friendly strings.
- **Server actions leaked raw database errors — LOW (fixed).** 104 places returned `actionError(error.message)` straight from Supabase, and `friendlyTournamentError()` fell back to the raw message. Postgres/PostgREST text names tables, policies, constraints, columns and functions, e.g. `new row violates row-level security policy for table "tournament_teams"`, `duplicate key value violates unique constraint "profiles_phone_unique"`, `Could not find the function public.x in the schema cache`.

## What's at risk

Schema reconnaissance (table/policy/function names) from error messages — useful to an attacker mapping the database, not a direct exploit.

## What's already secure

Generic error pages, no debug endpoints, no stack traces in responses.

## Recommendations

1. Route database errors through one helper that passes our own business codes and replaces everything else. **Done** — `dbActionError()` in `src/lib/actionError.ts`: a message that is exactly an `UPPER_CASE_CODE` (all 116 codes our functions raise, e.g. `ROSTER_LOCKED`, `FORBIDDEN`) or one of the three sentences our functions raise passes through for the UI to translate; anything else is logged server-side (`[action:db]`) and the client gets "Something went wrong. Please try again." All 104 call sites switched; `friendlyTournamentError()` falls back the same way.
2. Optional: add `src/app/global-error.tsx` for failures in the root layout (Next's default already hides details).

## Verification (2026-09-30)

- `grep` for `actionError(<err>.message)`: 0 remaining (was 104 in 14 files).
- Classifier: `ROSTER_LOCKED`, `FORBIDDEN`, `Court not found` → passed through; RLS violation, unique-constraint text, missing-function text, `JWT expired` → generic message.
- Typecheck, lint and production build pass.
