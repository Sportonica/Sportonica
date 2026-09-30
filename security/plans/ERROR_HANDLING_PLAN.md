# ERROR_HANDLING Fix Plan

## Changes

- `src/lib/actionError.ts` — `dbActionError()` + `isBusinessErrorMessage()`.
- 14 action files — `actionError(err.message)` → `dbActionError(err)` (104 sites).
- `src/lib/tournaments/types.ts` — `friendlyTournamentError()` returns a generic sentence for non-code messages.

## New files

None.

## Verification goals

- [x] Global error handling: framework error boundary + digest-only server errors
- [x] Client responses contain only friendly messages or our own business codes
- [x] Full error details logged server-side only
- [x] No stack traces, SQL errors or schema names in action results
- [x] Debug mode off in production; no API docs / debug endpoints (live scan)

## Manual verification (for the human)

- After deploy, trigger a normal business error (e.g. register a team twice) — you still see the friendly message.
