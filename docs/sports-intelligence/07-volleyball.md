# Volleyball

Runs on the shared scoring engine: no tables of its own and no SQL to run.
Everything is an event in `si_events`; the engine rebuilds the match from them.

- `sports/volleyballRules.ts`: formats (indoor best of 5 or 3, beach, custom), set score validation, table points, leaderboard formulas. Used by the form, the table and the engine, so they agree.
- `sports/volleyball.ts`: the engine.
- `pads/VolleyballPad.tsx`: the live scorer. `volleyball/`: court, set scorecard, public match panel.
- `tournaments/VolleyballResultModal.tsx`: Enter match result.

## Events

`LINEUP`, `LIBERO_SET`, `FIRST_SERVE`, `RALLY_WON`, `TOUCH`, `TIMEOUT`, `SUBSTITUTION`, `LIBERO_IN`, `LIBERO_OUT`, `SANCTION`, `MATCH_MVP`, `OFFICIALS`, `FINAL_SETS` for a result entered after the match, and `PLAYER_POINTS` for points added to a player by hand.

- A set starts with `FIRST_SERVE` and ends by itself when the score says so. There is no end-set event, so a set can't be ended at an invalid score.
- A team rotates only when it wins the serve. Each set starts from the last confirmed order.
- The Libero leaves automatically on reaching the front row, and never serves.
- A red card is a point and the serve to the other team. Expelled or disqualified players can't return, and replacing one is allowed past the substitution limit.

## Entered results

`saveVolleyballResult` writes `FINAL_SETS` then `MATCH_COMPLETE`, so the fixture, bracket and table update as for a live match.

- Player figures are only what was typed. A quick result creates no player lines.
- Over live scoring it needs confirming (`overrideLive`); the live events stay.
- Changing it replaces the event with a required reason. The old event, who changed it and when stay on record.
- If the winner changes, the bracket moves first, so the match and fixture never disagree. A later round with a result or a scoring record is frozen to the old winner's roster, so that change is refused and nothing is stored.

## Player points

`PLAYER_POINTS` (`player`, `points`) adds to one player's record by hand, with no category. The scorer does it from the panel on the scoring page (`volleyball/PlayerPointsPanel.tsx`); the Fixtures tab links to it.

- It is a statistical event (`statisticalEvents` on the engine), so it is accepted live, paused and after the match, and refused for a match not started, called off or a walkover.
- It only adds `manualPoints` to the player. Sets, rallies, the serve, the team's figures and the fixture never change, and correcting one doesn't re-send the fixture's result.
- Who and when are on the event. Undo is a void, a correction is a replacement with a required reason, and `getPlayerPoints` lists them all for the panel.
- `pointsScored` includes it, so it counts towards Top scorer, the MVP rating, player cards and profiles.

## Table

`computeVolleyballStandings`, from the fixtures plus each match's set scores (`getVolleyballMatchFacts`). Default points are FIVB's: 3-0 or 3-1 is 3 and 0, a deciding-set result is 2 and 1. Tiebreaks are in the rules, in order: wins, set ratio, point ratio, head to head.

## Leaderboards

Formulas are in `VOLLEYBALL_LEADERBOARDS`, and each is shown next to its table. Tournament MVP is points won, plus half of assists, digs and positive receptions, minus half of errors.

Tournament leaderboards, player cards and team pages include matches in progress, worked out from the contest's state (`volleyballLive.ts`). Career figures on `/p/<username>` wait for the match to finish.

## Public pages

- `/volleyball`: tournaments, live, upcoming and recent matches, leading teams and top players, with filters and search.
- `/tournaments/<slug>/teams/<id>`: a team's record, results and upcoming matches. The squad needs a sign-in, as the Teams tab does.
- `/tournaments/<slug>/players/<id>`: a roster player's recorded figures, match by match. Needs a sign-in.
- `/p/<username>`: a Volleyball section once a linked account has recorded figures.

`/sports/*` is excluded from the proxy for the sport photos, so a page there gets no CSP nonce and never hydrates. Don't put routes under it.
