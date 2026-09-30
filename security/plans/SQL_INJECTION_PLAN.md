# SQL_INJECTION Fix Plan

## Changes

- `src/lib/validation/search.ts` (new) — `filterSafeSearchTerm()`.
- `src/lib/squads/actions.ts`, `src/lib/friends/queries.ts`, `src/lib/tournaments/actions.ts` — use it for the search term.

## New files

- `src/lib/validation/search.ts`

## Verification goals

- [x] Every database query uses parameters (supabase-js / RPC named params)
- [x] No user input concatenated into SQL or PostgREST filter strings (3 search sites sanitized)
- [x] grep for dangerous patterns: remaining template-literal filters use server values only
- [x] Injection payloads return nothing; normal searches still work

## Manual verification (for the human)

- After deploy: search players by part of a name in Friends and in a team's roster — results as before.
