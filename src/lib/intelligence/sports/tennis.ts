// Tennis: points -> games -> sets -> match.
// Rules: ITF Rules of Tennis. Every competition difference (best of 3 or
// 5, tiebreak at 6-all or advantage sets, a match tiebreak instead of a
// final set, no-ad scoring) is a setting; see docs/sports-intelligence/06-game-iq.md.
//
// A point is recorded with who won it and, optionally, how (ace, double
// fault, winner, forced or unforced error) and which serve was in.
// Serve figures are only reported over points where the serve was recorded.

import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type AnalyticsCard, type Chart, type EngineEvent, type Issue, type MatchContext, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { add, isPosInt, mergeRules, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";
import { askMatch } from "../core/ask";
import { TENNIS_KNOWLEDGE } from "../knowledge/tennis";

export const TENNIS_PRESETS_LIST = ["best_of_3", "best_of_5", "doubles_pro", "custom"] as const;

export interface TennisRules {
  preset: (typeof TENNIS_PRESETS_LIST)[number];
  format: "singles" | "doubles";
  bestOfSets: number;
  gamesPerSet: number;
  /** games-all at which a tiebreak decides the set; null: advantage sets (win by two games) */
  tiebreakAt: number | null;
  tiebreakPoints: number;
  /** the deciding set: tiebreak at games-all, played out by two games, or a single match tiebreak */
  finalSet: "tiebreak" | "advantage" | "match_tiebreak";
  matchTiebreakPoints: number;
  /** at deuce the next point wins the game (deciding point) */
  noAd: boolean;
}

const BASE: TennisRules = {
  preset: "best_of_3", format: "singles", bestOfSets: 3, gamesPerSet: 6, tiebreakAt: 6, tiebreakPoints: 7,
  finalSet: "tiebreak", matchTiebreakPoints: 10, noAd: false,
};

export const TENNIS_PRESETS: Record<TennisRules["preset"], TennisRules> = {
  best_of_3: BASE,
  best_of_5: { ...BASE, preset: "best_of_5", bestOfSets: 5 },
  // ATP / WTA tour doubles: no-ad games, a match tiebreak to 10 instead of a third set
  doubles_pro: { ...BASE, preset: "doubles_pro", format: "doubles", noAd: true, finalSet: "match_tiebreak" },
  custom: { ...BASE, preset: "custom" },
};

export const TENNIS_RULE_CHOICES: Record<string, readonly string[]> = {
  preset: TENNIS_PRESETS_LIST, format: ["singles", "doubles"], finalSet: ["tiebreak", "advantage", "match_tiebreak"],
};

export const POINT_HOWS = ["ace", "double_fault", "winner", "forced_error", "unforced_error", "other"] as const;
type How = (typeof POINT_HOWS)[number];
// whose shot ended the point: the loser's for these
const BY_LOSER = new Set<How>(["double_fault", "forced_error", "unforced_error"]);
const HOW_KEY: Record<string, string> = { ace: "aces", double_fault: "doubleFaults", winner: "winners", forced_error: "forcedErrors", unforced_error: "unforcedErrors" };

export interface TennisSet {
  games: Record<Side, number>;
  /** tiebreak points, when one was played */
  tiebreak: Record<Side, number> | null;
  /** the whole set is one match tiebreak */
  matchTiebreak: boolean;
  winner: Side | null;
}

export interface TennisPoint {
  seq: number;
  /** point winner */
  w: Side;
  /** server */
  srv: Side;
  how: How | null;
  /** 1 or 2: the serve that was in; 0 for a double fault; null when not recorded */
  serve: 0 | 1 | 2 | null;
  set: number;
  tiebreak: boolean;
  /** what the point was for the receiver / either side */
  breakPoint: boolean;
  /** score after the point, as called */
  call: string;
  player: string | null;
}

export interface TennisState {
  sets: TennisSet[];
  setsWon: Record<Side, number>;
  /** points in the current game (or tiebreak) */
  game: Record<Side, number>;
  inTiebreak: boolean;
  serving: Side | null;
  /** who served the first point of the current tiebreak */
  tiebreakFirst: Side | null;
  decided: Side | null;
  points: TennisPoint[];
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  log: { seq: number; text: string }[];
}

const curSet = (s: TennisState): TennisSet => s.sets[s.sets.length - 1];
const setsNeeded = (r: TennisRules): number => Math.ceil(r.bestOfSets / 2);
const isDeciding = (s: TennisState, r: TennisRules): boolean => s.sets.length === r.bestOfSets;
const newSet = (matchTiebreak: boolean): TennisSet => ({ games: { a: 0, b: 0 }, tiebreak: matchTiebreak ? { a: 0, b: 0 } : null, matchTiebreak, winner: null });

/** Points that win the current tiebreak. */
const tiebreakTarget = (s: TennisState, r: TennisRules): number => (curSet(s).matchTiebreak ? r.matchTiebreakPoints : r.tiebreakPoints);

/** Does this game / tiebreak score win for `side`? */
function wins(points: Record<Side, number>, side: Side, s: TennisState, r: TennisRules): boolean {
  const mine = points[side], theirs = points[otherSide(side)];
  if (s.inTiebreak) return mine >= tiebreakTarget(s, r) && mine - theirs >= 2;
  if (r.noAd) return mine >= 4 && mine > theirs;
  return mine >= 4 && mine - theirs >= 2;
}

/** The server of the next point in a tiebreak: first point by F, then two each, alternating. */
function tiebreakServer(first: Side, played: number): Side {
  if (played === 0) return first;
  return Math.floor((played - 1) / 2) % 2 === 0 ? otherSide(first) : first;
}

const CALL = ["0", "15", "30", "40"];

/** "30-15", "Deuce", "Advantage Alpha", "5-4" in a tiebreak, from the server's side first. */
export function pointCall(s: TennisState, ctx: MatchContext, r: TennisRules): string {
  const g = s.game, srv = s.serving ?? "a", rcv = otherSide(srv);
  if (s.inTiebreak) return `${g[srv]}-${g[rcv]}`;
  if (g.a >= 3 && g.b >= 3) {
    if (g.a === g.b) return r.noAd ? "Deuce (deciding point)" : "Deuce";
    const ahead: Side = g.a > g.b ? "a" : "b";
    return `Advantage ${sideName(ctx, ahead)}`;
  }
  return `${CALL[Math.min(g[srv], 3)]}-${CALL[Math.min(g[rcv], 3)]}`;
}

interface Stakes { breakPoint: boolean; setPoint: Side | null; matchPoint: Side | null }

/** What the next point is worth, worked out by playing it both ways. */
function stakes(s: TennisState, r: TennisRules): Stakes {
  const out: Stakes = { breakPoint: false, setPoint: null, matchPoint: null };
  if (!s.serving || s.decided) return out;
  for (const side of SIDES) {
    const after = { ...s.game, [side]: s.game[side] + 1 };
    if (!wins(after, side, s, r)) continue;
    if (!s.inTiebreak && side !== s.serving) out.breakPoint = true;
    const set = curSet(s);
    const games = { ...set.games, [side]: set.games[side] + 1 };
    if (s.inTiebreak || setWonBy(games, side, s, r)) {
      if (s.setsWon[side] + 1 >= setsNeeded(r)) out.matchPoint = side; else out.setPoint = side;
    }
  }
  return out;
}

/** Does `side` win the set with these games (outside a tiebreak)? */
function setWonBy(games: Record<Side, number>, side: Side, s: TennisState, r: TennisRules): boolean {
  const mine = games[side], theirs = games[otherSide(side)];
  return mine >= r.gamesPerSet && mine - theirs >= 2;
}

/** Is a tiebreak played at this games score in this set? */
function tiebreakDue(s: TennisState, r: TennisRules): boolean {
  const set = curSet(s);
  const deciding = isDeciding(s, r);
  if (deciding && r.finalSet === "advantage") return false;
  return r.tiebreakAt !== null && set.games.a === r.tiebreakAt && set.games.b === r.tiebreakAt;
}

function credit(s: TennisState, side: Side, player: string | null, key: string, n = 1): void {
  add(s.team[side], key, n);
  if (player) add((s.players[player] ??= {}), key, n);
}

function setScoreText(set: TennisSet, first: Side = "a"): string {
  const o = otherSide(first);
  if (set.matchTiebreak) return `[${set.tiebreak![first]}-${set.tiebreak![o]}]`;
  const tb = set.tiebreak ? `(${Math.min(set.tiebreak.a, set.tiebreak.b)})` : "";
  return `${set.games[first]}-${set.games[o]}${tb}`;
}

const pctOf = (a: number | undefined, b: number | undefined) => round(pct(a ?? 0, b), 1);

function teamDerived(raw: Record<string, number>): Record<string, StatValue> {
  return {
    firstServePct: pctOf(raw.firstIn, raw.serveRecorded),
    firstServeWonPct: pctOf(raw.firstWon, raw.firstIn),
    secondServeWonPct: pctOf(raw.secondWon, raw.secondPlayed),
    servicePointsWonPct: pctOf(raw.servicePointsWon, raw.servicePoints),
    returnPointsWonPct: pctOf(raw.returnPointsWon, raw.returnPoints),
    totalPointsWonPct: pctOf(raw.pointsWon, (raw.pointsWon ?? 0) + (raw.pointsLost ?? 0)),
    breakPointConversion: pctOf(raw.breakPointsWon, raw.breakPointChances),
    breakPointsSavedPct: pctOf(raw.breakPointsSaved, raw.breakPointsFaced),
    holdPct: pctOf(raw.serviceGamesWon, raw.serviceGames),
    breakPoints: raw.breakPointChances ? `${raw.breakPointsWon ?? 0}/${raw.breakPointChances}` : "0/0",
    breakPointsSaved: raw.breakPointsFaced ? `${raw.breakPointsSaved ?? 0}/${raw.breakPointsFaced}` : "0/0",
    serviceGamesHeld: raw.serviceGames ? `${raw.serviceGamesWon ?? 0}/${raw.serviceGames}` : "0/0",
  };
}

const col = (key: string, label: string, kind: "raw" | "derived" = "raw", format?: StatColumn["format"]): StatColumn => ({ key, label, kind, ...(format ? { format } : {}) });

const TEAM_COLUMNS: StatColumn[] = [
  col("setsWon", "Sets won"), col("gamesWon", "Games won"), col("pointsWon", "Points won"),
  col("aces", "Aces"), col("doubleFaults", "Double faults"),
  col("firstServePct", "1st serve in %", "derived", "pct"), col("firstServeWonPct", "1st serve points won %", "derived", "pct"),
  col("secondServeWonPct", "2nd serve points won %", "derived", "pct"),
  col("servicePointsWonPct", "Service points won %", "derived", "pct"), col("returnPointsWonPct", "Return points won %", "derived", "pct"),
  col("breakPoints", "Break points won", "derived", "text"), col("breakPointConversion", "Break point conversion %", "derived", "pct"),
  col("breakPointsSaved", "Break points saved", "derived", "text"), col("serviceGamesHeld", "Service games held", "derived", "text"),
  col("winners", "Winners"), col("forcedErrors", "Forced errors"), col("unforcedErrors", "Unforced errors"),
  col("tiebreaksWon", "Tiebreaks won"), col("longestStreak", "Most points in a row"),
  col("totalPointsWonPct", "Total points won %", "derived", "pct"),
];

function teamRaw(s: TennisState, side: Side): Record<string, number> {
  let run = 0, best = 0;
  for (const p of s.points) { run = p.w === side ? run + 1 : 0; best = Math.max(best, run); }
  return { ...s.team[side], setsWon: s.setsWon[side], longestStreak: best };
}

export const tennisEngine: SportIntelligenceEngine<TennisRules, TennisState> = {
  sport: "tennis",
  label: "Tennis",
  eventTypes: ["FIRST_SERVE", "POINT_WON"],
  ruleChoices: TENNIS_RULE_CHOICES,

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, TENNIS_KNOWLEDGE); },
  rulesGuide: (rules) => TENNIS_KNOWLEDGE.guide(rules),

  resolveRules(input) {
    const presetIn = input && typeof input === "object" ? (input as { preset?: unknown }).preset : undefined;
    const preset = presetIn ?? "best_of_3";
    if (typeof preset !== "string" || !(preset in TENNIS_PRESETS)) throw new RulesError("preset must be best_of_3, best_of_5, doubles_pro or custom");
    const r = mergeRules(TENNIS_PRESETS[preset as TennisRules["preset"]], input);
    if (r.format !== "singles" && r.format !== "doubles") throw new RulesError("format must be singles or doubles");
    if (!isPosInt(r.bestOfSets) || r.bestOfSets % 2 === 0) throw new RulesError("bestOfSets must be an odd number");
    for (const k of ["gamesPerSet", "tiebreakPoints", "matchTiebreakPoints"] as const) if (!isPosInt(r[k])) throw new RulesError(`${k} must be a positive whole number`);
    if (r.tiebreakAt !== null && (!isPosInt(r.tiebreakAt) || r.tiebreakAt > r.gamesPerSet)) throw new RulesError("tiebreakAt must be empty (advantage sets) or at most gamesPerSet");
    if (!["tiebreak", "advantage", "match_tiebreak"].includes(r.finalSet)) throw new RulesError("finalSet must be tiebreak, advantage or match_tiebreak");
    if (r.finalSet === "match_tiebreak" && r.bestOfSets === 1) throw new RulesError("a one-set match cannot replace its only set with a match tiebreak");
    if (typeof r.noAd !== "boolean") throw new RulesError("noAd must be yes or no");
    return r;
  },

  initializeMatch() {
    return {
      sets: [newSet(false)], setsWon: { a: 0, b: 0 }, game: { a: 0, b: 0 }, inTiebreak: false,
      serving: null, tiebreakFirst: null, decided: null, points: [],
      team: { a: {}, b: {} }, players: {}, log: [],
    };
  },

  validateEvent(s, ev, ctx) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") {
      if (s.points.length) return "The first server is chosen before the first point";
      return isSide(p.side) ? null : "Say which side serves first";
    }
    if (!s.serving) return "Choose who serves first";
    if (s.decided) return `${sideName(ctx, s.decided)} have won the match. Complete it`;
    if (!isSide(p.side)) return "Say who won the point";
    const w = p.side, srv = s.serving, how = (p.how ?? null) as How | null;
    if (how !== null && !(POINT_HOWS as readonly string[]).includes(how)) return "Unknown way of winning a point";
    if (how === "ace" && w !== srv) return "Only the server can hit an ace";
    if (how === "double_fault" && w === srv) return "A double fault loses the point for the server";
    if (p.serve != null) {
      if (p.serve !== 1 && p.serve !== 2) return "serve must be 1 (first serve in) or 2 (second serve)";
      if (how === "double_fault") return "A double fault has no serve in";
    }
    if (p.player != null) {
      if (typeof p.player !== "string") return "player must be a player id";
      const shotBy: Side = how && BY_LOSER.has(how) ? otherSide(w) : w;
      if (sideOfPlayer(ctx, p.player) !== shotBy) return how && BY_LOSER.has(how) ? `The player who made that error must be in ${sideName(ctx, shotBy)}` : `That player is not in ${sideName(ctx, shotBy)}`;
    }
    if (p.shots != null && (!Number.isInteger(p.shots) || (p.shots as number) < 1)) return "shots must be a whole number, 1 or more";
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") {
      s.serving = p.side as Side;
      s.log.push({ seq: ev.seq, text: `${sideName(ctx, s.serving)} to serve first` });
      // a match that opens with a match tiebreak (one-set formats excluded) is handled when sets roll over
      return s;
    }
    const w = p.side as Side, srv = s.serving!, rcv = otherSide(srv);
    const how = (p.how ?? null) as How | null;
    const player = str(p.player);
    const st = stakes(s, rules);
    const set = curSet(s);
    const tb = s.inTiebreak;

    // ── point statistics ──
    credit(s, w, null, "pointsWon"); credit(s, otherSide(w), null, "pointsLost");
    credit(s, srv, null, "servicePoints"); credit(s, rcv, null, "returnPoints");
    if (w === srv) credit(s, srv, null, "servicePointsWon"); else credit(s, rcv, null, "returnPointsWon");
    const serve: 0 | 1 | 2 | null = how === "double_fault" ? 0 : p.serve === 1 || p.serve === 2 ? p.serve : how === "ace" ? null : null;
    if (serve !== null) {
      credit(s, srv, null, "serveRecorded");
      if (serve === 1) { credit(s, srv, null, "firstIn"); if (w === srv) credit(s, srv, null, "firstWon"); }
      else { credit(s, srv, null, "secondPlayed"); if (serve === 2 && w === srv) credit(s, srv, null, "secondWon"); }
    }
    if (how && HOW_KEY[how]) credit(s, BY_LOSER.has(how) ? otherSide(w) : w, player, HOW_KEY[how]);
    if (st.breakPoint) {
      credit(s, rcv, null, "breakPointChances"); credit(s, srv, null, "breakPointsFaced");
      if (w === rcv) credit(s, rcv, null, "breakPointsWon"); else credit(s, srv, null, "breakPointsSaved");
    }
    if (!tb && rules.noAd && s.game.a === 3 && s.game.b === 3) credit(s, w, null, "decidingPointsWon");
    if (typeof p.shots === "number") { add(s.team[w], "shotsTotal", p.shots); add(s.team[otherSide(w)], "shotsTotal", p.shots); add(s.team.a, "pointsWithLength"); add(s.team.b, "pointsWithLength"); }

    // ── the score ──
    s.game[w] += 1;
    let note = "";
    if (wins(s.game, w, s, rules)) {
      if (tb) {
        set.tiebreak = { ...s.game };
        set.games[w] += 1;
        if (!set.matchTiebreak) credit(s, w, null, "gamesWon");
        credit(s, w, null, "tiebreaksWon");
        s.log.push({ seq: ev.seq, text: `${sideName(ctx, w)} won the ${set.matchTiebreak ? "match tiebreak" : "tiebreak"} ${s.game[w]}-${s.game[otherSide(w)]}` });
        // after a tiebreak, the side that received first in it serves the next set
        const next = otherSide(s.tiebreakFirst ?? srv);
        s.inTiebreak = false; s.tiebreakFirst = null;
        endSet(s, w, ev, ctx, rules);
        s.serving = next;
        if (s.inTiebreak) s.tiebreakFirst = next;
      } else {
        set.games[w] += 1;
        credit(s, w, null, "gamesWon");
        credit(s, srv, null, "serviceGames"); if (w === srv) credit(s, srv, null, "serviceGamesWon"); else credit(s, rcv, null, "breaks");
        note = w === srv ? `${sideName(ctx, w)} held serve` : `${sideName(ctx, w)} broke serve`;
        s.log.push({ seq: ev.seq, text: `${note}: ${set.games.a}-${set.games.b} in set ${s.sets.length}` });
        s.game = { a: 0, b: 0 };
        s.serving = otherSide(srv);
        if (setWonBy(set.games, w, s, rules)) { endSet(s, w, ev, ctx, rules); if (s.inTiebreak) s.tiebreakFirst = s.serving; }
        else if (tiebreakDue(s, rules)) {
          s.inTiebreak = true; set.tiebreak = { a: 0, b: 0 }; s.tiebreakFirst = s.serving;
          s.log.push({ seq: ev.seq, text: `Tiebreak at ${set.games.a}-${set.games.b}` });
        }
      }
    }
    if (tb && s.inTiebreak) {
      // still in the tiebreak: the serve changes after the first point and then every two
      s.serving = tiebreakServer(s.tiebreakFirst!, s.game.a + s.game.b);
    }
    if (tb) credit(s, w, null, "tiebreakPointsWon");

    s.points.push({
      seq: ev.seq, w, srv, how, serve, set: s.sets.indexOf(set), tiebreak: tb, breakPoint: st.breakPoint,
      call: s.decided ? "Game, set and match" : set.winner ? "Game and set" : note ? "Game" : pointCall(s, ctx, rules), player,
    });
    return s;
  },

  validateScore(s) {
    const issues: Issue[] = [];
    for (const side of SIDES) {
      const won = s.points.filter((x) => x.w === side).length;
      if (won !== (s.team[side].pointsWon ?? 0)) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "Points won do not match the points recorded" });
      if (s.sets.filter((x) => x.winner === side).length !== s.setsWon[side]) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "Sets won do not match the sets" });
    }
    return issues;
  },

  getCurrentState(s, ctx, rules) {
    const set = curSet(s);
    const done = s.sets.filter((x) => x.winner);
    const st = stakes(s, rules);
    const call = s.serving && !s.decided ? pointCall(s, ctx, rules) : "";
    const label = s.decided ? `${sideName(ctx, s.decided)} won` : !s.serving ? "Not started"
      : `Set ${s.sets.length}${s.inTiebreak ? (set.matchTiebreak ? ", match tiebreak" : ", tiebreak") : ""}, ${sideName(ctx, s.serving)} serving`;
    const notes: string[] = [];
    if (st.matchPoint) notes.push(`Match point ${sideName(ctx, st.matchPoint)}`);
    else if (st.setPoint) notes.push(`Set point ${sideName(ctx, st.setPoint)}`);
    if (st.breakPoint) notes.push("Break point");
    const raw = { a: teamRaw(s, "a"), b: teamRaw(s, "b") };
    const facts = s.points.length ? [
      { label: "Aces", a: String(raw.a.aces ?? 0), b: String(raw.b.aces ?? 0) },
      { label: "Double faults", a: String(raw.a.doubleFaults ?? 0), b: String(raw.b.doubleFaults ?? 0) },
      { label: "Break points won", a: `${raw.a.breakPointsWon ?? 0}/${raw.a.breakPointChances ?? 0}`, b: `${raw.b.breakPointsWon ?? 0}/${raw.b.breakPointChances ?? 0}` },
    ] : [];
    const inSet = !s.decided && !set.winner;
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.setsWon.a), b: String(s.setsWon.b) },
      subScore: inSet && s.serving ? {
        a: set.matchTiebreak ? `[${s.game.a}]` : `${set.games.a} games${s.inTiebreak ? ` · ${s.game.a}` : ""}`,
        b: set.matchTiebreak ? `[${s.game.b}]` : `${set.games.b} games${s.inTiebreak ? ` · ${s.game.b}` : ""}`,
      } : null,
      periodLabel: label,
      brief: [...done.map((x) => setScoreText(x)), ...(inSet && s.serving ? [set.matchTiebreak ? `[${s.game.a}-${s.game.b}]` : `${set.games.a}-${set.games.b}`] : []), ...(inSet && call ? [call] : [])].join(", "),
      serving: s.decided ? null : s.serving,
      facts,
      periods: s.sets.filter((x) => x.winner || x === set).map((x, i) => ({
        label: x.matchTiebreak ? "Match TB" : `Set ${i + 1}`,
        a: x.matchTiebreak ? `[${(x.tiebreak ?? s.game).a}]` : `${x.games.a}${x.tiebreak && x.winner === "b" ? ` (${x.tiebreak.a})` : ""}`,
        b: x.matchTiebreak ? `[${(x.tiebreak ?? s.game).b}]` : `${x.games.b}${x.tiebreak && x.winner === "a" ? ` (${x.tiebreak.b})` : ""}`,
      })),
      notes: [...(call && !s.decided ? [call] : []), ...notes],
    };
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const lines = [`${sideName(ctx, "a")} ${s.setsWon.a} - ${sideName(ctx, "b")} ${s.setsWon.b} sets`];
    const sets = s.sets.filter((x) => x.winner).map((x) => setScoreText(x));
    if (sets.length) lines.push(`Sets: ${sets.join(", ")}`);
    if (s.serving && !s.decided) lines.push(`${curSet(s).games.a}-${curSet(s).games.b} in set ${s.sets.length}, ${pointCall(s, ctx, rules)}, ${sideName(ctx, s.serving)} serving`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx) {
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
      const raw = s.players[pl.id] ?? {};
      return { id: pl.id, name: pl.name, side, values: { aces: raw.aces ?? 0, doubleFaults: raw.doubleFaults ?? 0, winners: raw.winners ?? 0, forcedErrors: raw.forcedErrors ?? 0, unforcedErrors: raw.unforcedErrors ?? 0 } as Record<string, StatValue> };
    })).filter((r) => Object.values(r.values).some((v) => v));
    return [{ key: "players", title: "Players", columns: [col("aces", "Aces"), col("doubleFaults", "Double faults"), col("winners", "Winners"), col("forcedErrors", "Forced errors"), col("unforcedErrors", "Unforced errors")], rows }];
  },

  calculateTeamStatistics(s, ctx) {
    return [{
      key: "team", title: "Match statistics", columns: TEAM_COLUMNS,
      rows: SIDES.map((side) => { const raw = teamRaw(s, side); return { id: side, name: sideName(ctx, side), side, values: { ...raw, ...teamDerived(raw) } as Record<string, StatValue> }; }),
    }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      for (const side of SIDES) {
        lines.push({
          subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...teamRaw(s, side), matches: 1, wins: s.decided === side ? 1 : 0, setsLost: s.setsWon[otherSide(side)] },
        });
        for (const pl of ctx.sides[side].players) {
          lines.push({
            subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            // in singles the player is the side; in doubles the team figures belong to both partners
            raw: { ...teamRaw(s, side), ...(s.players[pl.id] ?? {}), matches: 1, wins: s.decided === side ? 1 : 0 },
          });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const raw = { a: teamRaw(s, "a"), b: teamRaw(s, "b") };
    const d = { a: teamDerived(raw.a), b: teamDerived(raw.b) };
    const cards: AnalyticsCard[] = [
      { label: "Break points won", value: `${names.a} ${d.a.breakPoints}, ${names.b} ${d.b.breakPoints}` },
      { label: "Service games held", value: `${names.a} ${d.a.serviceGamesHeld}, ${names.b} ${d.b.serviceGamesHeld}` },
      { label: "Total points won", value: `${names.a} ${raw.a.pointsWon ?? 0}, ${names.b} ${raw.b.pointsWon ?? 0}` },
      { label: "Most points in a row", value: `${names.a} ${raw.a.longestStreak}, ${names.b} ${raw.b.longestStreak}` },
    ];
    const insights: string[] = [];
    for (const side of SIDES) {
      const o = otherSide(side);
      if ((raw[side].breaks ?? 0) > 0) insights.push(`${names[side]} broke serve ${raw[side].breaks} time${raw[side].breaks === 1 ? "" : "s"}.`);
      if ((raw[side].breakPointsFaced ?? 0) >= 3) insights.push(`${names[side]} saved ${raw[side].breakPointsSaved ?? 0} of ${raw[side].breakPointsFaced} break points.`);
      if (d[side].firstServeWonPct !== null && (raw[side].firstIn ?? 0) >= 8) insights.push(`${names[side]} won ${d[side].firstServeWonPct}% of points on their first serve.`);
      if ((raw[side].aces ?? 0) >= 3) insights.push(`${names[side]} served ${raw[side].aces} aces.`);
      if ((raw[side].doubleFaults ?? 0) >= 3) insights.push(`${names[side]} served ${raw[side].doubleFaults} double faults.`);
      if ((raw[side].unforcedErrors ?? 0) > (raw[o].unforcedErrors ?? 0) + 5) insights.push(`${names[side]} made ${raw[side].unforcedErrors} unforced errors to ${raw[o].unforcedErrors ?? 0}.`);
    }
    const totalA = raw.a.pointsWon ?? 0, totalB = raw.b.pointsWon ?? 0;
    if (s.decided && ((s.decided === "a" && totalA < totalB) || (s.decided === "b" && totalB < totalA))) insights.push(`${names[s.decided]} won the match despite winning fewer points (${Math.min(totalA, totalB)} to ${Math.max(totalA, totalB)}).`);
    const setLabels = s.sets.map((x, i) => (x.matchTiebreak ? "Match TB" : `Set ${i + 1}`));
    const charts: Chart[] = [
      { key: "points-by-set", title: "Points won by set", type: "bar", labels: setLabels, format: "int",
        series: SIDES.map((side) => ({ name: names[side], side, values: s.sets.map((_, i) => s.points.filter((x) => x.set === i && x.w === side).length) })) },
      { key: "serve", title: "Serve and return %", type: "bar", labels: ["1st serve in", "1st serve won", "2nd serve won", "Return won"], format: "dec1",
        series: SIDES.map((side) => ({ name: names[side], side, values: [d[side].firstServePct, d[side].firstServeWonPct, d[side].secondServeWonPct, d[side].returnPointsWonPct].map((v) => (typeof v === "number" ? v : null)) })) },
      { key: "progression", title: "Points won through the match", type: "line", labels: ["0", ...s.points.map((_, i) => String(i + 1))], format: "int",
        series: SIDES.map((side) => { let n = 0; return { name: names[side], side, values: [0, ...s.points.map((x) => (n += x.w === side ? 1 : 0))] }; }) },
    ];
    const tables: StatTable[] = [{
      key: "sets", title: "Sets",
      columns: [col("score", "Score", "raw", "text"), col("winner", "Won by", "raw", "text")],
      rows: s.sets.filter((x) => x.winner).map((x, i) => ({ id: String(i), name: x.matchTiebreak ? "Match tiebreak" : `Set ${i + 1}`, side: x.winner, values: { score: setScoreText(x), winner: names[x.winner!] } })),
    }];
    return { cards, charts, tables, insights } satisfies Analytics;
  },

  validateMatchCompletion(s, ctx) {
    if (s.decided) return null;
    return `The match is not decided yet: ${sideName(ctx, "a")} ${s.setsWon.a}, ${sideName(ctx, "b")} ${s.setsWon.b} in sets`;
  },

  finalizeMatch(s): MatchResult {
    const w = s.decided!;
    return { outcome: "win", winner: w, method: "played", margin: s.sets.filter((x) => x.winner).map((x) => setScoreText(x, w)).join(", ") };
  },

  // the fixture shows sets won
  mirrorScore: (s) => ({ scoreA: s.setsWon.a, scoreB: s.setsWon.b }),

  deriveStats(_subject, raw) {
    const games = raw.matches ?? 0;
    const per = (k: string) => round(ratio(raw[k] ?? 0, games || null), 1);
    const d = teamDerived(raw);
    return {
      columns: [
        col("matches", "Matches"), col("wins", "Wins"), col("winPct", "Win %", "derived", "pct"),
        col("setsWon", "Sets won"), col("acesPerMatch", "Aces per match", "derived", "dec1"), col("doubleFaultsPerMatch", "Double faults per match", "derived", "dec1"),
        col("firstServePct", "1st serve in %", "derived", "pct"), col("firstServeWonPct", "1st serve points won %", "derived", "pct"),
        col("secondServeWonPct", "2nd serve points won %", "derived", "pct"), col("returnPointsWonPct", "Return points won %", "derived", "pct"),
        col("breakPointConversion", "Break point conversion %", "derived", "pct"), col("holdPct", "Service games held %", "derived", "pct"),
        col("tiebreaksWon", "Tiebreaks won"),
      ],
      values: { ...raw, ...d, winPct: round(pct(raw.wins ?? 0, games || null), 1), acesPerMatch: per("aces"), doubleFaultsPerMatch: per("doubleFaults") },
    };
  },

  derivedLog: (s) => s.log,

  eventLabel(s, _ev, rules) {
    if (!s.serving || s.decided) return null;
    const set = curSet(s);
    return `Set ${s.sets.length} ${set.games.a}-${set.games.b}${s.inTiebreak ? `, ${set.matchTiebreak ? "match " : ""}tiebreak ${s.game.a}-${s.game.b}` : `, ${CALL[Math.min(s.game.a, 3)]}-${CALL[Math.min(s.game.b, 3)]}`}`.replace(/40-40/, rules.noAd ? "deuce (deciding point)" : "deuce");
  },

  describeEvent(ev: EngineEvent, ctx: MatchContext) {
    const p = ev.payload;
    if (ev.type === "FIRST_SERVE") return `${isSide(p.side) ? sideName(ctx, p.side) : ""} to serve first`;
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    const how = typeof p.how === "string" && p.how !== "other" ? ` (${p.how.replace(/_/g, " ")}${str(p.player) ? `, ${playerName(ctx, str(p.player))}` : ""})` : "";
    const serve = p.serve === 1 ? ", 1st serve" : p.serve === 2 ? ", 2nd serve" : "";
    return `Point ${side}${how}${serve}`;
  },
};

function endSet(s: TennisState, w: Side, ev: EngineEvent, ctx: MatchContext, rules: TennisRules): void {
  const set = curSet(s);
  set.winner = w;
  s.setsWon[w] += 1;
  s.game = { a: 0, b: 0 };
  s.log.push({ seq: ev.seq, text: `${sideName(ctx, w)} won set ${s.sets.length} ${setScoreText(set, w)}` });
  if (s.setsWon[w] >= setsNeeded(rules)) {
    s.decided = w;
    s.log.push({ seq: ev.seq, text: `${sideName(ctx, w)} won the match ${s.setsWon[w]}-${s.setsWon[otherSide(w)]}` });
    return;
  }
  const deciding = s.sets.length + 1 === rules.bestOfSets;
  const matchTiebreak = deciding && rules.finalSet === "match_tiebreak";
  s.sets.push(newSet(matchTiebreak));
  if (matchTiebreak) { s.inTiebreak = true; s.tiebreakFirst = null; }
}
