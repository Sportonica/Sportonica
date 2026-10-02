// Badminton: rallies -> points -> games -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md (defaults are BWF).

import { askMatch } from "../core/ask";
import { BADMINTON_KNOWLEDGE } from "../knowledge/badminton";
import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type Issue, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable,
} from "../core/types";
import { add, isPosInt, mergeRules, pct, playerName, playersOf, round, sideName, sideOfPlayer, str } from "../core/util";
import {
  RALLY_DERIVED_COLUMNS, gameWonBy, momentum, progressionCharts, rallyDerived, rallyRaw, scoringRuns, streaks,
  type GameScore, type Rally,
} from "./rally";

export interface BadmintonRules {
  format: "singles" | "doubles";
  bestOf: number;
  pointsToWin: number;
  winBy: number;
  pointCap: number | null;
}

const DEFAULTS: BadmintonRules = { format: "singles", bestOf: 3, pointsToWin: 21, winBy: 2, pointCap: 30 };

type Court = "right" | "left";
const HOWS = ["ace", "service_error", "winner", "smash_winner", "net_winner", "unforced_error", "defensive", "other"] as const;
// how -> whose shot it was: the rally winner's, or the loser's mistake
const BY_WINNER = new Set(["ace", "winner", "smash_winner", "net_winner", "defensive"]);
const BY_LOSER = new Set(["service_error", "unforced_error"]);
const HOW_COUNTER: Record<string, string> = {
  ace: "aces", service_error: "serviceErrors", winner: "winners", smash_winner: "smashWinners",
  net_winner: "netWinners", unforced_error: "unforcedErrors", defensive: "defensivePoints",
};

export interface BadmintonState {
  games: GameScore[];
  gamesWon: Record<Side, number>;
  serving: Side | null;
  courts: Record<Side, Record<Court, string | null>>;
  server: string | null;
  receiver: string | null;
  rallies: Rally[];
  decided: Side | null;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  log: { seq: number; text: string }[];
}

const current = (s: BadmintonState): GameScore => s.games[s.games.length - 1];
const courtFor = (score: number): Court => (score % 2 === 0 ? "right" : "left");

// Put `playerId` in the right court of its side (the court served from at 0).
function placeRight(s: BadmintonState, side: Side, playerId: string): void {
  const c = s.courts[side];
  if (c.right === playerId) return;
  if (c.left === playerId) { c.left = c.right; c.right = playerId; }
}

function refreshServer(s: BadmintonState): void {
  if (!s.serving) { s.server = null; s.receiver = null; return; }
  const court = courtFor(current(s)[s.serving]);
  s.server = s.courts[s.serving][court] ?? s.courts[s.serving].right;
  const rec = s.courts[otherSide(s.serving)];
  s.receiver = rec[court] ?? rec.right;
}

const TEAM_RAW_COLUMNS: StatColumn[] = [
  { key: "points", label: "Points won", kind: "raw" },
  { key: "pointsAgainst", label: "Points lost", kind: "raw" },
  { key: "gamesWon", label: "Games won", kind: "raw" },
  { key: "serves", label: "Serves", kind: "raw" },
  { key: "aces", label: "Aces", kind: "raw" },
  { key: "serviceErrors", label: "Service errors", kind: "raw" },
  { key: "winners", label: "Winners", kind: "raw" },
  { key: "smashWinners", label: "Smash winners", kind: "raw" },
  { key: "netWinners", label: "Net winners", kind: "raw" },
  { key: "unforcedErrors", label: "Unforced errors", kind: "raw" },
  { key: "defensivePoints", label: "Defensive points", kind: "raw" },
  { key: "longestStreak", label: "Longest streak", kind: "raw" },
  { key: "longestRally", label: "Longest rally", kind: "raw" },
];

function teamRaw(s: BadmintonState, side: Side): Record<string, number> {
  const games = s.games.filter((g) => g.winner).length;
  return { ...rallyRaw(s.rallies, side), ...s.team[side], gamesWon: s.gamesWon[side], gamesPlayed: games };
}

function derive(raw: Record<string, number>): Record<string, number | string | null> {
  return {
    ...rallyDerived(raw),
    gameWinPct: round(pct(raw.gamesWon, raw.gamesPlayed), 1),
    // a rally length of 0 means "never recorded", not "no rally"
    longestRally: raw.ralliesWithLength ? raw.longestRally : null,
  };
}

const DERIVED_COLUMNS: StatColumn[] = [
  ...RALLY_DERIVED_COLUMNS,
  { key: "gameWinPct", label: "Games won %", kind: "derived", format: "pct" },
];

export const badmintonEngine: SportIntelligenceEngine<BadmintonRules, BadmintonState> = {
  sport: "badminton",
  label: "Badminton",
  eventTypes: ["FIRST_SERVE", "GAME_SERVE", "RALLY_WON"],

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, BADMINTON_KNOWLEDGE); },
  rulesGuide: (rules) => BADMINTON_KNOWLEDGE.guide(rules),
  insights: (s, ctx, rules) => BADMINTON_KNOWLEDGE.insights!(s, ctx, rules),

  resolveRules(input) {
    const r = mergeRules(DEFAULTS, input);
    if (r.format !== "singles" && r.format !== "doubles") throw new RulesError("format must be singles or doubles");
    if (!isPosInt(r.bestOf) || r.bestOf % 2 === 0) throw new RulesError("bestOf must be an odd number of games");
    if (!isPosInt(r.pointsToWin)) throw new RulesError("pointsToWin must be a positive whole number");
    if (!isPosInt(r.winBy)) throw new RulesError("winBy must be at least 1");
    if (r.pointCap !== null && (!isPosInt(r.pointCap) || r.pointCap < r.pointsToWin)) {
      throw new RulesError("pointCap must be empty or at least pointsToWin");
    }
    return r;
  },

  initializeMatch(ctx) {
    const court = (side: Side) => {
      const p = playersOf(ctx, side);
      return { right: p[0]?.id ?? null, left: p[1]?.id ?? null };
    };
    return {
      games: [{ a: 0, b: 0, winner: null }], gamesWon: { a: 0, b: 0 }, serving: null,
      courts: { a: court("a"), b: court("b") }, server: null, receiver: null,
      rallies: [], decided: null, team: { a: {}, b: {} }, players: {}, log: [],
    };
  },

  validateEvent(s, ev, ctx) {
    const p = ev.payload;
    const g = current(s);
    if (ev.type === "FIRST_SERVE" || ev.type === "GAME_SERVE") {
      if (s.decided) return "The match is already decided";
      if (g.a !== 0 || g.b !== 0) return "The server can only be set before the first rally of a game";
      if (ev.type === "FIRST_SERVE") {
        if (s.games.length > 1) return "The winner of the previous game serves first";
        if (!isSide(p.side)) return "Say which side serves first";
      } else if (!s.serving) return "Set the first server of the match first";
      const srvSide = ev.type === "FIRST_SERVE" ? (p.side as Side) : s.serving!;
      if (p.server != null && (typeof p.server !== "string" || sideOfPlayer(ctx, p.server) !== srvSide)) return "The server must be a player of the serving side";
      if (p.receiver != null && (typeof p.receiver !== "string" || sideOfPlayer(ctx, p.receiver) !== otherSide(srvSide))) return "The receiver must be a player of the receiving side";
      return null;
    }
    // RALLY_WON
    if (s.decided) return "The match is already decided";
    if (!s.serving) return "Set who serves first before scoring";
    if (!isSide(p.winner)) return "Say which side won the rally";
    const how = p.how == null ? "other" : p.how;
    if (typeof how !== "string" || !(HOWS as readonly string[]).includes(how)) return "Unknown way of winning the rally";
    if (how === "ace" && p.winner !== s.serving) return "Only the serving side can serve an ace";
    if (how === "service_error" && p.winner === s.serving) return "A service error gives the point to the receiver";
    if (p.player != null) {
      if (typeof p.player !== "string") return "player must be a player id";
      const ps = sideOfPlayer(ctx, p.player);
      if (!ps) return "That player is not in this match";
      if (BY_WINNER.has(how) && ps !== p.winner) return "That shot belongs to the side that won the rally";
      if (BY_LOSER.has(how) && ps === p.winner) return "That error belongs to the side that lost the rally";
    }
    if (p.shots != null && !isPosInt(p.shots)) return "Rally length must be a positive whole number";
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE" || ev.type === "GAME_SERVE") {
      if (ev.type === "FIRST_SERVE") s.serving = p.side as Side;
      const side = s.serving!;
      if (typeof p.server === "string") placeRight(s, side, p.server);
      if (typeof p.receiver === "string") placeRight(s, otherSide(side), p.receiver);
      refreshServer(s);
      return s;
    }

    const winner = p.winner as Side;
    const loser = otherSide(winner);
    const serving = s.serving!;
    const how = (p.how as string | undefined) ?? "other";
    const g = current(s);
    const server = s.server;

    // every rally starts with a serve
    add(s.team[serving], "serves");
    if (server) add((s.players[server] ??= {}), "serves");

    const counter = HOW_COUNTER[how];
    if (counter) {
      const creditSide = BY_LOSER.has(how) ? loser : winner;
      add(s.team[creditSide], counter);
      // an ace or a service error is the server's even if no player was named
      const who = str(p.player) ?? (how === "ace" || how === "service_error" ? server : null);
      if (who) add((s.players[who] ??= {}), counter);
    }

    g[winner] += 1;
    s.rallies.push({
      seq: ev.seq, w: winner, srv: serving, pt: winner, g: s.games.length - 1, a: g.a, b: g.b,
      ...(isPosInt(p.shots) ? { shots: p.shots } : {}), how,
    });

    // Doubles: the serving side swaps courts only when it wins the point.
    if (winner === serving) {
      const c = s.courts[serving];
      if (c.left !== null) { const t = c.right; c.right = c.left; c.left = t; }
    } else {
      s.serving = winner;
    }

    const won = gameWonBy(g, rules.pointsToWin, rules.winBy, rules.pointCap);
    if (won) {
      g.winner = won;
      s.gamesWon[won] += 1;
      s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won game ${s.games.length} ${g[won]}-${g[otherSide(won)]}` });
      if (s.gamesWon[won] > rules.bestOf / 2) {
        s.decided = won;
        s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won the match ${s.gamesWon[won]}-${s.gamesWon[otherSide(won)]}` });
      } else {
        s.games.push({ a: 0, b: 0, winner: null });
        s.serving = won; // the winner of a game serves first in the next
      }
    }
    refreshServer(s);
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    s.games.forEach((g, i) => {
      const last = i === s.games.length - 1;
      const won = gameWonBy(g, rules.pointsToWin, rules.winBy, rules.pointCap);
      if (g.winner !== won) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Game ${i + 1} is ${g.a}-${g.b}, which does not match its recorded winner` });
      if (!last && !g.winner) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Game ${i + 1} was left unfinished` });
      const cap = rules.pointCap ?? Infinity;
      if (g.a > cap || g.b > cap) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Game ${i + 1} goes past the ${cap} point cap` });
    });
    const need = Math.ceil(rules.bestOf / 2);
    if (s.gamesWon.a > need || s.gamesWon.b > need) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "A side has won more games than the format allows" });
    return issues;
  },

  getCurrentState(s, ctx) {
    const g = current(s);
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.gamesWon.a), b: String(s.gamesWon.b) },
      subScore: s.decided ? null : { a: String(g.a), b: String(g.b) },
      periodLabel: s.decided ? "Final" : `Game ${s.games.length}`,
      brief: s.decided ? s.games.map((x) => `${x.a}-${x.b}`).join(", ") : `${g.a} : ${g.b}`,
      serving: s.decided ? null : s.serving,
      periods: s.games.map((x, i) => ({ label: `G${i + 1}`, a: String(x.a), b: String(x.b) })),
      notes: [],
    };
    if (!s.decided && s.server) {
      view.notes.push(`${playerName(ctx, s.server)} to serve from the ${courtFor(g[s.serving!])} court${s.receiver ? ` to ${playerName(ctx, s.receiver)}` : ""}`);
    }
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const g = current(s);
    const lines: string[] = [];
    if (s.decided) {
      lines.push(`${sideName(ctx, s.decided)} won ${s.gamesWon[s.decided]}-${s.gamesWon[otherSide(s.decided)]}`);
      lines.push(s.games.map((x) => `${x.a}-${x.b}`).join(", "));
      return lines;
    }
    const lead = g.a === g.b ? `Level at ${g.a}-${g.b}` : `${sideName(ctx, g.a > g.b ? "a" : "b")} leads ${Math.max(g.a, g.b)}-${Math.min(g.a, g.b)}`;
    lines.push(lead, `Game ${s.games.length}`);
    if (s.games.length > 1) lines.push(`Games: ${sideName(ctx, "a")} ${s.gamesWon.a}, ${sideName(ctx, "b")} ${s.gamesWon.b}`);
    const deuceAt = rules.pointsToWin - 1;
    if (g.a >= deuceAt && g.b >= deuceAt) {
      lines.push(rules.pointCap !== null && g.a === rules.pointCap - 1 && g.b === rules.pointCap - 1 ? "Next point wins the game" : `Extended game: a ${rules.winBy} point lead is needed`);
    }
    return lines;
  },

  calculatePlayerStatistics(s, ctx) {
    const columns: StatColumn[] = [
      { key: "serves", label: "Serves", kind: "raw" }, { key: "aces", label: "Aces", kind: "raw" },
      { key: "serviceErrors", label: "Service errors", kind: "raw" }, { key: "winners", label: "Winners", kind: "raw" },
      { key: "smashWinners", label: "Smash winners", kind: "raw" }, { key: "netWinners", label: "Net winners", kind: "raw" },
      { key: "unforcedErrors", label: "Unforced errors", kind: "raw" }, { key: "defensivePoints", label: "Defensive points", kind: "raw" },
    ];
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => ({
      id: pl.id, name: pl.name, side,
      values: Object.fromEntries(columns.map((c) => [c.key, s.players[pl.id]?.[c.key] ?? 0])),
    })));
    return [{ key: "players", title: "Players", columns, rows }];
  },

  calculateTeamStatistics(s, ctx) {
    const columns = [...TEAM_RAW_COLUMNS, ...DERIVED_COLUMNS];
    const rows = SIDES.map((side) => {
      const raw = teamRaw(s, side);
      return { id: side, name: sideName(ctx, side), side, values: { ...Object.fromEntries(TEAM_RAW_COLUMNS.map((c) => [c.key, raw[c.key] ?? 0])), ...derive(raw) } };
    });
    return [{ key: "sides", title: "Match statistics", columns, rows }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      for (const side of SIDES) {
        lines.push({ subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...teamRaw(s, side), matches: 1, wins: s.decided === side ? 1 : 0 } });
        for (const pl of ctx.sides[side].players) {
          lines.push({ subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            // a player's rally record is their side's: singles exactly, doubles as a pair
            raw: { ...teamRaw(s, side), ...(s.players[pl.id] ?? {}), matches: 1, wins: s.decided === side ? 1 : 0 } });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const st = streaks(s.rallies);
    const mo = momentum(s.rallies);
    const cards = [
      { label: "Longest streak", value: `${names.a} ${st.longest.a}, ${names.b} ${st.longest.b}` },
      { label: "Current run", value: st.current.side ? `${names[st.current.side]} ${st.current.length}` : "n/a" },
      { label: "Momentum", value: mo ? `${names.a} ${mo.a}%, ${names.b} ${mo.b}%` : "n/a", hint: "Share of the last 10 rallies" },
    ];
    const runs = scoringRuns(s.rallies, 4);
    const runTable: StatTable = {
      key: "runs", title: "Scoring runs (4 or more)",
      columns: [{ key: "game", label: "Game", kind: "raw" }, { key: "length", label: "Points in a row", kind: "raw" }],
      rows: runs.map((r, i) => ({ id: String(i), name: names[r.side], side: r.side, values: { game: r.g + 1, length: r.length } })),
    };
    const gameChart = {
      key: "games", title: "Points by game", type: "bar" as const,
      labels: s.games.map((_, i) => `Game ${i + 1}`),
      series: SIDES.map((side) => ({ name: names[side], side, values: s.games.map((g) => g[side]) })),
      format: "int" as const,
    };
    return { cards, charts: [gameChart, ...progressionCharts(s.rallies, names, "Game")], tables: [runTable] } satisfies Analytics;
  },

  validateMatchCompletion(s, _ctx, rules) {
    return s.decided ? null : `The match is not decided yet. A side needs ${Math.ceil(rules.bestOf / 2)} games`;
  },

  finalizeMatch(s): MatchResult {
    const w = s.decided!;
    return { outcome: "win", winner: w, method: "played", margin: `${s.gamesWon[w]}-${s.gamesWon[otherSide(w)]}: ${s.games.map((g) => `${g.a}-${g.b}`).join(", ")}` };
  },

  mirrorScore(s) {
    return { scoreA: s.gamesWon.a, scoreB: s.gamesWon.b };
  },

  deriveStats(_subject, raw) {
    return { columns: [...TEAM_RAW_COLUMNS, { key: "matches", label: "Matches", kind: "raw" }, { key: "wins", label: "Wins", kind: "raw" }, { key: "winPct", label: "Win %", kind: "derived", format: "pct" }, ...DERIVED_COLUMNS],
      values: { ...raw, ...derive(raw), winPct: round(pct(raw.wins, raw.matches), 1) } };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, ctx) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") return `${isSide(p.side) ? sideName(ctx, p.side) : ""} to serve first`;
    if (ev.type === "GAME_SERVE") return `${playerName(ctx, str(p.server))} to serve`;
    const how = typeof p.how === "string" && p.how !== "other" ? ` (${p.how.replace(/_/g, " ")}${str(p.player) ? `, ${playerName(ctx, str(p.player))}` : ""})` : "";
    return `Point ${isSide(p.winner) ? sideName(ctx, p.winner) : ""}${how}`;
  },
};
