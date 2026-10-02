# Football (futsal) event scoring

Football now runs on the same event-driven pipeline as every other sport. Each action a scorer taps is stored as its own event, validated against the competition's rules, and replayed into the score, the statistics, the analytics and Game IQ:

```
tap (goal, shot, pass, foul, card ...)  → event with a device id (offline queue, safe retries)
  → rule check on the server            → append-only si_events (corrections are new events)
  → score + player and team stats       → analytics, insights, Game IQ
  → live score card for every viewer    → on completion: fixture result + player stats
```

Tournaments whose sport is **Futsal** (or old data saying Football) use it. The quick score entry in the Fixtures tab stays: organizers choose per match. Once a match is opened in the live scorer, its quick entry is replaced by a link, so the two cannot overwrite each other.

## Presets

| Rule | futsal | sevens | eleven |
|---|---|---|---|
| `playersOnPitch` / `minPlayers` | 5 / 3 | 7 / 5 | 11 / 7 |
| `periods` × `periodMinutes` | 2 × 20 | 2 × 25 | 2 × 45 |
| `extraTimeMinutes` (each half) | 5 | 0 | 15 |
| `knockoutDecider` | extra time, then penalties | penalties | extra time, then penalties |
| `shootoutKicks` | 5 | 5 | 5 |
| `maxSubstitutions` (empty = rolling) | rolling | rolling | 5, no return |
| `yellowsForRed` | 2 | 2 | 2 |
| `accumulatedFoulLimit` | 5 (6th foul: second penalty mark) | none | none |
| `timeoutsPerPeriod` | 1 | 0 | 0 |

`knockout` is set per match when it is opened, using the same test the database uses: a match that is not in a league, and not in a group stage, cannot end level.

## Events

| Event | Payload | Effect |
|---|---|---|
| `PERIOD_START` / `PERIOD_END` | | halves, then extra time halves when a knockout match is level |
| `LINEUP` | `side`, `players[]` | before kick-off |
| `SUBSTITUTION` | `side`, `in`, `out`, `minute?` | limits and no-return follow the preset |
| `GOAL` | `side`, `player?`, `assist?`, `kind?`, `ownGoal?`, `minute?` | +1 for `side`; also a shot on target; an own goal's player is from the other team |
| `SHOT` | `side`, `player?`, `outcome` (on_target, off_target, blocked, woodwork), `keeper?`, `penalty?` | an on-target shot that is not a goal is a save |
| `PASS` | `side`, `player?`, `to?`, `completed`, `key?` | optional; gives possession share and pass accuracy |
| `FOUL` | `side`, `player?`, `on?`, `penalty?` | futsal: counts toward accumulated fouls |
| `CARD` | `side`, `player?`, `color` | second yellow = red; a sent-off player leaves and cannot return |
| `CORNER`, `OFFSIDE`, `TACKLE`, `INTERCEPTION` | `side`, `player?` | |
| `TIMEOUT` | `side` | futsal only |
| `SHOOTOUT_START` | `first` | only for a level knockout match after any extra time |
| `SHOOTOUT_KICK` | `side`, `player?`, `scored` | in turn; decided as soon as the trailing side cannot catch up, then sudden death |

Every event may carry `minute`. The score changes only through `GOAL`; shootout kicks change the shootout score, never the match score.

## What the fixture gets

When the match is completed:
- **Result:** `record_match_result()` receives the regular-time score, the extra-time goals and the shootout score, so the bracket, home cards and existing displays work unchanged.
- **Player stats:** `record_match_player_stats()` receives each player's goals, assists, yellow cards and red card, so top scorers and card fines keep adding up. A Man of the Match already chosen by hand is kept.

## Statistics and insights

- **Player:** minutes (lineups plus a minute on every substitution), goals, assists, shots, on target, passes, pass %, key passes, tackles, interceptions, fouls, fouls drawn, offsides, saves, cards.
- **Team:** goals, shots, on target, shot accuracy, conversion, possession (share of recorded passes, only when passes were recorded), passes, pass accuracy, corners, fouls, offsides, saves, tackles, interceptions, woodwork, cards.
- **Live score card:** shots (on target), corners, fouls (this half, in futsal), cards, scorers with minutes, and the penalty score.
- **Insights:** braces and hat-tricks, shots not converted, comebacks, goalkeepers under fire, possession dominance, sendings-off, late goals, clean sheets, the shootout.
- **Game IQ:** answers from the match and the competition's rules (extra time, penalties, substitutions, cards, accumulated fouls, offside), plus a glossary.

**Not calculated:** expected goals, which needs shot locations, which are not recorded.

## Database

Apply `db/sports_intelligence_football.sql` once (it allows `football` and `tennis` on `si_contests`; it replaces the tennis-only script). Until then, opening a futsal match in the live scorer says the script is needed; quick entry works as before.

## Tests

`scripts/intelligence/football.test.mjs`: 12 checks covering:
- goals, assists, shots and saves
- own goals
- cards and sendings-off
- accumulated fouls
- league draws against knockout matches
- extra time and the fixture split
- shootouts and sudden death
- substitution rules and minutes
- possession
- timeouts
- Game IQ
- corrections
- season totals and presets
