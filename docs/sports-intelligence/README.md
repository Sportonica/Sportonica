# Sports Intelligence

Event-based scoring, statistics and analytics for basketball, pickleball, cricket, volleyball, badminton, swimming, tennis and football (futsal).

| Document | Contents |
|---|---|
| [01-architecture.md](01-architecture.md) | What existed, what is reused, the design, API mapping, limits |
| [02-sport-rules.md](02-sport-rules.md) | Rule specification for each sport |
| [03-database-plan.md](03-database-plan.md) | Tables, constraints, indexes, functions, security |
| [04-adding-a-sport.md](04-adding-a-sport.md) | How to add another sport |
| [05-basketball.md](05-basketball.md) | Basketball game intelligence: presets, fouls, possessions, formulas, standings, questions |
| [06-game-iq.md](06-game-iq.md) | Game IQ for cricket, volleyball, badminton, pickleball, swimming; the tennis engine |
| [07-football.md](07-football.md) | Football (futsal) event scoring: presets, events, fixture sync, statistics |

## Setting up

1. Apply `db/sports_intelligence.sql` once in the Supabase SQL editor, and `db/sports_intelligence_football.sql` for tennis and football.
2. Open a basketball, pickleball, cricket, volleyball, badminton or swimming tournament's console and choose **Live scoring**.

## Where things are

| Path | What |
|---|---|
| `src/lib/intelligence/core` | Sport-neutral contracts, lifecycle, corrections, reconstruction |
| `src/lib/intelligence/sports` | One rules engine per sport |
| `src/lib/intelligence/actions.ts` | The API (server actions) |
| `src/components/intelligence` | Score card, match centre, scorer console, pads |
| `src/app/tournaments/[id]/score`, `.../live` | Scorer and public routes |
| `scripts/intelligence` | Tests: `npm run test:intelligence` |

## Tests

`npm run test:intelligence` runs 144 checks over the core, the eight engines, basketball standings and Game IQ with no database: scoring, progression, completion, refusals, derived metrics, edge cases, reconstruction, corrections and historical aggregation. The test harness drives the engines the same way the server action does (one event at a time against the running state, corrections appended, then a full rebuild compared with the live state).

The database functions and the pages that use them are not covered by automated tests. They need the SQL applied to a real Supabase project.
