# Basketball Game Intelligence

The basketball engine turns a scorer's taps into the game state, box score, team statistics, possession analytics, momentum insights, standings and plain-language answers. Everything is derived from one source of truth: the event log in `si_events`.

```
competition rules (tournaments.scoring_rules)
  → contest opened: rules + rosters frozen (si_contests)
  → play-by-play events (si_events, append only)
  → validation (engine.validateEvent, server side)
  → game state (engine.updateScore; full rebuild = reconstruct())
  → player / team statistics → analytics + insights
  → live score card (Realtime) · box score · play-by-play
  → stat lines on completion (si_stat_lines) → tournament leaders
  → fixture result (record_match_result) → standings
  → questions and glossary (engine.answerQuestion)
```

| Piece | File |
|---|---|
| Rules, presets, foul windows, timeout pools, vocabulary | `src/lib/intelligence/sports/basketball/rules.ts` |
| Engine: validation, state, statistics, analytics | `src/lib/intelligence/sports/basketball.ts` |
| Glossary and question answering | `src/lib/intelligence/sports/basketball/knowledge.ts` |
| Standings | `src/lib/tournaments/standings.ts` |
| Scorer pad | `src/components/intelligence/pads/BasketballPad.tsx` |
| Match centre (Ask card, insights, leader filters) | `src/components/intelligence/MatchCentre.tsx` |
| Services | `src/lib/intelligence/actions.ts` (`askContest` added) |
| Tests | `scripts/intelligence/basketball.test.mjs`, `standings.test.mjs` |

## Competition configuration

Nothing about a competition is assumed. A preset fills every value; any value can then be edited in **Live scoring → Scoring rules**. A match keeps the rules it was opened with.

| Rule | FIBA | NBA | NCAA (men) | Meaning |
|---|---|---|---|---|
| `periods` × `periodMinutes` | 4 × 10 | 4 × 12 | 2 × 20 | regulation |
| `overtimeMinutes` | 5 | 5 | 5 | each overtime |
| `playersOnCourt` | 5 | 5 | 5 | |
| `gameRosterSize` | 12 | 13 | 15 | players dressed for one game: on court plus substitutes (FIBA 5 + 7) |
| `shotClockSeconds` | 24 | 24 | 30 | empty = no shot clock |
| `alternatingPossession` | yes | no | yes | possession arrow for held balls |
| `foulLimit` | 5 | 6 | 5 | fouls to foul out |
| `technicalsCountTowardFoulLimit` | yes | no | yes | |
| `technicalEjectAt` / `unsportsmanlikeEjectAt` | 2 / 2 | 2 / 2 | 2 / 2 | ejection |
| `combinedEjectAt` | 2 | – | – | technical + unsportsmanlike together |
| `teamFoulWindow` | period | period | half | where team fouls are counted |
| `bonusAfterFouls` | 4 | 4 | 6 | free throws from the next common foul |
| `doubleBonusAfterFouls` | – | – | 9 | two shots instead of one-and-one |
| `overtimeTeamFouls` | carry | reset | carry | overtime continues the last window or starts again |
| `bonusAfterFoulsOvertime` | – | 3 | – | threshold when overtime resets |
| `offensiveFoulsAreTeamFouls` | yes | no | yes | |
| `technicalsAreTeamFouls` | yes | no | yes | player technicals only; bench technicals never |
| `timeoutsPerGame` | – | 7 | 4 | one pool for regulation |
| `timeoutsFirstHalf` / `SecondHalf` | 2 / 3 | – | – | used when there is no per-game pool |
| `timeoutsPerOvertime` | 1 | 2 | 1 | |
| `clutchMinutes` / `clutchMargin` | 5 / 5 | 5 / 5 | 5 / 5 | clutch time definition |
| `standingsWinPoints` / `LossPoints` / `ForfeitLossPoints` | 2 / 1 / 0 | 1 / 0 / 0 | 1 / 0 / 0 | league table |
| `standingsTiebreak` | head_to_head | head_to_head | head_to_head | or point_difference |
| `twoPointValue`, `threePointValue`, `freeThrowValue` | 2, 3, 1 | 2, 3, 1 | 2, 3, 1 | 1, 2, 1 for 3x3 |
| `trackShotAttempts` | yes | yes | yes | misses recorded (needed for %, possessions) |

## Events

Every event may carry `clock` (seconds left in the period) and `shotClock`. Player events need the player on that team, still eligible, and on court once lineups are known.

| Event | Payload | Effect |
|---|---|---|
| `PERIOD_START` / `PERIOD_END` | | overtime only when level and ties are not allowed |
| `ROSTER` | `side`, `players[]` (up to `gameRosterSize`) | before tip-off; required when a team registered more than `gameRosterSize`. Only dressed players may appear in lineups, substitutions, events and the box score |
| `LINEUP` | `side`, `players[]` (exactly `playersOnCourt`, or every eligible player once fouls leave fewer) | first lineup = starters; the rest of the game roster is the bench |
| `SUBSTITUTION` | `side`, `in`, `out` | without a clock, minutes become unknown |
| `SHOT_MADE` / `SHOT_MISSED` | `side`, `player?`, `points`, `assist?`, `zone?`, `shotType?`, `x?`, `y?` (0 to 100), `fastBreak?` | zone must agree with the value |
| `FREE_THROW_MADE` / `MISSED` | `side`, `player?`, `technical?` | technical free throws do not change possession |
| `REBOUND` | `side`, `player?` (none = team rebound), `offensive` | |
| `ASSIST`, `STEAL`, `BLOCK`, `TURNOVER` | `side`, `player?` | |
| `FOUL` | `side`, `player?` (none = bench), `kind`, `on?` (opponent fouled), `freeThrows?` 0 to 3 | kinds: personal, shooting, offensive, technical, unsportsmanlike (flagrant 1), disqualifying (flagrant 2) |
| `TIMEOUT` | `side` | refused when the pool is empty |
| `JUMP_BALL` | `side` (winner) | the opening jump sets the arrow to the other side |
| `HELD_BALL` | | ball to the arrow side, arrow flips (FIBA, NCAA only) |
| `ARROW` | `side` | set the arrow by hand |
| `OFFICIALS` | `names[]` (1 to 5) | |
| `VIOLATION` | `side`, `player?`, `kind` | see Score and rules engine |
| `OUT_OF_BOUNDS` | `side` (who put it out), `player?` | |
| `GOALTENDING` | `side` (defending), `player?`, `shooter?`, `points` | the basket is awarded |
| aliases | `TWO_POINT_MADE` … `3PT_MISSED` | stored as `SHOT_MADE` / `SHOT_MISSED` |

An offensive foul is also a turnover. A foul that disqualifies removes the player from the floor; the scorer names the replacement with a substitution.

## Score and rules engine

**Accuracy principle:** the score never changes without a valid scoring event, and no scoring event is accepted without passing the competition's rules.

```
scorer action → event (client id) → canonical form (TWO_POINT_MADE → SHOT_MADE 2)
  → rule validation (base checks, free-throw sequence, dead ball, shot clock, expected score)
  → accepted: game state, score, player and team stats, explanation → snapshot → Realtime
  → refused: nothing stored, the scorer is told why
```

**Only three events change the score:** `SHOT_MADE` (+2 or +3), `FREE_THROW_MADE` (+1) and `GOALTENDING` (the basket is awarded to the shooting team). Misses, violations, fouls, jump balls and out-of-bounds never do.

Every scoring play keeps its points, the score after it, the period and clock, the player and team, and an explanation such as "Alpha's score changed from 72 to 75 because Alpha 3 made a three-point field goal (+3)."

**Event names:** `TWO_POINT_MADE`, `TWO_POINT_MISSED`, `THREE_POINT_MADE` and `THREE_POINT_MISSED` (or `2PT_`/`3PT_`) are accepted and stored as the shot events with the competition's values.

**Expected score:** a client may send `expectedScore: { a, b }` with any event. It is refused unless previous score + this event's points equals it ("Scoring inconsistency: 75-70 plus 3 for Alpha is 78-70, not 79-70").

### Free throws

Free throws are awarded by the foul, not typed in.

| Foul | Free throws |
|---|---|
| Shooting foul straight after a made shot | 1 (and-one: the basket, the foul and the free throw stay three separate events) |
| Shooting foul straight after a missed shot | the shot's value (2 or 3); the miss stops counting as a field goal attempt |
| Common foul, team not in the penalty | 0 |
| Common foul in the bonus | `bonusFreeThrows` (2), as a one-and-one where `oneAndOne` is on (NCAA), two shots in the double bonus |
| Technical | `technicalFreeThrows` (FIBA and NBA 1, NCAA 2), any player, taken first; possession does not change |
| Unsportsmanlike / flagrant, disqualifying | on a shot as for a shooting foul, otherwise `unsportsmanlikeFreeThrows` (2) |
| Offensive | none |

The scorer can still state `freeThrows` where the referee's call differs.

**Sequence rules:**
- **Each attempt counts on its own:** made +1, missed +0.
- **Order:** until a set is finished, only that team's free throws (by the fouled player, when known), fouls, timeouts and substitutions are accepted. A shot, rebound, turnover or the end of the period is refused.
- **One-and-one:** a missed first shot ends it.
- **No extras:** a free throw beyond the awarded number is refused until play moves on.
- **Free throws with no recorded foul:** accepted, so a scorer who does not log fouls can still score. They are flagged in the explanation.

### Violations, out-of-bounds, goaltending

| Event | Effect |
|---|---|
| `VIOLATION` traveling, double_dribble, carrying, backcourt, three_seconds, five_seconds, eight_seconds, shot_clock, basket_interference | turnover; the ball goes to the other team; score unchanged |
| `VIOLATION` kicked_ball, defensive_three_seconds | the offence keeps the ball; score unchanged |
| `OUT_OF_BOUNDS` (side = the team that put it out) | the ball goes to the other team; a turnover only if that team had the ball |
| `GOALTENDING` (side = the defending team, `shooter`, `points`) | the basket is credited to the shooter (field goal made, points added) |

After a violation or the ball going out, the other team has a dead ball. A basket by the team that lost it is refused ("The basket cannot count: Alpha 1 traveling, so the ball went to Bravo") until the other team acts, or a steal or jump ball changes possession.

### Shot clock

- **Running down:** within a possession the shot clock only runs down.
- **Reset:** an offensive rebound, a kicked ball or a defensive foul resets it to `shotClockReset` (FIBA and NBA 14, NCAA 20) if it was lower.
- **Full clock:** a new possession starts a full clock.
- **Game clock:** a shot clock above the game clock is refused, because the shot clock is switched off then.
- **Display:** values are recorded as the scorer sends them; the device does not run a shot clock.

### Game state machine

Match status (scheduled, live, paused, completed, abandoned, postponed, cancelled) combined with the period gives the brief's states:

| State | Status and period |
|---|---|
| SCHEDULED | scheduled |
| WARMUP | live, before tip-off ("Not started") |
| LIVE_Q1 to LIVE_Q4 | live, period open |
| HALFTIME | the middle period ended |
| OVERTIME | period beyond regulation |
| FINAL | completed |

**Transitions:**
- Periods only open one at a time, in order.
- Overtime only opens when level (unless the competition allows ties). There is no limit on overtimes.
- A game is final only when the scorer completes it; a score never ends a game.
- A final game accepts nothing except audited corrections.

### Corrections and undo

- **Corrections:** a correction (reverse or replace) is a new event naming its target, with the scorer, time and reason, and the score before and after it. The timeline shows "Score 82-70 to 80-70".
- **Undo last:** this reverses the latest event and rebuilds the game from the log, so the score, stats and possessions all follow. Points are never subtracted by hand.
- **Questions:** "Why was this basket cancelled?" is answered from the latest correction.

### Explanations and rule questions

**Explanations:** every score change, scoreless play, foul (and the free throws it gave, and why), violation and change of possession produces an explanation from the event itself. The last 40 are kept in the game state.

**Questions the Ask card answers:**
- **From the competition's configuration:** "How many points is a three-pointer?", "Does a missed free throw change the score?", "What happens when the game is tied?", "When does overtime start?", "How many fouls can a player have?", "What is a team bonus?", "What happens after a technical foul?", "How long is the shot clock?"
- **From the explanations:** "Why did the score increase by 1?", "Why did possession change?", "Why did the basket not count?", "Why are free throws being taken?"

## Possessions

Counted from play-by-play, never from the score. A side starts a possession the first time it acts with the ball (shot, free throw, offensive rebound, turnover, offensive foul) or wins it (defensive rebound, steal, jump ball, held ball). An offensive rebound continues the same possession, which is the standard definition; points after it are second-chance points. A possession that starts after the opponent's turnover produces points off turnovers.

One possession is inferred rather than seen: when a side that just scored takes a shot or turns the ball over with no event recorded for the opponent in between, the opponent must have had the ball (it inbounds after a score). That possession is counted, marked `inferred`, and reported in the Possessions card. Free throws never trigger this (an and-one or a second free throw is the same possession). A steal after a score infers the opponent's possession ended in that turnover.

Possessions are reported only when `trackShotAttempts` is on. The box-score estimate (FGA + 0.44 × FTA − ORB + TOV) is shown alongside, labelled as an estimate.

## Formulas and when they are reported

"n/a" means the data cannot support the figure. It is never shown as 0.

| Figure | Formula | Needs |
|---|---|---|
| FG%, 3P%, FT% | made / attempted × 100 | misses tracked, attempts > 0 |
| eFG% | (FGM + 0.5 × 3PM) / FGA | misses tracked |
| TS% | PTS / (2 × (FGA + 0.44 × FTA)) | misses tracked |
| Efficiency (EFF) | PTS + REB + AST + STL + BLK − missed FG − missed FT − TOV | misses tracked |
| Minutes | seconds on court / 60 | both lineups, a clock on every substitution |
| Plus/minus | team points − opponent points while on court | both lineups before the first basket |
| USG% | 100 × (FGA + 0.44 FTA + TOV) × (team min / N) / (min × (team FGA + 0.44 team FTA + team TOV)) | minutes, misses tracked; N = players on court |
| AST% | 100 × AST / ((min / (team min / N)) × team FGM − FGM) | minutes |
| TOV% | 100 × TOV / (FGA + 0.44 FTA + TOV) | misses tracked |
| REB% | 100 × REB × (team min / N) / (min × (team REB + opponent REB)) | minutes |
| On-court ORtg / DRtg / Net | 100 × points for (against) on court / possessions on court | lineups known for every possession, possessions counted |
| Possessions, PPP | counted; points / possessions | misses tracked |
| Offensive / defensive / net rating | 100 × points / possessions | possessions > 0 |
| Pace | (possessions + opponent possessions) / 2 × regulation seconds / seconds played | possessions, clock for a period in play |
| OREB%, DREB%, TRB% | own / (own + opponent's opposite) | denominator > 0 |
| Opponent FG%, 3P% | opponent made / attempted | misses tracked |
| Clutch figures | the same counters, only for events in the last `clutchMinutes` of the final period or overtime with margin ≤ `clutchMargin` before the event | a clock on every play event in the final period or overtime |
| Scoring drought | longest game-clock gap between a side's scores in a period | a clock on every score in that period |
| Run duration | first − last clock of the run | both ends clocked in one period |
| Comeback | the largest deficit a side overcame to take the lead | |

Historical (season) figures sum raw counters and derive from the sums: per-game averages, percentages over all attempts (never an average of percentages), usage only if every game had minutes, ratings only if every game counted possessions.

## Live and analytics

**Score card:** score, period and clock, possession indicator, team fouls in the current window, bonus or double bonus, timeouts left, foul trouble, fouled-out players, and the possession arrow.

**Play-by-play:** the period, game clock and shot clock on every event, the score after every scoring play, and run calls ("Bravo on an 8-0 run", "Alpha end Bravo's 10-0 run").

**Analytics tab:**
- **Insights:** plain sentences, each from a recorded figure.
- **Cards:** lead changes, ties, largest lead, best run, comeback, possessions, pace, PPP.
- **Charts:** scoring by period, score progression, game flow (margin), shooting efficiency, PPP by period, team comparison, shot distribution by zone, scoring runs.
- **Tables:** game leaders, contribution, runs, momentum, how possessions ended, shooting by zone and by shot type, clutch.

**Box score (Players tab):** MIN, PTS, REB, AST, STL, BLK, TO, FG, 3P, FT, +/−, PF; plus Shooting, Advanced and Fouls tables. Tables scroll horizontally on a phone.

## Questions and glossary

`askContest(contestId, question)` answers from the stored game state through keyword matching (no language model), so the same question always gets the same answer.

**Game questions it answers:**
- The score and who is leading
- A player's points, rebounds, assists, fouls, shooting, plus/minus or full line
- Leaders in any category, optionally for one team
- A team's threes, free throws, shooting, rebounds, turnovers, paint, second-chance, bench and fast-break points
- Points in a given period
- The biggest run, lead changes and largest lead
- What caused the current lead (the largest recorded differences)
- Double-doubles and triple-doubles
- Overtime, possessions, timeouts left, team fouls, bonus and who has the ball

**Glossary:** "What is …" or "Explain …" questions are answered from 45 explained terms.

**What it won't do:** a figure the data cannot support is answered as not available, with the reason. A question it cannot answer says so; it never guesses.

## Standings

Basketball tables are computed from the fixtures with the competition's rules:
- **Table points:** for a win, a loss and a forfeit.
- **Forfeits:** a walkover, or a result with no score, counts as a forfeit, with no points for or against.
- **Columns:** win %, points for and against, difference, streak and last five.

**Tiebreakers:**
- **`head_to_head`** (FIBA): among teams level on points, the games between them decide first (points, then difference, then points scored). Then overall difference, overall points scored, and name.
- **`point_difference`:** overall difference first, then games between the tied teams.

Football keeps `tournament_standings()`.

## Data architecture

The brief suggested a table per concept (`basketball_games`, `basketball_events`, `basketball_possessions`, `basketball_shots`, `basketball_fouls`, `basketball_player_stats`, …). They are deliberately not separate tables. Each would be a second copy of what the event log already holds, and copies drift. The log is authoritative; every concept below is derived from it and rebuilt identically by `reconstruct()`:

| Suggested entity | Where it lives |
|---|---|
| games, game periods | `tournament_matches` (fixture) + `si_contests` (status, state, period scores) |
| teams, players, game players | `tournament_teams`, `tournament_team_players`; rosters frozen in `si_contests.context` |
| events, shots, fouls, rebounds, substitutions, timeouts, lineups | `si_events` rows by `type` |
| possessions | derived in state (`possessions[]`) |
| team, player, game stats | derived; raw counters stored per finished game in `si_stat_lines` |
| competition rules | `tournaments.scoring_rules`, frozen per game in `si_contests.rules` |
| seasons | a tournament is the competition-season; history filters by tournament and date |
| standings | derived from `tournament_matches` |

Integrity (§26), all server side:
- **Event validation:** every event passes the engine's validation in a server action before `si_append_event` stores it.
- **Permissions:** the RPC checks `si_can_score`.
- **Ordering:** a sequence lock rejects simultaneous writers.
- **Idempotency:** `client_id` makes retries safe.
- **Immutability:** events cannot be updated or deleted (a trigger enforces this), and corrections must name their target and give a reason.
- **One contest per fixture.**
- **Completed games:** they accept only corrections.
- **Audit:** `recalculateContest` rebuilds from the log and reports drift.

No schema change was needed.

## Limitations

- **Shot locations:** coordinates (`x`, `y`) are accepted and validated, but the scorer pad records zones by chip, not by tapping a court, and no coordinate shot chart is drawn yet. Zone distribution is charted.
- **Shot clock:** values are recorded when the scorer sends them. There is no running shot clock on the device.
- **Rules not modelled:** the NBA last-two-minutes bonus rule, FIBA's limit of two timeouts in the last two minutes, coach ejections, and per-foul free-throw counts beyond what the scorer records.
- **Head-to-head tiebreak:** applied once to the whole tied group, not re-applied to each remaining subset as FIBA does for three or more teams.
- **Tactics:** offensive and defensive schemes are explained in the glossary but never detected. There is no tracking or video data, so the engine does not claim them.
- **Home and away:** fixtures have sides A and B, so there are no home or away records.
- **Trust in scorers:** an authorised scorer calling `si_append_event` directly (outside the app) could store an event, and a cached state, that skipped validation. The event log still holds the truth: `Recalculate from events` replays it, reports any impossible event as invalid, leaves it out of the score and overwrites the cached state.
