// Cricket: deliveries -> overs -> innings -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md.
//
// Cricket is not "team points". The unit is the delivery, and an over
// is a count of LEGAL deliveries: a wide or a no-ball adds runs without
// using one up. Overs are therefore always held as a ball count;
// "4.5" means 4 overs and 5 balls (29 balls), never the decimal 4.5.

import { askMatch } from "../core/ask";
import { CRICKET_KNOWLEDGE } from "../knowledge/cricket";
import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type EngineEvent, type Issue, type MatchContext, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { add, isNonNegInt, isPosInt, mergeRules, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";

export interface CricketPhase { name: string; from: number; to: number }

export interface CricketRules {
  preset: "t20" | "odi" | "test" | "custom";
  oversPerInnings: number | null;
  inningsPerSide: number;
  ballsPerOver: number;
  wicketsPerInnings: number;
  maxOversPerBowler: number | null;
  wideRuns: number;
  noBallRuns: number;
  wideRebowled: boolean;
  noBallRebowled: boolean;
  freeHit: boolean;
  allowDeclaration: boolean;
  allowDraw: boolean;
  followOnLead: number | null;
  phases: CricketPhase[];
}

const BASE = { ballsPerOver: 6, wicketsPerInnings: 10, wideRuns: 1, noBallRuns: 1, wideRebowled: true, noBallRebowled: true };

export const CRICKET_PRESETS: Record<CricketRules["preset"], CricketRules> = {
  t20: { ...BASE, preset: "t20", oversPerInnings: 20, inningsPerSide: 1, maxOversPerBowler: 4, freeHit: true, allowDeclaration: false, allowDraw: false, followOnLead: null,
    phases: [{ name: "Powerplay", from: 1, to: 6 }, { name: "Middle", from: 7, to: 15 }, { name: "Death", from: 16, to: 20 }] },
  odi: { ...BASE, preset: "odi", oversPerInnings: 50, inningsPerSide: 1, maxOversPerBowler: 10, freeHit: true, allowDeclaration: false, allowDraw: false, followOnLead: null,
    phases: [{ name: "Powerplay", from: 1, to: 10 }, { name: "Middle", from: 11, to: 40 }, { name: "Death", from: 41, to: 50 }] },
  test: { ...BASE, preset: "test", oversPerInnings: null, inningsPerSide: 2, maxOversPerBowler: null, freeHit: false, allowDeclaration: true, allowDraw: true, followOnLead: 200, phases: [] },
  custom: { ...BASE, preset: "custom", oversPerInnings: 20, inningsPerSide: 1, maxOversPerBowler: null, freeHit: false, allowDeclaration: false, allowDraw: false, followOnLead: null, phases: [] },
};

const EXTRAS = ["wide", "no_ball", "bye", "leg_bye"] as const;
const WICKETS = ["bowled", "caught", "lbw", "stumped", "hit_wicket", "run_out", "obstructing_field", "hit_ball_twice"] as const;
const BOWLER_WICKETS = new Set(["bowled", "caught", "lbw", "stumped", "hit_wicket"]);
const ON_WIDE = new Set(["stumped", "hit_wicket", "run_out", "obstructing_field"]);
const ON_NO_BALL = new Set(["run_out", "obstructing_field", "hit_ball_twice"]);
// the striker is always the one out for these; a run out or obstruction can be either batter
const STRIKER_ONLY = new Set(["bowled", "caught", "lbw", "stumped", "hit_wicket", "hit_ball_twice"]);
const RETIRE_KINDS = ["hurt", "out", "timed_out"] as const;

interface Bat { runs: number; balls: number; fours: number; sixes: number; out: boolean; how: string | null; by: string | null; fielder: string | null; retiredHurt: boolean; order: number }
interface Bowl { balls: number; runs: number; wickets: number; maidens: number; wides: number; noBalls: number }
interface Over { n: number; bowler: string; runs: number; bowlerRuns: number; wickets: number; legal: number; balls: string[] }
interface Stand { wicket: number; runs: number; balls: number; batters: string[] }

export interface CricketInnings {
  n: number;
  batting: Side;
  runs: number;
  wickets: number;
  /** legal deliveries */
  balls: number;
  extras: { wides: number; noBalls: number; byes: number; legByes: number; penalty: number };
  batters: Record<string, Bat>;
  bowlers: Record<string, Bowl>;
  fielding: Record<string, Record<string, number>>;
  striker: string | null;
  nonStriker: string | null;
  bowler: string | null;
  lastOverBowler: string | null;
  overs: Over[];
  fow: { wicket: number; runs: number; balls: number; player: string }[];
  partnerships: Stand[];
  stand: Stand;
  closed: null | "all_out" | "overs" | "target" | "declared" | "ended";
  target: number | null;
  maxBalls: number | null;
  freeHit: boolean;
  followOn: boolean;
}

export interface CricketState {
  toss: { winner: Side; decision: "bat" | "bowl" } | null;
  innings: CricketInnings[];
  /** penalty runs awarded to a side that has not batted yet */
  carry: Record<Side, number>;
  result: MatchResult | null;
  log: { seq: number; text: string }[];
}

// ── overs arithmetic ────────────────────────────────────────────────

/** 29 balls -> "4.5". */
export function oversText(balls: number, ballsPerOver = 6): string {
  return `${Math.floor(balls / ballsPerOver)}.${balls % ballsPerOver}`;
}

/** "4.5" -> 29 balls. Rejects "4.6" and beyond: that is not a number of balls. */
export function parseOvers(text: string | number, ballsPerOver = 6): number | null {
  const m = /^(\d+)(?:\.(\d))?$/.exec(String(text).trim());
  if (!m) return null;
  const part = m[2] ? Number(m[2]) : 0;
  if (part >= ballsPerOver) return null;
  return Number(m[1]) * ballsPerOver + part;
}

/** Runs per over from a ball count. */
export function runRate(runs: number, balls: number, ballsPerOver = 6): number | null {
  return ratio(runs, balls / ballsPerOver);
}

const ordinal = (n: number): string => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const cur = (s: CricketState): CricketInnings | null => s.innings[s.innings.length - 1] ?? null;
const open = (s: CricketState): CricketInnings | null => { const i = cur(s); return i && !i.closed ? i : null; };
const total = (s: CricketState, side: Side): number => s.innings.filter((i) => i.batting === side).reduce((t, i) => t + i.runs, 0);
const played = (s: CricketState, side: Side): number => s.innings.filter((i) => i.batting === side).length;
const currentOver = (inn: CricketInnings, rules: CricketRules): Over | null => {
  const o = inn.overs[inn.overs.length - 1];
  return o && o.legal < rules.ballsPerOver ? o : null;
};

function newBat(order: number): Bat {
  return { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null, by: null, fielder: null, retiredHurt: false, order };
}

/** Which side bats the next innings, or null if no more innings are possible. */
function expectedBatting(s: CricketState, rules: CricketRules, followOn: boolean): Side | "any" | null {
  const n = s.innings.length;
  if (n >= rules.inningsPerSide * 2) return null;
  if (n === 0) {
    if (!s.toss) return "any";
    return s.toss.decision === "bat" ? s.toss.winner : otherSide(s.toss.winner);
  }
  const first = s.innings[0].batting;
  if (n === 1) return otherSide(first);
  if (n === 2) return followOn ? s.innings[1].batting : first;
  return otherSide(s.innings[2].batting);
}

function chaseTarget(s: CricketState, rules: CricketRules, batting: Side): number | null {
  // a target exists only in the match's last innings
  const lastForBatting = played(s, batting) === rules.inningsPerSide - 1;
  const otherDone = played(s, otherSide(batting)) === rules.inningsPerSide;
  return lastForBatting && otherDone ? total(s, otherSide(batting)) - total(s, batting) + 1 : null;
}

function closeStand(inn: CricketInnings): void {
  // an empty stand (the not-out batter left alone at the end) is not a partnership
  if (inn.stand.runs > 0 || inn.stand.balls > 0) inn.partnerships.push(inn.stand);
  inn.stand = { wicket: inn.wickets + 1, runs: 0, balls: 0, batters: [inn.striker, inn.nonStriker].filter((x): x is string => !!x) };
}

function evaluate(s: CricketState, ctx: MatchContext, rules: CricketRules, seq: number): void {
  const inn = cur(s);
  if (!inn || !inn.closed || s.result) return;
  const x = inn.batting, y = otherSide(x);
  const xDone = played(s, x) >= rules.inningsPerSide;
  const yDone = played(s, y) >= rules.inningsPerSide;
  const tx = total(s, x), ty = total(s, y);

  if (inn.closed === "target") {
    const left = rules.wicketsPerInnings - inn.wickets;
    s.result = { outcome: "win", winner: x, method: "played", margin: `by ${left} wicket${left === 1 ? "" : "s"}` };
  } else if (xDone && yDone) {
    // the chase fell short: compare with what was needed (a revised target counts)
    const needed = inn.target ?? ty - (tx - inn.runs) + 1;
    const short = needed - 1 - inn.runs;
    if (short === 0) s.result = { outcome: "tie", winner: null, method: "played", margin: "scores level" };
    else if (short > 0) s.result = { outcome: "win", winner: y, method: "played", margin: `by ${short} run${short === 1 ? "" : "s"}` };
    else s.result = { outcome: "win", winner: x, method: "played", margin: `by ${-short} run${short === -1 ? "" : "s"}` };
  } else if (xDone && !yDone && ty > tx) {
    s.result = { outcome: "win", winner: y, method: "played", margin: `by an innings and ${ty - tx} runs` };
  }
  if (s.result) s.log.push({ seq, text: s.result.outcome === "tie" ? "Match tied" : `${sideName(ctx, s.result.winner!)} won ${s.result.margin}` });
}

function checkClose(s: CricketState, ctx: MatchContext, rules: CricketRules, seq: number): void {
  const inn = open(s);
  if (!inn) return;
  if (inn.target !== null && inn.runs >= inn.target) inn.closed = "target";
  else if (inn.wickets >= rules.wicketsPerInnings) inn.closed = "all_out";
  else if (inn.maxBalls !== null && inn.balls >= inn.maxBalls) inn.closed = "overs";
  if (inn.closed) {
    closeStand(inn);
    inn.striker = null; inn.nonStriker = null;
    s.log.push({ seq, text: `${ordinal(inn.n)} innings closed: ${sideName(ctx, inn.batting)} ${inn.runs}/${inn.wickets} (${oversText(inn.balls, rules.ballsPerOver)} ov)` });
    evaluate(s, ctx, rules, seq);
  }
}

function recordWicket(inn: CricketInnings, player: string, how: string, bowler: string | null, fielder: string | null): void {
  const b = inn.batters[player];
  b.out = true; b.how = how; b.by = bowler; b.fielder = fielder;
  inn.wickets += 1;
  inn.fow.push({ wicket: inn.wickets, runs: inn.runs, balls: inn.balls, player });
  if (inn.striker === player) inn.striker = null;
  if (inn.nonStriker === player) inn.nonStriker = null;
  closeStand(inn);
}

// ── statistics ──────────────────────────────────────────────────────

const strikeRate = (runs: number, balls: number): number | null => round(ratio(runs * 100, balls), 2);

function battingTable(inn: CricketInnings, ctx: MatchContext): StatTable {
  const columns: StatColumn[] = [
    { key: "how", label: "Dismissal", kind: "raw", format: "text" },
    { key: "runs", label: "R", kind: "raw" }, { key: "balls", label: "B", kind: "raw" },
    { key: "fours", label: "4s", kind: "raw" }, { key: "sixes", label: "6s", kind: "raw" },
    { key: "sr", label: "SR", kind: "derived", format: "dec2" },
  ];
  const rows = Object.entries(inn.batters).sort((x, y) => x[1].order - y[1].order).map(([id, b]) => ({
    id, name: playerName(ctx, id), side: inn.batting,
    values: {
      how: b.out ? dismissalText(b, ctx) : b.retiredHurt ? "retired hurt" : "not out",
      runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, sr: strikeRate(b.runs, b.balls),
    } as Record<string, StatValue>,
  }));
  return { key: `bat-${inn.n}`, title: `${sideName(ctx, inn.batting)} batting (${ordinal(inn.n)} innings)`, columns, rows };
}

function dismissalText(b: Bat, ctx: MatchContext): string {
  const bowler = b.by ? playerName(ctx, b.by) : "";
  const fielder = b.fielder ? playerName(ctx, b.fielder) : "";
  switch (b.how) {
    case "bowled": return `b ${bowler}`;
    case "lbw": return `lbw b ${bowler}`;
    case "caught": return fielder && b.fielder !== b.by ? `c ${fielder} b ${bowler}` : `c & b ${bowler}`;
    case "stumped": return `st ${fielder} b ${bowler}`.replace("  ", " ");
    case "hit_wicket": return `hit wicket b ${bowler}`;
    case "run_out": return fielder ? `run out (${fielder})` : "run out";
    default: return (b.how ?? "out").replace(/_/g, " ");
  }
}

function bowlingTable(inn: CricketInnings, ctx: MatchContext, rules: CricketRules): StatTable {
  const columns: StatColumn[] = [
    { key: "overs", label: "O", kind: "raw", format: "text" }, { key: "maidens", label: "M", kind: "raw" },
    { key: "runs", label: "R", kind: "raw" }, { key: "wickets", label: "W", kind: "raw" },
    { key: "wides", label: "Wd", kind: "raw" }, { key: "noBalls", label: "Nb", kind: "raw" },
    { key: "econ", label: "Econ", kind: "derived", format: "dec2" },
    { key: "avg", label: "Avg", kind: "derived", format: "dec2" },
    { key: "sr", label: "SR", kind: "derived", format: "dec1" },
  ];
  const rows = Object.entries(inn.bowlers).map(([id, b]) => ({
    id, name: playerName(ctx, id), side: otherSide(inn.batting),
    values: {
      overs: oversText(b.balls, rules.ballsPerOver), maidens: b.maidens, runs: b.runs, wickets: b.wickets, wides: b.wides, noBalls: b.noBalls,
      econ: round(runRate(b.runs, b.balls, rules.ballsPerOver), 2),
      avg: round(ratio(b.runs, b.wickets), 2),
      sr: round(ratio(b.balls, b.wickets), 1),
    } as Record<string, StatValue>,
  }));
  return { key: `bowl-${inn.n}`, title: `${sideName(ctx, otherSide(inn.batting))} bowling (${ordinal(inn.n)} innings)`, columns, rows };
}

function phaseTable(inn: CricketInnings, ctx: MatchContext, rules: CricketRules): StatTable | null {
  if (!rules.phases.length) return null;
  return {
    key: `phases-${inn.n}`, title: `${sideName(ctx, inn.batting)} by phase (${ordinal(inn.n)} innings)`,
    columns: [
      { key: "overs", label: "Overs", kind: "raw", format: "text" }, { key: "runs", label: "Runs", kind: "raw" },
      { key: "wickets", label: "Wickets", kind: "raw" }, { key: "rr", label: "Run rate", kind: "derived", format: "dec2" },
    ],
    rows: rules.phases.map((ph) => {
      const overs = inn.overs.filter((o) => o.n >= ph.from && o.n <= ph.to);
      const runs = overs.reduce((t, o) => t + o.runs, 0), balls = overs.reduce((t, o) => t + o.legal, 0);
      return { id: ph.name, name: ph.name, side: inn.batting, values: { overs: `${ph.from}-${ph.to}`, runs, wickets: overs.reduce((t, o) => t + o.wickets, 0), rr: round(runRate(runs, balls, rules.ballsPerOver), 2) } };
    }),
  };
}

const CAREER_RAW: StatColumn[] = [
  { key: "matches", label: "Matches", kind: "raw" }, { key: "batInnings", label: "Innings", kind: "raw" },
  { key: "notOuts", label: "Not outs", kind: "raw" }, { key: "batRuns", label: "Runs", kind: "raw" },
  { key: "batBalls", label: "Balls faced", kind: "raw" }, { key: "fours", label: "4s", kind: "raw" }, { key: "sixes", label: "6s", kind: "raw" },
  { key: "wickets", label: "Wickets", kind: "raw" }, { key: "bowlRuns", label: "Runs conceded", kind: "raw" },
  { key: "maidens", label: "Maidens", kind: "raw" }, { key: "catches", label: "Catches", kind: "raw" },
  { key: "runOuts", label: "Run outs", kind: "raw" }, { key: "stumpings", label: "Stumpings", kind: "raw" },
];
const CAREER_DERIVED: StatColumn[] = [
  { key: "batAvg", label: "Batting average", kind: "derived", format: "dec2" },
  { key: "batSr", label: "Strike rate", kind: "derived", format: "dec2" },
  { key: "bowlAvg", label: "Bowling average", kind: "derived", format: "dec2" },
  { key: "econ", label: "Economy", kind: "derived", format: "dec2" },
  { key: "bowlSr", label: "Bowling strike rate", kind: "derived", format: "dec1" },
];

export const cricketEngine: SportIntelligenceEngine<CricketRules, CricketState> = {
  sport: "cricket",
  label: "Cricket",
  eventTypes: ["TOSS", "INNINGS_START", "DELIVERY", "NEW_BATTER", "RETIRE", "PENALTY_RUNS", "DECLARE", "INNINGS_END", "TARGET_REVISED"],

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, CRICKET_KNOWLEDGE); },
  rulesGuide: (rules) => CRICKET_KNOWLEDGE.guide(rules),

  resolveRules(input) {
    const preset = (input && typeof input === "object" ? (input as { preset?: unknown }).preset : undefined) ?? "t20";
    if (typeof preset !== "string" || !(preset in CRICKET_PRESETS)) throw new RulesError("preset must be t20, odi, test or custom");
    const r = mergeRules(CRICKET_PRESETS[preset as CricketRules["preset"]], input);
    if (r.oversPerInnings !== null && !isPosInt(r.oversPerInnings)) throw new RulesError("oversPerInnings must be empty or a positive whole number");
    if (r.inningsPerSide !== 1 && r.inningsPerSide !== 2) throw new RulesError("inningsPerSide must be 1 or 2");
    if (!isPosInt(r.ballsPerOver) || r.ballsPerOver > 9) throw new RulesError("ballsPerOver must be between 1 and 9");
    if (!isPosInt(r.wicketsPerInnings)) throw new RulesError("wicketsPerInnings must be a positive whole number");
    if (r.maxOversPerBowler !== null && !isPosInt(r.maxOversPerBowler)) throw new RulesError("maxOversPerBowler must be empty or a positive whole number");
    if (!isNonNegInt(r.wideRuns) || !isNonNegInt(r.noBallRuns)) throw new RulesError("wide and no-ball runs cannot be negative");
    if (r.followOnLead !== null && !isPosInt(r.followOnLead)) throw new RulesError("followOnLead must be empty or a positive whole number");
    if (!Array.isArray(r.phases) || r.phases.some((p) => !p || typeof p.name !== "string" || !isPosInt(p.from) || !isPosInt(p.to) || p.to < p.from)) throw new RulesError("phases must be named over ranges");
    return r;
  },

  initializeMatch() {
    return { toss: null, innings: [], carry: { a: 0, b: 0 }, result: null, log: [] };
  },

  validateEvent(s, ev, ctx, rules) {
    const p = ev.payload;
    const inn = open(s);
    if (s.result && ev.type !== "PENALTY_RUNS") return "The match is already decided";

    switch (ev.type) {
      case "TOSS":
        if (s.innings.length) return "The toss comes before the first innings";
        if (!isSide(p.winner)) return "Say which side won the toss";
        return p.decision === "bat" || p.decision === "bowl" ? null : "The toss decision is bat or bowl";

      case "INNINGS_START": {
        if (inn) return "The current innings is still in progress";
        if (!isSide(p.batting)) return "Say which side is batting";
        const followOn = p.followOn === true;
        if (followOn) {
          if (s.innings.length !== 2 || rules.inningsPerSide !== 2) return "A follow-on can only be enforced after each side's first innings";
          if (rules.followOnLead === null) return "This format has no follow-on";
          const lead = s.innings[0].runs - s.innings[1].runs;
          if (lead < rules.followOnLead) return `A lead of ${rules.followOnLead} is needed to enforce the follow-on (the lead is ${lead})`;
        }
        const expected = expectedBatting(s, rules, followOn);
        if (expected === null) return "All innings have been played";
        if (expected !== "any" && expected !== p.batting) return `${sideName(ctx, expected)} bats this innings`;
        if (typeof p.striker !== "string" || typeof p.nonStriker !== "string") return "Name the two opening batters";
        if (p.striker === p.nonStriker) return "The two opening batters must be different players";
        if (sideOfPlayer(ctx, p.striker) !== p.batting || sideOfPlayer(ctx, p.nonStriker) !== p.batting) return "Both batters must be in the batting side";
        return null;
      }

      case "DELIVERY": {
        if (!inn) return "Start an innings before bowling";
        if (!inn.striker || !inn.nonStriker) return "A new batter must come in before the next ball";
        if (typeof p.striker !== "string" || typeof p.nonStriker !== "string") return "Name the striker and the non-striker";
        const atCrease = new Set([inn.striker, inn.nonStriker]);
        if (p.striker === p.nonStriker || !atCrease.has(p.striker) || !atCrease.has(p.nonStriker)) return "The striker and non-striker must be the two batters at the crease";
        if (typeof p.bowler !== "string" || sideOfPlayer(ctx, p.bowler) !== otherSide(inn.batting)) return "The bowler must be in the fielding side";

        const over = currentOver(inn, rules);
        if (over) {
          if (p.bowler !== over.bowler && p.bowlerChange !== true) return "The bowler cannot change during an over";
        } else {
          if (inn.lastOverBowler === p.bowler) return "A bowler cannot bowl two overs in a row";
          const done = inn.bowlers[p.bowler]?.balls ?? 0;
          if (rules.maxOversPerBowler !== null && done >= rules.maxOversPerBowler * rules.ballsPerOver) return `${playerName(ctx, p.bowler)} has bowled the maximum ${rules.maxOversPerBowler} overs`;
        }

        const extra = p.extra ?? null;
        if (extra !== null && !(EXTRAS as readonly unknown[]).includes(extra)) return "Unknown extra";
        const runsBat = p.runsBat ?? 0, extraRuns = p.extraRuns ?? 0;
        if (!isNonNegInt(runsBat) || !isNonNegInt(extraRuns)) return "Runs must be whole numbers";
        if (runsBat > 8 || extraRuns > 8) return "That is more runs than one ball can produce";
        if (extra === "wide" && runsBat !== 0) return "There are no runs off the bat on a wide";
        if ((extra === "bye" || extra === "leg_bye") && (runsBat !== 0 || extraRuns < 1)) return "Byes and leg-byes need at least one run and none off the bat";
        if (extra === null && extraRuns !== 0) return "Extra runs need an extra type";
        if (extra === "no_ball" && runsBat > 0 && extraRuns > 0) return "A no-ball scores off the bat or as byes, not both";

        if (p.wicket != null) {
          const w = p.wicket as Record<string, unknown>;
          if (typeof w !== "object" || typeof w.type !== "string" || !(WICKETS as readonly string[]).includes(w.type)) return "Unknown dismissal";
          if (extra === "wide" && !ON_WIDE.has(w.type)) return `A batter cannot be out ${w.type.replace(/_/g, " ")} off a wide`;
          if (extra === "no_ball" && !ON_NO_BALL.has(w.type)) return `A batter cannot be out ${w.type.replace(/_/g, " ")} off a no-ball`;
          if (inn.freeHit && extra !== "wide" && !ON_NO_BALL.has(w.type)) return `A batter cannot be out ${w.type.replace(/_/g, " ")} on a free hit`;
          const out = w.player ?? p.striker;
          if (typeof out !== "string" || !atCrease.has(out)) return "The batter out must be one of the two at the crease";
          if (STRIKER_ONLY.has(w.type) && out !== p.striker) return "Only the striker can be out that way";
          if (w.fielder != null && (typeof w.fielder !== "string" || sideOfPlayer(ctx, w.fielder) !== otherSide(inn.batting))) return "The fielder must be in the fielding side";
          if (BOWLER_WICKETS.has(w.type) && (runsBat !== 0 || (extraRuns !== 0 && extra !== "wide"))) return "No runs are scored on that dismissal";
        }
        return null;
      }

      case "NEW_BATTER": {
        if (!inn) return "There is no innings in progress";
        if (inn.striker && inn.nonStriker) return "Both batters are already at the crease";
        if (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== inn.batting) return "The new batter must be in the batting side";
        if (inn.striker === p.player || inn.nonStriker === p.player) return "That batter is already at the crease";
        if (inn.batters[p.player]?.out) return "That batter is already out";
        return null;
      }

      case "RETIRE": {
        if (!inn) return "There is no innings in progress";
        if (typeof p.player !== "string" || (inn.striker !== p.player && inn.nonStriker !== p.player)) return "Only a batter at the crease can retire";
        return (RETIRE_KINDS as readonly unknown[]).includes(p.kind) ? null : "Say whether the batter retired hurt, retired out or was timed out";
      }

      case "PENALTY_RUNS":
        if (!isSide(p.side)) return "Say which side is awarded the runs";
        if (s.result) return "The match is already decided";
        return isPosInt(p.runs) ? null : "Penalty runs must be a positive whole number";

      case "DECLARE":
        if (!inn) return "There is no innings in progress";
        return rules.allowDeclaration ? null : "Declarations are not allowed in this format";

      case "INNINGS_END":
        return inn ? null : "There is no innings in progress";

      case "TARGET_REVISED":
        if (!inn || inn.target === null) return "A target can only be revised during the chase";
        if (!isPosInt(p.target)) return "The revised target must be a positive whole number";
        if (p.maxOvers != null && !isPosInt(p.maxOvers)) return "The revised overs must be a positive whole number";
        return null;
    }
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;

    switch (ev.type) {
      case "TOSS":
        s.toss = { winner: p.winner as Side, decision: p.decision as "bat" | "bowl" };
        return s;

      case "INNINGS_START": {
        const batting = p.batting as Side;
        const striker = p.striker as string, nonStriker = p.nonStriker as string;
        const inn: CricketInnings = {
          n: s.innings.length + 1, batting, runs: s.carry[batting], wickets: 0, balls: 0,
          extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: s.carry[batting] },
          batters: { [striker]: newBat(1), [nonStriker]: newBat(2) }, bowlers: {}, fielding: {},
          striker, nonStriker, bowler: null, lastOverBowler: null, overs: [], fow: [], partnerships: [],
          stand: { wicket: 1, runs: 0, balls: 0, batters: [striker, nonStriker] },
          closed: null, target: chaseTarget(s, rules, batting),
          maxBalls: rules.oversPerInnings === null ? null : rules.oversPerInnings * rules.ballsPerOver,
          freeHit: false, followOn: p.followOn === true,
        };
        s.carry[batting] = 0;
        s.innings.push(inn);
        s.log.push({ seq: ev.seq, text: `${ordinal(inn.n)} innings: ${sideName(ctx, batting)} batting${inn.followOn ? " (follow-on)" : ""}${inn.target !== null ? `, target ${inn.target}` : ""}` });
        return s;
      }

      case "NEW_BATTER": {
        const inn = open(s)!;
        const id = p.player as string;
        const existing = inn.batters[id];
        if (existing) existing.retiredHurt = false; // a retired hurt batter resumes their innings
        else inn.batters[id] = newBat(Object.keys(inn.batters).length + 1);
        const wantsNonStriker = p.position === "non_striker";
        if (!inn.striker && !(wantsNonStriker && !inn.nonStriker)) inn.striker = id; else inn.nonStriker = id;
        if (!inn.stand.batters.includes(id)) inn.stand.batters = [inn.striker, inn.nonStriker].filter((x): x is string => !!x);
        return s;
      }

      case "RETIRE": {
        const inn = open(s)!;
        const id = p.player as string;
        if (p.kind === "hurt") {
          inn.batters[id].retiredHurt = true;
          if (inn.striker === id) inn.striker = null; else inn.nonStriker = null;
        } else {
          recordWicket(inn, id, p.kind === "timed_out" ? "timed_out" : "retired_out", null, null);
        }
        checkClose(s, ctx, rules, ev.seq);
        return s;
      }

      case "PENALTY_RUNS": {
        const side = p.side as Side, runs = p.runs as number;
        const target = [...s.innings].reverse().find((i) => i.batting === side);
        if (!target) { s.carry[side] += runs; return s; }
        target.runs += runs; target.extras.penalty += runs;
        const live = open(s);
        // runs given to the side that batted first move the chasing side's target
        if (live && live !== target && live.target !== null) live.target += runs;
        checkClose(s, ctx, rules, ev.seq);
        return s;
      }

      case "DECLARE":
      case "INNINGS_END": {
        const inn = open(s)!;
        inn.closed = ev.type === "DECLARE" ? "declared" : "ended";
        closeStand(inn);
        inn.striker = null; inn.nonStriker = null;
        s.log.push({ seq: ev.seq, text: `${ordinal(inn.n)} innings ${ev.type === "DECLARE" ? "declared" : "ended"}: ${sideName(ctx, inn.batting)} ${inn.runs}/${inn.wickets}` });
        evaluate(s, ctx, rules, ev.seq);
        return s;
      }

      case "TARGET_REVISED": {
        const inn = open(s)!;
        inn.target = p.target as number;
        if (isPosInt(p.maxOvers)) inn.maxBalls = p.maxOvers * rules.ballsPerOver;
        s.log.push({ seq: ev.seq, text: `Target revised to ${inn.target}${isPosInt(p.maxOvers) ? ` from ${p.maxOvers} overs` : ""}` });
        checkClose(s, ctx, rules, ev.seq);
        return s;
      }
    }

    // DELIVERY
    const inn = open(s)!;
    const striker = p.striker as string, nonStriker = p.nonStriker as string, bowlerId = p.bowler as string;
    const extra = (p.extra ?? null) as (typeof EXTRAS)[number] | null;
    const runsBat = (p.runsBat as number | undefined) ?? 0;
    const extraRuns = (p.extraRuns as number | undefined) ?? 0;
    const wicket = (p.wicket ?? null) as { type: string; player?: string; fielder?: string } | null;

    inn.striker = striker; inn.nonStriker = nonStriker;

    let over = currentOver(inn, rules);
    if (!over) {
      over = { n: inn.overs.length + 1, bowler: bowlerId, runs: 0, bowlerRuns: 0, wickets: 0, legal: 0, balls: [] };
      inn.overs.push(over);
    }
    over.bowler = bowlerId;
    inn.bowler = bowlerId;
    const bowl = (inn.bowlers[bowlerId] ??= { balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0 });
    const bat = inn.batters[striker];

    const legal = !((extra === "wide" && rules.wideRebowled) || (extra === "no_ball" && rules.noBallRebowled));
    let team = runsBat, conceded = runsBat;

    if (extra === "wide") {
      const w = rules.wideRuns + extraRuns;
      team += w; conceded += w; inn.extras.wides += w; bowl.wides += 1;
    } else if (extra === "no_ball") {
      team += rules.noBallRuns + extraRuns; conceded += rules.noBallRuns;
      inn.extras.noBalls += rules.noBallRuns; inn.extras.byes += extraRuns; bowl.noBalls += 1;
    } else if (extra === "bye") { team += extraRuns; inn.extras.byes += extraRuns; }
    else if (extra === "leg_bye") { team += extraRuns; inn.extras.legByes += extraRuns; }

    // the batter faces every ball except a wide
    if (extra !== "wide") {
      bat.balls += 1; bat.runs += runsBat;
      const boundary = p.boundary !== false;
      if (runsBat === 4 && boundary) bat.fours += 1;
      if (runsBat === 6 && boundary) bat.sixes += 1;
    }

    inn.runs += team; bowl.runs += conceded;
    over.runs += team; over.bowlerRuns += conceded;
    inn.stand.runs += team;
    if (legal) { inn.balls += 1; bowl.balls += 1; over.legal += 1; inn.stand.balls += 1; }

    const tag = extra === "wide" ? `${team}wd` : extra === "no_ball" ? `${team}nb` : extra === "bye" ? `${extraRuns}b` : extra === "leg_bye" ? `${extraRuns}lb` : String(runsBat);
    over.balls.push(wicket ? (team ? `${tag}+W` : "W") : tag);

    if (wicket) {
      const out = wicket.player ?? striker;
      const fielder = wicket.fielder ?? null;
      const credited = BOWLER_WICKETS.has(wicket.type);
      recordWicket(inn, out, wicket.type, credited ? bowlerId : null, fielder);
      over.wickets += 1;
      if (credited) bowl.wickets += 1;
      const catcher = wicket.type === "caught" ? fielder ?? bowlerId : fielder;
      if (catcher) {
        const key = wicket.type === "caught" ? "catches" : wicket.type === "run_out" ? "runOuts" : wicket.type === "stumped" ? "stumpings" : null;
        if (key) add((inn.fielding[catcher] ??= {}), key);
      }
    }

    // Batters cross on an odd number of runs actually run.
    const ran = extra === "wide" ? extraRuns : ((runsBat === 4 || runsBat === 6) && p.boundary !== false ? 0 : runsBat) + extraRuns;
    if (ran % 2 === 1) { const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t; }

    inn.freeHit = rules.freeHit && (extra === "no_ball" || (inn.freeHit && extra === "wide"));

    if (over.legal >= rules.ballsPerOver) {
      if (over.bowlerRuns === 0) bowl.maidens += 1;
      inn.lastOverBowler = bowlerId; inn.bowler = null;
      const t = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = t;
      s.log.push({ seq: ev.seq, text: `End of over ${over.n}: ${sideName(ctx, inn.batting)} ${inn.runs}/${inn.wickets}` });
    }

    checkClose(s, ctx, rules, ev.seq);
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    for (const inn of s.innings) {
      const fromBat = Object.values(inn.batters).reduce((t, b) => t + b.runs, 0);
      const ex = inn.extras;
      if (fromBat + ex.wides + ex.noBalls + ex.byes + ex.legByes + ex.penalty !== inn.runs) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Innings ${inn.n}: batters' runs plus extras do not add up to the total` });
      if (inn.overs.reduce((t, o) => t + o.legal, 0) !== inn.balls) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Innings ${inn.n}: the overs do not add up to the balls bowled` });
      if (inn.overs.some((o) => o.legal > rules.ballsPerOver)) issues.push({ severity: "error", code: "INVALID_DELIVERY", message: `Innings ${inn.n}: an over has more than ${rules.ballsPerOver} legal balls` });
      if (inn.wickets > rules.wicketsPerInnings) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Innings ${inn.n}: more wickets than the format allows` });
      if (inn.maxBalls !== null && inn.balls > inn.maxBalls) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Innings ${inn.n}: more overs than the format allows` });
      if (Object.values(inn.bowlers).reduce((t, b) => t + b.balls, 0) !== inn.balls) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: `Innings ${inn.n}: the bowlers' overs do not add up` });
    }
    return issues;
  },

  getCurrentState(s, ctx, rules) {
    const line = (side: Side) => {
      const mine = s.innings.filter((i) => i.batting === side);
      return mine.length ? mine.map((i) => `${i.runs}/${i.wickets}${i.closed === "declared" ? "d" : ""}`).join(" & ") : "";
    };
    const sub = (side: Side) => {
      const last = [...s.innings].reverse().find((i) => i.batting === side);
      return last ? `(${oversText(last.balls, rules.ballsPerOver)} ov)` : "Yet to bat";
    };
    const inn = cur(s);
    const view: ScoreView = {
      kind: "versus",
      score: { a: line("a"), b: line("b") },
      subScore: { a: sub("a"), b: sub("b") },
      periodLabel: s.result ? "Final" : !inn ? "Not started" : inn.closed ? "Innings break" : `${ordinal(inn.n)} innings`,
      brief: s.result ? (s.result.outcome === "tie" ? "Match tied" : `${sideName(ctx, s.result.winner!)} won ${s.result.margin}`)
        : !inn ? ""
        : [`${oversText(inn.balls, rules.ballsPerOver)} ov`, ...chaseLines(s, rules).slice(1).map((l) => l.replace("Required: ", "need "))].join(" · "),
      serving: inn && !inn.closed ? inn.batting : null,
      periods: s.innings.map((i) => ({ label: `Inn ${i.n}`, a: i.batting === "a" ? `${i.runs}/${i.wickets}` : "", b: i.batting === "b" ? `${i.runs}/${i.wickets}` : "" })),
      notes: [],
    };
    if (inn && !inn.closed) {
      const over = currentOver(inn, rules);
      if (inn.striker) view.notes.push(`${playerName(ctx, inn.striker)} ${inn.batters[inn.striker].runs}* (${inn.batters[inn.striker].balls})${inn.nonStriker ? `, ${playerName(ctx, inn.nonStriker)} ${inn.batters[inn.nonStriker].runs} (${inn.batters[inn.nonStriker].balls})` : ""}`);
      if (over) view.notes.push(`This over: ${over.balls.join(" ")}`);
      if (inn.freeHit) view.notes.push("Free hit");
    }
    view.notes.push(...chaseLines(s, rules));
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const inn = cur(s);
    if (!inn) return ["Match not started"];
    const lines = [`${sideName(ctx, inn.batting)} ${inn.runs}/${inn.wickets}`, `${oversText(inn.balls, rules.ballsPerOver)} overs`];
    lines.push(...chaseLines(s, rules));
    if (s.result) lines.push(s.result.outcome === "tie" ? "Match tied" : `${sideName(ctx, s.result.winner!)} won ${s.result.margin}`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx, rules) {
    return s.innings.flatMap((inn) => [battingTable(inn, ctx), bowlingTable(inn, ctx, rules)]);
  },

  calculateTeamStatistics(s, ctx, rules) {
    const columns: StatColumn[] = [
      { key: "runs", label: "Runs", kind: "raw" }, { key: "wickets", label: "Wickets", kind: "raw" },
      { key: "overs", label: "Overs", kind: "raw", format: "text" },
      { key: "fours", label: "Fours", kind: "raw" }, { key: "sixes", label: "Sixes", kind: "raw" },
      { key: "extras", label: "Extras", kind: "raw" }, { key: "wides", label: "Wides", kind: "raw" },
      { key: "noBalls", label: "No-balls", kind: "raw" }, { key: "byes", label: "Byes", kind: "raw" },
      { key: "legByes", label: "Leg-byes", kind: "raw" }, { key: "penalty", label: "Penalty runs", kind: "raw" },
      { key: "rr", label: "Run rate", kind: "derived", format: "dec2" },
    ];
    const rows = s.innings.map((inn) => {
      const bats = Object.values(inn.batters), ex = inn.extras;
      return {
        id: `inn-${inn.n}`, name: `${sideName(ctx, inn.batting)} (${ordinal(inn.n)} innings)`, side: inn.batting,
        values: {
          runs: inn.runs, wickets: inn.wickets, overs: oversText(inn.balls, rules.ballsPerOver),
          fours: bats.reduce((t, b) => t + b.fours, 0), sixes: bats.reduce((t, b) => t + b.sixes, 0),
          extras: ex.wides + ex.noBalls + ex.byes + ex.legByes + ex.penalty, wides: ex.wides, noBalls: ex.noBalls, byes: ex.byes, legByes: ex.legByes, penalty: ex.penalty,
          rr: round(runRate(inn.runs, inn.balls, rules.ballsPerOver), 2),
        } as Record<string, StatValue>,
      };
    });
    return [{ key: "innings", title: "Innings", columns, rows }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      const norm = 6 / rules.ballsPerOver; // career economy is per six-ball over
      for (const side of SIDES) {
        const batted = s.innings.filter((i) => i.batting === side), bowled = s.innings.filter((i) => i.batting !== side);
        lines.push({
          subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: {
            matches: 1, wins: s.result?.winner === side ? 1 : 0,
            runs: batted.reduce((t, i) => t + i.runs, 0), wicketsLost: batted.reduce((t, i) => t + i.wickets, 0), ballsFaced: batted.reduce((t, i) => t + i.balls, 0) * norm,
            runsConceded: bowled.reduce((t, i) => t + i.runs, 0), wicketsTaken: bowled.reduce((t, i) => t + i.wickets, 0), ballsBowled: bowled.reduce((t, i) => t + i.balls, 0) * norm,
          },
        });
        for (const pl of ctx.sides[side].players) {
          const raw: Record<string, number> = { matches: 1 };
          for (const inn of batted) {
            const b = inn.batters[pl.id];
            if (!b) continue;
            add(raw, "batInnings"); add(raw, "batRuns", b.runs); add(raw, "batBalls", b.balls); add(raw, "fours", b.fours); add(raw, "sixes", b.sixes);
            add(raw, b.out ? "dismissals" : "notOuts");
          }
          for (const inn of bowled) {
            const b = inn.bowlers[pl.id];
            if (b) { add(raw, "bowlBalls", b.balls * norm); add(raw, "bowlRuns", b.runs); add(raw, "wickets", b.wickets); add(raw, "maidens", b.maidens); add(raw, "wides", b.wides); add(raw, "noBalls", b.noBalls); }
            const f = inn.fielding[pl.id];
            if (f) for (const [k, v] of Object.entries(f)) add(raw, k, v);
          }
          lines.push({ subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null, raw });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx, rules) {
    const inn = cur(s);
    const cards: Analytics["cards"] = [];
    if (inn) {
      const crr = round(runRate(inn.runs, inn.balls, rules.ballsPerOver), 2);
      cards.push({ label: "Current run rate", value: crr === null ? "n/a" : crr.toFixed(2) });
      const chase = chaseNumbers(s, rules);
      if (chase) {
        cards.push({ label: "Target", value: String(chase.target) });
        cards.push({ label: "Required run rate", value: chase.rrr === null ? "n/a" : chase.rrr.toFixed(2), hint: chase.ballsLeft === null ? "No overs limit" : `${chase.need} from ${chase.ballsLeft} balls` });
      }
      if (!inn.closed) cards.push({ label: "Partnership", value: `${inn.stand.runs} (${inn.stand.balls})` });
    }
    const maxOvers = Math.max(0, ...s.innings.map((i) => i.overs.length));
    const labels = Array.from({ length: maxOvers }, (_, i) => String(i + 1));
    const name = (i: CricketInnings) => `${sideName(ctx, i.batting)}${rules.inningsPerSide > 1 ? ` (${ordinal(i.n)})` : ""}`;
    const tables: StatTable[] = [];
    for (const i of s.innings) {
      tables.push({
        key: `partnerships-${i.n}`, title: `${name(i)} partnerships`,
        columns: [{ key: "batters", label: "Batters", kind: "raw", format: "text" }, { key: "runs", label: "Runs", kind: "raw" }, { key: "balls", label: "Balls", kind: "raw" }],
        rows: [...i.partnerships, ...(i.closed ? [] : [i.stand])].filter((st) => st.batters.length).map((st) => ({
          id: `${i.n}-${st.wicket}`, name: `${ordinal(st.wicket)} wicket`, side: i.batting,
          values: { batters: st.batters.map((b) => playerName(ctx, b)).join(" and "), runs: st.runs, balls: st.balls },
        })),
      });
      tables.push({
        key: `fow-${i.n}`, title: `${name(i)} fall of wickets`,
        columns: [{ key: "score", label: "Score", kind: "raw", format: "text" }, { key: "over", label: "Over", kind: "raw", format: "text" }],
        rows: i.fow.map((f) => ({ id: `${i.n}-${f.wicket}`, name: playerName(ctx, f.player), side: i.batting, values: { score: `${f.runs}/${f.wicket}`, over: oversText(f.balls, rules.ballsPerOver) } })),
      });
      const ph = phaseTable(i, ctx, rules);
      if (ph) tables.push(ph);
    }
    return {
      cards,
      charts: [
        { key: "worm", title: "Run progression", type: "line", labels: ["0", ...labels],
          series: s.innings.map((i) => { let t = 0; return { name: name(i), side: i.batting, values: [0, ...labels.map((_, k) => (i.overs[k] ? (t += i.overs[k].runs) : null))] }; }), format: "int" },
        { key: "manhattan", title: "Runs per over", type: "bar", labels,
          series: s.innings.map((i) => ({ name: name(i), side: i.batting, values: labels.map((_, k) => i.overs[k]?.runs ?? null) })), format: "int" },
        { key: "run-rate", title: "Run rate after each over", type: "line", labels,
          series: s.innings.map((i) => { let r = 0, b = 0; return { name: name(i), side: i.batting, values: labels.map((_, k) => { const o = i.overs[k]; if (!o) return null; r += o.runs; b += o.legal; return round(runRate(r, b, rules.ballsPerOver), 2); }) }; }), format: "dec1" },
      ],
      tables,
    };
  },

  validateMatchCompletion(s, _ctx, rules) {
    if (s.result) return null;
    if (rules.allowDraw && s.innings.length > 0) return null;
    return "The match is not decided. Finish the innings, or abandon the match if it cannot be completed";
  },

  finalizeMatch(s): MatchResult {
    return s.result ?? { outcome: "draw", winner: null, method: "played", margin: null };
  },

  mirrorScore(s, _ctx, rules) {
    const last = (side: Side) => [...s.innings].reverse().find((i) => i.batting === side) ?? null;
    const a = last("a"), b = last("b");
    const ov = (i: CricketInnings | null) => (i ? Number(oversText(i.balls, rules.ballsPerOver)) : null);
    return {
      scoreA: total(s, "a"), scoreB: total(s, "b"),
      cricket: { wicketsA: a?.wickets ?? null, wicketsB: b?.wickets ?? null, oversA: ov(a), oversB: ov(b), target: cur(s)?.target ?? null },
    };
  },

  deriveStats(subject, raw) {
    const n = (k: string) => raw[k] ?? 0;
    if (subject === "team") {
      return {
        columns: [
          { key: "matches", label: "Matches", kind: "raw" }, { key: "wins", label: "Wins", kind: "raw" },
          { key: "runs", label: "Runs", kind: "raw" }, { key: "wicketsLost", label: "Wickets lost", kind: "raw" },
          { key: "runsConceded", label: "Runs conceded", kind: "raw" }, { key: "wicketsTaken", label: "Wickets taken", kind: "raw" },
          { key: "runRate", label: "Run rate", kind: "derived", format: "dec2" }, { key: "economy", label: "Economy", kind: "derived", format: "dec2" },
        ],
        values: { ...raw, runRate: round(runRate(n("runs"), n("ballsFaced")), 2), economy: round(runRate(n("runsConceded"), n("ballsBowled")), 2) },
      };
    }
    return {
      columns: [...CAREER_RAW, ...CAREER_DERIVED],
      values: {
        ...raw,
        // an average needs at least one dismissal; all not-outs has no average
        batAvg: round(ratio(n("batRuns"), raw.dismissals), 2),
        batSr: strikeRate(n("batRuns"), n("batBalls")),
        bowlAvg: round(ratio(n("bowlRuns"), raw.wickets), 2),
        econ: round(runRate(n("bowlRuns"), n("bowlBalls")), 2),
        bowlSr: round(ratio(n("bowlBalls"), raw.wickets), 1),
      },
    };
  },

  derivedLog: (s) => s.log,

  eventLabel: (s, ev, rules) => cricketBallLabel(s, ev, rules),

  describeEvent(ev, ctx) {
    const p = ev.payload;
    switch (ev.type) {
      case "TOSS": return `${isSide(p.winner) ? sideName(ctx, p.winner) : ""} won the toss and chose to ${String(p.decision)}`;
      case "INNINGS_START": return `${isSide(p.batting) ? sideName(ctx, p.batting) : ""} innings started`;
      case "NEW_BATTER": return `${playerName(ctx, str(p.player))} comes in`;
      case "RETIRE": return `${playerName(ctx, str(p.player))} ${p.kind === "hurt" ? "retired hurt" : p.kind === "timed_out" ? "timed out" : "retired out"}`;
      case "PENALTY_RUNS": return `${String(p.runs)} penalty runs to ${isSide(p.side) ? sideName(ctx, p.side) : ""}`;
      case "DECLARE": return "Innings declared";
      case "INNINGS_END": return "Innings ended";
      case "TARGET_REVISED": return `Target revised to ${String(p.target)}`;
      default: {
        const extra = str(p.extra);
        const runs = (typeof p.runsBat === "number" ? p.runsBat : 0) + (typeof p.extraRuns === "number" ? p.extraRuns : 0);
        const w = p.wicket as { type?: string; player?: string } | null | undefined;
        const what = w?.type ? `OUT, ${w.type.replace(/_/g, " ")}` : extra ? `${extra.replace(/_/g, " ")}${runs ? ` + ${runs}` : ""}` : runs === 0 ? "no run" : `${runs} run${runs === 1 ? "" : "s"}`;
        const note = str(p.commentary);
        return `${playerName(ctx, str(p.bowler))} to ${playerName(ctx, str(p.striker))}: ${what}${note ? `. ${note}` : ""}`;
      }
    }
  },
};

/** "over.ball" of the delivery about to be bowled, e.g. "1st innings 17.4". */
export function cricketBallLabel(s: CricketState, ev: EngineEvent, rules: CricketRules): string | null {
  if (ev.type !== "DELIVERY") return null;
  const inn = open(s);
  if (!inn) return null;
  return `${ordinal(inn.n)} innings ${Math.floor(inn.balls / rules.ballsPerOver)}.${(inn.balls % rules.ballsPerOver) + 1}`;
}

function chaseNumbers(s: CricketState, rules: CricketRules): { target: number; need: number; ballsLeft: number | null; rrr: number | null } | null {
  const inn = cur(s);
  if (!inn || inn.target === null) return null;
  const need = Math.max(0, inn.target - inn.runs);
  const ballsLeft = inn.maxBalls === null ? null : Math.max(0, inn.maxBalls - inn.balls);
  return { target: inn.target, need, ballsLeft, rrr: ballsLeft === null ? null : round(runRate(need, ballsLeft, rules.ballsPerOver), 2) };
}

function chaseLines(s: CricketState, rules: CricketRules): string[] {
  const c = chaseNumbers(s, rules);
  const inn = cur(s);
  if (!c || !inn || inn.closed) return c ? [`Target: ${c.target}`] : [];
  return [`Target: ${c.target}`, c.ballsLeft === null ? `Required: ${c.need} runs` : `Required: ${c.need} runs from ${c.ballsLeft} balls`];
}

export function playersAvailableToBat(s: CricketState, ctx: MatchContext): string[] {
  const inn = open(s);
  if (!inn) return [];
  return playersOf(ctx, inn.batting).map((p) => p.id).filter((id) => !inn.batters[id]?.out && id !== inn.striker && id !== inn.nonStriker);
}
