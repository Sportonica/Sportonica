# Sports Intelligence: sport rule specification

Deliverable B. One section per sport: scoring, structure, events, statistics, derived metrics, completion, edge cases.

Every rule that differs between competitions is a value in `competition.rules` (`tournaments.scoring_rules`). The defaults listed here follow the named governing body's standard format. Anything not listed as configurable is not assumed: it is either enforced exactly as written or not supported, and unsupported items are listed.

Conventions used by every sport:

- Sides are `a` and `b` (the fixture's team A and team B).
- A metric is **raw** when it is counted straight from events, **derived** when it is calculated from raw counters. A derived metric whose inputs are missing or whose denominator is zero is reported as "not available", never as 0.
- Lifecycle events are shared by all sports: `MATCH_START`, `MATCH_PAUSE`, `MATCH_RESUME`, `MATCH_POSTPONE`, `MATCH_CANCEL`, `MATCH_ABANDON`, `MATCH_FORFEIT`, `MATCH_RESTART`, `MATCH_COMPLETE`, `CORRECTION_VOID`.
- Sport events are accepted only while the match is live.

Shared edge cases:

| Case | Handling |
|---|---|
| Postponed | `MATCH_POSTPONE` from scheduled. `MATCH_START` later resumes it. |
| Cancelled | `MATCH_CANCEL` from scheduled or postponed. Terminal. |
| Walkover | `MATCH_FORFEIT {side}` before the start. The other side wins, method "walkover". |
| Forfeit | `MATCH_FORFEIT {side}` during play. The other side wins, method "forfeit". Statistics up to that point are kept. |
| Abandoned | `MATCH_ABANDON {reason}`. Outcome "no result". Statistics are kept. |
| Restart | `MATCH_RESTART {reason}`. Sport state returns to the start; earlier events stay in the log for audit. |
| Incomplete | `MATCH_COMPLETE` is refused until the sport's completion rule is met. |
| Double submission | Same `client_id` is stored once. |
| Offline reconnection | Queued events are sent in order with their original `client_id` and `occurred_at`. |
| Simultaneous scorers | The second write fails the sequence check and must reload. |
| Correction | Void or replacement event with a reason. Nothing is deleted. |

---

## Basketball

The full basketball specification (presets, fouls, timeouts, possessions, every formula, standings, questions) is [05-basketball.md](05-basketball.md). The summary below covers the core.

Default format: FIBA. 4 periods of 10 minutes, overtime periods of 5 minutes, 5 fouls to foul out, 5 players on court.

| Rule key | Default | Meaning |
|---|---|---|
| `periods` | 4 | regulation periods |
| `periodMinutes` | 10 | 12 for NBA style |
| `overtimeMinutes` | 5 | |
| `allowTie` | false | if true a match may end level after regulation |
| `twoPointValue`, `threePointValue`, `freeThrowValue` | 2, 3, 1 | set 1, 2, 1 for 3x3 |
| `foulLimit` | 5 | personal plus technical plus unsportsmanlike; 6 for NBA style |
| `playersOnCourt` | 5 | |
| `trackShotAttempts` | true | whether misses are being recorded |

**Scoring.** Free throw 1, field goal 2, three point field goal 3.

**Structure.** Periods are opened and closed by `PERIOD_START` and `PERIOD_END`. A period beyond regulation is overtime and may only be opened when the score is level.

**Events.** `PERIOD_START`, `PERIOD_END`, `LINEUP`, `SUBSTITUTION`, `SHOT_MADE`, `SHOT_MISSED`, `FREE_THROW_MADE`, `FREE_THROW_MISSED`, `REBOUND`, `ASSIST`, `STEAL`, `BLOCK`, `TURNOVER`, `FOUL`, `TIMEOUT`. `SHOT_MADE` carries `points`, and optionally `paint`, `fastBreak`, `secondChance`, `assist`. Any event may carry `clock` (seconds left in the period).

**Raw statistics.** Player and team: points, field goals made and attempted, three pointers made and attempted, free throws made and attempted, offensive and defensive rebounds, assists, steals, blocks, turnovers, fouls, seconds played. Team only: points by period, points in the paint, second chance points, fast break points, bench points, timeouts.

**Derived metrics and the data each needs.**

| Metric | Formula | Available when |
|---|---|---|
| FG%, 3P%, FT% | made / attempted | attempts > 0 and `trackShotAttempts` |
| eFG% | (FGM + 0.5 × 3PM) / FGA | same |
| TS% | PTS / (2 × (FGA + 0.44 × FTA)) | same |
| Assist to turnover | AST / TOV | TOV > 0 |
| Minutes | seconds on court / 60 | lineups known and every substitution carried a clock |
| Points per minute | PTS / minutes | minutes available and > 0 |
| Plus/minus | team points minus opponent points while on court | both lineups known before the first score |
| Bench points | points by non starters | starters known |
| Possessions (estimate) | FGA + 0.44 × FTA − ORB + TOV | `trackShotAttempts` |
| Offensive, defensive efficiency | 100 × points / possessions | possessions > 0 |
| Turnover rate | TOV / possessions | possessions > 0 |
| Offensive rebound rate | ORB / (ORB + opponent DRB) | denominator > 0 |
| Lead changes, largest lead, scoring runs | from the scoring log | always |

**Completion.** No period open, all regulation periods played, and the score is not level unless `allowTie`.

**Rejected as impossible.** Scoring with no period open; opening overtime when not level; a point value that is not one of the configured three; an event for a player not on that team; an event for a fouled out player; with lineups known, an event for a player not on court; substituting in a player already on court.

---

## Pickleball

Default format: USA Pickleball traditional. Side-out scoring, games to 11, win by 2, match is best of 3 games.

| Rule key | Default | Meaning |
|---|---|---|
| `format` | `doubles` | or `singles` |
| `scoring` | `side_out` | or `rally` |
| `pointsToWin` | 11 | 15 and 21 are common alternatives |
| `winBy` | 2 | |
| `pointCap` | none | a game ends when a side reaches the cap |
| `bestOfGames` | 3 | games per set |
| `bestOfSets` | 1 | sets per match; 1 means a match is simply best of N games |
| `nextGameServe` | `alternate` | who serves first in the next game: `alternate`, `winner` or `loser` |

**Scoring.**
- Side-out: only the serving side scores. When the serving side loses a rally in doubles, serve passes to the partner (second server), then to the opponents (side out). Each game starts with the first serving side on its second server, so that side has one server only.
- Rally: the rally winner scores. If the receiver wins, the serve also passes.

**Events.** `FIRST_SERVE {side}` once before the first rally. `RALLY_WON {winner, how?, player?, shots?}` where `how` is `ace`, `winner`, `unforced_error`, `service_fault` or `other`. Side outs, game wins and set wins are **computed**, not recorded, so an impossible one cannot be entered. They appear in the timeline as derived entries.

**Raw statistics.** Per side: points won and lost, rallies won on serve, rallies served, rallies won on return, rallies received, aces, service faults, winners, unforced errors, games won and lost, sets won and lost, longest streak.

**Derived.** Point winning % (rallies won / rallies played), service point winning %, return point winning %, game winning %, set winning %, longest winning streak, current run, score progression per game.

**Completion.** A game ends when a side has at least `pointsToWin` and leads by `winBy`, or reaches `pointCap`. A set ends when a side wins more than half of `bestOfGames`. The match ends when a side wins more than half of `bestOfSets`.

**Rejected as impossible.** A rally before the first server is set; a rally after the match is decided; an ace credited to the receiving side; a service fault that gives the point to the server.

**Not applicable / not supported.** Double faults do not exist in pickleball (one serve attempt); a lost serve is a `service_fault`. Rally scoring "freeze" variants (game point must be won on serve) are not supported.

---

## Cricket

Cricket has its own model: innings of deliveries. It is never treated as team points.

Presets: `t20`, `odi`, `test`, `custom`.

| Rule key | T20 | ODI | Test | Meaning |
|---|---|---|---|---|
| `oversPerInnings` | 20 | 50 | none | none means unlimited |
| `inningsPerSide` | 1 | 1 | 2 | |
| `ballsPerOver` | 6 | 6 | 6 | |
| `wicketsPerInnings` | 10 | 10 | 10 | lower it for short sided cricket (8 a side means 7) |
| `maxOversPerBowler` | 4 | 10 | none | |
| `wideRuns`, `noBallRuns` | 1, 1 | 1, 1 | 1, 1 | penalty for the delivery |
| `wideRebowled`, `noBallRebowled` | true | true | true | false for local formats where the ball counts |
| `freeHit` | true | true | false | the delivery after a no-ball |
| `allowDeclaration` | false | false | true | |
| `allowDraw` | false | false | true | |
| `followOnLead` | none | none | 200 | minimum first innings lead to enforce the follow-on |
| `phases` | 1–6, 7–15, 16–20 | 1–10, 11–40, 41–50 | none | named over ranges; the first is the powerplay |

**Events.** `TOSS`, `INNINGS_START`, `DELIVERY`, `NEW_BATTER`, `RETIRE`, `PENALTY_RUNS`, `DECLARE`, `INNINGS_END`, `TARGET_REVISED`.

**A delivery stores:** innings, over number, ball number, striker, non-striker, bowler, runs off the bat, extra type, extra runs, total runs, whether it was legal, wicket (type, player out, fielder), whether it was a boundary, and commentary.

**Legal and illegal deliveries.** A wide or a no-ball is illegal: it adds runs and, when `wideRebowled` / `noBallRebowled` is true, does not count towards the over. Byes and leg-byes are legal deliveries.

**Who is charged.**

| Delivery | Team total | Batter | Ball faced | Bowler conceded | Counts in over |
|---|---|---|---|---|---|
| Runs off the bat | + runs | + runs | yes | + runs | yes |
| Wide | + `wideRuns` + runs run | 0 | no | + all | no (if rebowled) |
| No-ball | + `noBallRuns` + bat runs + any byes | + bat runs | yes | + penalty + bat runs | no (if rebowled) |
| Bye, leg-bye | + runs | 0 | yes | 0 | yes |
| Penalty runs | + runs | 0 | no | 0 | no |

**Dismissals.** `bowled`, `caught`, `lbw`, `stumped`, `hit_wicket`, `run_out`, `obstructing_field`, `hit_ball_twice`, `timed_out`, `retired_out`. The bowler is credited for bowled, caught, lbw, stumped and hit wicket. On a wide only stumped, hit wicket, run out and obstructing the field are possible. On a no-ball or a free hit only run out, obstructing the field and hit the ball twice are possible. Retired hurt is not a wicket and the batter may return.

**Overs.** Overs are stored as a count of legal balls. "4.5" means 4 overs and 5 balls, that is 29 balls, never 4.5. Economy and run rate divide by balls / `ballsPerOver`.

**Raw statistics.** Batting: runs, balls faced, fours, sixes, dismissal. Bowling: legal balls, runs conceded, wickets, maidens, wides, no-balls. Fielding: catches, run outs, stumpings. Team: runs, wickets, balls, extras by type, fall of wickets, partnerships, runs per over.

**Derived.**

| Metric | Formula | Available when |
|---|---|---|
| Strike rate | runs / balls × 100 | balls > 0 |
| Batting average | runs / dismissals | dismissals > 0 (historical) |
| Economy | runs conceded / (balls / `ballsPerOver`) | balls > 0 |
| Bowling average | runs conceded / wickets | wickets > 0 |
| Bowling strike rate | balls / wickets | wickets > 0 |
| Current run rate | runs / (balls / `ballsPerOver`) | balls > 0 |
| Required run rate | runs needed / (balls left / `ballsPerOver`) | chasing, limited overs, balls left > 0 |
| Partnerships | runs and balls between wickets | always |
| Wickets and runs by phase | from the per over log | `phases` configured |

A maiden is a completed over in which the bowler conceded no runs. Byes and leg-byes do not spoil a maiden.

**Innings end.** All out, overs completed, target reached (final innings), declared, or ended manually.

**Result.**
- The side batting last reaches the target: wins by wickets in hand.
- All innings complete: higher aggregate wins by runs; equal aggregates is a tie.
- A side has completed all its innings and is still behind a side with an innings unplayed: the other side wins by an innings and the difference.
- Two innings a side and undecided at close: draw (only when `allowDraw`).
- Abandoned: no result.
- `TARGET_REVISED {target, maxOvers}` replaces the chase target. The revised figure is entered by the scorer; DLS is not calculated.

**Rejected as impossible.** A delivery with the innings closed or a batter not yet at the crease; a striker or non-striker who is out or not in the batting side; a bowler from the batting side; the same bowler bowling consecutive overs; a bowler over `maxOversPerBowler`; a change of bowler mid over without `bowlerChange`; bat runs on a wide; a dismissal type that the delivery type cannot produce; a follow-on without the required lead; a declaration when not allowed.

**Not supported.** Super overs (a tied limited overs match is recorded as a tie). DLS calculation.

---

## Volleyball

Default format: FIVB indoor. Best of 5, sets to 25, deciding set to 15, win by 2, no cap.

| Rule key | Default | Meaning |
|---|---|---|
| `bestOf` | 5 | 3 is supported |
| `setPoints` | 25 | |
| `decidingSetPoints` | 15 | |
| `winBy` | 2 | |
| `pointCap` | none | |
| `playersOnCourt` | 6 | 2 for beach |
| `timeoutsPerSet` | 2 | |
| `substitutionsPerSet` | 6 | |
| `decidingSetToss` | true | the deciding set's first server is set by a new `FIRST_SERVE` |

**Scoring.** Rally point: every rally gives a point to its winner. When the receiving side wins it gains the serve and rotates one position clockwise.

**Events.** `FIRST_SERVE {side}`, `LINEUP {side, players}` (rotation order, position 1 first), `RALLY_WON {winner, how?, player?, shots?}`, `TOUCH {side, player, kind, quality?}`, `SUBSTITUTION`, `TIMEOUT`. `how` is `ace`, `kill`, `block`, `service_error`, `attack_error`, `opponent_error` or `other`. `TOUCH.kind` is `attack`, `dig`, `assist` or `reception`.

**Raw statistics.** Player and team: serves, aces, service errors, attack attempts, kills, attack errors, block points, digs, assists, receptions, positive receptions, reception errors. Team: points per set, rallies served and received, rallies won when receiving, longest rally (when `shots` is recorded).

**Derived.**

| Metric | Formula | Available when |
|---|---|---|
| Attack % (hitting efficiency) | (kills − attack errors) / attack attempts | attempts > 0 |
| Kill % | kills / attack attempts | attempts > 0 |
| Service efficiency | (aces − service errors) / serves | serves > 0 |
| Reception efficiency | (positive receptions − reception errors) / receptions | receptions > 0 |
| Side-out % | rallies won when receiving / rallies received | rallies received > 0 |
| Points per set | points / sets played | sets played > 0 |
| Longest rally, scoring runs | from the rally log | longest rally needs `shots` |

**Completion.** A set ends at the set's points target with a lead of `winBy`, or at `pointCap`. The match can only be completed when one side has won more than half of `bestOf`.

**Rejected as impossible.** A rally before the first server is known; a rally after the match is decided; an ace for the receiving side; a service error that gives the point to the server; a kill or block credited to a player of the losing side; more timeouts or substitutions than allowed in the set; a lineup of the wrong size.

---

## Badminton

Default format: BWF. Best of 3 games to 21, win by 2, cap at 30.

| Rule key | Default | Meaning |
|---|---|---|
| `format` | `singles` | or `doubles` |
| `bestOf` | 3 | |
| `pointsToWin` | 21 | |
| `winBy` | 2 | |
| `pointCap` | 30 | at 29 all the next point wins |

**Scoring.** Rally point. The rally winner scores and serves next. The winner of a game serves first in the next game.

**Deuce.** At 20 all a side must lead by 2. At 29 all the 30th point wins the game.

**Doubles service.** Each side has a right and a left service court. The serving side's players swap courts only when they win a point while serving. When the receiving side wins the rally it serves from the court that matches its score: right when even, left when odd. The engine tracks courts and names the server and the receiver.

**Events.** `FIRST_SERVE {side, server?, receiver?}`, `GAME_SERVE {server?, receiver?}` (optional, to name the players starting a later game), `RALLY_WON {winner, how?, player?, shots?}`. `how` is `ace`, `service_error`, `winner`, `smash_winner`, `net_winner`, `unforced_error`, `defensive` or `other`.

**Raw statistics.** Points won and lost, serves, service errors, aces, winners, smash winners, net winners, unforced errors, defensive points, rallies won on serve and on return, total shots and rallies with a recorded length, longest rally.

**Derived.** Point winning %, serve point winning %, return point winning %, game winning %, average rally length and longest rally (only over rallies whose length was recorded), longest winning streak, scoring runs, momentum (share of the last 10 rallies).

**Completion.** The match ends when a side wins more than half of `bestOf`.

**Rejected as impossible.** A rally before the first server is set; a rally after the match is decided; an ace for the receiving side; a service error that gives the point to the server; a named player who is not on the side the event credits.

---

## Swimming

Swimming is an event and performance system. There are no sides and no score. A contest is one race: one event, one round, one heat.

| Rule key | Default | Meaning |
|---|---|---|
| `distance` | required | metres |
| `stroke` | required | `freestyle`, `backstroke`, `breaststroke`, `butterfly`, `medley` |
| `course` | 50 | pool length in metres; 25 for short course |
| `relay` | false | |
| `relayLegs` | 4 | |
| `round` | `heat` | `heat`, `semi`, `final`, `timed_final` |
| `heat` | 1 | |
| `lanes` | 8 | |
| `entries` | required | lane, entry, name, and for relays the swimmers in order |
| `falseStartRule` | `one_start` | a false start disqualifies; `two_start` allows one per race |
| `rankPrecisionMs` | 10 | times are ranked to the hundredth; swimmers equal to the hundredth tie |
| `minMsPer50` | 15000 | sanity floor: a faster time is rejected as a timing error |

**Time.** Every time is an integer number of milliseconds. "01:02.45" is 62 450 ms and is displayed as 1:02.45. A time is never stored or compared as a decimal number.

**Events.** `RACE_START`, `FALSE_START {lane, recall?}`, `REACTION {lane, timeMs}`, `SPLIT {lane, distance, timeMs, strokeRate?}`, `RACE_FINISH {lane, timeMs}`, `DISQUALIFICATION {lane, reason}`, `DNS {lane}`, `DNF {lane}`. Split times are cumulative from the start.

**Raw statistics.** Per entry: final time, reaction time, each split, stroke rate where given, placement, status. Relays: each leg's time from the splits at leg boundaries, in relay order.

**Derived.**

| Metric | Formula | Available when |
|---|---|---|
| Lap times | difference between consecutive splits | two or more splits |
| Average split | final time / number of laps | finished |
| Pace | final time per 100 m | finished |
| Ranking | by final time at `rankPrecisionMs`; equal times share a place | finished |
| Gap to winner | final time − winner's time | finished |
| Personal best, season best | fastest earlier time for the same athlete, distance, stroke and course; season is the calendar year | earlier results exist |
| Difference from personal best | final time − previous best | earlier results exist |
| Improvement, improvement % | previous time − this time, and that over the previous time | a previous result exists |

**Completion.** Every entered lane has finished, been disqualified, not started, or not finished.

**Rejected as impossible.** A split or finish before the start; a lane with no entry; a time that is zero, negative or not a whole number of milliseconds; a split that is not later than the previous one; a split distance that is not a multiple of the course length or is beyond the race distance; a finish earlier than the last split; a time faster than the sanity floor; any timing for a lane already disqualified, finished, or marked as not started.

**Edge cases.** False start with `one_start` disqualifies the lane and the race continues; with `recall` the start is cancelled, splits are cleared and the race starts again. Ties share a place and the next place is skipped. Heats and finals are separate contests; ranking across heats of the same event is computed over their results.
