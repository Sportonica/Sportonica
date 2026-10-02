# Game IQ for every sport, and tennis

Basketball has its own Game IQ (see [05-basketball.md](05-basketball.md)). This document covers cricket, volleyball, badminton, pickleball, swimming and the new tennis engine. Football (futsal) keeps its manual score entry and has no engine.

## What Game IQ adds

| Feature | Where in the app | Source |
|---|---|---|
| **Ask about this game** | Match centre, Live tab | `askContest()` → `engine.answerQuestion()` |
| **How scoring works** | Match centre (Live tab) and Live scoring hub | `engine.rulesGuide(rules)` |
| Rule answers ("How many points win a game?") | Ask card | the competition's saved scoring rules |
| Glossary ("What is a free hit?") | Ask card | per-sport glossary |
| Why the score changed | Ask card | the latest recorded rallies, points or balls |
| Statistics ("Who has the most kills?") | Ask card | the stat tables the engine already produces |

Answers come only from the match's recorded events and the competition's rules. A figure that was never recorded is answered as not recorded; a question it cannot place lists what it can answer.

## How it is built

```
src/lib/intelligence/core/ask.ts        shared answerer: score, players, leaders, team figures, rules, glossary, why
src/lib/intelligence/knowledge/<sport>.ts  each sport: glossary, rules in words, stat vocabulary, explanations, guide
src/lib/intelligence/knowledge/rally.ts    shared by the rally sports: why a rally did or did not score
```

Each engine gets two lines: `answerQuestion` calls `askMatch(this, …, <SPORT>_KNOWLEDGE)` and `rulesGuide` returns the guide. The engines' scoring logic is unchanged.

The order of answering:
1. A sport-specific question (swimming: who won, why a swimmer was disqualified)
2. "Why …" from the latest plays
3. A rule, when no player or team is named
4. A glossary term
5. A player's figure
6. A leader
7. A team's figure
8. The score

Adding Game IQ to another sport is one knowledge file plus those two engine lines (and the sport in `capabilities.ts`, which a test keeps in step).

### What each sport knows

| Sport | Rules answered from settings | Glossary (examples) | Why the score changed |
|---|---|---|---|
| Cricket | overs, balls an over, wickets, wides, no-balls, free hit, bowler limits, result, follow-on, declarations, powerplay | LBW, free hit, maiden, economy, strike rate, DLS (not calculated) | every ball: dot, runs off the bat, four, six, wide, no-ball, bye, leg-bye, wicket |
| Volleyball | points per set, deciding set, best of, timeouts, substitutions, rotation | rally scoring, side-out, kill, dig, libero, attack % | each rally and how it was won |
| Badminton | game to 21, setting and the 30 cap, best of, service courts | rally point scoring, setting, smash, clear, let | each rally and how it was won |
| Pickleball | side-out or rally scoring, game to 11, server number, next game's server | kitchen, two-bounce rule, dink, 0-0-2 | a point, or a side out with no point |
| Swimming | event, false-start rule, how places are decided, relays | strokes, split, reaction time, DQ, heat, PB | the race log |
| Tennis | 15-30-40, deuce or no-ad, sets, tiebreaks, final set, serving order | love, deuce, break point, tiebreak, ace, bagel | every point, on serve or return, with the call |

## Tennis

A new engine (`src/lib/intelligence/sports/tennis.ts`) with a one-tap scorer pad (`pads/TennisPad.tsx`).

**Events:**
- `FIRST_SERVE {side}`
- `POINT_WON {side, how?, serve?, player?, shots?}`

`how` is one of `ace`, `double_fault`, `winner`, `forced_error`, `unforced_error` or `other`. `serve` is `1` (first serve in) or `2`.

**Settings and presets:**

| Rule | best_of_3 | best_of_5 | doubles_pro |
|---|---|---|---|
| `format` | singles | singles | doubles |
| `bestOfSets` | 3 | 5 | 3 |
| `gamesPerSet` | 6 | 6 | 6 |
| `tiebreakAt` (empty = advantage sets) | 6 | 6 | 6 |
| `tiebreakPoints` | 7 | 7 | 7 |
| `finalSet` | tiebreak | tiebreak | match_tiebreak |
| `matchTiebreakPoints` | 10 | 10 | 10 |
| `noAd` | no | no | yes |

**Scoring:**
- **Games:** points are called 0, 15, 30, 40. At deuce a player needs two points in a row; with no-ad scoring the next point wins.
- **Sets:** a set goes to 6 games with a 2-game lead, with a tiebreak at 6-all to 7 (win by 2).
- **Tiebreak serving:** the next server serves the first point, then the serve changes every two points. After a tiebreak, the player who received first serves the next set.
- **Final set:** a tiebreak, played out by two games (advantage), or a single match tiebreak to 10.
- **Fixture score:** sets won.
- **Live score card:** sets, the current set's games and points, and the server. It also flags break point, set point and match point, and shows aces, double faults and break points won.

**Statistics:**
- Points, games and sets won
- Aces and double faults
- 1st serve in %, 1st and 2nd serve points won %, service and return points won %
- Break points won and saved, service games held
- Winners, forced and unforced errors, tiebreaks won, most points in a row

Serve figures only count points where the serve was recorded. Season figures sum raw counters.

**Refused as impossible:**
- An ace won by the receiver, or a double fault won by the server
- A serve recorded on a double fault
- A player credited to the wrong side
- Any point after the match is won

**Database:** apply `db/sports_intelligence_tennis.sql` once (it adds `tennis` to the allowed sports on `si_contests`). Until then, setting up a tennis match says so.

## Fixtures and tables for set and game sports

Volleyball and tennis (sets) and badminton and pickleball (games) cannot draw and have no extra time or penalties. The Fixtures tab no longer offers them, and a level score cannot be saved. Their tables label the score columns sets or games won and lost.

## Running

Running is not part of this. It already has its own results feature (race categories and finish times), and a second engine would duplicate it. Adding Game IQ to running would mean building on that feature instead.

## Tests

`npm run test:intelligence` includes `tennis.test.mjs` (10 checks) and `gameiq.test.mjs` (5 checks across cricket, volleyball, badminton, pickleball and swimming).
