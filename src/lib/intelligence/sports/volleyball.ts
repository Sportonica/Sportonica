// Volleyball: rallies -> points -> sets -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md (defaults are FIVB indoor).

import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type Issue, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { add, isNonNegInt, isPosInt, mergeRules, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";
import { gameWonBy, progressionCharts, rallyRaw, scoringRuns, streaks, type GameScore, type Rally } from "./rally";

export interface VolleyballRules {
  bestOf: number;
  setPoints: number;
  decidingSetPoints: number;
  winBy: number;
  pointCap: number | null;
  playersOnCourt: number;
  timeoutsPerSet: number;
  substitutionsPerSet: number;
  decidingSetToss: boolean;
}

const DEFAULTS: VolleyballRules = {
  bestOf: 5, setPoints: 25, decidingSetPoints: 15, winBy: 2, pointCap: null,
  playersOnCourt: 6, timeoutsPerSet: 2, substitutionsPerSet: 6, decidingSetToss: true,
};

const HOWS = ["ace", "kill", "block", "service_error", "attack_error", "opponent_error", "other"] as const;
const BY_WINNER = new Set(["ace", "kill", "block"]);
const BY_LOSER = new Set(["service_error", "attack_error", "opponent_error"]);
const TOUCH_KINDS = ["attack", "dig", "assist", "reception"] as const;
const RECEPTION_QUALITY = ["perfect", "good", "poor", "error"] as const;

export interface VolleyballState {
  sets: GameScore[];
  setsWon: Record<Side, number>;
  serving: Side | null;
  setFirstServer: Side | null;
  /** rotation order, position 1 (the server) first; null until a lineup is given */
  rotation: Record<Side, string[] | null>;
  timeouts: Record<Side, number>;
  subs: Record<Side, number>;
  rallies: Rally[];
  decided: Side | null;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  log: { seq: number; text: string }[];
}

const cur = (s: VolleyballState): GameScore => s.sets[s.sets.length - 1];
const isDeciding = (s: VolleyballState, rules: VolleyballRules): boolean => rules.bestOf > 1 && s.sets.length === rules.bestOf;
const target = (s: VolleyballState, rules: VolleyballRules): number => (isDeciding(s, rules) ? rules.decidingSetPoints : rules.setPoints);

function credit(s: VolleyballState, side: Side, player: string | null, key: string): void {
  add(s.team[side], key);
  if (player) add((s.players[player] ??= {}), key);
}

const RAW_COLUMNS: StatColumn[] = [
  { key: "serves", label: "Serves", kind: "raw" },
  { key: "aces", label: "Aces", kind: "raw" },
  { key: "serviceErrors", label: "Service errors", kind: "raw" },
  { key: "attacks", label: "Attacks", kind: "raw" },
  { key: "kills", label: "Kills", kind: "raw" },
  { key: "attackErrors", label: "Attack errors", kind: "raw" },
  { key: "blocks", label: "Block points", kind: "raw" },
  { key: "digs", label: "Digs", kind: "raw" },
  { key: "assists", label: "Assists", kind: "raw" },
  { key: "receptions", label: "Receptions", kind: "raw" },
  { key: "receptionPositive", label: "Positive receptions", kind: "raw" },
  { key: "receptionErrors", label: "Reception errors", kind: "raw" },
];

const DERIVED_COLUMNS: StatColumn[] = [
  { key: "attackPct", label: "Attack %", kind: "derived", format: "pct" },
  { key: "killPct", label: "Kill %", kind: "derived", format: "pct" },
  { key: "serviceEff", label: "Service efficiency %", kind: "derived", format: "pct" },
  { key: "receptionEff", label: "Reception efficiency %", kind: "derived", format: "pct" },
];

const TEAM_EXTRA_RAW: StatColumn[] = [
  { key: "points", label: "Points", kind: "raw" },
  { key: "setsWon", label: "Sets won", kind: "raw" },
  { key: "received", label: "Rallies received", kind: "raw" },
  { key: "returnWon", label: "Side-outs won", kind: "raw" },
  { key: "longestStreak", label: "Longest run", kind: "raw" },
];

const TEAM_EXTRA_DERIVED: StatColumn[] = [
  { key: "sideOutPct", label: "Side-out %", kind: "derived", format: "pct" },
  { key: "pointsPerSet", label: "Points per set", kind: "derived", format: "dec1" },
];

function derive(raw: Record<string, number>): Record<string, StatValue> {
  const n = (k: string) => raw[k] ?? 0;
  return {
    attackPct: round(pct(n("kills") - n("attackErrors"), raw.attacks), 1),
    killPct: round(pct(raw.kills, raw.attacks), 1),
    serviceEff: round(pct(n("aces") - n("serviceErrors"), raw.serves), 1),
    receptionEff: round(pct(n("receptionPositive") - n("receptionErrors"), raw.receptions), 1),
    sideOutPct: round(pct(raw.returnWon, raw.received), 1),
    pointsPerSet: round(ratio(raw.points, raw.setsPlayed), 1),
  };
}

function teamRaw(s: VolleyballState, side: Side): Record<string, number> {
  const r = rallyRaw(s.rallies, side);
  return {
    ...r, ...s.team[side], serves: r.served, setsWon: s.setsWon[side], setsLost: s.setsWon[otherSide(side)],
    setsPlayed: s.sets.filter((x) => x.a + x.b > 0).length,
  };
}

export const volleyballEngine: SportIntelligenceEngine<VolleyballRules, VolleyballState> = {
  sport: "volleyball",
  label: "Volleyball",
  eventTypes: ["FIRST_SERVE", "LINEUP", "RALLY_WON", "TOUCH", "SUBSTITUTION", "TIMEOUT"],

  resolveRules(input) {
    const r = mergeRules(DEFAULTS, input);
    if (!isPosInt(r.bestOf) || r.bestOf % 2 === 0) throw new RulesError("bestOf must be an odd number of sets");
    if (!isPosInt(r.setPoints) || !isPosInt(r.decidingSetPoints)) throw new RulesError("set points must be positive whole numbers");
    if (!isPosInt(r.winBy)) throw new RulesError("winBy must be at least 1");
    if (r.pointCap !== null && (!isPosInt(r.pointCap) || r.pointCap < r.setPoints)) throw new RulesError("pointCap must be empty or at least setPoints");
    if (!isPosInt(r.playersOnCourt)) throw new RulesError("playersOnCourt must be a positive whole number");
    if (!isNonNegInt(r.timeoutsPerSet) || !isNonNegInt(r.substitutionsPerSet)) throw new RulesError("timeouts and substitutions per set cannot be negative");
    return r;
  },

  initializeMatch() {
    return {
      sets: [{ a: 0, b: 0, winner: null }], setsWon: { a: 0, b: 0 }, serving: null, setFirstServer: null,
      rotation: { a: null, b: null }, timeouts: { a: 0, b: 0 }, subs: { a: 0, b: 0 },
      rallies: [], decided: null, team: { a: {}, b: {} }, players: {}, log: [],
    };
  },

  validateEvent(s, ev, ctx, rules) {
    const p = ev.payload;
    const g = cur(s);
    if (s.decided) return "The match is already decided";
    switch (ev.type) {
      case "FIRST_SERVE":
        if (s.serving) return "The first server of this set is already set";
        if (g.a !== 0 || g.b !== 0) return "The first server can only be set before the first rally of a set";
        return isSide(p.side) ? null : "Say which side serves first";
      case "LINEUP": {
        if (!isSide(p.side)) return "Say which side the lineup is for";
        if (g.a !== 0 || g.b !== 0) return "A lineup can only be given before the first rally of a set";
        const list = p.players;
        if (!Array.isArray(list) || list.length !== rules.playersOnCourt) return `A lineup needs exactly ${rules.playersOnCourt} players`;
        if (new Set(list).size !== list.length) return "A player appears twice in the lineup";
        if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every lineup player must belong to that side";
        return null;
      }
      case "RALLY_WON": {
        if (!s.serving) return isDeciding(s, rules) ? "Set who serves first in the deciding set" : "Set who serves first before scoring";
        if (!isSide(p.winner)) return "Say which side won the rally";
        const how = p.how == null ? "other" : p.how;
        if (typeof how !== "string" || !(HOWS as readonly string[]).includes(how)) return "Unknown way of winning the rally";
        if (how === "ace" && p.winner !== s.serving) return "Only the serving side can serve an ace";
        if (how === "service_error" && p.winner === s.serving) return "A service error gives the point to the receiving side";
        if (p.player != null) {
          if (typeof p.player !== "string") return "player must be a player id";
          const ps = sideOfPlayer(ctx, p.player);
          if (!ps) return "That player is not in this match";
          if (BY_WINNER.has(how) && ps !== p.winner) return "A kill, block or ace belongs to the side that won the rally";
          if (BY_LOSER.has(how) && ps === p.winner) return "That error belongs to the side that lost the rally";
        }
        if (p.shots != null && !isPosInt(p.shots)) return "Rally length must be a positive whole number";
        return null;
      }
      case "TOUCH": {
        if (!isSide(p.side)) return "Say which side";
        if (typeof p.kind !== "string" || !(TOUCH_KINDS as readonly string[]).includes(p.kind)) return "Unknown touch";
        if (p.player != null && (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== p.side)) return "That player is not on that side";
        if (p.kind === "reception" && p.quality != null && !(RECEPTION_QUALITY as readonly unknown[]).includes(p.quality)) return "Unknown reception quality";
        return null;
      }
      case "SUBSTITUTION": {
        if (!isSide(p.side)) return "Say which side";
        if (s.subs[p.side] >= rules.substitutionsPerSet) return `${sideName(ctx, p.side)} has used all ${rules.substitutionsPerSet} substitutions this set`;
        if (typeof p.in !== "string" || typeof p.out !== "string") return "Say who comes on and who goes off";
        if (sideOfPlayer(ctx, p.in) !== p.side || sideOfPlayer(ctx, p.out) !== p.side) return "Both players must belong to that side";
        const rot = s.rotation[p.side];
        if (rot) {
          if (!rot.includes(p.out)) return "The player going off is not on court";
          if (rot.includes(p.in)) return "The player coming on is already on court";
        }
        return null;
      }
      case "TIMEOUT":
        if (!isSide(p.side)) return "Say which side";
        return s.timeouts[p.side] >= rules.timeoutsPerSet ? `${sideName(ctx, p.side)} has no timeouts left this set` : null;
    }
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    switch (ev.type) {
      case "FIRST_SERVE": s.serving = p.side as Side; s.setFirstServer = s.serving; return s;
      case "LINEUP": s.rotation[p.side as Side] = [...(p.players as string[])]; return s;
      case "TIMEOUT": s.timeouts[p.side as Side] += 1; return s;
      case "SUBSTITUTION": {
        const side = p.side as Side;
        s.subs[side] += 1;
        const rot = s.rotation[side];
        if (rot) rot[rot.indexOf(p.out as string)] = p.in as string;
        return s;
      }
      case "TOUCH": {
        const side = p.side as Side, who = str(p.player);
        if (p.kind === "attack") credit(s, side, who, "attacks");
        else if (p.kind === "dig") credit(s, side, who, "digs");
        else if (p.kind === "assist") credit(s, side, who, "assists");
        else {
          credit(s, side, who, "receptions");
          if (p.quality === "perfect" || p.quality === "good") credit(s, side, who, "receptionPositive");
          if (p.quality === "error") credit(s, side, who, "receptionErrors");
        }
        return s;
      }
    }

    // RALLY_WON
    const winner = p.winner as Side, loser = otherSide(winner);
    const serving = s.serving!;
    const how = (p.how as string | undefined) ?? "other";
    const server = s.rotation[serving]?.[0] ?? null;
    const named = str(p.player);
    const g = cur(s);

    if (server) add((s.players[server] ??= {}), "serves");
    switch (how) {
      case "ace": credit(s, winner, named ?? server, "aces"); break;
      case "service_error": credit(s, loser, named ?? server, "serviceErrors"); break;
      case "kill": credit(s, winner, named, "attacks"); credit(s, winner, named, "kills"); break;
      case "attack_error": credit(s, loser, named, "attacks"); credit(s, loser, named, "attackErrors"); break;
      case "block": credit(s, winner, named, "blocks"); break;
      case "opponent_error": credit(s, loser, named, "errors"); break;
    }

    g[winner] += 1;
    s.rallies.push({ seq: ev.seq, w: winner, srv: serving, pt: winner, g: s.sets.length - 1, a: g.a, b: g.b, ...(isPosInt(p.shots) ? { shots: p.shots } : {}), how });

    // Side out: the receiving side takes the serve and rotates one place.
    if (winner !== serving) {
      s.serving = winner;
      const rot = s.rotation[winner];
      if (rot && rot.length > 1) rot.push(rot.shift()!);
    }

    const won = gameWonBy(g, target(s, rules), rules.winBy, rules.pointCap);
    if (won) {
      g.winner = won;
      s.setsWon[won] += 1;
      s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won set ${s.sets.length} ${g[won]}-${g[otherSide(won)]}` });
      if (s.setsWon[won] > rules.bestOf / 2) {
        s.decided = won;
        s.log.push({ seq: ev.seq, text: `${sideName(ctx, won)} won the match ${s.setsWon[won]}-${s.setsWon[otherSide(won)]}` });
      } else {
        const first = s.setFirstServer ?? serving;
        s.sets.push({ a: 0, b: 0, winner: null });
        s.timeouts = { a: 0, b: 0 };
        s.subs = { a: 0, b: 0 };
        if (isDeciding(s, rules) && rules.decidingSetToss) { s.serving = null; s.setFirstServer = null; }
        else { s.serving = otherSide(first); s.setFirstServer = s.serving; }
      }
    }
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    s.sets.forEach((g, i) => {
      const t = rules.bestOf > 1 && i === rules.bestOf - 1 ? rules.decidingSetPoints : rules.setPoints;
      if (g.winner !== gameWonBy(g, t, rules.winBy, rules.pointCap)) {
        issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Set ${i + 1} is ${g.a}-${g.b}, which does not match its recorded winner` });
      }
      if (i < s.sets.length - 1 && !g.winner) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Set ${i + 1} was left unfinished` });
    });
    const need = Math.ceil(rules.bestOf / 2);
    if (s.setsWon.a > need || s.setsWon.b > need) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "A side has won more sets than the format allows" });
    if (s.sets.length > rules.bestOf) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "More sets were played than the format allows" });
    return issues;
  },

  getCurrentState(s, ctx) {
    const g = cur(s);
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.setsWon.a), b: String(s.setsWon.b) },
      subScore: s.decided ? null : { a: String(g.a), b: String(g.b) },
      periodLabel: s.decided ? "Final" : `Set ${s.sets.length}`,
      serving: s.decided ? null : s.serving,
      periods: s.sets.map((x, i) => ({ label: `S${i + 1}`, a: String(x.a), b: String(x.b) })),
      notes: [],
    };
    if (!s.decided && s.serving) {
      const server = s.rotation[s.serving]?.[0];
      if (server) view.notes.push(`${playerName(ctx, server)} serving`);
    }
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    if (s.decided) return [`${sideName(ctx, s.decided)} won ${s.setsWon[s.decided]} sets to ${s.setsWon[otherSide(s.decided)]}`, s.sets.map((x) => `${x.a}-${x.b}`).join(", ")];
    const g = cur(s);
    const sets = s.setsWon.a === s.setsWon.b
      ? `Sets level at ${s.setsWon.a}-${s.setsWon.b}`
      : `${sideName(ctx, s.setsWon.a > s.setsWon.b ? "a" : "b")} leads ${Math.max(s.setsWon.a, s.setsWon.b)} sets to ${Math.min(s.setsWon.a, s.setsWon.b)}`;
    const lines = [sets, `Current set: ${g.a}-${g.b}`];
    if (isDeciding(s, rules)) lines.push(`Deciding set to ${rules.decidingSetPoints}`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx) {
    const columns = [...RAW_COLUMNS, ...DERIVED_COLUMNS];
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
      const raw = s.players[pl.id] ?? {};
      const d = derive(raw);
      return { id: pl.id, name: pl.name, side, values: { ...Object.fromEntries(RAW_COLUMNS.map((c) => [c.key, raw[c.key] ?? 0])), ...Object.fromEntries(DERIVED_COLUMNS.map((c) => [c.key, d[c.key]])) } };
    }));
    return [{ key: "players", title: "Players", columns, rows }];
  },

  calculateTeamStatistics(s, ctx) {
    const raws = [...TEAM_EXTRA_RAW, ...RAW_COLUMNS];
    const rows = SIDES.map((side) => {
      const raw = teamRaw(s, side);
      return { id: side, name: sideName(ctx, side), side, values: { ...Object.fromEntries(raws.map((c) => [c.key, raw[c.key] ?? 0])), ...derive(raw), longestRally: raw.ralliesWithLength ? raw.longestRally : null } };
    });
    return [{ key: "sides", title: "Match statistics", columns: [...raws, { key: "longestRally", label: "Longest rally", kind: "raw" }, ...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED], rows }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      for (const side of SIDES) {
        lines.push({ subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...teamRaw(s, side), matches: 1, wins: s.decided === side ? 1 : 0 } });
        const setsPlayed = s.sets.filter((x) => x.a + x.b > 0).length;
        for (const pl of ctx.sides[side].players) {
          lines.push({ subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            raw: { ...(s.players[pl.id] ?? {}), matches: 1, setsPlayed } });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const st = streaks(s.rallies);
    const runs = scoringRuns(s.rallies, 4);
    const eff: StatTable = {
      key: "efficiency", title: "Attack and service efficiency",
      columns: [...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED],
      rows: SIDES.map((side) => ({ id: side, name: names[side], side, values: derive(teamRaw(s, side)) })),
    };
    const runTable: StatTable = {
      key: "runs", title: "Scoring runs (4 or more)",
      columns: [{ key: "set", label: "Set", kind: "raw" }, { key: "length", label: "Points in a row", kind: "raw" }],
      rows: runs.map((r, i) => ({ id: String(i), name: names[r.side], side: r.side, values: { set: r.g + 1, length: r.length } })),
    };
    const lengths = s.rallies.filter((r) => r.shots !== undefined).map((r) => r.shots!);
    return {
      cards: [
        { label: "Longest run", value: `${names.a} ${st.longest.a}, ${names.b} ${st.longest.b}` },
        { label: "Current run", value: st.current.side ? `${names[st.current.side]} ${st.current.length}` : "n/a" },
        { label: "Longest rally", value: lengths.length ? `${Math.max(...lengths)} touches` : "n/a", hint: lengths.length ? undefined : "Rally length was not recorded" },
      ],
      charts: [
        { key: "sets", title: "Points by set", type: "bar", labels: s.sets.map((_, i) => `Set ${i + 1}`), series: SIDES.map((side) => ({ name: names[side], side, values: s.sets.map((g) => g[side]) })), format: "int" },
        ...progressionCharts(s.rallies, names, "Set"),
      ],
      tables: [eff, runTable],
    } satisfies Analytics;
  },

  validateMatchCompletion(s, _ctx, rules) {
    const need = Math.ceil(rules.bestOf / 2);
    return s.decided ? null : `The match cannot be completed until a side has won ${need} sets`;
  },

  finalizeMatch(s): MatchResult {
    const w = s.decided!;
    return { outcome: "win", winner: w, method: "played", margin: `${s.setsWon[w]}-${s.setsWon[otherSide(w)]}: ${s.sets.map((g) => `${g.a}-${g.b}`).join(", ")}` };
  },

  mirrorScore: (s) => ({ scoreA: s.setsWon.a, scoreB: s.setsWon.b }),

  deriveStats(subject, raw) {
    const d = derive(raw);
    const perMatch = (k: string) => round(ratio(raw[k], raw.matches), 1);
    const avg: StatColumn[] = [
      { key: "killsPerMatch", label: "Kills per match", kind: "derived", format: "dec1" },
      { key: "blocksPerMatch", label: "Blocks per match", kind: "derived", format: "dec1" },
      { key: "digsPerMatch", label: "Digs per match", kind: "derived", format: "dec1" },
    ];
    const columns = subject === "team"
      ? [{ key: "matches", label: "Matches", kind: "raw" as const }, { key: "wins", label: "Wins", kind: "raw" as const }, ...TEAM_EXTRA_RAW, ...RAW_COLUMNS, ...avg, ...DERIVED_COLUMNS, ...TEAM_EXTRA_DERIVED]
      : [{ key: "matches", label: "Matches", kind: "raw" as const }, ...RAW_COLUMNS, ...avg, ...DERIVED_COLUMNS];
    return { columns, values: { ...raw, ...d, killsPerMatch: perMatch("kills"), blocksPerMatch: perMatch("blocks"), digsPerMatch: perMatch("digs") } };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, ctx) {
    const p = ev.payload;
    const who = str(p.player) ? ` by ${playerName(ctx, str(p.player))}` : "";
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    switch (ev.type) {
      case "FIRST_SERVE": return `${side} to serve first`;
      case "LINEUP": return `${side} lineup set`;
      case "TIMEOUT": return `Timeout ${side}`;
      case "SUBSTITUTION": return `${side}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}`;
      case "TOUCH": return `${side} ${String(p.kind)}${who}${p.quality ? ` (${String(p.quality)})` : ""}`;
      default: {
        const how = typeof p.how === "string" && p.how !== "other" ? ` (${p.how.replace(/_/g, " ")}${who})` : "";
        return `Point ${isSide(p.winner) ? sideName(ctx, p.winner) : ""}${how}`;
      }
    }
  },
};
