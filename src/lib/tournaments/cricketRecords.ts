// Cricket tournament statistics and records, worked out on read from
// what is already stored, so a corrected ball shows up everywhere at once:
//   - players: each scored match's stat lines (si_stat_lines, one per
//     player per match, rewritten on every correction), plus the totals
//     entered by hand from the fixtures for matches not scored ball by ball
//   - teams: the fixtures' runs, wickets and overs (the same rows the
//     points table uses)
// Nothing here is stored, so there is nothing to go stale.

import type { TournamentCricketStatRow, TournamentMatch } from "./types";
import { ballsOf, cricketOutcome, cricketRulesOf, oversOf, type CricketMatchFacts } from "./standings";

// ── players ─────────────────────────────────────────────────────

/** One player's figures in one scored match (the engine's raw stat line). */
export interface CricketLine { contestId: string; playerId: string; teamId: string | null; raw: Record<string, number> }

export interface CricketPlayer {
  id: string;
  name: string;
  team: string;
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  notOuts: number;
  /** null when no innings was scored ball by ball */
  highest: { runs: number; notOut: boolean } | null;
  fifties: number;
  hundreds: number;
  fours: number;
  sixes: number;
  average: number | null;
  strikeRate: number | null;
  wickets: number;
  /** balls bowled and runs conceded: ball-by-ball matches only (hand entry has no runs conceded) */
  bowlBalls: number;
  bowlRuns: number;
  maidens: number;
  best: { wickets: number; runs: number } | null;
  economy: number | null;
  bowlAverage: number | null;
  threeFors: number;
  fiveFors: number;
  catches: number;
  /** players of the match, as entered by hand */
  mom: number;
}

const r2 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

export function cricketPlayers(
  lines: CricketLine[], who: (playerId: string, teamId: string | null) => { name: string; team: string }, hand: TournamentCricketStatRow[] = [],
): CricketPlayer[] {
  const out = new Map<string, CricketPlayer & { dismissals: number }>();
  const get = (id: string, name: string, team: string) => {
    let p = out.get(id);
    if (!p) {
      p = { id, name, team, matches: 0, innings: 0, runs: 0, balls: 0, notOuts: 0, dismissals: 0, highest: null, fifties: 0, hundreds: 0, fours: 0, sixes: 0,
        average: null, strikeRate: null, wickets: 0, bowlBalls: 0, bowlRuns: 0, maidens: 0, best: null, economy: null, bowlAverage: null, threeFors: 0, fiveFors: 0, catches: 0, mom: 0 };
      out.set(id, p);
    }
    return p;
  };
  for (const l of lines) {
    const w = who(l.playerId, l.teamId);
    const p = get(l.playerId, w.name, w.team);
    const n = (k: string) => l.raw[k] ?? 0;
    p.matches += 1;
    if (n("batInnings")) {
      p.innings += n("batInnings"); p.runs += n("batRuns"); p.balls += n("batBalls"); p.fours += n("fours"); p.sixes += n("sixes");
      p.notOuts += n("notOuts"); p.dismissals += n("dismissals");
      const runs = n("batRuns"), notOut = n("notOuts") > 0 && !n("dismissals");
      if (!p.highest || runs > p.highest.runs || (runs === p.highest.runs && notOut && !p.highest.notOut)) p.highest = { runs, notOut };
      if (runs >= 100) p.hundreds += 1; else if (runs >= 50) p.fifties += 1;
    }
    if (n("bowlBalls")) {
      const wk = n("wickets"), rc = n("bowlRuns");
      p.bowlBalls += n("bowlBalls"); p.bowlRuns += rc; p.maidens += n("maidens");
      if (!p.best || wk > p.best.wickets || (wk === p.best.wickets && rc < p.best.runs)) p.best = { wickets: wk, runs: rc };
      if (wk >= 5) p.fiveFors += 1; else if (wk >= 3) p.threeFors += 1;
    }
    p.wickets += n("wickets"); p.catches += n("catches");
  }
  // totals entered by hand, for matches not scored ball by ball
  for (const h of hand) {
    const p = get(h.team_player_id, h.player_name, h.team_name);
    p.runs += h.runs; p.balls += h.balls_faced; p.fours += h.fours; p.sixes += h.sixes; p.wickets += h.wickets; p.catches += h.catches; p.mom += h.mom_count;
  }
  return [...out.values()].map(({ dismissals, ...p }) => ({
    ...p,
    // an average needs a dismissal; a player never out has none
    average: dismissals ? r2(p.runs / dismissals) : null,
    strikeRate: p.balls ? r2((p.runs * 100) / p.balls) : null,
    economy: p.bowlBalls ? r2((p.bowlRuns * 6) / p.bowlBalls) : null,
    bowlAverage: p.bowlBalls && p.wickets ? r2(p.bowlRuns / p.wickets) : null,
  }));
}

// ── partnerships ────────────────────────────────────────────────

export interface PartnershipRecord {
  wicket: number; runs: number; balls: number; batters: string[]; team: string; opponent: string;
  /** each batter's runs and balls in it, when the match kept them */
  shares?: { name: string; runs: number; balls: number }[];
  unbroken?: boolean;
}

/** Highest partnership for each wicket, 1st to 10th, from a list of partnerships. */
export function bestByWicket(list: PartnershipRecord[]): PartnershipRecord[] {
  const best = new Map<number, PartnershipRecord>();
  for (const p of list) { const cur = best.get(p.wicket); if (!cur || p.runs > cur.runs || (p.runs === cur.runs && p.balls < cur.balls)) best.set(p.wicket, p); }
  return [...best.values()].sort((a, b) => a.wicket - b.wicket);
}

// ── teams ───────────────────────────────────────────────────────

export interface TeamInnings { teamId: string; team: string; opponentId: string; opponent: string; runs: number; wickets: number; balls: number; chasing: boolean; won: boolean; matchId: string }

export interface CricketTeamStats {
  teamId: string;
  team: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  runs: number;
  balls: number;
  highest: TeamInnings | null;
  lowest: TeamInnings | null;
  average: number | null;
  bestChase: TeamInnings | null;
  /** margins this team won by */
  biggestWinRuns: number | null;
  biggestWinWickets: number | null;
}

/** Which side batted second: the scored match says; otherwise the toss, the target, or (a win by wickets) the result. */
export function chasingSide(m: TournamentMatch, wicketsPerInnings: number, facts: CricketMatchFacts = {}): "a" | "b" | null {
  const first = facts[m.id]?.first;
  if (first === "a" || first === "b") return first === "a" ? "b" : "a";
  if (m.toss_winner_team_id && m.toss_decision) {
    const tossA = m.toss_winner_team_id === m.team_a_id;
    const aFirst = tossA === (m.toss_decision === "bat");
    return aFirst ? "b" : "a";
  }
  if (m.target_runs !== null && m.score_a !== null && m.score_b !== null) {
    if (m.score_a === m.target_runs - 1 && m.score_b !== m.target_runs - 1) return "b";
    if (m.score_b === m.target_runs - 1 && m.score_a !== m.target_runs - 1) return "a";
  }
  // a chase stops as soon as the target is passed, so it ends at most 6 runs ahead (a six off the
  // last ball): a winner further ahead than that batted first
  if (m.winner_team_id && m.score_a !== null && m.score_b !== null) {
    const w = m.winner_team_id === m.team_a_id ? "a" : "b";
    if ((w === "a" ? m.score_a - m.score_b : m.score_b - m.score_a) > 6) return w === "a" ? "b" : "a";
  }
  // a winner that finished in fewer overs than the loser batted, not all out, can only have been chasing
  if (m.winner_team_id && m.score_a !== null && m.score_b !== null && m.overs_a !== null && m.overs_b !== null) {
    const w = m.winner_team_id === m.team_a_id ? "a" : "b";
    const wk = w === "a" ? m.wickets_a : m.wickets_b;
    const mine = w === "a" ? m.overs_a : m.overs_b, theirs = w === "a" ? m.overs_b : m.overs_a;
    if (wk !== null && wk < wicketsPerInnings && ballsOf(mine, 6) < ballsOf(theirs, 6)) return w;
  }
  return null;
}

export function cricketTeams(
  matches: TournamentMatch[], teams: { id: string; name: string }[], scoringRules: unknown, facts: CricketMatchFacts = {},
): { teams: CricketTeamStats[]; innings: TeamInnings[] } {
  const rules = cricketRulesOf(scoringRules);
  const bpo = rules.ballsPerOver || 6;
  const name = (id: string | null) => teams.find((t) => t.id === id)?.name ?? "TBD";
  const stats = new Map(teams.map((t) => [t.id, {
    teamId: t.id, team: t.name, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, runs: 0, balls: 0,
    highest: null, lowest: null, average: null, bestChase: null, biggestWinRuns: null, biggestWinWickets: null,
  } as CricketTeamStats]));
  const innings: TeamInnings[] = [];
  for (const m of matches) {
    if (!m.team_a_id || !m.team_b_id) continue;
    // the same reading of a result as the points table (walkovers have no innings to record)
    const out = m.status === "walkover" ? null : cricketOutcome(m, facts);
    if (out === null) continue;
    const A = stats.get(m.team_a_id), B = stats.get(m.team_b_id);
    for (const s of [A, B]) if (s) s.played += 1;
    if (out === "nr") { for (const s of [A, B]) if (s) s.noResult += 1; continue; }
    if (out === "tie") { for (const s of [A, B]) if (s) s.tied += 1; }
    else for (const [s, side] of [[A, "a"], [B, "b"]] as const) if (s) { if (out === side) s.won += 1; else s.lost += 1; }
    if (m.score_a === null || m.score_b === null) continue;

    const chase = chasingSide(m, rules.wicketsPerInnings, facts);
    // won on a super over: the match itself was level, so it is no chase won and has no margin
    const superOverWin = !!m.winner_team_id && m.score_a === m.score_b;
    for (const side of ["a", "b"] as const) {
      const id = side === "a" ? m.team_a_id : m.team_b_id, opp = side === "a" ? m.team_b_id : m.team_a_id;
      const inn: TeamInnings = {
        teamId: id, team: name(id), opponentId: opp, opponent: name(opp), matchId: m.id,
        runs: (side === "a" ? m.score_a : m.score_b)!, wickets: (side === "a" ? m.wickets_a : m.wickets_b) ?? 0,
        balls: ballsOf(side === "a" ? m.overs_a : m.overs_b, bpo), chasing: chase === side, won: m.winner_team_id === id && !superOverWin,
      };
      innings.push(inn);
      const s = stats.get(id);
      if (!s) continue;
      s.runs += inn.runs; s.balls += inn.balls;
      if (!s.highest || inn.runs > s.highest.runs) s.highest = inn;
      // a successful chase stops early, so it is never a team's "lowest" total
      if (!(inn.chasing && inn.won) && (!s.lowest || inn.runs < s.lowest.runs)) s.lowest = inn;
      if (inn.chasing && inn.won && (!s.bestChase || inn.runs > s.bestChase.runs)) s.bestChase = inn;
    }
    // margins: by runs when the side batting first won, by wickets when the chase did
    if (m.winner_team_id && chase && !superOverWin) {
      const winnerSide = m.winner_team_id === m.team_a_id ? "a" : "b";
      const s = stats.get(m.winner_team_id);
      if (s && winnerSide === chase) {
        const left = rules.wicketsPerInnings - ((winnerSide === "a" ? m.wickets_a : m.wickets_b) ?? 0);
        if (s.biggestWinWickets === null || left > s.biggestWinWickets) s.biggestWinWickets = left;
      } else if (s) {
        const by = Math.abs(m.score_a - m.score_b);
        if (s.biggestWinRuns === null || by > s.biggestWinRuns) s.biggestWinRuns = by;
      }
    }
  }
  for (const s of stats.values()) {
    const n = innings.filter((i) => i.teamId === s.teamId).length;
    s.average = n ? r2(s.runs / n) : null;
  }
  return { teams: [...stats.values()], innings };
}

/** "142/4 (17.3)" */
export const inningsText = (i: TeamInnings, bpo = 6) => `${i.runs}/${i.wickets}${i.balls ? ` (${oversOf(i.balls, bpo)})` : ""}`;
