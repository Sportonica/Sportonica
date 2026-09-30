# Sports Intelligence: architecture report

Deliverable A. Written before implementation, from an inspection of the repository at `preview/all-features` and of the SQL kept on the `changes` branch (`supabase/tournaments.sql`).

## 1. What exists today

The brief refers to an existing "Football Intelligence". No module of that name exists. What the repository has is **tournament match scoring**, which is what football (futsal) uses today:

| Piece | Where | What it does |
|---|---|---|
| Match record | `tournament_matches` | One row per fixture. Holds `score_a`, `score_b`, extra time, penalties, `winner_team_id`, `status`. |
| Final result | `record_match_result()` RPC | Writes the final score, works out the winner, pushes the winner into the next bracket match. |
| Live score | `update_live_score()` RPC (`db/live_match_score.sql`) | Overwrites the running score and sets `status = 'live'`. |
| Player stats | `tournament_match_player_stats` | Per match, per player totals typed in after the match: goals, assists, cards, man of the match. |
| Cricket | `record_cricket_result()`, `tournament_cricket_player_stats` | Runs, wickets and overs per side typed in as totals. Not ball by ball. |
| Running | `tournament_race_categories`, `tournament_race_results` | One finish time per runner, ranked per category. |
| Audit | `tournament_match_audit` | Before and after snapshot of a match row on each change. |
| Standings, bracket | `tournament_standings()`, `propagate_match_winner()` | Derived from completed match rows. |
| Sport branching | `getSportKind()` in `src/lib/sports.ts` | `team_ball`, `cricket` or `individual_race`. |
| Live display | `useLiveRefresh` | Polls the server every 15 s while a match is live. |
| Access control | `is_tournament_organizer()`, `has_venue_access()`, `is_super_admin()` | Who may score a tournament. |

Key properties of the current system:

- It stores **the score**, never the events that produced it. A goal is a number going from 1 to 2.
- Nothing can be reconstructed. If the stored score is wrong there is no source to rebuild it from.
- Statistics are typed in separately from the score and are not checked against it.
- The API convention is **server actions** in `src/lib/*/actions.ts` calling Postgres RPCs. There are no REST routes for domain data.
- Tests are plain assertion scripts run with `node --experimental-strip-types` (`npm run test:bulk`). There is no test runner.

## 2. What is reused

| Existing piece | How the new system uses it |
|---|---|
| `tournaments`, `tournament_teams`, `tournament_team_players` | Competition, team and player identity. No new tables for these. |
| `tournament_matches` | Still the fixture. A scored match links to it one to one. |
| `record_match_result()`, `record_cricket_result()` | Called when an event-scored match is completed, so bracket progression, standings and awards keep working unchanged. |
| Live score columns | Mirrored from the event engine on every event, so the home page rail, fixtures list and bracket show live scores with no change to their code. |
| Permission helpers | The same three checks guard every new write. |
| Supabase Realtime | Already used for payments, chat and slots. The live match view subscribes the same way. |
| Server actions and `ActionError` | All new endpoints follow this convention. |
| `tournament_race_categories` | A swimming race can be attached to a category. |

## 3. Proposed architecture

```
Scorer UI ──► server action ──► engine validates ──► si_append_event() RPC
                                     │                    │ one transaction:
                                     │                    │  insert event (append only)
                                     ▼                    │  save state snapshot
                        state, statistics, analytics      │  save raw stat lines
                                                          │  mirror score to tournament_matches
                                                          ▼
                                                   Supabase Realtime ──► live match centre
```

### 3.1 Layers

1. **Core** (`src/lib/intelligence/core`). Sport neutral. Owns the event envelope, the match lifecycle (start, pause, resume, postpone, cancel, abandon, forfeit, restart, complete), corrections, duplicate and gap detection, and deterministic reconstruction.
2. **Engines** (`src/lib/intelligence/sports`). One file per sport, each implementing `SportIntelligenceEngine`. All scoring rules live here and nowhere else.
3. **Statistics**. Engines keep raw counters in state. Derived figures are computed from raw counters on read and are never stored as a source of truth.
4. **Persistence** (`db/sports_intelligence.sql`). Append only event log, state snapshot, raw stat lines.
5. **Actions** (`src/lib/intelligence/actions.ts`). The API.
6. **UI** (`src/components/intelligence`). A generic live match centre that renders whatever an engine returns, plus one scorer pad per sport.

### 3.2 The engine interface

```ts
interface SportIntelligenceEngine<Rules, State> {
  resolveRules(input): Rules                 // competition.rules merged over defaults, validated
  initializeMatch(ctx, rules): State
  validateEvent(state, event, ctx, rules)    // null, or the reason it is impossible
  recordEvent(state, event, ctx, rules)      // validate, then updateScore
  updateScore(state, event, ctx, rules)      // the pure reducer
  validateScore(state, ctx, rules)           // invariants on a finished reconstruction
  getCurrentState(state, ctx, rules)         // read model for the score card
  getMatchSummary(state, ctx, rules)         // the "score reader" lines
  calculateStatistics / calculatePlayerStatistics / calculateTeamStatistics
  calculateAdvancedAnalytics(state, ctx, rules)
  validateMatchCompletion(state, ctx, rules)
  finalizeMatch(state, ctx, rules)           // result: winner, outcome, margin
  deriveStats(subject, rawTotals)            // for historical aggregation
}
```

Sports are **not** forced into one scoring model. The state type is different per sport: basketball keeps period scores and a scoring log, cricket keeps innings of deliveries, swimming keeps lanes of split times and has no "sides" at all. What they share is the event envelope, the lifecycle and the interface.

### 3.3 Events and reconstruction

Every change is an event: `{ seq, type, payload, occurred_at, recorded_by, client_id }`. `recalculateScore(contestId)`:

1. loads every event for the contest;
2. drops exact duplicates (same `client_id`);
3. resolves corrections (section 3.4);
4. orders by `seq`, the per-contest counter assigned inside the database transaction, and reports any gap as a missing event;
5. replays through the core lifecycle and the sport engine, skipping and reporting any event the rules make impossible;
6. returns state, status, result, statistics and the list of issues.

The replay is a pure function of the event list and the rules, so it is deterministic. The stored snapshot is only a cache: the recalculate action compares it with the replay and reports drift.

### 3.4 Corrections

Events are never updated or deleted (a database trigger rejects both). A mistake is fixed by appending:

- a **void**: a `CORRECTION_VOID` event naming the event it cancels, or
- a **replacement**: a new event with `replaces_event_id` set. It takes the original's position in the replay, which matters for order sensitive sports (the third ball of an over stays the third ball).

Both carry who, when and a mandatory reason. A correction is rejected if replaying the log with it would make any later event impossible.

### 3.5 Live pipeline and performance

- A normal event does **not** replay history. The action loads the snapshot, applies one event, and writes event plus snapshot in one RPC. Cost is constant per event.
- Only corrections and the explicit recalculate action replay the full log.
- `expected_seq` gives optimistic concurrency: two scorers submitting at once cannot both win; the loser is told to reload.
- `client_id` makes submission idempotent: a double tap or an offline retry returns the already stored event.
- Historical statistics read `si_stat_lines` (raw counters per player or team per contest), indexed by player, user, team and tournament, and paginated. They never touch the event log.

## 4. Database changes

Summarised here, detailed in `03-database-plan.md`. Three new tables (`si_contests`, `si_events`, `si_stat_lines`), one new column (`tournaments.scoring_rules`), four RPCs. No existing table is dropped or altered destructively.

## 5. API changes

New server actions in `src/lib/intelligence/actions.ts`. Mapping to the endpoints listed in the brief:

| Brief | Action |
|---|---|
| `GET /sports` | `listIntelligenceSports()` |
| `GET /matches/:id` and `/live`, `/score` | `getContest(contestId)`, `getContestForMatch(matchId)` |
| `GET /matches/:id/events` | `getContestEvents(contestId, page)` |
| `GET /matches/:id/statistics`, `/analytics` | `getContestIntelligence(contestId)` |
| `POST /matches/:id/events` | `recordContestEvent(contestId, input)` |
| `POST /matches/:id/start`, `pause`, `resume`, `complete` | `recordContestEvent` with `MATCH_START`, `MATCH_PAUSE`, `MATCH_RESUME`, `MATCH_COMPLETE` |
| corrections | `correctContestEvent(contestId, eventId, reason, replacement?)` |
| `recalculateScore(matchId)` | `recalculateContest(contestId)` |
| `GET /players/:id/statistics` | `getPlayerHistory(userId, sport, filter)` |
| `GET /teams/:id/statistics` | `getTeamHistory(teamId, sport)` |
| `GET /athletes/:id/performance` | `getAthletePerformance(userId)` |

## 6. Frontend changes

| Route | Purpose |
|---|---|
| `/tournaments/[id]/score` | Scorer hub. Lists fixtures to score; creates swimming races. |
| `/tournaments/[id]/score/[contestId]` | Scorer console. Sport specific pad, undo, corrections, audit. |
| `/tournaments/[id]/live/[contestId]` | Public match centre: live card, timeline, statistics, analytics, participants, history. |

Two small additions to existing components: a "Live scorer" link in the organizer's fixtures tab, and a "Match centre" link on public fixtures.

## 7. What is deliberately not changed

- **Football stays on its current path.** The existing score entry, `update_live_score`, player stats modal and their SQL are untouched. No football engine is registered, so nothing about futsal tournaments changes. Moving football onto events later means writing one engine file; section 3.2 is the contract.
- The existing cricket totals form and running results keep working. Event scoring is an additional path, chosen per match.
- `getSportKind()` is not modified.

## 8. Known limits

- The database trusts the server action for rule validity. It enforces permission, ordering, idempotency and immutability itself. A user with scorer rights who bypasses the app can insert an event the rules forbid; reconstruction will flag it and skip it.
- Duckworth Lewis Stern is not computed. A revised target can be entered as an event.
- The SQL must be applied to Supabase by hand, as with every other file in `db/`.
