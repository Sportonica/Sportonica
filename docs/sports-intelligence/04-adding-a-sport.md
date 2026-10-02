# Sports Intelligence: adding a sport

Deliverable G. Adding a sport touches five places and changes no existing sport.

## 1. Write the rules down first

Add a section to `02-sport-rules.md`: scoring, structure, events, raw statistics, derived metrics with the data each needs, the completion rule, and what must be refused as impossible. List which rules vary by competition; those become rule keys with defaults.

## 2. Write the engine

Create `src/lib/intelligence/sports/<sport>.ts` exporting an object that implements `SportIntelligenceEngine<Rules, State>` from `core/types.ts`.

| Method | What it must do |
|---|---|
| `resolveRules(input)` | Merge over your defaults with `mergeRules`, validate, throw `RulesError` on a bad value. |
| `initializeMatch(ctx, rules)` | Return the empty state. It must be plain JSON: no `Map`, `Set`, `Date` or class instances, because it is stored in a `jsonb` column. |
| `validateEvent(state, ev, ctx, rules)` | Return `null` if the event is possible, otherwise the reason as a sentence a scorer can act on. |
| `updateScore(state, ev, ctx, rules)` | Apply the event. May mutate and return the state it is given. Must be deterministic: no clock, no randomness. |
| `validateScore` | Invariants that hold for every reachable state. Reconstruction reports violations. |
| `getCurrentState`, `getMatchSummary` | The score card read model and the plain-language score lines. |
| `calculate*Statistics`, `calculateAdvancedAnalytics` | Tables, cards and charts as data. Mark every column `raw` or `derived`. Return `null` for a derived value whose inputs are missing. |
| `validateMatchCompletion`, `finalizeMatch` | When the match may be completed, and its result. |
| `mirrorScore` | The two numbers shown on the fixture row, or `null` if there is no fixture. |
| `deriveStats(subject, raw)` | Derived figures from summed raw counters, for historical statistics. |
| `derivedLog`, `describeEvent` | Timeline text. |

Rules of thumb that the existing engines follow:

- Record causes, compute consequences. A rally is recorded; a game won is computed. Then an impossible consequence cannot be entered.
- Keep raw counters in state. Compute percentages and averages on read with `ratio` and `pct` from `core/util.ts`, which return `null` on a zero denominator.
- A raw counter that is an extreme must be named for it: a key starting with `longest`, `max` or `best` is combined across matches with max, `fastest` or `min` with min, everything else is summed (`aggregate.ts`).
- Lifecycle events (start, pause, forfeit and so on) and corrections are handled by the core. Do not handle them in the engine.

Rally sports can reuse `sports/rally.ts` for streaks, serve and return counts and progression charts.

## 3. Register it

- Add the key to `SPORT_KEYS` in `core/types.ts`.
- Add the engine to `ENGINES` in `registry.ts`.
- Add the key to the `sport` check constraint on `si_contests` in `db/sports_intelligence.sql` and apply that statement.

The sport's name in `src/lib/sports.ts` lower-cased must equal the key.

## 4. Add a scorer pad

Create `src/components/intelligence/pads/<Sport>Pad.tsx` taking `PadProps` (`contest`, `send`) and add it to `PADS` in `pads/index.tsx`. A rally sport needs no new component, only a `RallyPadConfig`. The pad only decides which buttons to show; it never decides whether an event is legal. Send the event and let the engine refuse it.

Nothing else in the UI changes. The score card, tables, charts, timeline, match centre and scorer console render what the engine returns.

## 5. Test it

Add `scripts/intelligence/<sport>.test.mjs` and its name to `run-all.mjs`. Use `openMatch` from `harness.mjs`, which drives the engine exactly as the server action does. Cover at least:

- basic scoring and progression;
- completion, including the case that must not complete;
- every refusal in your rule specification (`m.refuses(...)` also checks the match was left untouched);
- each derived metric against a hand-calculated value, and its "not available" case;
- `m.assertReconstructs(...)`: the rebuilt state equals the live state, twice, and regardless of load order;
- one correction;
- one historical aggregation through `aggregate`.

Run `npm run test:intelligence`.

## Moving football onto events

Football is deliberately not registered. To move it: write `sports/football.ts` (goals, cards, periods, extra time, penalty shoot-out), register it under the key `futsal`, and add a pad. Its `mirrorScore` and the existing `record_match_result()` call already cover extra time and penalties on the fixture row. Until then, futsal tournaments keep the score entry in the Fixtures tab.
