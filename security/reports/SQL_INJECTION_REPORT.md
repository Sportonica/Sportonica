# SQL_INJECTION Security Report

## Status: PASS (after fix) — was LOW

## Findings

- **App → database:** all queries go through supabase-js (PostgREST) or `.rpc()` with named parameters — values are sent separately, never spliced into SQL. No raw SQL in the app.
- **Database functions:** every dynamic `EXECUTE` in the repo SQL is migration-time and uses `format('%I', …)` for identifiers (constraint/table names from the catalog) — no user input reaches dynamic SQL. The audit's own SQL follows the same rule.
- **PostgREST filter-string injection — LOW (fixed).** Three searches built filter strings from the raw search box value:
  - `src/lib/squads/actions.ts` (squad invite search)
  - `src/lib/friends/queries.ts` (`listAllPlayers`)
  - `src/lib/tournaments/actions.ts` (`searchPlayersForTeam`)

  ```ts
  .or(`full_name.ilike.%${term}%,username.ilike.%${term}%`)
  ```
  PostgREST parses that string (comma = new condition, dot = column.operator.value), so the user controlled the query logic. **Proven:** the term `zzqqxx%,role.eq.super_admin,username.eq.x` returned the super-admin account (the honest search matched 0); `…,created_at.gt.2000-01-01,…` returned all 54 profiles; a bare `%` matched everyone.

  Impact was limited: RLS and column grants still applied, so nothing beyond what the public API allows could be read. But the query logic was attacker-chosen, and it's the kind of bug that becomes serious the moment a search runs with the service role.
- Other `.or()` strings use server values only (user ids, timestamps, ids from the database).

## What's at risk

Before the fix: search results chosen by the attacker (e.g. "find the admin accounts"), within what RLS permits.

## What's already secure

Parameterized queries everywhere; no string-built SQL in functions.

## Recommendations

1. Sanitize search terms before embedding them in PostgREST filter strings. **Done** — `src/lib/validation/search.ts` (`filterSafeSearchTerm`: strips `, ( ) " ' \ : * .`, escapes `%`/`_`, caps at 60 chars), used by all three.
2. Rule for new code: never interpolate user input into `.or()` / `.filter()` strings without it.

## Verification (2026-09-29)

| Search term | Before | After |
|---|---|---|
| `zzqqxx%,role.eq.super_admin,username.eq.x` | 1 row (the super admin) | 0 rows |
| `zzqqxx%,created_at.gt.2000-01-01,username.eq.x` | 54 rows | 0 rows |
| `%` | everyone | 0 rows |
| real name / username fragment | found | still found |
