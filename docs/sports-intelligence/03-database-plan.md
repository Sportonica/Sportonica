# Sports Intelligence: database plan

Deliverable C. The SQL is in `db/sports_intelligence.sql`. It is idempotent and must be applied once in the Supabase SQL editor.

## Mapping the brief's model to tables

| Brief | Table | Status |
|---|---|---|
| sports | none. `src/lib/sports.ts` is the single definition of sports; the engine registry keys off it. | reused |
| competitions, seasons | `tournaments` | reused, one column added |
| matches / events | `tournament_matches` for fixtures, plus `si_contests` | reused + new |
| participants, teams | `tournament_teams` | reused |
| players / athletes | `tournament_team_players` (linked to `profiles` by `user_id`) | reused |
| match_periods | inside `si_contests.state` (periods differ per sport: quarters, sets, innings, none) | new, as JSON |
| match_events | `si_events` | new |
| scores | `si_contests.state`, mirrored to `tournament_matches.score_*` | new + reused |
| statistics, player_statistics, team_statistics, performance_metrics | `si_stat_lines` (raw counters only) | new |
| analytics_snapshots | `si_contests.state` and `si_contests.summary` | new |
| audit | `si_events` itself (append only) and the existing `tournament_match_audit` for the mirrored row | new + reused |

A separate `sports`, `seasons` or `teams` table would duplicate what already exists, so none is created. A season is derived from the contest date.

## Modified table

`tournaments`
- `scoring_rules jsonb not null default '{}'`. The competition's rule configuration (`competition.rules` in the brief). Empty means "use the sport's defaults".

## New tables

### `si_contests`
One scored thing: a match between two sides, or one swimming race.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tournament_id` | uuid fk → `tournaments` on delete cascade | |
| `match_id` | uuid fk → `tournament_matches` on delete cascade, nullable | set for versus sports |
| `race_category_id` | uuid fk → `tournament_race_categories` on delete set null, nullable | optional grouping for swimming |
| `sport` | text, checked against the six engine keys | |
| `label` | text | e.g. "100m Freestyle, Heat 3" |
| `rules` | jsonb | resolved rules frozen when the contest is opened |
| `context` | jsonb | sides and rosters frozen when the contest is opened |
| `status` | text: scheduled, live, paused, completed, abandoned, postponed, cancelled | |
| `state` | jsonb | snapshot of the engine state (cache) |
| `summary` | jsonb | score card read model (cache, what Realtime delivers) |
| `last_seq` | int | highest event sequence applied |
| `started_at`, `completed_at` | timestamptz | |
| `created_by`, `created_at`, `updated_at` | audit fields | |

Constraints and indexes
- unique partial index on `match_id` where not null: one contest per fixture.
- index on `(tournament_id, status)`.
- index on `(sport, status, updated_at desc)` for "what is live now".

### `si_events`
The append only event log.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `contest_id` | uuid fk → `si_contests` on delete cascade | |
| `seq` | int | per contest, assigned in the transaction |
| `type` | text | |
| `payload` | jsonb | |
| `occurred_at` | timestamptz | when it happened on the scorer's device |
| `recorded_at` | timestamptz default now() | when the server stored it |
| `recorded_by` | uuid fk → `auth.users` | |
| `client_id` | uuid | idempotency key from the device |
| `voids_event_id` | uuid fk → `si_events`, nullable | for a void |
| `replaces_event_id` | uuid fk → `si_events`, nullable | for a replacement |
| `reason` | text | required when either of the two above is set |

Constraints and indexes
- unique `(contest_id, seq)`: ordering and paginated retrieval.
- unique `(contest_id, client_id)`: a resubmitted event cannot be stored twice.
- check: an event is not both a void and a replacement; a correction has a non empty reason.
- trigger: `update` and `delete` raise an exception. History cannot be rewritten.
- index on `voids_event_id` and on `replaces_event_id`.

### `si_stat_lines`
Raw counters for one subject in one contest. Written when the contest is completed, and removed again if a correction reopens it, so a match in progress never appears in career statistics.

| Column | Type | Notes |
|---|---|---|
| `contest_id` | uuid fk → `si_contests` on delete cascade | |
| `subject` | text: `player` or `team` | |
| `subject_key` | text | team player id, or team id |
| `tournament_id` | uuid fk | denormalised for aggregation |
| `sport` | text | |
| `team_id` | uuid fk → `tournament_teams`, nullable | |
| `team_player_id` | uuid fk → `tournament_team_players`, nullable | |
| `user_id` | uuid, nullable | the linked account, for career statistics |
| `event_key` | text, nullable | swimming: `100-freestyle-50` |
| `raw` | jsonb | counters only, never a percentage or an average |
| `played_at` | timestamptz | for date range and season filters |

Constraints and indexes
- primary key `(contest_id, subject, subject_key)`.
- indexes on `(user_id, sport, played_at desc)`, `(team_player_id)`, `(team_id, sport)`, `(tournament_id, sport)`, `(sport, event_key, played_at desc)`.

## Relationships

```
tournaments ─┬─< tournament_matches ──(0..1)── si_contests ─┬─< si_events
             │                                              └─< si_stat_lines
             ├─< tournament_teams ─< tournament_team_players      │
             └─< tournament_race_categories ──(0..n)── si_contests
                                   tournament_teams, tournament_team_players >─┘
```

## Functions

| Function | Purpose |
|---|---|
| `si_can_score(tournament_id)` | The existing three permission checks in one place. |
| `si_open_contest(...)` | Creates the contest for a fixture or a race. Returns the existing one if already open. |
| `si_append_event(...)` | One transaction: permission, lock the contest, idempotency check, sequence check, insert event, save snapshot, write stat lines if the contest is now completed, mirror the live score to `tournament_matches`. |
| `si_write_snapshot(...)` | Internal helper shared by the two functions around it. Not callable by clients. |
| `si_save_snapshot(...)` | Same snapshot write without a new event. Used by recalculate. |

## Row level security

- Read on all three tables follows `tournament_matches`: anyone may read a contest whose tournament is public; organizers, venue managers and super admins may read their own drafts.
- No insert, update or delete policy exists. All writes go through the security definer functions above.

## Realtime

`si_contests` is added to the `supabase_realtime` publication. The match centre subscribes to updates of one row.

## Why a snapshot and an event log both exist

The event log is the source of truth. The snapshot exists so that a live event costs one read and one write, and so that Realtime can deliver a ready to render score. `recalculateContest` proves the two agree.
