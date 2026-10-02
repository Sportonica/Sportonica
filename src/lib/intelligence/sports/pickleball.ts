// Pickleball: rallies -> points -> games -> sets -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md (defaults are USA
// Pickleball traditional side-out scoring). Side outs, game wins and set
// wins are computed here, never recorded, so none can be entered wrongly.

import { askMatch } from "../core/ask";
import { PICKLEBALL_KNOWLEDGE } from "../knowledge/pickleball";
import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type Issue, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable,
} from "../core/types";
import { add, isPosInt, mergeRules, pct, playerName, playersOf, round, sideName, sideOfPlayer, str } from "../core/util";
import {
  RALLY_DERIVED_COLUMNS, gameWonBy, momentum, progressionCharts, rallyDerived, rallyRaw, streaks,
  type GameScore, type Rally,
} from "./rally";

export interface PickleballRules {
  format: "singles" | "doubles";
  scoring: "side_out" | "rally";
  pointsToWin: number;
  winBy: number;
  pointCap: number | null;
  bestOfGames: number;
  bestOfSets: number;
  nextGameServe: "alternate" | "winner" | "loser";
}

const DEFAULTS: PickleballRules = {
  format: "doubles", scoring: "side_out", pointsToWin: 11, winBy: 2, pointCap: null,
  bestOfGames: 3, bestOfSets: 1, nextGameServe: "alternate",
};

const HOWS = ["ace", "winner", "unforced_error", "service_fault", "other"] as const;
const HOW_COUNTER: Record<string, string> = { ace: "aces", winner: "winners", unforced_error: "unforcedErrors", service_fault: "serviceFaults" };
const BY_LOSER = new Set(["unforced_error", "service_fault"]);

interface PbSet { games: GameScore[]; gamesWon: Record<Side, number>; winner: Side | null }

export interface PickleballState {
  sets: PbSet[];
  setsWon: Record<Side, number>;
  serving: Side | null;
  /** doubles side-out only: first or second server of the serving side */
  serverNumber: 1 | 2;
  /** who served first in the current game, to work out the next game's server */
  gameFirstServer: Side | null;
  rallies: Rally[];
  decided: Side | null;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  log: { seq: number; text: string }[];
}

const curSet = (s: PickleballState): PbSet => s.sets[s.sets.length - 1];
const curGame = (s: PickleballState): GameScore => { const st = curSet(s); return st.games[st.games.length - 1]; };
const gameIndex = (s: PickleballState): number => s.sets.reduce((n, st) => n + st.games.length, 0) - 1;
const allGames = (s: PickleballState): GameScore[] => s.sets.flatMap((st) => st.games);

// Each game opens with the serving side on its second server (one server only).
function openGame(s: PickleballState, rules: PickleballRules, first: Side): void {
  s.serving = first;
  s.gameFirstServer = first;
  s.serverNumber = rules.format === "doubles" && rules.scoring === "side_out" ? 2 : 1;
}

const TEAM_RAW_COLUMNS: StatColumn[] = [
  { key: "points", label: "Points won", kind: "raw" },
  { key: "pointsAgainst", label: "Points lost", kind: "raw" },
  { key: "gamesWon", label: "Games won", kind: "raw" },
  { key: "gamesLost", label: "Games lost", kind: "raw" },
  { key: "setsWon", label: "Sets won", kind: "raw" },
  { key: "setsLost", label: "Sets lost", kind: "raw" },
  { key: "served", label: "Service rallies", kind: "raw" },
  { key: "serveWon", label: "Service rallies won", kind: "raw" },
  { key: "received", label: "Return rallies", kind: "raw" },
  { key: "returnWon", label: "Return rallies won", kind: "raw" },
  { key: "aces", label: "Aces", kind: "raw" },
  { key: "serviceFaults", label: "Service faults", kind: "raw" },
  { key: "winners", label: "Winners", kind: "raw" },
  { key: "unforcedErrors", label: "Unforced errors", kind: "raw" },
  { key: "longestStreak", label: "Longest streak", kind: "raw" },
];

const DERIVED_COLUMNS: StatColumn[] = [
  ...RALLY_DERIVED_COLUMNS.filter((c) => c.key !== "avgRally"),
  { key: "gameWinPct", label: "Games won %", kind: "derived", format: "pct" },
  { key: "setWinPct", label: "Sets won %", kind: "derived", format: "pct" },
];

function teamRaw(s: PickleballState, side: Side): Record<string, number> {
  const o = otherSide(side);
  const games = allGames(s).filter((g) => g.winner);
  return {
    ...rallyRaw(s.rallies, side), ...s.team[side],
    gamesWon: games.filter((g) => g.winner === side).length, gamesLost: games.filter((g) => g.winner === o).length,
    setsWon: s.setsWon[side], setsLost: s.setsWon[o],
  };
}

function derive(raw: Record<string, number>): Record<string, number | string | null> {
  const d = rallyDerived(raw);
  return {
    pointWinPct: d.pointWinPct, servePointPct: d.servePointPct, returnPointPct: d.returnPointPct,
    gameWinPct: round(pct(raw.gamesWon, (raw.gamesWon ?? 0) + (raw.gamesLost ?? 0)), 1),
    setWinPct: round(pct(raw.setsWon, (raw.setsWon ?? 0) + (raw.setsLost ?? 0)), 1),
  };
}

/** The score as it is called: server's score, receiver's score, and in doubles side-out the server number. */
export function pickleballCall(s: PickleballState, rules: PickleballRules): string {
  if (!s.serving) return "0-0";
  const g = curGame(s);
  const base = `${g[s.serving]}-${g[otherSide(s.serving)]}`;
  return rules.format === "doubles" && rules.scoring === "side_out" ? `${base}-${s.serverNumber}` : base;
}

export const pickleballEngine: SportIntelligenceEngine<PickleballRules, PickleballState> = {
  sport: "pickleball",
  label: "Pickleball",
  eventTypes: ["FIRST_SERVE", "RALLY_WON"],

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, PICKLEBALL_KNOWLEDGE); },
  rulesGuide: (rules) => PICKLEBALL_KNOWLEDGE.guide(rules),
  insights: (s, ctx, rules) => PICKLEBALL_KNOWLEDGE.insights!(s, ctx, rules),

  resolveRules(input) {
    const r = mergeRules(DEFAULTS, input);
    if (r.format !== "singles" && r.format !== "doubles") throw new RulesError("format must be singles or doubles");
    if (r.scoring !== "side_out" && r.scoring !== "rally") throw new RulesError("scoring must be side_out or rally");
    if (!isPosInt(r.pointsToWin)) throw new RulesError("pointsToWin must be a positive whole number");
    if (!isPosInt(r.winBy)) throw new RulesError("winBy must be at least 1");
    if (r.pointCap !== null && (!isPosInt(r.pointCap) || r.pointCap < r.pointsToWin)) throw new RulesError("pointCap must be empty or at least pointsToWin");
    if (!isPosInt(r.bestOfGames) || r.bestOfGames % 2 === 0) throw new RulesError("bestOfGames must be an odd number");
    if (!isPosInt(r.bestOfSets) || r.bestOfSets % 2 === 0) throw new RulesError("bestOfSets must be an odd number");
    if (!["alternate", "winner", "loser"].includes(r.nextGameServe)) throw new RulesError("nextGameServe must be alternate, winner or loser");
    return r;
  },

  initializeMatch() {
    return {
      sets: [{ games: [{ a: 0, b: 0, winner: null }], gamesWon: { a: 0, b: 0 }, winner: null }],
      setsWon: { a: 0, b: 0 }, serving: null, serverNumber: 1, gameFirstServer: null,
      rallies: [], decided: null, team: { a: {}, b: {} }, players: {}, log: [],
    };
  },

  validateEvent(s, ev, ctx) {
    const p = ev.payload;
    if (s.decided) return "The match is already decided";
    if (ev.type === "FIRST_SERVE") {
      if (s.rallies.length > 0) return "The first server can only be set before the first rally";
      if (!isSide(p.side)) return "Say which side serves first";
      return null;
    }
    if (!s.serving) return "Set who serves first before scoring";
    if (!isSide(p.winner)) return "Say which side won the rally";
    const how = p.how == null ? "other" : p.how;
    if (typeof how !== "string" || !(HOWS as readonly string[]).includes(how)) return "Unknown way of winning the rally";
    if (how === "ace" && p.winner !== s.serving) return "Only the serving side can serve an ace";
    if (how === "service_fault" && p.winner === s.serving) return "A service fault loses the rally for the server";
    if (p.player != null) {
      if (typeof p.player !== "string") return "player must be a player id";
      const ps = sideOfPlayer(ctx, p.player);
      if (!ps) return "That player is not in this match";
      if (BY_LOSER.has(how) ? ps === p.winner : how !== "other" && ps !== p.winner) return "That player is on the wrong side for this outcome";
    }
    if (p.shots != null && !isPosInt(p.shots)) return "Rally length must be a positive whole number";
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") { openGame(s, rules, p.side as Side); return s; }

    const winner = p.winner as Side;
    const serving = s.serving!;
    const how = (p.how as string | undefined) ?? "other";
    const st = curSet(s);
    const g = curGame(s);

    const counter = HOW_COUNTER[how];
    if (counter) {
      add(s.team[BY_LOSER.has(how) ? otherSide(winner) : winner], counter);
      const who = str(p.player);
      if (who) add((s.players[who] ??= {}), counter);
    }

    let scored: Side | null = null;
    if (rules.scoring === "rally") {
      g[winner] += 1; scored = winner;
      if (winner !== serving) s.serving = winner;
    } else if (winner === serving) {
      g[winner] += 1; scored = winner;
    } else if (rules.format === "doubles" && s.serverNumber === 1) {
      s.serverNumber = 2;
      s.log.push({ seq: ev.seq, text: `Second server for ${sideName(ctx, serving)}` });
    } else {
      s.serving = winner; s.serverNumber = 1;
      s.log.push({ seq: ev.seq, text: `Side out: ${sideName(ctx, winner)} to serve` });
    }

    s.rallies.push({ seq: ev.seq, w: winner, srv: serving, pt: scored, g: gameIndex(s), a: g.a, b: g.b, ...(isPosInt(p.shots) ? { shots: p.shots } : {}), how });

    const won = gameWonBy(g, rules.pointsToWin, rules.winBy, rules.pointCap);
    if (!won) return s;

    g.winner = won;
    st.gamesWon[won] += 1;
    s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won the game ${g[won]}-${g[otherSide(won)]}` });
    const first = s.gameFirstServer ?? serving;
    const next = rules.nextGameServe === "winner" ? won : rules.nextGameServe === "loser" ? otherSide(won) : otherSide(first);

    if (st.gamesWon[won] > rules.bestOfGames / 2) {
      st.winner = won;
      s.setsWon[won] += 1;
      if (rules.bestOfSets > 1) s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won set ${s.sets.length}` });
      if (s.setsWon[won] > rules.bestOfSets / 2) {
        s.decided = won;
        s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won the match` });
        return s;
      }
      s.sets.push({ games: [{ a: 0, b: 0, winner: null }], gamesWon: { a: 0, b: 0 }, winner: null });
    } else {
      st.games.push({ a: 0, b: 0, winner: null });
    }
    openGame(s, rules, next);
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    allGames(s).forEach((g, i) => {
      if (g.winner !== gameWonBy(g, rules.pointsToWin, rules.winBy, rules.pointCap)) {
        issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Game ${i + 1} is ${g.a}-${g.b}, which does not match its recorded winner` });
      }
    });
    const needSets = Math.ceil(rules.bestOfSets / 2), needGames = Math.ceil(rules.bestOfGames / 2);
    if (s.setsWon.a > needSets || s.setsWon.b > needSets) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "A side has won more sets than the format allows" });
    for (const st of s.sets) if (st.gamesWon.a > needGames || st.gamesWon.b > needGames) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "A side has won more games in a set than the format allows" });
    return issues;
  },

  getCurrentState(s, ctx, rules) {
    const st = curSet(s), g = curGame(s);
    const multiSet = rules.bestOfSets > 1;
    const total = (side: Side) => (multiSet ? s.setsWon[side] : st.gamesWon[side]);
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(total("a")), b: String(total("b")) },
      subScore: s.decided ? null : { a: String(g.a), b: String(g.b) },
      periodLabel: s.decided ? "Final" : multiSet ? `Set ${s.sets.length}, Game ${st.games.length}` : `Game ${st.games.length}`,
      brief: s.decided ? allGames(s).map((x) => `${x.a}-${x.b}`).join(", ") : `${g.a} : ${g.b}`,
      serving: s.decided ? null : s.serving,
      periods: s.sets.flatMap((x, si) => x.games.map((gm, gi) => ({ label: multiSet ? `S${si + 1} G${gi + 1}` : `G${gi + 1}`, a: String(gm.a), b: String(gm.b) }))),
      notes: [],
    };
    if (!s.decided && s.serving) view.notes.push(`Score call: ${pickleballCall(s, rules)} (${sideName(ctx, s.serving)} serving)`);
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const st = curSet(s), g = curGame(s);
    if (s.decided) return [`${sideName(ctx, s.decided)} won`, allGames(s).map((x) => `${x.a}-${x.b}`).join(", ")];
    const lines = [
      g.a === g.b ? `Level at ${g.a}-${g.b}` : `${sideName(ctx, g.a > g.b ? "a" : "b")} leads ${Math.max(g.a, g.b)}-${Math.min(g.a, g.b)}`,
      `Game ${st.games.length}, Set ${s.sets.length}`,
    ];
    if (g.a >= rules.pointsToWin - 1 && g.b >= rules.pointsToWin - 1) lines.push(`Win by ${rules.winBy}: the game continues until a side leads by ${rules.winBy}`);
    if (st.gamesWon.a === st.gamesWon.b && st.gamesWon.a === Math.floor(rules.bestOfGames / 2) && rules.bestOfGames > 1) lines.push("Deciding game");
    return lines;
  },

  calculatePlayerStatistics(s, ctx) {
    const columns: StatColumn[] = [
      { key: "aces", label: "Aces", kind: "raw" }, { key: "serviceFaults", label: "Service faults", kind: "raw" },
      { key: "winners", label: "Winners", kind: "raw" }, { key: "unforcedErrors", label: "Unforced errors", kind: "raw" },
    ];
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => ({
      id: pl.id, name: pl.name, side, values: Object.fromEntries(columns.map((c) => [c.key, s.players[pl.id]?.[c.key] ?? 0])),
    })));
    return [{ key: "players", title: "Players", columns, rows }];
  },

  calculateTeamStatistics(s, ctx) {
    const rows = SIDES.map((side) => {
      const raw = teamRaw(s, side);
      return { id: side, name: sideName(ctx, side), side, values: { ...Object.fromEntries(TEAM_RAW_COLUMNS.map((c) => [c.key, raw[c.key] ?? 0])), ...derive(raw) } };
    });
    return [{ key: "sides", title: "Match statistics", columns: [...TEAM_RAW_COLUMNS, ...DERIVED_COLUMNS], rows }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      for (const side of SIDES) {
        const base = { ...teamRaw(s, side), matches: 1, wins: s.decided === side ? 1 : 0 };
        lines.push({ subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null, raw: base });
        for (const pl of ctx.sides[side].players) {
          lines.push({ subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null, raw: { ...base, ...(s.players[pl.id] ?? {}) } });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const st = streaks(s.rallies), mo = momentum(s.rallies);
    const games = allGames(s);
    const serveTable: StatTable = {
      key: "serve-return", title: "Serve and return",
      columns: [
        { key: "served", label: "Served", kind: "raw" }, { key: "servePointPct", label: "Won on serve %", kind: "derived", format: "pct" },
        { key: "received", label: "Received", kind: "raw" }, { key: "returnPointPct", label: "Won on return %", kind: "derived", format: "pct" },
      ],
      rows: SIDES.map((side) => { const raw = teamRaw(s, side); return { id: side, name: names[side], side, values: { served: raw.served, received: raw.received, ...derive(raw) } }; }),
    };
    return {
      cards: [
        { label: "Longest streak", value: `${names.a} ${st.longest.a}, ${names.b} ${st.longest.b}` },
        { label: "Current run", value: st.current.side ? `${names[st.current.side]} ${st.current.length}` : "n/a" },
        { label: "Momentum", value: mo ? `${names.a} ${mo.a}%, ${names.b} ${mo.b}%` : "n/a", hint: "Share of the last 10 rallies" },
      ],
      charts: [
        { key: "games", title: "Points by game", type: "bar", labels: games.map((_, i) => `Game ${i + 1}`), series: SIDES.map((side) => ({ name: names[side], side, values: games.map((g) => g[side]) })), format: "int" },
        ...progressionCharts(s.rallies.filter((r) => r.pt), names, "Game"),
      ],
      tables: [serveTable],
    } satisfies Analytics;
  },

  validateMatchCompletion(s) {
    return s.decided ? null : "The match is not decided yet";
  },

  finalizeMatch(s): MatchResult {
    const w = s.decided!;
    return { outcome: "win", winner: w, method: "played", margin: allGames(s).map((g) => `${g.a}-${g.b}`).join(", ") };
  },

  mirrorScore(s, _ctx, rules) {
    if (rules.bestOfSets > 1) return { scoreA: s.setsWon.a, scoreB: s.setsWon.b };
    const games = allGames(s).filter((g) => g.winner);
    return { scoreA: games.filter((g) => g.winner === "a").length, scoreB: games.filter((g) => g.winner === "b").length };
  },

  deriveStats(_subject, raw) {
    return {
      columns: [...TEAM_RAW_COLUMNS, { key: "matches", label: "Matches", kind: "raw" }, { key: "wins", label: "Wins", kind: "raw" }, { key: "winPct", label: "Win %", kind: "derived", format: "pct" }, ...DERIVED_COLUMNS],
      values: { ...raw, ...derive(raw), winPct: round(pct(raw.wins, raw.matches), 1) },
    };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, ctx) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") return `${isSide(p.side) ? sideName(ctx, p.side) : ""} to serve first`;
    const how = typeof p.how === "string" && p.how !== "other" ? ` (${p.how.replace(/_/g, " ")}${str(p.player) ? `, ${playerName(ctx, str(p.player))}` : ""})` : "";
    return `Rally to ${isSide(p.winner) ? sideName(ctx, p.winner) : ""}${how}`;
  },
};
