// League tables. How a table is scored and ranked depends on the sport
// and the competition, so neither is assumed here.
//
// Football (and any sport without its own rules) keeps
// tournament_standings(): 3 for a win, 1 for a draw, ranked on points,
// goal difference, goals scored.
//
// Basketball is computed from the fixtures with the competition's own
// rules (tournaments.scoring_rules, see sports/basketball/rules.ts):
// table points for a win, a loss and a forfeit, no draws unless the
// competition allows ties, and either FIBA's head-to-head tiebreak or
// overall point difference first. For an event-scored match the score
// is the final the scorer console wrote to the fixture.

import type { TournamentMatch, TournamentStanding, TournamentTeam } from "./types";
import { resolveBasketballRules, type BasketballRules } from "../intelligence/sports/basketball/rules";

export interface StandingsScheme {
  draws: boolean;
  // short column labels for the scored-for / against / difference counts
  forLabel: string;
  againstLabel: string;
  diffLabel: string;
  // the same, spelled out for screen readers and the public chips
  forName: string;
  againstName: string;
  diffName: string;
}

const FOOTBALL: StandingsScheme = {
  draws: true,
  forLabel: "GF", againstLabel: "GA", diffLabel: "GD",
  forName: "Goals for", againstName: "Goals against", diffName: "Goal difference",
};

const BASKETBALL: StandingsScheme = {
  draws: false,
  forLabel: "PF", againstLabel: "PA", diffLabel: "+/-",
  forName: "Points for", againstName: "Points against", diffName: "Point difference",
};

// Sports decided in sets or games: no draws, no extra time or penalties,
// and the fixture score is sets (or games) won.
const SETS: StandingsScheme = {
  draws: false,
  forLabel: "SW", againstLabel: "SL", diffLabel: "+/-",
  forName: "Sets won", againstName: "Sets lost", diffName: "Set difference",
};
const GAMES: StandingsScheme = {
  draws: false,
  forLabel: "GW", againstLabel: "GL", diffLabel: "+/-",
  forName: "Games won", againstName: "Games lost", diffName: "Game difference",
};

const key = (sport: string | null | undefined) => (sport ?? "").trim().toLowerCase();
export const isBasketball = (sport: string | null | undefined): boolean => key(sport) === "basketball";

export function standingsScheme(sport: string | null | undefined, scoringRules?: unknown): StandingsScheme {
  if (isBasketball(sport)) return { ...BASKETBALL, draws: basketballRulesOf(scoringRules).allowTie };
  if (key(sport) === "volleyball" || key(sport) === "tennis") return SETS;
  if (key(sport) === "badminton" || key(sport) === "pickleball") return GAMES;
  return FOOTBALL;
}

/** The competition's basketball rules, or the FIBA defaults if none (or invalid ones) are saved. */
export function basketballRulesOf(scoringRules: unknown): BasketballRules {
  try { return resolveBasketballRules(scoringRules ?? {}); } catch { return resolveBasketballRules({}); }
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export interface BasketballStanding extends TournamentStanding {
  win_pct: number | null;
  forfeits: number;
  // "W3", "L1"; empty before the first game
  streak: string;
  // most recent last, e.g. "WWLWL"
  last5: string;
}

type TeamRef = Pick<TournamentTeam, "id" | "name" | "status" | "group_name">;

interface Game { a: string; b: string; winner: string | null; scoreA: number | null; scoreB: number | null; forfeit: boolean; order: number }

const ordered = (m: TournamentMatch) => [m.starts_at ? Date.parse(m.starts_at) : Number.MAX_SAFE_INTEGER, m.round, Date.parse(m.created_at)];

/** Games that count: league or group stage, finished, both teams known. */
function gamesOf(matches: TournamentMatch[], group: string | null): Game[] {
  return matches
    .filter((m) => (m.stage === "league" || m.stage === "group") && (group === null || m.group_name === group))
    .filter((m) => (m.status === "completed" || m.status === "walkover") && m.team_a_id && m.team_b_id)
    .sort((x, y) => {
      const ox = ordered(x), oy = ordered(y);
      return ox[0] - oy[0] || ox[1] - oy[1] || ox[2] - oy[2];
    })
    .map((m, i) => ({
      a: m.team_a_id!, b: m.team_b_id!, winner: m.winner_team_id, scoreA: m.score_a, scoreB: m.score_b,
      // a walkover, or a result recorded with no score, is a forfeit: no points for or against
      forfeit: m.status === "walkover" || m.score_a === null || m.score_b === null,
      order: i,
    }));
}

interface Tally { played: number; won: number; drawn: number; lost: number; forfeits: number; pf: number; pa: number; points: number; results: ("W" | "L" | "D")[] }

function tally(teamIds: string[], games: Game[], rules: BasketballRules): Map<string, Tally> {
  const t = new Map<string, Tally>(teamIds.map((id) => [id, { played: 0, won: 0, drawn: 0, lost: 0, forfeits: 0, pf: 0, pa: 0, points: 0, results: [] }]));
  for (const g of games) {
    for (const [me, them, mine, theirs] of [[g.a, g.b, g.scoreA, g.scoreB], [g.b, g.a, g.scoreB, g.scoreA]] as const) {
      const row = t.get(me);
      if (!row || !t.has(them)) continue;
      row.played += 1;
      if (!g.forfeit) { row.pf += mine ?? 0; row.pa += theirs ?? 0; }
      if (g.winner === me) { row.won += 1; row.points += rules.standingsWinPoints; row.results.push("W"); }
      else if (g.winner === them) {
        row.lost += 1; row.results.push("L");
        if (g.forfeit) { row.forfeits += 1; row.points += rules.standingsForfeitLossPoints; }
        else row.points += rules.standingsLossPoints;
      } else {
        // a tie, only possible where the competition allows one: halfway between a win and a loss
        row.drawn += 1; row.results.push("D");
        row.points += (rules.standingsWinPoints + rules.standingsLossPoints) / 2;
      }
    }
  }
  return t;
}

/** Order teams level on points. FIBA: games between them first; otherwise overall difference first. */
function breakTies(ids: string[], all: Map<string, Tally>, games: Game[], rules: BasketballRules, name: (id: string) => string): string[] {
  if (ids.length < 2) return ids;
  const set = new Set(ids);
  const mini = tally(ids, games.filter((g) => set.has(g.a) && set.has(g.b)), rules);
  const diff = (m: Map<string, Tally>, id: string) => m.get(id)!.pf - m.get(id)!.pa;
  const h2h = (x: string, y: string) =>
    mini.get(y)!.points - mini.get(x)!.points || diff(mini, y) - diff(mini, x) || mini.get(y)!.pf - mini.get(x)!.pf;
  const overall = (x: string, y: string) => diff(all, y) - diff(all, x) || all.get(y)!.pf - all.get(x)!.pf;
  return [...ids].sort((x, y) =>
    (rules.standingsTiebreak === "head_to_head" ? h2h(x, y) || overall(x, y) : overall(x, y) || h2h(x, y))
    || name(x).localeCompare(name(y)));
}

export function computeBasketballStandings(
  matches: TournamentMatch[], teams: TeamRef[], scoringRules: unknown, group: string | null = null,
): BasketballStanding[] {
  const rules = basketballRulesOf(scoringRules);
  const pool = teams.filter((t) => t.status === "confirmed" && (group === null || t.group_name === group));
  const ids = pool.map((t) => t.id);
  const name = (id: string) => pool.find((t) => t.id === id)?.name ?? "";
  const games = gamesOf(matches, group);
  const all = tally(ids, games, rules);

  // group by table points, best first, then break each tie
  const byPoints = new Map<number, string[]>();
  for (const id of ids) byPoints.set(all.get(id)!.points, [...(byPoints.get(all.get(id)!.points) ?? []), id]);
  const order = [...byPoints.keys()].sort((x, y) => y - x).flatMap((p) => breakTies(byPoints.get(p)!, all, games, rules, name));

  return order.map((id) => {
    const r = all.get(id)!;
    const last = r.results[r.results.length - 1];
    let run = 0;
    for (let i = r.results.length - 1; i >= 0 && r.results[i] === last; i--) run += 1;
    return {
      team_id: id, team_name: name(id),
      played: r.played, won: r.won, drawn: r.drawn, lost: r.lost,
      goals_for: r.pf, goals_against: r.pa, goal_diff: r.pf - r.pa, points: r.points,
      win_pct: r.played ? Math.round((1000 * (r.won + r.drawn / 2)) / r.played) / 10 : null,
      forfeits: r.forfeits,
      streak: last ? `${last}${run}` : "",
      last5: r.results.slice(-5).join(""),
    };
  });
}
