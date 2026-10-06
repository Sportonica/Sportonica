// Basketball: events -> game state -> player and team statistics ->
// analytics. Competition rules live in ./basketball/rules.ts (FIBA, NBA,
// NCAA and custom presets); this file never assumes one competition.
// Spec: docs/sports-intelligence/05-basketball.md.
//
// A derived figure is only reported when the data behind it was really
// recorded: shooting percentages need misses, possessions need misses,
// rebounds and turnovers, minutes need lineups and a clock on every
// substitution, plus/minus and on-court ratings need both lineups before
// the first possession, clutch figures need a clock on every event late
// in the game. Otherwise the figure is null ("n/a"), never 0.
//
// Possessions are counted from play-by-play, not from the score: a team
// starts a possession the first time it acts with the ball (a shot, free
// throw, offensive rebound, turnover) or wins it (defensive rebound,
// steal, jump ball, held ball). An offensive rebound continues the same
// possession (the standard definition; it is counted as a second
// chance). The box-score estimate is reported alongside, labelled as one.

import {
  SIDES, isSide, otherSide,
  type Analytics, type AnalyticsCard, type Chart, type EngineEvent, type Issue, type MatchContext, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatRow, type StatTable, type StatValue,
} from "../core/types";
import { add, formatClock, isNonNegInt, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";
import {
  BASKETBALL_RULE_CHOICES, EVENT_ALIASES, FOUL_KINDS, OFFENSIVE_VIOLATIONS, PAINT_ZONES, SHOT_TYPES, SHOT_ZONES, THREE_POINT_ZONES, VIOLATIONS,
  bonusThreshold, foulKindName, foulWindow, isOvertime, label, periodName, periodSeconds, resolveBasketballRules, timeoutPool,
  type BasketballRules, type FoulKind, type ShotType, type ShotZone, type Violation,
} from "./basketball/rules";
import { answerBasketballQuestion, type GameFacts } from "./basketball/knowledge";

export type { BasketballRules } from "./basketball/rules";
export { periodName } from "./basketball/rules";

// a run is reported once it reaches this many unanswered points
const RUN_ALERT = 8;
const PLAY_EVENTS = new Set(["SHOT_MADE", "SHOT_MISSED", "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL", "JUMP_BALL", "HELD_BALL", "VIOLATION", "OUT_OF_BOUNDS", "GOALTENDING"]);
// events a player takes part in: they must be on the team, still eligible, and on court when lineups are known
const PLAYER_EVENTS = new Set(["SHOT_MADE", "SHOT_MISSED", "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL", "VIOLATION", "OUT_OF_BOUNDS", "GOALTENDING"]);
const CLUTCH_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov"];

interface ScoreEntry { seq: number; side: Side; pts: number; period: number; clock: number | null; a: number; b: number }

export type PossessionStart = "jump_ball" | "held_ball" | "rebound" | "turnover" | "score" | "other";
export type PossessionResult = "score" | "turnover" | "miss" | "held_ball" | "period_end" | "other";

export interface Possession {
  side: Side;
  period: number;
  startSeq: number;
  endSeq: number | null;
  startClock: number | null;
  endClock: number | null;
  points: number;
  start: PossessionStart;
  result: PossessionResult | null;
  // offensive rebounds inside this possession (second chances)
  oreb: number;
  // not seen in the events but certain from the rules: the side scored, so the
  // opponent had the ball before the side acted with it again
  inferred?: boolean;
}

export interface ShotRecord {
  seq: number;
  side: Side;
  player: string | null;
  points: number;
  made: boolean;
  zone: ShotZone | null;
  shotType: ShotType | null;
  x: number | null;
  y: number | null;
  period: number;
  clock: number | null;
  assisted: boolean;
  fastBreak: boolean;
  /** a missed shot on which the shooter was fouled: not a field goal attempt */
  fouled?: boolean;
  /** counted in the clutch figures */
  clutch?: boolean;
}

/** Free throws awarded by one foul, taken one attempt at a time. */
export interface FreeThrowSet {
  side: Side;
  /** the fouled player, who must shoot; null: any player (a technical) */
  player: string | null;
  total: number;
  taken: number;
  made: number;
  technical: boolean;
  /** NCAA one-and-one: the second shot only if the first goes in */
  oneAndOne: boolean;
  reason: string;
}

/** Why something happened, worked out from the event that caused it. */
export interface Explanation {
  seq: number;
  kind: "score" | "no_score" | "foul" | "possession" | "violation";
  side: Side | null;
  points: number;
  text: string;
}

export interface BasketballState {
  period: number;
  periodOpen: boolean;
  /** seconds left in the period, as last sent by the scorer */
  clock: number | null;
  score: Record<Side, number>;
  byPeriod: Record<Side, number[]>;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  /** players who may not return: fouled out or disqualified */
  out: Record<string, "fouled_out" | "disqualified">;
  /** the players dressed for this game, when chosen (null: the whole team roster) */
  gameRoster: Record<Side, string[] | null>;
  onCourt: Record<Side, string[] | null>;
  starters: Record<Side, string[] | null>;
  /** team fouls per foul window ("P3", "H2", "OT1") */
  teamFouls: Record<Side, Record<string, number>>;
  /** timeouts used per pool ("H1", "G", "OT1") */
  timeoutsUsed: Record<Side, Record<string, number>>;
  /** substitutions made in the game (absent in states saved before it was counted) */
  subsUsed?: Record<Side, number>;
  /** sides whose game was entered as a box score after the fact, not play by play */
  boxScore?: Record<Side, boolean>;
  /** a box score left out shot attempts: percentages cannot be calculated */
  attemptsUnknown?: boolean;
  /** who has the ball right now, when the events say so (null: loose or unknown) */
  ball: Side | null;
  /** alternating-possession arrow: the side that gets the next held ball */
  arrow: Side | null;
  /** whose possession is being counted */
  owner: Side | null;
  /** how the counted possession is ending, set by the event that ends it */
  ending: PossessionResult | null;
  possessions: Possession[];
  shots: ShotRecord[];
  scoring: ScoreEntry[];
  run: { side: Side | null; points: number };
  /** false once a basket was scored without both lineups known */
  plusMinusValid: boolean;
  /** false once a substitution was recorded without a clock */
  minutesValid: boolean;
  /** false once a possession started without both lineups known */
  ratingsValid: boolean;
  clutch: { team: Record<Side, Record<string, number>>; players: Record<string, Record<string, number>>; seen: boolean; unknown: boolean };
  officials: string[];
  /** free throws still to be taken, in order (technicals first) */
  freeThrows: FreeThrowSet[];
  /** a foul's free throws were just completed: another one needs a new foul (until play moves on) */
  freeThrowsDone: string | null;
  /** the highest the shot clock may show now: it only runs down within a possession unless a rule resets it (null: unknown) */
  shotClockCap: number | null;
  /** after a violation or the ball going out: who was given the ball, until they act with it */
  dead: { to: Side; reason: string } | null;
  /** why recent things happened, newest last (the last 40) */
  recent: Explanation[];
  lastSeq: number;
  log: { seq: number; text: string }[];
}

const lineupsKnown = (s: BasketballState): boolean => !!s.onCourt.a && !!s.onCourt.b;

/** The players dressed for the game: the chosen game roster, or the whole team roster. */
export function gameRosterOf(s: BasketballState, ctx: MatchContext, side: Side): string[] {
  return s.gameRoster[side] ?? playersOf(ctx, side).map((p) => p.id);
}

/** Players who may still play: dressed, not fouled out or disqualified. */
export function eligibleOf(s: BasketballState, ctx: MatchContext, side: Side): string[] {
  return gameRosterOf(s, ctx, side).filter((id) => !s.out[id]);
}

/** The bench: dressed and eligible but not on court (null while lineups are unknown). */
export function benchOf(s: BasketballState, ctx: MatchContext, side: Side): string[] | null {
  const court = s.onCourt[side];
  return court ? eligibleOf(s, ctx, side).filter((id) => !court.includes(id)) : null;
}

/** A lineup is the players on court, or every eligible player once fouls leave fewer. */
const lineupSize = (s: BasketballState, ctx: MatchContext, side: Side, rules: BasketballRules): number =>
  Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length);
const n0 = (raw: Record<string, number> | undefined, k: string): number => raw?.[k] ?? 0;

/** Misses are known: the competition records them, and no box score left them out. */
const tracksShots = (s: BasketballState, rules: BasketballRules): boolean => rules.trackShotAttempts && !s.attemptsUnknown;
const openPossession = (s: BasketballState): Possession | null => {
  const p = s.possessions[s.possessions.length - 1];
  return p && p.endSeq === null ? p : null;
};
const evClock = (ev: EngineEvent): number | null => (isNonNegInt(ev.payload.clock) ? ev.payload.clock : null);

// Credit elapsed clock time to everyone on court.
function runClock(s: BasketballState, to: number): void {
  if (s.clock === null) return;
  const elapsed = s.clock - to;
  if (elapsed > 0) for (const side of SIDES) for (const id of s.onCourt[side] ?? []) add((s.players[id] ??= {}), "secs", elapsed);
  s.clock = to;
}

function credit(s: BasketballState, side: Side, player: string | null, key: string, n: number, clutch: boolean): void {
  add(s.team[side], key, n);
  if (player) add((s.players[player] ??= {}), key, n);
  if (clutch && CLUTCH_KEYS.includes(key)) {
    add(s.clutch.team[side], key, n);
    if (player) add((s.clutch.players[player] ??= {}), key, n);
  }
}

// ── possessions ─────────────────────────────────────────────────────

const START_AFTER: Record<PossessionResult, PossessionStart> = {
  score: "score", turnover: "turnover", miss: "rebound", held_ball: "held_ball", period_end: "other", other: "other",
};

function closePossession(s: BasketballState, ev: EngineEvent, result: PossessionResult): void {
  const p = openPossession(s);
  if (!p) return;
  p.endSeq = ev.seq;
  p.endClock = evClock(ev) ?? s.clock;
  p.result = result;
}

function creditOnCourt(s: BasketballState, side: Side): void {
  if (!lineupsKnown(s)) s.ratingsValid = false;
  else for (const x of SIDES) for (const id of s.onCourt[x]!) add((s.players[id] ??= {}), x === side ? "offPoss" : "defPoss");
}

/**
 * `side` scored and is now acting with the ball again with nothing
 * recorded for the opponent: after a made basket the opponent inbounds,
 * so it had a possession, ended by `result` (a steal says how; otherwise unknown).
 */
function inferOpponentPossession(s: BasketballState, side: Side, ev: EngineEvent, result: PossessionResult): void {
  closePossession(s, ev, "score");
  const opp = otherSide(side);
  s.possessions.push({ side: opp, period: s.period, startSeq: ev.seq, endSeq: ev.seq, startClock: null, endClock: null, points: 0, start: "score", result, oreb: 0, inferred: true });
  creditOnCourt(s, opp);
  s.owner = opp;
  s.ending = result;
}

/**
 * `side` now has the ball in a counted possession; a no-op if it already
 * had. `infer`: the event is a shot or turnover, which `side` cannot make
 * straight after its own score (free throws can: an and-one).
 */
function gainPossession(s: BasketballState, side: Side, ev: EngineEvent, start?: PossessionStart, infer = false): void {
  if (s.owner === side && openPossession(s)) {
    if (!(infer && s.ending === "score")) return;
    inferOpponentPossession(s, side, ev, "other");
  }
  const reason = start ?? (s.ending ? START_AFTER[s.ending] : "other");
  closePossession(s, ev, s.ending ?? "other");
  s.possessions.push({ side, period: s.period, startSeq: ev.seq, endSeq: null, startClock: evClock(ev) ?? s.clock, endClock: null, points: 0, start: reason, result: null, oreb: 0 });
  s.owner = side;
  s.ending = null;
  creditOnCourt(s, side);
}

// ── scoring ─────────────────────────────────────────────────────────

function addPoints(s: BasketballState, ev: EngineEvent, side: Side, player: string | null, pts: number, clutch: boolean, ctx: MatchContext, inPossession: boolean): void {
  s.score[side] += pts;
  const arr = s.byPeriod[side];
  arr[s.period - 1] = (arr[s.period - 1] ?? 0) + pts;
  credit(s, side, player, "pts", pts, clutch);
  if (!lineupsKnown(s)) s.plusMinusValid = false;
  else for (const x of SIDES) for (const id of s.onCourt[x]!) {
    const pl = (s.players[id] ??= {});
    add(pl, x === side ? "onFor" : "onAgainst", pts);
    add(pl, "plusMinus", x === side ? pts : -pts);
    if (clutch) add((s.clutch.players[id] ??= {}), "plusMinus", x === side ? pts : -pts);
  }
  if (player && s.starters[side] && !s.starters[side]!.includes(player)) add(s.team[side], "benchPts", pts);

  const poss = openPossession(s);
  if (inPossession && poss && poss.side === side) {
    poss.points += pts;
    if (poss.oreb > 0) add(s.team[side], "secondChancePts", pts);
    if (poss.start === "turnover") add(s.team[side], "ptsOffTov", pts);
  }

  s.scoring.push({ seq: ev.seq, side, pts, period: s.period, clock: evClock(ev), a: s.score.a, b: s.score.b });

  // momentum: say so when a run reaches RUN_ALERT, and when it ends
  if (s.run.side === side) {
    const before = s.run.points;
    s.run.points += pts;
    if (before < RUN_ALERT && s.run.points >= RUN_ALERT) s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)} on a ${s.run.points}-0 run` });
  } else {
    if (s.run.side && s.run.points >= RUN_ALERT) s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)} end ${sideName(ctx, s.run.side)}'s ${s.run.points}-0 run` });
    s.run = { side, points: pts };
  }
}

// ── analytics over the scoring log ──────────────────────────────────

export function leadStats(scoring: ScoreEntry[]): { leadChanges: number; timesTied: number; largestLead: Record<Side, number> } {
  let leader: Side | null = null, leadChanges = 0, timesTied = 0;
  const largestLead: Record<Side, number> = { a: 0, b: 0 };
  for (const e of scoring) {
    const diff = e.a - e.b;
    if (diff === 0) { timesTied += 1; continue; }
    const now: Side = diff > 0 ? "a" : "b";
    if (leader && leader !== now) leadChanges += 1;
    leader = now;
    if (Math.abs(diff) > largestLead[now]) largestLead[now] = Math.abs(diff);
  }
  return { leadChanges, timesTied, largestLead };
}

/** The largest deficit each side overcame to take the lead. */
export function comebacks(scoring: ScoreEntry[]): Record<Side, number> {
  const out: Record<Side, number> = { a: 0, b: 0 };
  const worst: Record<Side, number> = { a: 0, b: 0 };
  for (const e of scoring) {
    for (const side of SIDES) {
      const margin = side === "a" ? e.a - e.b : e.b - e.a;
      if (margin < 0) worst[side] = Math.max(worst[side], -margin);
      else if (margin > 0 && worst[side] > 0) { out[side] = Math.max(out[side], worst[side]); worst[side] = 0; }
    }
  }
  return out;
}

export interface ScoringRun { side: Side; points: number; period: number; startSeq: number; endSeq: number; seconds: number | null }

/** Runs of unanswered points. `seconds` when both ends carry a clock in the same period. */
export function scoringRunsOf(scoring: ScoreEntry[], min: number): ScoringRun[] {
  const out: ScoringRun[] = [];
  let cur: { side: Side; points: number; first: ScoreEntry; last: ScoreEntry } | null = null;
  const flush = () => {
    if (!cur || cur.points < min) return;
    const { first, last } = cur;
    const seconds = first.period === last.period && first.clock !== null && last.clock !== null ? first.clock - last.clock : null;
    out.push({ side: cur.side, points: cur.points, period: first.period, startSeq: first.seq, endSeq: last.seq, seconds });
  };
  for (const e of scoring) {
    if (cur && e.side === cur.side) { cur.points += e.pts; cur.last = e; }
    else { flush(); cur = { side: e.side, points: e.pts, first: e, last: e }; }
  }
  flush();
  return out;
}

/** Longest stretch of game clock without a score, per side; null where clocks are missing. */
export function droughts(s: BasketballState, rules: BasketballRules): Record<Side, { seconds: number; period: number } | null> {
  const out: Record<Side, { seconds: number; period: number } | null> = { a: null, b: null };
  for (let period = 1; period <= s.period; period++) {
    const entries = s.scoring.filter((e) => e.period === period);
    if (entries.some((e) => e.clock === null)) continue; // not measurable
    const closed = period < s.period || !s.periodOpen;
    const end = closed ? 0 : s.clock;
    if (end === null) continue;
    for (const side of SIDES) {
      let from = periodSeconds(period, rules);
      const marks = [...entries.filter((e) => e.side === side).map((e) => e.clock as number), end];
      for (const at of marks) {
        const gap = from - at;
        if (gap > 0 && (!out[side] || gap > out[side]!.seconds)) out[side] = { seconds: gap, period };
        from = at;
      }
    }
  }
  return out;
}

/** The standard box-score estimate. Reported only next to the counted figure, and labelled. */
export const possessions = (raw: Record<string, number>): number =>
  n0(raw, "fga") + 0.44 * n0(raw, "fta") - n0(raw, "oreb") + n0(raw, "tov");

// ── statistics ──────────────────────────────────────────────────────

const col = (key: string, lbl: string, kind: "raw" | "derived" = "raw", format?: StatColumn["format"]): StatColumn => ({ key, label: lbl, kind, ...(format ? { format } : {}) });

const BOX_RAW: StatColumn[] = [
  col("pts", "PTS"), col("fgm", "FGM"), col("fga", "FGA"), col("tpm", "3PM"), col("tpa", "3PA"), col("ftm", "FTM"), col("fta", "FTA"),
  col("oreb", "OREB"), col("dreb", "DREB"), col("reb", "REB"), col("ast", "AST"), col("stl", "STL"), col("blk", "BLK"), col("tov", "TOV"), col("pf", "PF"),
];

const withReb = (raw: Record<string, number>): Record<string, number> => ({ ...raw, reb: n0(raw, "oreb") + n0(raw, "dreb") });
const made = (raw: Record<string, number>, m: string, a: string): string => `${n0(raw, m)}-${n0(raw, a)}`;

/** Shooting figures; null unless misses were being tracked. */
function shooting(raw: Record<string, number>, tracked: boolean): Record<string, StatValue> {
  return {
    fgPct: tracked ? round(pct(raw.fgm ?? 0, raw.fga), 1) : null,
    tpPct: tracked ? round(pct(raw.tpm ?? 0, raw.tpa), 1) : null,
    ftPct: tracked ? round(pct(raw.ftm ?? 0, raw.fta), 1) : null,
    efgPct: tracked ? round(pct(n0(raw, "fgm") + 0.5 * n0(raw, "tpm"), raw.fga), 1) : null,
    tsPct: tracked ? round(pct(n0(raw, "pts"), 2 * (n0(raw, "fga") + 0.44 * n0(raw, "fta"))), 1) : null,
    astTov: round(ratio(raw.ast ?? 0, raw.tov), 2),
  };
}

/** FIBA / NBA efficiency: PTS + REB + AST + STL + BLK - missed FG - missed FT - TOV. Needs misses. */
const efficiency = (raw: Record<string, number>, tracked: boolean): number | null => tracked
  ? n0(raw, "pts") + n0(raw, "oreb") + n0(raw, "dreb") + n0(raw, "ast") + n0(raw, "stl") + n0(raw, "blk")
    - (n0(raw, "fga") - n0(raw, "fgm")) - (n0(raw, "fta") - n0(raw, "ftm")) - n0(raw, "tov")
  : null;

const isDouble = (raw: Record<string, number>, need: number): boolean =>
  ["pts", "reb", "ast", "stl", "blk"].filter((k) => (k === "reb" ? n0(raw, "oreb") + n0(raw, "dreb") : n0(raw, k)) >= 10).length >= need;

/** Seconds of game played so far, from the period lengths: needs a clock only for a period still running. */
function secondsPlayed(s: BasketballState, rules: BasketballRules): number | null {
  let total = 0;
  for (let p = 1; p <= s.period; p++) total += periodSeconds(p, rules);
  if (s.periodOpen) {
    if (s.clock === null) return null;
    total -= s.clock;
  }
  return total;
}

interface TeamFigures {
  poss: number | null;
  oppPoss: number | null;
  secs: number | null;
}

function teamFigures(s: BasketballState, side: Side, rules: BasketballRules): TeamFigures {
  const counted = tracksShots(s, rules);
  return {
    poss: counted ? s.possessions.filter((p) => p.side === side).length : null,
    oppPoss: counted ? s.possessions.filter((p) => p.side !== side).length : null,
    secs: secondsPlayed(s, rules),
  };
}

function teamDerived(own: Record<string, number>, opp: Record<string, number>, f: TeamFigures, rules: BasketballRules, periodsPlayed: number): Record<string, StatValue> {
  const tracked = rules.trackShotAttempts;
  const poss = f.poss !== null && f.poss > 0 ? f.poss : null;
  const oppPoss = f.oppPoss !== null && f.oppPoss > 0 ? f.oppPoss : null;
  const off = poss ? (100 * n0(own, "pts")) / poss : null;
  const def = oppPoss ? (100 * n0(opp, "pts")) / oppPoss : null;
  const regulationSecs = rules.periods * rules.periodMinutes * 60;
  return {
    ...shooting(own, tracked),
    possessions: poss,
    possEst: tracked ? round(possessions(own), 1) : null,
    ppp: poss ? round(n0(own, "pts") / poss, 2) : null,
    oppPpp: oppPoss ? round(n0(opp, "pts") / oppPoss, 2) : null,
    offRating: round(off, 1),
    defRating: round(def, 1),
    netRating: off !== null && def !== null ? round(off - def, 1) : null,
    pace: poss && oppPoss && f.secs ? round(((poss + oppPoss) / 2) * (regulationSecs / f.secs), 1) : null,
    tovRate: poss ? round(pct(n0(own, "tov"), poss), 1) : null,
    orebPct: round(pct(n0(own, "oreb"), n0(own, "oreb") + n0(opp, "dreb")), 1),
    drebPct: round(pct(n0(own, "dreb"), n0(own, "dreb") + n0(opp, "oreb")), 1),
    trbPct: round(pct(n0(own, "oreb") + n0(own, "dreb"), n0(own, "oreb") + n0(own, "dreb") + n0(opp, "oreb") + n0(opp, "dreb")), 1),
    oppFgPct: tracked ? round(pct(n0(opp, "fgm"), opp.fga), 1) : null,
    oppTpPct: tracked ? round(pct(n0(opp, "tpm"), opp.tpa), 1) : null,
    oppTov: n0(opp, "tov"),
    ptsPerPeriod: round(ratio(n0(own, "pts"), periodsPlayed), 1),
  };
}

const TEAM_COLUMNS: StatColumn[] = [
  col("pts", "PTS"), col("fg", "FG", "raw", "text"), col("fgPct", "FG%", "derived", "pct"), col("tp", "3P", "raw", "text"), col("tpPct", "3P%", "derived", "pct"),
  col("ft", "FT", "raw", "text"), col("ftPct", "FT%", "derived", "pct"), col("oreb", "OREB"), col("dreb", "DREB"), col("reb", "REB"),
  col("ast", "AST"), col("tov", "TOV"), col("astTov", "AST/TOV", "derived", "dec2"), col("stl", "STL"), col("blk", "BLK"), col("pf", "PF"),
  col("paintPts", "Points in the paint"), col("fastBreakPts", "Fast break points"), col("secondChancePts", "Second chance points", "derived"),
  col("ptsOffTov", "Points off turnovers", "derived"), col("benchPts", "Bench points"), col("largestLead", "Largest lead", "derived"),
  col("oppFgPct", "Opponent FG%", "derived", "pct"), col("oppTpPct", "Opponent 3P%", "derived", "pct"), col("oppTov", "Opponent turnovers"),
];

const TEAM_ADVANCED: StatColumn[] = [
  col("possessions", "Possessions", "derived"), col("possEst", "Possessions (box-score estimate)", "derived", "dec1"), col("pace", "Pace", "derived", "dec1"),
  col("ppp", "Points per possession", "derived", "dec2"), col("oppPpp", "Opponent points per possession", "derived", "dec2"),
  col("offRating", "Offensive rating", "derived", "dec1"), col("defRating", "Defensive rating", "derived", "dec1"), col("netRating", "Net rating", "derived", "dec1"),
  col("efgPct", "eFG%", "derived", "pct"), col("tsPct", "TS%", "derived", "pct"), col("tovRate", "Turnover rate %", "derived", "pct"),
  col("orebPct", "Offensive rebound %", "derived", "pct"), col("drebPct", "Defensive rebound %", "derived", "pct"), col("trbPct", "Total rebound %", "derived", "pct"),
  col("ptsPerPeriod", "Points per period", "derived", "dec1"),
];

// ── the engine ──────────────────────────────────────────────────────

function playerStatus(s: BasketballState, id: string): string {
  return s.out[id] === "fouled_out" ? "Fouled out" : s.out[id] === "disqualified" ? "Disqualified" : "";
}

function playerRows(s: BasketballState, ctx: MatchContext, rules: BasketballRules): StatRow[] {
  const tracked = tracksShots(s, rules);
  const minutesOk = s.minutesValid && lineupsKnown(s);
  const ratingsOk = s.ratingsValid && lineupsKnown(s) && tracked;
  const teamSecs: Record<Side, number> = { a: 0, b: 0 };
  for (const side of SIDES) for (const pl of playersOf(ctx, side)) teamSecs[side] += n0(s.players[pl.id], "secs");

  return SIDES.flatMap((side) => playersOf(ctx, side).filter((pl) => gameRosterOf(s, ctx, side).includes(pl.id)).map((pl) => {
    const raw = withReb(s.players[pl.id] ?? {});
    const tm = withReb(s.team[side]), opp = withReb(s.team[otherSide(side)]);
    const secs = minutesOk ? n0(raw, "secs") : null;
    const min = secs !== null ? secs / 60 : null;
    const share = secs && teamSecs[side] ? teamSecs[side] / rules.playersOnCourt / secs : null; // team minutes / 5 over player minutes
    const offR = ratingsOk ? ratio(100 * n0(raw, "onFor"), raw.offPoss) : null;
    const defR = ratingsOk ? ratio(100 * n0(raw, "onAgainst"), raw.defPoss) : null;
    const plusMinus = s.plusMinusValid && lineupsKnown(s) ? n0(raw, "plusMinus") : null;
    return {
      id: pl.id, name: pl.number != null ? `${pl.number} ${pl.name}` : pl.name, side,
      values: {
        ...Object.fromEntries(BOX_RAW.map((c) => [c.key, n0(raw, c.key)])),
        ...shooting(raw, tracked),
        fg: made(raw, "fgm", "fga"), tp: made(raw, "tpm", "tpa"), ft: made(raw, "ftm", "fta"),
        min: round(min, 1),
        plusMinus,
        ptsPerMin: round(ratio(n0(raw, "pts"), min), 2),
        rebPerMin: round(ratio(n0(raw, "reb"), min), 2),
        pmPer10: plusMinus !== null && min ? round((10 * plusMinus) / min, 1) : null,
        eff: efficiency(raw, tracked),
        usgPct: tracked && share !== null ? round(pct((n0(raw, "fga") + 0.44 * n0(raw, "fta") + n0(raw, "tov")) * share, n0(tm, "fga") + 0.44 * n0(tm, "fta") + n0(tm, "tov")), 1) : null,
        astPct: share !== null ? round(pct(n0(raw, "ast"), n0(tm, "fgm") / share - n0(raw, "fgm")), 1) : null,
        tovPct: tracked ? round(pct(n0(raw, "tov"), n0(raw, "fga") + 0.44 * n0(raw, "fta") + n0(raw, "tov")), 1) : null,
        rebPct: share !== null ? round(pct(n0(raw, "reb") * share, n0(tm, "reb") + n0(opp, "reb")), 1) : null,
        offRating: round(offR, 1), defRating: round(defR, 1), netRating: offR !== null && defR !== null ? round(offR - defR, 1) : null,
        foulsShooting: n0(raw, "foulsShooting"), foulsOffensive: n0(raw, "foulsOffensive"), techs: n0(raw, "techs"),
        unsportsmanlike: n0(raw, "unsportsmanlike"), pfd: n0(raw, "pfd"), status: playerStatus(s, pl.id),
      } as Record<string, StatValue>,
    };
  }));
}

function teamValues(s: BasketballState, ctx: MatchContext, rules: BasketballRules, side: Side): Record<string, StatValue> {
  const own = withReb(s.team[side]), opp = withReb(s.team[otherSide(side)]);
  const lead = leadStats(s.scoring);
  const counted = tracksShots(s, rules);
  return {
    ...Object.fromEntries(BOX_RAW.map((c) => [c.key, n0(own, c.key)])),
    fg: made(own, "fgm", "fga"), tp: made(own, "tpm", "tpa"), ft: made(own, "ftm", "fta"),
    paintPts: n0(own, "paintPts"), fastBreakPts: n0(own, "fastBreakPts"),
    secondChancePts: counted ? n0(own, "secondChancePts") : null,
    ptsOffTov: counted ? n0(own, "ptsOffTov") : null,
    benchPts: s.starters[side] ? n0(own, "benchPts") : null,
    largestLead: lead.largestLead[side],
    timeouts: n0(own, "timeouts"),
    ...teamDerived(own, opp, teamFigures(s, side, rules), { ...rules, trackShotAttempts: tracksShots(s, rules) }, s.period),
  };
}

/** The period team fouls and timeouts are read for: the one in play, or between periods the next one to be played. */
function currentPeriod(s: BasketballState, rules: BasketballRules): number {
  if (s.periodOpen) return s.period;
  if (s.period === 0) return 1;
  const more = s.period < rules.periods || (s.score.a === s.score.b && !rules.allowTie);
  return more ? s.period + 1 : s.period;
}

export function teamFoulsNow(s: BasketballState, side: Side, rules: BasketballRules): number {
  return s.teamFouls[side][foulWindow(currentPeriod(s, rules), rules)] ?? 0;
}

/** Whether `side` shoots free throws on the opponent's next common foul. */
export function bonusFor(s: BasketballState, side: Side, rules: BasketballRules): "double" | "bonus" | null {
  const committed = teamFoulsNow(s, otherSide(side), rules);
  if (rules.doubleBonusAfterFouls !== null && committed >= rules.doubleBonusAfterFouls) return "double";
  return committed >= bonusThreshold(currentPeriod(s, rules), rules) ? "bonus" : null;
}

export function timeoutsLeft(s: BasketballState, side: Side, rules: BasketballRules): number {
  const pool = timeoutPool(currentPeriod(s, rules), rules);
  return Math.max(0, pool.allowance - (s.timeoutsUsed[side][pool.key] ?? 0));
}

/** Substitutions a side may still make, or null when they are unlimited. */
export function substitutionsLeft(s: BasketballState, side: Side, rules: BasketballRules): number | null {
  const limit = rules.substitutionsPerGame ?? null;
  return limit === null ? null : Math.max(0, limit - (s.subsUsed?.[side] ?? 0));
}

function periodLabel(s: BasketballState, rules: BasketballRules): string {
  if (isBoxScore(s)) return "Box score";
  if (s.period === 0) return "Not started";
  if (s.periodOpen) return `${periodName(s.period, rules)}${s.clock !== null ? `, ${formatClock(s.clock)} remaining` : ""}`;
  if (s.period === rules.periods && s.score.a === s.score.b && !rules.allowTie) return "End of regulation";
  if (rules.periods % 2 === 0 && s.period === rules.periods / 2) return "Halftime";
  return `End of ${periodName(s.period, rules)}`;
}

function gameFacts(s: BasketballState, ctx: MatchContext, rules: BasketballRules): GameFacts {
  const rows = playerRows(s, ctx, rules);
  const lead = leadStats(s.scoring);
  return {
    teams: SIDES.map((side) => ({ side, name: sideName(ctx, side), score: s.score[side], byPeriod: s.byPeriod[side].map((v) => v ?? 0), values: teamValues(s, ctx, rules, side), timeoutsLeft: timeoutsLeft(s, side, rules), teamFouls: teamFoulsNow(s, side, rules), bonus: bonusFor(s, side, rules) })),
    players: rows.map((r) => ({ id: r.id, name: playerName(ctx, r.id), number: playersOf(ctx, r.side!).find((p) => p.id === r.id)?.number ?? null, side: r.side!, values: r.values, onCourt: !!s.onCourt[r.side!]?.includes(r.id) })),
    periodNames: Array.from({ length: Math.max(s.period, rules.periods) }, (_, i) => periodName(i + 1, rules)),
    period: s.period, periodOpen: s.periodOpen, clock: s.clock, periodLabel: periodLabel(s, rules), overtime: isOvertime(s.period, rules), regulationPeriods: rules.periods,
    leadChanges: lead.leadChanges, timesTied: lead.timesTied, largestLead: lead.largestLead,
    runs: scoringRunsOf(s.scoring, 1).map((r) => ({ side: r.side, points: r.points, period: periodName(r.period, rules) })),
    possessionsTracked: tracksShots(s, rules),
    possessions: { a: s.possessions.filter((p) => p.side === "a").length, b: s.possessions.filter((p) => p.side === "b").length },
    ball: s.ball, foulLimit: rules.foulLimit, trackShotAttempts: tracksShots(s, rules),
    plusMinusValid: s.plusMinusValid && lineupsKnown(s),
    rules, recent: s.recent,
    freeThrowDue: s.freeThrows[0] ? freeThrowLabel(s.freeThrows[0], ctx) : null,
  };
}

export const basketballEngine: SportIntelligenceEngine<BasketballRules, BasketballState> = {
  sport: "basketball",
  label: "Basketball",
  eventTypes: [
    "BOX_SCORE", "PERIOD_START", "PERIOD_END", "PERIOD_REOPEN", "LINEUP", "SUBSTITUTION", "SHOT_MADE", "SHOT_MISSED",
    "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL", "TIMEOUT",
    "JUMP_BALL", "HELD_BALL", "ARROW", "OFFICIALS", "ROSTER", "VIOLATION", "OUT_OF_BOUNDS", "GOALTENDING",
    ...Object.keys(EVENT_ALIASES),
  ],
  ruleChoices: BASKETBALL_RULE_CHOICES,

  resolveRules: resolveBasketballRules,

  initializeMatch() {
    return {
      period: 0, periodOpen: false, clock: null, score: { a: 0, b: 0 }, byPeriod: { a: [], b: [] },
      team: { a: {}, b: {} }, players: {}, out: {}, gameRoster: { a: null, b: null }, onCourt: { a: null, b: null }, starters: { a: null, b: null },
      teamFouls: { a: {}, b: {} }, timeoutsUsed: { a: {}, b: {} }, subsUsed: { a: 0, b: 0 },
      ball: null, arrow: null, owner: null, ending: null, possessions: [], shots: [], scoring: [], run: { side: null, points: 0 },
      plusMinusValid: true, minutesValid: true, ratingsValid: true,
      clutch: { team: { a: {}, b: {} }, players: {}, seen: false, unknown: false },
      officials: [], freeThrows: [], freeThrowsDone: null, shotClockCap: null, dead: null, recent: [], lastSeq: 0, log: [],
    };
  },

  validateEvent: validateRules,

  updateScore: updateRules,

  validateScore(s, ctx, rules) {
    const issues: Issue[] = [];
    const bad = (message: string) => issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message });
    for (const side of SIDES) {
      const sum = s.byPeriod[side].reduce((t, v) => t + (v ?? 0), 0);
      if (sum !== s.score[side]) bad("Period scores do not add up to the total");
      const t = s.team[side];
      const fromShots = (n0(t, "fgm") - n0(t, "tpm")) * rules.twoPointValue + n0(t, "tpm") * rules.threePointValue + n0(t, "ftm") * rules.freeThrowValue
        + n0(t, "unattributedPts");
      if (fromShots !== s.score[side]) bad("The score does not match the baskets recorded");
      if (n0(t, "fgm") > n0(t, "fga") || n0(t, "tpm") > n0(t, "tpa") || n0(t, "ftm") > n0(t, "fta")) bad("More shots made than attempted");
      // a player's share can never exceed the team's
      for (const key of ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf"]) {
        const players = playersOf(ctx, side).reduce((x, pl) => x + n0(s.players[pl.id], key), 0);
        if (players > n0(t, key)) bad(`${sideName(ctx, side)}: players' ${key} add up to more than the team's`);
      }
      const possPts = s.possessions.filter((x) => x.side === side).reduce((x, q) => x + q.points, 0);
      if (possPts > s.score[side]) bad("Points in possessions exceed the score");
      for (const v of Object.values(t)) if (v < 0) bad("A statistic is negative");
    }
    const last = s.scoring[s.scoring.length - 1];
    if (last && (last.a !== s.score.a || last.b !== s.score.b)) bad("The scoring log does not end on the score");
    return issues;
  },

  getCurrentState(s, ctx, rules) {
    const label = periodLabel(s, rules);
    const notes: string[] = [];
    if (!s.periodOpen && s.period >= rules.periods && s.score.a === s.score.b && !rules.allowTie) notes.push("Scores level: overtime to follow");
    const trouble = SIDES.flatMap((side) => (s.onCourt[side] ?? playersOf(ctx, side).map((x) => x.id))
      .filter((id) => !s.out[id] && n0(s.players[id], "pf") >= rules.foulLimit - 1)
      .map((id) => `${playerName(ctx, id)} (${n0(s.players[id], "pf")})`));
    if (trouble.length) notes.push(`Foul trouble: ${trouble.join(", ")}`);
    const gone = Object.entries(s.out).map(([id, why]) => `${playerName(ctx, id)} ${why === "fouled_out" ? "fouled out" : "disqualified"}`);
    if (gone.length) notes.push(gone.join(", "));
    if (rules.alternatingPossession && s.arrow) notes.push(`Possession arrow: ${sideName(ctx, s.arrow)}`);
    if (s.freeThrows[0]) notes.push(`Free throws: ${freeThrowLabel(s.freeThrows[0], ctx)}${s.freeThrows.length > 1 ? `, then ${s.freeThrows.length - 1} more set${s.freeThrows.length > 2 ? "s" : ""}` : ""}`);
    for (const side of SIDES) {
      const n = eligibleOf(s, ctx, side).length;
      if (n < rules.playersOnCourt) notes.push(`${sideName(ctx, side)} has only ${n} eligible player${n === 1 ? "" : "s"}`);
      const listed = gameRosterOf(s, ctx, side).length;
      if (s.period === 0 && listed > rules.gameRosterSize) notes.push(`${sideName(ctx, side)}: choose ${rules.gameRosterSize} of ${listed} registered players for this game`);
    }

    const bonusText = (side: Side) => { const b = bonusFor(s, side, rules); return b === "double" ? "Double bonus" : b ? "Bonus" : "No"; };
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.score.a), b: String(s.score.b) },
      subScore: null,
      periodLabel: label,
      brief: Array.from({ length: s.period }, (_, i) => `${s.byPeriod.a[i] ?? 0}-${s.byPeriod.b[i] ?? 0}`).join(", "),
      serving: null,
      possession: s.periodOpen ? s.ball : null,
      facts: s.period === 0 && !s.periodOpen ? [] : [
        { label: "Team fouls", a: String(teamFoulsNow(s, "a", rules)), b: String(teamFoulsNow(s, "b", rules)) },
        { label: "Bonus", a: bonusText("a"), b: bonusText("b") },
        { label: "Timeouts left", a: String(timeoutsLeft(s, "a", rules)), b: String(timeoutsLeft(s, "b", rules)) },
      ],
      periods: Array.from({ length: s.period }, (_, i) => ({ label: periodName(i + 1, rules), a: String(s.byPeriod.a[i] ?? 0), b: String(s.byPeriod.b[i] ?? 0) })),
      notes,
    };
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const lines = [`${sideName(ctx, "a")} ${s.score.a} - ${sideName(ctx, "b")} ${s.score.b}`, periodLabel(s, rules)];
    const top = SIDES.map((side) => playersOf(ctx, side).reduce<{ id: string; pts: number } | null>((m, pl) => {
      const pts = n0(s.players[pl.id], "pts");
      return pts > 0 && (!m || pts > m.pts) ? { id: pl.id, pts } : m;
    }, null)).filter((x): x is { id: string; pts: number } => !!x);
    if (top.length) lines.push(`Top scorers: ${top.map((t) => `${playerName(ctx, t.id)} ${t.pts}`).join(", ")}`);
    if (s.officials.length) lines.push(`Officials: ${s.officials.join(", ")}`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx, rules) {
    const rows = playerRows(s, ctx, rules);
    return [
      {
        key: "box", title: "Box score",
        columns: [col("min", "MIN", "derived", "dec1"), col("pts", "PTS"), col("reb", "REB"), col("ast", "AST"), col("stl", "STL"), col("blk", "BLK"), col("tov", "TO"),
          col("fg", "FG", "raw", "text"), col("tp", "3P", "raw", "text"), col("ft", "FT", "raw", "text"), col("plusMinus", "+/-", "derived"), col("pf", "PF")],
        rows,
      },
      {
        key: "shooting", title: "Shooting",
        columns: [col("fgm", "FGM"), col("fga", "FGA"), col("fgPct", "FG%", "derived", "pct"), col("tpm", "3PM"), col("tpa", "3PA"), col("tpPct", "3P%", "derived", "pct"),
          col("ftm", "FTM"), col("fta", "FTA"), col("ftPct", "FT%", "derived", "pct"), col("efgPct", "eFG%", "derived", "pct"), col("tsPct", "TS%", "derived", "pct"), col("oreb", "OREB"), col("dreb", "DREB")],
        rows,
      },
      {
        key: "advanced", title: "Advanced",
        columns: [col("eff", "EFF", "derived"), col("usgPct", "USG%", "derived", "pct"), col("astPct", "AST%", "derived", "pct"), col("tovPct", "TOV%", "derived", "pct"),
          col("rebPct", "REB%", "derived", "pct"), col("offRating", "ORtg on court", "derived", "dec1"), col("defRating", "DRtg on court", "derived", "dec1"),
          col("netRating", "Net on court", "derived", "dec1"), col("astTov", "AST/TOV", "derived", "dec2"), col("ptsPerMin", "PTS/MIN", "derived", "dec2"),
          col("rebPerMin", "REB/MIN", "derived", "dec2"), col("pmPer10", "+/- per 10 min", "derived", "dec1")],
        rows,
      },
      {
        key: "fouls", title: "Fouls",
        columns: [col("pf", "PF"), col("foulsShooting", "Shooting"), col("foulsOffensive", "Offensive"), col("techs", "Technical"),
          col("unsportsmanlike", rules.preset === "nba" || rules.preset === "ncaa" ? "Flagrant" : "Unsportsmanlike"), col("pfd", "Drawn"), col("status", "Status", "derived", "text")],
        rows,
      },
    ];
  },

  calculateTeamStatistics(s, ctx, rules) {
    const rows = SIDES.map((side) => ({ id: side, name: sideName(ctx, side), side, values: teamValues(s, ctx, rules, side) }));
    const window = foulWindow(currentPeriod(s, rules), rules);
    const fouls = SIDES.map((side) => {
      const t = s.team[side];
      return {
        id: side, name: sideName(ctx, side), side,
        values: {
          teamFouls: s.teamFouls[side][window] ?? 0, pf: n0(t, "pf"), foulsShooting: n0(t, "foulsShooting"), foulsOffensive: n0(t, "foulsOffensive"),
          techs: n0(t, "techs") + n0(t, "benchTechs"), unsportsmanlike: n0(t, "unsportsmanlike"),
          ftAwarded: n0(t, "foulsFtUnknown") ? null : n0(t, "ftAwarded"),
          timeouts: n0(t, "timeouts"), timeoutsLeft: timeoutsLeft(s, side, rules),
        } as Record<string, StatValue>,
      };
    });
    return [
      { key: "team", title: "Team statistics", columns: TEAM_COLUMNS, rows },
      { key: "teamAdvanced", title: "Possessions and efficiency", columns: TEAM_ADVANCED, rows },
      {
        key: "teamFouls", title: "Fouls and timeouts",
        columns: [col("teamFouls", "Team fouls (this window)"), col("pf", "Personal fouls"), col("foulsShooting", "Shooting"), col("foulsOffensive", "Offensive"),
          col("techs", "Technical"), col("unsportsmanlike", rules.preset === "nba" || rules.preset === "ncaa" ? "Flagrant" : "Unsportsmanlike"),
          col("ftAwarded", "Free throws conceded from fouls", "derived"), col("timeouts", "Timeouts used"), col("timeoutsLeft", "Timeouts left", "derived")],
        rows: fouls,
      },
    ];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      const winner = s.score.a === s.score.b ? null : s.score.a > s.score.b ? "a" : "b";
      const tracked = tracksShots(s, rules) ? 1 : 0;
      const secs = secondsPlayed(s, rules) ?? 0;
      const minutesOk = s.minutesValid && lineupsKnown(s);
      const ratingsOk = s.ratingsValid && lineupsKnown(s) && tracksShots(s, rules);
      for (const side of SIDES) {
        const own = withReb(s.team[side]), opp = withReb(s.team[otherSide(side)]);
        const f = teamFigures(s, side, rules);
        lines.push({
          subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: {
            ...s.team[side], matches: 1, wins: winner === side ? 1 : 0, losses: winner && winner !== side ? 1 : 0, periods: s.period,
            oppPts: n0(opp, "pts"), oppFgm: n0(opp, "fgm"), oppFga: n0(opp, "fga"), oppTpm: n0(opp, "tpm"), oppTpa: n0(opp, "tpa"),
            oppOreb: n0(opp, "oreb"), oppDreb: n0(opp, "dreb"), oppTov: n0(opp, "tov"),
            poss: f.poss ?? 0, oppPoss: f.oppPoss ?? 0, gameSecs: secs, tracked,
          },
        });
        const tmSecs = playersOf(ctx, side).reduce((x, pl) => x + n0(s.players[pl.id], "secs"), 0);
        // only players dressed for the game played in it
        for (const pl of ctx.sides[side].players.filter((x) => gameRosterOf(s, ctx, side).includes(x.id))) {
          const raw = s.players[pl.id] ?? {};
          const r = withReb(raw);
          lines.push({
            subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            raw: {
              ...raw, matches: 1, tracked,
              doubleDoubles: isDouble(r, 2) ? 1 : 0, tripleDoubles: isDouble(r, 3) ? 1 : 0,
              ...(minutesOk
                ? { tmFga: n0(own, "fga"), tmFta: n0(own, "fta"), tmTov: n0(own, "tov"), tmFgm: n0(own, "fgm"), tmReb: n0(own, "reb"), oppReb: n0(opp, "reb"), tmSlotSecs: tmSecs / rules.playersOnCourt }
                : { secs: 0, secsUnknown: 1 }),
              ...(ratingsOk ? {} : { onFor: 0, onAgainst: 0, offPoss: 0, defPoss: 0, ratingsUnknown: 1 }),
            },
          });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx, rules) {
    return basketballAnalytics(s, ctx, rules);
  },

  validateMatchCompletion(s, ctx, rules) {
    if (isBoxScore(s)) {
      const missing = SIDES.filter((x) => !s.boxScore![x]);
      if (missing.length) return `Enter ${sideName(ctx, missing[0])}'s box score too`;
      if (s.score.a === s.score.b && !rules.allowTie) return "The score is level. A game cannot end level: enter the score after overtime";
      return null;
    }
    if (s.periodOpen) return `${periodName(s.period, rules)} is still in progress. Tap End ${periodName(s.period, rules)} under the clock, and play the remaining ${rules.periods === 4 ? "quarters" : "periods"} first`;
    if (s.period < rules.periods) return `Only ${s.period} of ${rules.periods} ${rules.periods === 4 ? "quarters" : "periods"} have been played. To stop early, use Abandon`;
    if (s.score.a === s.score.b && !rules.allowTie) return "The score is level. Play overtime";
    return null;
  },

  finalizeMatch(s, _ctx, rules): MatchResult {
    if (s.score.a === s.score.b) return { outcome: "tie", winner: null, method: "played", margin: `${s.score.a}-${s.score.b}` };
    const w: Side = s.score.a > s.score.b ? "a" : "b";
    const ot = s.period > rules.periods ? `, ${periodName(s.period, rules)}` : "";
    return { outcome: "win", winner: w, method: "played", margin: `${s.score[w]}-${s.score[otherSide(w)]}${ot}` };
  },

  mirrorScore: (s) => ({ scoreA: s.score.a, scoreB: s.score.b }),

  deriveStats(subject, rawIn) {
    const raw = withReb(rawIn);
    const games = n0(raw, "matches");
    // percentages only if every match in the sum tracked misses
    const tracked = games > 0 && n0(raw, "tracked") === games;
    const per = (k: string, places = 1) => round(ratio(n0(raw, k), games || null), places);
    if (subject === "player") {
      const minutesKnown = games > 0 && n0(raw, "secsUnknown") === 0;
      const min = minutesKnown ? n0(raw, "secs") / 60 : null;
      const share = minutesKnown && n0(raw, "secs") > 0 && n0(raw, "tmSlotSecs") > 0 ? n0(raw, "tmSlotSecs") / n0(raw, "secs") : null;
      const ratingsKnown = games > 0 && n0(raw, "ratingsUnknown") === 0 && tracked;
      const offR = ratingsKnown ? ratio(100 * n0(raw, "onFor"), raw.offPoss) : null;
      const defR = ratingsKnown ? ratio(100 * n0(raw, "onAgainst"), raw.defPoss) : null;
      const eff = efficiency(raw, tracked);
      return {
        columns: [
          col("matches", "Games"), col("mpg", "MPG", "derived", "dec1"), col("ppg", "PPG", "derived", "dec1"), col("rpg", "RPG", "derived", "dec1"), col("apg", "APG", "derived", "dec1"),
          col("spg", "SPG", "derived", "dec1"), col("bpg", "BPG", "derived", "dec1"), col("tpmPg", "3PM per game", "derived", "dec1"),
          col("fgPct", "FG%", "derived", "pct"), col("tpPct", "3P%", "derived", "pct"), col("ftPct", "FT%", "derived", "pct"),
          col("efgPct", "eFG%", "derived", "pct"), col("tsPct", "TS%", "derived", "pct"), col("effPg", "EFF per game", "derived", "dec1"),
          col("usgPct", "USG%", "derived", "pct"), col("offRating", "ORtg on court", "derived", "dec1"), col("defRating", "DRtg on court", "derived", "dec1"),
          col("doubleDoubles", "Double-doubles"), col("tripleDoubles", "Triple-doubles"), ...BOX_RAW,
        ],
        values: {
          ...raw, ...shooting(raw, tracked),
          mpg: min !== null ? round(min / games, 1) : null,
          ppg: per("pts"), rpg: per("reb"), apg: per("ast"), spg: per("stl"), bpg: per("blk"), tpmPg: per("tpm"),
          effPg: eff !== null ? round(eff / games, 1) : null,
          usgPct: tracked && share !== null ? round(pct((n0(raw, "fga") + 0.44 * n0(raw, "fta") + n0(raw, "tov")) * share, n0(raw, "tmFga") + 0.44 * n0(raw, "tmFta") + n0(raw, "tmTov")), 1) : null,
          offRating: round(offR, 1), defRating: round(defR, 1),
        },
      };
    }
    const allPoss = games > 0 && tracked;
    const off = allPoss ? ratio(100 * n0(raw, "pts"), raw.poss) : null;
    const def = allPoss ? ratio(100 * n0(raw, "oppPts"), raw.oppPoss) : null;
    // pace per regulation length is a per-competition figure; across games it is possessions per 40 minutes
    const pace = allPoss && n0(raw, "gameSecs") > 0 ? round(((n0(raw, "poss") + n0(raw, "oppPoss")) / 2) * (2400 / n0(raw, "gameSecs")), 1) : null;
    return {
      columns: [
        col("matches", "Games"), col("wins", "Wins"), col("losses", "Losses"), col("winPct", "Win %", "derived", "pct"),
        col("ppg", "Points per game", "derived", "dec1"), col("oppg", "Opponent points per game", "derived", "dec1"), col("diffPg", "Point difference per game", "derived", "dec1"),
        col("fgPct", "FG%", "derived", "pct"), col("tpPct", "3P%", "derived", "pct"), col("ftPct", "FT%", "derived", "pct"),
        col("rpg", "Rebounds per game", "derived", "dec1"), col("apg", "Assists per game", "derived", "dec1"), col("tovPg", "Turnovers per game", "derived", "dec1"),
        col("spg", "Steals per game", "derived", "dec1"), col("bpg", "Blocks per game", "derived", "dec1"), col("fpg", "Fouls per game", "derived", "dec1"),
        col("pace", "Pace (per 40 min)", "derived", "dec1"), col("offRating", "Offensive rating", "derived", "dec1"), col("defRating", "Defensive rating", "derived", "dec1"),
        col("netRating", "Net rating", "derived", "dec1"),
      ],
      values: {
        ...raw, ...shooting(raw, tracked),
        winPct: round(pct(n0(raw, "wins"), games || null), 1),
        ppg: per("pts"), oppg: per("oppPts"), diffPg: games ? round((n0(raw, "pts") - n0(raw, "oppPts")) / games, 1) : null,
        rpg: per("reb"), apg: per("ast"), tovPg: per("tov"), spg: per("stl"), bpg: per("blk"), fpg: per("pf"),
        pace, offRating: round(off, 1), defRating: round(def, 1), netRating: off !== null && def !== null ? round(off - def, 1) : null,
      },
    };
  },

  derivedLog: (s) => [
    ...s.log,
    // the score after every scoring play, for the play-by-play
    ...s.scoring.map((e) => ({ seq: e.seq, text: `Score ${e.a}-${e.b}` })),
  ],

  eventLabel(s, ev, rules) {
    if (ev.type === "PERIOD_START" || !s.periodOpen) return null;
    const clock = evClock(ev);
    const shot = isNonNegInt(ev.payload.shotClock) ? `, shot clock ${ev.payload.shotClock}` : "";
    const set = FT_EVENTS.has(ev.type) ? s.freeThrows[0] : null;
    const ft = set ? `, free throw ${set.taken + 1} of ${set.total}` : "";
    return `${periodName(s.period, rules)}${clock !== null ? ` ${formatClock(clock)}` : ""}${shot}${ft}`;
  },

  describeEvent(evIn, ctx, rules) {
    const c = canonical(evIn, rules);
    const ev = typeof c === "string" ? evIn : c;
    const p = ev.payload;
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    const who = str(p.player) ? playerName(ctx, str(p.player)) : side;
    const detail = [p.zone ? label(String(p.zone)) : null, p.shotType ? label(String(p.shotType)) : null, p.fastBreak ? "fast break" : null].filter(Boolean).join(", ");
    switch (ev.type) {
      case "BOX_SCORE": return `${side} box score: ${boxScorePoints(p, rules)} points`;
      case "PERIOD_START": return "Period started";
      case "PERIOD_END": return "Period ended";
      case "PERIOD_REOPEN": return "Period reopened";
      case "LINEUP": return `${side} lineup set`;
      case "SUBSTITUTION": return `${side}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}`;
      case "TIMEOUT": return `Timeout ${side}`;
      case "JUMP_BALL": return `Jump ball won by ${side}`;
      case "HELD_BALL": return "Held ball";
      case "ARROW": return `Possession arrow set to ${side}`;
      case "OFFICIALS": return `Officials: ${Array.isArray(p.names) ? p.names.join(", ") : ""}`;
      case "VIOLATION": return `${who} ${label(String(p.kind))}: ball to ${isSide(p.side) ? sideName(ctx, otherSide(p.side)) : "the other team"}`;
      case "OUT_OF_BOUNDS": return `${who} out of bounds: ball to ${isSide(p.side) ? sideName(ctx, otherSide(p.side)) : "the other team"}`;
      case "GOALTENDING": return `Goaltending by ${who}: ${p.points} points to ${str(p.shooter) ? playerName(ctx, str(p.shooter)) : isSide(p.side) ? sideName(ctx, otherSide(p.side)) : "the shooter"}`;
      case "ROSTER": return `${side} game roster: ${Array.isArray(p.players) ? p.players.length : 0} players`;
      case "SHOT_MADE": return `${who} scores ${p.points === rules.threePointValue ? "a three" : String(p.points)}${detail ? ` (${detail})` : ""}${str(p.assist) ? `, assist ${playerName(ctx, str(p.assist))}` : ""}`;
      case "SHOT_MISSED": return `${who} misses${p.points === rules.threePointValue ? " a three" : ` a ${String(p.points)}`}${detail ? ` (${detail})` : ""}`;
      case "FREE_THROW_MADE": return `${who} makes a ${p.technical ? "technical " : ""}free throw`;
      case "FREE_THROW_MISSED": return `${who} misses a ${p.technical ? "technical " : ""}free throw`;
      case "REBOUND": return `${str(p.player) ? who : `${side} team`} ${p.offensive ? "offensive" : "defensive"} rebound`;
      case "ASSIST": return `${who} assist`;
      case "STEAL": return `${who} steal`;
      case "BLOCK": return `${who} block`;
      case "TURNOVER": return `${who} turnover`;
      case "FOUL": {
        const kind = (p.kind ?? "personal") as FoulKind;
        const on = str(p.on) ? ` on ${playerName(ctx, str(p.on))}` : "";
        const fts = isNonNegInt(p.freeThrows) && p.freeThrows > 0 ? `, ${p.freeThrows} free throw${p.freeThrows === 1 ? "" : "s"}` : "";
        const whoFoul = str(p.player) ? who : kind === "technical" ? `${side} bench` : side;
        return `${whoFoul} ${kind === "personal" ? "" : `${foulKindName(kind, rules)} `}foul${on}${fts}`;
      }
      default: return ev.type;
    }
  },

  answerQuestion(s, ctx, rules, question) {
    return answerBasketballQuestion(question, gameFacts(s, ctx, rules));
  },
};

// ── box score: a game entered after the fact ─────────────────────────
// A game nobody scored play by play can still be entered from the score
// sheet: one BOX_SCORE event per team with each player's line (and a
// line with no player for points not credited to anyone). It feeds the
// same score, standings, box score and career totals as live scoring.
// What needs the play-by-play (minutes, plus/minus, possessions, runs,
// clutch) is withheld; percentages too when attempts are left out.

// `points`: on the team line only, points nobody was credited with (a final score typed without the scorers)
export const BOX_SCORE_FIELDS = ["twos", "threes", "ftm", "fga", "tpa", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "points"] as const;
export type BoxScoreLine = { player?: string | null } & Partial<Record<(typeof BOX_SCORE_FIELDS)[number], number>>;

export const isBoxScore = (s: BasketballState): boolean => !!(s.boxScore?.a || s.boxScore?.b);

const lineNum = (l: BoxScoreLine, k: (typeof BOX_SCORE_FIELDS)[number]): number => l[k] ?? 0;
const linePoints = (l: BoxScoreLine, rules: BasketballRules): number =>
  lineNum(l, "twos") * rules.twoPointValue + lineNum(l, "threes") * rules.threePointValue + lineNum(l, "ftm") * rules.freeThrowValue + lineNum(l, "points");

/** The points a BOX_SCORE payload adds up to. */
export function boxScorePoints(p: Record<string, unknown>, rules: BasketballRules): number {
  return Array.isArray(p.lines) ? (p.lines as BoxScoreLine[]).reduce((t, l) => t + linePoints(l, rules), 0) : 0;
}

function validateBoxScore(s: BasketballState, p: Record<string, unknown>, ctx: MatchContext, rules: BasketballRules): string | null {
  if (!isSide(p.side)) return "Say which side the box score is for";
  if (s.period > 0 && !isBoxScore(s)) return "This game is being scored play by play. A box score is for a game that was not";
  if (s.boxScore?.[p.side]) return `${sideName(ctx, p.side)}'s box score is already in. Correct it instead`;
  const lines = p.lines;
  if (!Array.isArray(lines) || !lines.length) return "Enter at least one line";
  const seen = new Set<string>();
  for (const l of lines as BoxScoreLine[]) {
    if (!l || typeof l !== "object") return "Each line must be a player's figures";
    const who = l.player ?? null;
    if (who !== null) {
      if (typeof who !== "string" || sideOfPlayer(ctx, who) !== p.side) return "Every player must belong to that team";
      if (seen.has(who)) return `${playerName(ctx, who)} appears twice`;
      seen.add(who);
    } else if (seen.has("")) return "Only one line can be for the team";
    else seen.add("");
    for (const k of BOX_SCORE_FIELDS) {
      const v = l[k];
      if (v !== undefined && v !== null && (!isNonNegInt(v) || v > 300)) return `${k} must be a whole number from 0 to 300`;
    }
    if (who && l.points) return `${playerName(ctx, who)}: a player's points come from baskets and free throws`;
    const name = who ? playerName(ctx, who) : sideName(ctx, p.side);
    if (l.fga != null && l.fga < lineNum(l, "twos") + lineNum(l, "threes")) return `${name}: more field goals made than attempted`;
    if (l.tpa != null && l.tpa < lineNum(l, "threes")) return `${name}: more threes made than attempted`;
    if (l.fta != null && l.fta < lineNum(l, "ftm")) return `${name}: more free throws made than attempted`;
  }
  const total = boxScorePoints(p, rules);
  if (p.periods != null) {
    const per = p.periods;
    if (!Array.isArray(per) || !per.length || per.length > rules.periods + 6 || per.some((v) => !isNonNegInt(v))) return "Period scores must be whole numbers, one per period";
    if (per.length < rules.periods) return `Give all ${rules.periods} periods, or none`;
    const sum = (per as number[]).reduce((t, v) => t + v, 0);
    if (sum !== total) return `The period scores add up to ${sum}, but the players' points add up to ${total}`;
  }
  return null;
}

function applyBoxScore(s: BasketballState, ev: EngineEvent, ctx: MatchContext, rules: BasketballRules): void {
  const p = ev.payload;
  const side = p.side as Side;
  let total = 0;
  for (const l of p.lines as BoxScoreLine[]) {
    const who = l.player ?? null;
    const fgm = lineNum(l, "twos") + lineNum(l, "threes");
    if ((fgm && l.fga == null) || (lineNum(l, "threes") && l.tpa == null) || (lineNum(l, "ftm") && l.fta == null)) s.attemptsUnknown = true;
    const counts: Record<string, number> = {
      fgm, fga: l.fga ?? fgm, tpm: lineNum(l, "threes"), tpa: l.tpa ?? lineNum(l, "threes"), ftm: lineNum(l, "ftm"), fta: l.fta ?? lineNum(l, "ftm"),
      oreb: lineNum(l, "oreb"), dreb: lineNum(l, "dreb"), ast: lineNum(l, "ast"), stl: lineNum(l, "stl"), blk: lineNum(l, "blk"), tov: lineNum(l, "tov"), pf: lineNum(l, "pf"),
      pts: linePoints(l, rules),
    };
    for (const [k, v] of Object.entries(counts)) if (v) credit(s, side, who, k, v, false);
    if (!who && lineNum(l, "points")) add(s.team[side], "unattributedPts", lineNum(l, "points"));
    if (who && counts.pf >= rules.foulLimit) s.out[who] = "fouled_out";
    total += counts.pts;
  }
  s.boxScore = { ...(s.boxScore ?? { a: false, b: false }), [side]: true };
  s.score[side] += total;
  if (Array.isArray(p.periods)) {
    s.byPeriod[side] = [...(p.periods as number[])];
    s.period = Math.max(s.period, p.periods.length);
  } else s.byPeriod[side] = [(s.byPeriod[side][0] ?? 0) + total];
  s.scoring.push({ seq: ev.seq, side, pts: total, period: 0, clock: null, a: s.score.a, b: s.score.b });
  s.plusMinusValid = false; s.minutesValid = false; s.ratingsValid = false; s.clutch.unknown = true;
  s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)} box score entered: ${total} points` });
}

// ── core validation and reducer (wrapped by ./basketball/… rules below) ──

function validateBase(s: BasketballState, ev: EngineEvent, ctx: MatchContext, rules: BasketballRules): string | null {
  const p = ev.payload;
  if (p.clock != null) {
    if (!isNonNegInt(p.clock)) return "The clock must be whole seconds";
    if (s.periodOpen && p.clock > periodSeconds(s.period, rules)) return "The clock is longer than the period";
    if (s.periodOpen && s.clock !== null && p.clock > s.clock) return "The clock cannot run backwards";
  }
  if (p.shotClock != null) {
    if (rules.shotClockSeconds === null) return "This competition plays without a shot clock";
    if (!isNonNegInt(p.shotClock) || p.shotClock > rules.shotClockSeconds) return `The shot clock must be 0 to ${rules.shotClockSeconds} seconds`;
    // with less game time left than shot clock, the shot clock is switched off
    if (isNonNegInt(p.clock) && p.shotClock > p.clock) return "The shot clock cannot show more than the game clock: it is switched off";
  }

  switch (ev.type) {
    case "ROSTER": {
      if (!isSide(p.side)) return "Say which side the game roster is for";
      if (s.period > 0) return "The game roster is set before tip-off";
      const list = p.players;
      if (!Array.isArray(list) || !list.length) return "Choose the players for this game";
      if (new Set(list).size !== list.length) return "A player appears twice in the game roster";
      if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every player must belong to that team";
      if (list.length > rules.gameRosterSize) return `A game roster holds at most ${rules.gameRosterSize} players (${rules.playersOnCourt} on court and ${rules.gameRosterSize - rules.playersOnCourt} substitutes)`;
      const court = s.onCourt[p.side];
      if (court && court.some((id) => !list.includes(id))) return "Every player in the lineup must be in the game roster";
      return null;
    }
    case "BOX_SCORE":
      return validateBoxScore(s, p, ctx, rules);
    case "PERIOD_START":
      if (isBoxScore(s)) return "This game was entered as a box score. Correct the box score instead";
      if (s.periodOpen) return `${periodName(s.period, rules)} is still in progress`;
      if (s.period === 0) {
        for (const side of SIDES) {
          const listed = gameRosterOf(s, ctx, side).length;
          if (listed > rules.gameRosterSize) return `${sideName(ctx, side)} has ${listed} players registered. Choose the ${rules.gameRosterSize} dressed for this game first`;
        }
      }
      if (s.period >= rules.periods && s.score.a !== s.score.b) return "Overtime is only played when the score is level";
      if (s.period >= rules.periods && rules.allowTie) return "This competition allows a tie: there is no overtime";
      return null;
    case "PERIOD_END":
      return s.periodOpen ? null : "No period is in progress";
    // the last period taken back, to add what was missed before it ended (after reopening a finished match)
    case "PERIOD_REOPEN":
      if (isBoxScore(s)) return "This game was entered as a box score. Correct the box score instead";
      if (s.periodOpen) return `${periodName(s.period, rules)} is still in progress`;
      return s.period > 0 ? null : "No period has been played yet";
    case "LINEUP": {
      if (!isSide(p.side)) return "Say which side the lineup is for";
      const list = p.players;
      if (Array.isArray(list) && list.some((id) => s.out[id as string])) return "A fouled out or disqualified player cannot be in the lineup";
      const size = lineupSize(s, ctx, p.side, rules);
      if (!Array.isArray(list) || list.length !== size) return size === rules.playersOnCourt ? `A lineup needs exactly ${rules.playersOnCourt} players` : `Only ${size} players are still eligible: the lineup needs all of them`;
      if (new Set(list).size !== list.length) return "A player appears twice in the lineup";
      if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every lineup player must belong to that side";
      if (list.some((id) => !gameRosterOf(s, ctx, p.side as Side).includes(id as string))) return "A lineup player is not in the game roster";
      return null;
    }
    case "SUBSTITUTION": {
      if (!isSide(p.side)) return "Say which side";
      const court = s.onCourt[p.side];
      if (!court) return "Set the lineup before recording substitutions";
      if (typeof p.in !== "string" || typeof p.out !== "string") return "Say who comes on and who goes off";
      if (sideOfPlayer(ctx, p.in) !== p.side) return "The player coming on is not in that team";
      if (!gameRosterOf(s, ctx, p.side).includes(p.in)) return "The player coming on is not in the game roster";
      if (!court.includes(p.out)) return "The player going off is not on court";
      if (court.includes(p.in)) return "The player coming on is already on court";
      if (s.out[p.in]) return "A fouled out or disqualified player cannot come back on";
      if (substitutionsLeft(s, p.side, rules) === 0) return `${sideName(ctx, p.side)} has used all ${rules.substitutionsPerGame} substitutions`;
      return null;
    }
    case "TIMEOUT": {
      if (!isSide(p.side)) return "Say which side";
      if (!s.periodOpen) return "Timeouts are taken during a period";
      if (timeoutsLeft(s, p.side, rules) <= 0) {
        const pool = timeoutPool(s.period, rules);
        const where = pool.key === "G" ? "this game" : pool.key.startsWith("OT") ? "this overtime" : pool.key === "H1" ? "the first half" : "the second half";
        return `${sideName(ctx, p.side)} has no timeouts left in ${where}`;
      }
      return null;
    }
    case "ARROW":
      if (!rules.alternatingPossession) return "This competition has no possession arrow";
      return isSide(p.side) ? null : "Say which side the arrow points to";
    case "OFFICIALS": {
      const names = p.names;
      if (!Array.isArray(names) || !names.length || names.length > 5 || names.some((x) => typeof x !== "string" || !x.trim() || x.length > 80)) return "Give one to five official names";
      return null;
    }
  }

  // play events
  if (!s.periodOpen) return "Start the period before recording play";
  if (ev.type === "HELD_BALL") {
    if (!rules.alternatingPossession) return "Record a jump ball: this competition has no possession arrow";
    return s.arrow ? null : "The possession arrow is not set yet. Record the opening jump ball first";
  }
  if (!isSide(p.side)) return "Say which side";
  const side = p.side;
  if (PLAYER_EVENTS.has(ev.type) && p.player != null) {
    if (typeof p.player !== "string") return "player must be a player id";
    if (sideOfPlayer(ctx, p.player) !== side) return `That player is not in ${sideName(ctx, side)}`;
    if (!gameRosterOf(s, ctx, side).includes(p.player)) return `${playerName(ctx, p.player)} is not dressed for this game`;
    if (s.out[p.player]) return `${playerName(ctx, p.player)} ${s.out[p.player] === "fouled_out" ? "has fouled out" : "has been disqualified"}`;
    if (s.onCourt[side] && !s.onCourt[side]!.includes(p.player)) return `${playerName(ctx, p.player)} is not on court`;
  }
  if (ev.type === "SHOT_MADE" || ev.type === "SHOT_MISSED") {
    if (p.points !== rules.twoPointValue && p.points !== rules.threePointValue) return `A field goal is worth ${rules.twoPointValue} or ${rules.threePointValue}`;
    const three = p.points === rules.threePointValue;
    if (p.assist != null) {
      if (ev.type === "SHOT_MISSED") return "A missed shot has no assist";
      if (typeof p.assist !== "string" || sideOfPlayer(ctx, p.assist) !== side) return "The assist must come from a team mate";
      if (p.assist === p.player) return "A player cannot assist their own basket";
      if (!gameRosterOf(s, ctx, side).includes(p.assist)) return `${playerName(ctx, p.assist)} is not dressed for this game`;
      if (s.out[p.assist]) return `${playerName(ctx, p.assist)} is no longer eligible`;
      if (s.onCourt[side] && !s.onCourt[side]!.includes(p.assist)) return `${playerName(ctx, p.assist)} is not on court`;
    }
    if (p.zone != null) {
      if (!(SHOT_ZONES as readonly unknown[]).includes(p.zone)) return "Unknown shot zone";
      if (three !== THREE_POINT_ZONES.includes(p.zone as ShotZone)) return three ? "That zone is inside the arc" : "That zone is beyond the arc";
    }
    if (p.paint && three) return "A shot from outside the arc is not in the paint";
    if (p.shotType != null && !(SHOT_TYPES as readonly unknown[]).includes(p.shotType)) return "Unknown shot type";
    for (const k of ["x", "y"] as const) if (p[k] != null && (typeof p[k] !== "number" || p[k] < 0 || p[k] > 100)) return "Shot location must be 0 to 100";
  }
  if ((ev.type === "FREE_THROW_MADE" || ev.type === "FREE_THROW_MISSED") && p.technical != null && typeof p.technical !== "boolean") return "technical must be yes or no";
  if (ev.type === "FOUL") {
    const kind = (p.kind ?? "personal") as FoulKind;
    if (!(FOUL_KINDS as readonly unknown[]).includes(kind)) return "Unknown foul type";
    if (p.on != null) {
      if (typeof p.on !== "string" || sideOfPlayer(ctx, p.on) !== otherSide(side)) return "The fouled player must be on the other team";
      if (!gameRosterOf(s, ctx, otherSide(side)).includes(p.on)) return `${playerName(ctx, p.on)} is not dressed for this game`;
      if (kind === "technical") return "A technical foul is not committed on a player";
    }
    if (p.freeThrows != null) {
      if (!isNonNegInt(p.freeThrows) || p.freeThrows > 3) return "Free throws awarded must be 0 to 3";
      if (kind === "offensive" && p.freeThrows > 0) return "An offensive foul gives no free throws";
    }
  }
  if (ev.type === "REBOUND" && typeof p.offensive !== "boolean") return "Say whether the rebound was offensive or defensive";
  if (ev.type === "VIOLATION") {
    if (!(VIOLATIONS as readonly unknown[]).includes(p.kind)) return "Unknown violation";
    if (p.kind === "shot_clock" && rules.shotClockSeconds === null) return "This competition plays without a shot clock";
  }
  if (ev.type === "GOALTENDING") {
    if (p.points !== rules.twoPointValue && p.points !== rules.threePointValue) return `A goaltended field goal is worth ${rules.twoPointValue} or ${rules.threePointValue}`;
    const shooting = otherSide(side);
    if (p.shooter != null) {
      if (typeof p.shooter !== "string" || sideOfPlayer(ctx, p.shooter) !== shooting) return `The shooter must be in ${sideName(ctx, shooting)}`;
      if (!gameRosterOf(s, ctx, shooting).includes(p.shooter)) return `${playerName(ctx, p.shooter)} is not dressed for this game`;
      if (s.out[p.shooter]) return `${playerName(ctx, p.shooter)} is no longer eligible`;
      if (s.onCourt[shooting] && !s.onCourt[shooting]!.includes(p.shooter)) return `${playerName(ctx, p.shooter)} is not on court`;
    }
  }
  return null;
}

function updateBase(s: BasketballState, ev: EngineEvent, ctx: MatchContext, rules: BasketballRules): BasketballState {
  const p = ev.payload;
  const clock = evClock(ev);
  // clutch is decided by the clock and margin before the event
  let clutch = false;
  if (PLAY_EVENTS.has(ev.type) && s.periodOpen && s.period >= rules.periods) {
    if (clock === null) s.clutch.unknown = true;
    else clutch = clock <= rules.clutchMinutes * 60 && Math.abs(s.score.a - s.score.b) <= rules.clutchMargin;
    if (clutch) s.clutch.seen = true;
  }
  if (clock !== null && s.periodOpen) runClock(s, clock);
  const side = p.side as Side;
  const who = str(p.player);
  const technicalFt = (ev.type === "FREE_THROW_MADE" || ev.type === "FREE_THROW_MISSED") && p.technical === true;

  // possession: who is acting with the ball
  let afterSteal = false;
  switch (ev.type) {
    case "SHOT_MADE": case "SHOT_MISSED": case "TURNOVER": case "ASSIST":
      if (ev.type === "TURNOVER") {
        // a steal recorded first already handed the ball over: this is the same turnover
        const cur = openPossession(s);
        afterSteal = !!cur && cur.side !== side && cur.start === "turnover" && cur.startSeq === s.lastSeq;
        if (!afterSteal) gainPossession(s, side, ev, undefined, true);
      } else gainPossession(s, side, ev, undefined, ev.type !== "ASSIST");
      break;
    case "FREE_THROW_MADE": case "FREE_THROW_MISSED":
      if (!technicalFt) gainPossession(s, side, ev);
      break;
    case "REBOUND":
      if (p.offensive) { gainPossession(s, side, ev); const cur = openPossession(s); if (cur && s.ending === "miss") cur.oreb += 1; s.ending = null; }
      else { gainPossession(s, side, ev, "rebound"); s.ending = null; }
      break;
    case "STEAL":
      if (s.owner === side && s.ending === "score" && openPossession(s)) inferOpponentPossession(s, side, ev, "turnover");
      if (s.owner !== side) { s.ending = "turnover"; gainPossession(s, side, ev, "turnover"); }
      break;
    case "FOUL":
      if (p.kind === "offensive") gainPossession(s, side, ev, undefined, true);
      break;
    case "JUMP_BALL":
      if (s.owner !== side) { s.ending = s.ending ?? "held_ball"; gainPossession(s, side, ev, "jump_ball"); }
      break;
    case "HELD_BALL":
      if (s.owner !== s.arrow) { s.ending = "held_ball"; gainPossession(s, s.arrow!, ev, "held_ball"); }
      break;
    case "VIOLATION":
      if ((OFFENSIVE_VIOLATIONS as readonly string[]).includes(p.kind as string)) gainPossession(s, side, ev, undefined, true);
      break;
    case "OUT_OF_BOUNDS":
      if (s.ball === side || (s.ball === null && s.owner === side)) gainPossession(s, side, ev, undefined, true);
      break;
    case "GOALTENDING":
      // the shot was the other team's, so it had the ball
      gainPossession(s, otherSide(side), ev, undefined, true);
      break;
  }

  switch (ev.type) {
    case "BOX_SCORE": applyBoxScore(s, ev, ctx, rules); break;
    case "PERIOD_REOPEN":
      s.periodOpen = true; s.clock = null;
      s.log.push({ seq: ev.seq, text: `${periodName(s.period, rules)} reopened` });
      break;
    case "PERIOD_START":
      s.period += 1; s.periodOpen = true; s.clock = periodSeconds(s.period, rules);
      for (const x of SIDES) s.byPeriod[x][s.period - 1] = 0;
      s.log.push({ seq: ev.seq, text: `${periodName(s.period, rules)} started` });
      break;
    case "PERIOD_END": {
      runClock(s, 0);
      closePossession(s, ev, s.ending ?? "period_end");
      s.owner = null; s.ending = null; s.ball = null;
      s.periodOpen = false; s.clock = null;
      s.log.push({ seq: ev.seq, text: `End of ${periodName(s.period, rules)}: ${sideName(ctx, "a")} ${s.score.a}, ${sideName(ctx, "b")} ${s.score.b}` });
      break;
    }
    case "LINEUP":
      s.onCourt[side] = [...(p.players as string[])];
      if (!s.starters[side]) s.starters[side] = [...(p.players as string[])];
      break;
    case "SUBSTITUTION": {
      const court = s.onCourt[side]!;
      court[court.indexOf(p.out as string)] = p.in as string;
      s.subsUsed = s.subsUsed ?? { a: 0, b: 0 };
      s.subsUsed[side] += 1;
      if (clock === null) s.minutesValid = false;
      break;
    }
    case "TIMEOUT": {
      const pool = timeoutPool(s.period, rules);
      s.timeoutsUsed[side][pool.key] = (s.timeoutsUsed[side][pool.key] ?? 0) + 1;
      add(s.team[side], "timeouts");
      break;
    }
    case "ARROW": s.arrow = side; break;
    case "ROSTER": s.gameRoster[side] = [...(p.players as string[])]; break;
    case "OFFICIALS": s.officials = (p.names as string[]).map((x) => x.trim()); break;
    case "JUMP_BALL":
      s.ball = side;
      if (rules.alternatingPossession && !s.arrow) s.arrow = otherSide(side);
      break;
    case "HELD_BALL":
      s.ball = s.arrow;
      s.log.push({ seq: ev.seq, text: `Held ball: possession to ${sideName(ctx, s.arrow!)}` });
      s.arrow = otherSide(s.arrow!);
      break;
    case "SHOT_MADE": {
      const pts = p.points as number;
      const three = pts === rules.threePointValue;
      credit(s, side, who, "fgm", 1, clutch); credit(s, side, who, "fga", 1, clutch);
      if (three) { credit(s, side, who, "tpm", 1, clutch); credit(s, side, who, "tpa", 1, clutch); }
      const zone = (p.zone as ShotZone | undefined) ?? null;
      if ((zone && PAINT_ZONES.includes(zone)) || (!zone && p.paint)) add(s.team[side], "paintPts", pts);
      if (p.fastBreak) add(s.team[side], "fastBreakPts", pts);
      if (typeof p.assist === "string") credit(s, side, p.assist, "ast", 1, clutch);
      s.shots.push({ ...shotRecord(s, ev, side, who, pts, true, clock), clutch });
      addPoints(s, ev, side, who, pts, clutch, ctx, true);
      s.ending = "score"; s.ball = otherSide(side);
      break;
    }
    case "SHOT_MISSED":
      credit(s, side, who, "fga", 1, clutch);
      if (p.points === rules.threePointValue) credit(s, side, who, "tpa", 1, clutch);
      s.shots.push({ ...shotRecord(s, ev, side, who, p.points as number, false, clock), clutch });
      s.ending = "miss"; s.ball = null;
      break;
    case "FREE_THROW_MADE":
      credit(s, side, who, "ftm", 1, clutch); credit(s, side, who, "fta", 1, clutch);
      addPoints(s, ev, side, who, rules.freeThrowValue, clutch, ctx, !technicalFt);
      if (!technicalFt) { s.ending = "score"; s.ball = otherSide(side); }
      break;
    case "FREE_THROW_MISSED":
      credit(s, side, who, "fta", 1, clutch);
      if (!technicalFt) { s.ending = "miss"; s.ball = null; }
      break;
    case "REBOUND":
      credit(s, side, who, p.offensive ? "oreb" : "dreb", 1, clutch);
      if (!who) add(s.team[side], "teamReb");
      s.ball = side;
      break;
    case "ASSIST": credit(s, side, who, "ast", 1, clutch); break;
    case "STEAL": credit(s, side, who, "stl", 1, clutch); s.ball = side; break;
    case "BLOCK": credit(s, side, who, "blk", 1, clutch); break;
    case "TURNOVER":
      credit(s, side, who, "tov", 1, clutch);
      if (!afterSteal) { s.ending = "turnover"; s.ball = otherSide(side); }
      break;
    case "FOUL": recordFoul(s, ev, ctx, rules, side, who, clutch); break;
    case "VIOLATION": {
      const kind = p.kind as Violation;
      if ((OFFENSIVE_VIOLATIONS as readonly string[]).includes(kind)) {
        // a violation is a turnover: the ball goes to the other team, the score is untouched
        credit(s, side, who, "tov", 1, clutch);
        add(s.team[side], "violations");
        s.ending = "turnover"; s.ball = otherSide(side);
        s.dead = { to: otherSide(side), reason: `${who ? playerName(ctx, who) : sideName(ctx, side)} ${label(kind)}` };
      } else {
        // a defensive violation leaves the ball with the offence
        add(s.team[side], "violations");
        s.ball = otherSide(side);
        s.dead = { to: otherSide(side), reason: `${sideName(ctx, side)} ${label(kind)}` };
      }
      break;
    }
    case "OUT_OF_BOUNDS": {
      const hadBall = s.owner === side;
      if (hadBall) { credit(s, side, who, "tov", 1, clutch); s.ending = "turnover"; }
      s.ball = otherSide(side);
      s.dead = { to: otherSide(side), reason: `${who ? playerName(ctx, who) : sideName(ctx, side)} put the ball out of bounds` };
      break;
    }
    case "GOALTENDING": {
      const shooting = otherSide(side);
      const shooter = str(p.shooter);
      const pts = p.points as number;
      credit(s, shooting, shooter, "fgm", 1, clutch); credit(s, shooting, shooter, "fga", 1, clutch);
      if (pts === rules.threePointValue) { credit(s, shooting, shooter, "tpm", 1, clutch); credit(s, shooting, shooter, "tpa", 1, clutch); }
      add(s.team[side], "goaltending");
      s.shots.push({ ...shotRecord(s, ev, shooting, shooter, pts, true, clock), zone: null, shotType: null });
      addPoints(s, ev, shooting, shooter, pts, clutch, ctx, true);
      s.ending = "score"; s.ball = side;
      s.log.push({ seq: ev.seq, text: `Goaltending by ${who ? playerName(ctx, who) : sideName(ctx, side)}: the basket counts for ${shooter ? playerName(ctx, shooter) : sideName(ctx, shooting)} (+${pts})` });
      break;
    }
  }
  s.lastSeq = ev.seq;
  return s;
}

// ── the rules layer: aliases, free-throw sequences, dead balls, score checks, explanations ──

const FT_EVENTS = new Set(["FREE_THROW_MADE", "FREE_THROW_MISSED"]);
// what cannot happen while free throws are still to be taken
const WAIT_FOR_FREE_THROWS = new Set(["SHOT_MADE", "SHOT_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "VIOLATION", "OUT_OF_BOUNDS", "GOALTENDING", "JUMP_BALL", "HELD_BALL", "PERIOD_END"]);
// acting with the ball: refused for the team that just lost it on a dead ball
const WITH_BALL = new Set(["SHOT_MADE", "SHOT_MISSED", "FREE_THROW_MADE", "FREE_THROW_MISSED", "ASSIST", "TURNOVER"]);

function pushRecent(s: BasketballState, e: Explanation): void {
  s.recent.push(e);
  if (s.recent.length > 40) s.recent.splice(0, s.recent.length - 40);
}

/** TWO_POINT_MADE, 3PT_MISSED ... -> SHOT_MADE / SHOT_MISSED with the competition's value. */
function canonical(ev: EngineEvent, rules: BasketballRules): EngineEvent | string {
  const alias = EVENT_ALIASES[ev.type];
  if (!alias) return ev;
  const points = alias.three ? rules.threePointValue : rules.twoPointValue;
  if (ev.payload.points != null && ev.payload.points !== points) return `${ev.type} is worth ${points}, not ${String(ev.payload.points)}`;
  return { ...ev, type: alias.type, payload: { ...ev.payload, points } };
}

/** Points an event adds, and to whom. Only these three events ever change the score. */
function scoreChange(ev: EngineEvent, rules: BasketballRules): { side: Side; points: number } | null {
  const side = ev.payload.side as Side;
  if (ev.type === "SHOT_MADE") return { side, points: ev.payload.points as number };
  if (ev.type === "FREE_THROW_MADE") return { side, points: rules.freeThrowValue };
  if (ev.type === "GOALTENDING") return { side: otherSide(side), points: ev.payload.points as number };
  return null;
}

export function freeThrowLabel(set: FreeThrowSet, ctx: MatchContext): string {
  return `${set.player ? playerName(ctx, set.player) : sideName(ctx, set.side)}, free throw ${set.taken + 1} of ${set.total}${set.oneAndOne ? " (one-and-one)" : ""}${set.technical ? " (technical)" : ""}`;
}

// events after which the shot clock is reset to the competition's reset value (if it was lower)
const resetsShotClock = (ev: EngineEvent): boolean =>
  (ev.type === "REBOUND" && ev.payload.offensive === true) || (ev.type === "VIOLATION" && ev.payload.kind === "kicked_ball")
  || (ev.type === "FOUL" && ev.payload.kind !== "offensive" && ev.payload.kind !== "technical");

// events with which a team takes the ball: a new possession starts a full shot clock
const takesBall = (s: BasketballState, ev: EngineEvent): boolean => {
  const side = ev.payload.side as Side;
  if (["STEAL", "JUMP_BALL", "HELD_BALL", "PERIOD_START"].includes(ev.type)) return true;
  if (ev.type === "REBOUND" && ev.payload.offensive === false) return true;
  return (WITH_BALL.has(ev.type) || ev.type === "REBOUND") && s.owner !== null && s.owner !== side;
};

/** The highest shot clock reading the engine accepts with this event (null: any). */
export function shotClockCapFor(s: BasketballState, ev: EngineEvent, rules: BasketballRules): number | null {
  if (s.shotClockCap === null || takesBall(s, ev) || rules.shotClockSeconds === null) return null;
  if (resetsShotClock(ev)) return Math.max(s.shotClockCap, rules.shotClockReset ?? rules.shotClockSeconds);
  return s.shotClockCap;
}

function validateRules(s: BasketballState, evIn: EngineEvent, ctx: MatchContext, rules: BasketballRules): string | null {
  const ev = canonical(evIn, rules);
  if (typeof ev === "string") return ev;
  const why = validateBase(s, ev, ctx, rules);
  if (why) return why;
  const p = ev.payload;
  const side = p.side as Side;

  // free throws are taken in order, by the right team and the fouled player, before play goes on
  const set = s.freeThrows[0];
  if (set && FT_EVENTS.has(ev.type)) {
    if (side !== set.side) return `${sideName(ctx, set.side)} are taking free throws now: ${freeThrowLabel(set, ctx)}`;
    if (set.player && str(p.player) && p.player !== set.player) return `${playerName(ctx, set.player)} was fouled and takes these free throws`;
    if (p.technical === true && !set.technical) return `The free throw now is for a ${set.reason}, not a technical`;
  } else if (set && WAIT_FOR_FREE_THROWS.has(ev.type)) {
    return `Finish the free throws first: ${freeThrowLabel(set, ctx)}`;
  } else if (!set && FT_EVENTS.has(ev.type) && s.freeThrowsDone && p.technical !== true) {
    return `${s.freeThrowsDone}. Another free throw needs a foul`;
  }

  // after a violation the other team has the ball: a basket by the team that lost it cannot count
  if (s.dead) {
    const acting = ev.type === "GOALTENDING" ? otherSide(side) : side;
    const exempt = FT_EVENTS.has(ev.type) && (p.technical === true || !!set);
    if ((WITH_BALL.has(ev.type) || ev.type === "GOALTENDING") && acting !== s.dead.to && !exempt) {
      return ev.type === "SHOT_MADE" || ev.type === "GOALTENDING"
        ? `The basket cannot count: ${s.dead.reason}, so the ball went to ${sideName(ctx, s.dead.to)}`
        : `${sideName(ctx, s.dead.to)} have the ball: ${s.dead.reason}`;
    }
  }

  // the shot clock only runs down within a possession, unless this event resets it
  if (isNonNegInt(p.shotClock)) {
    const cap = shotClockCapFor(s, ev, rules);
    if (cap !== null && p.shotClock > cap) return `The shot clock cannot read ${p.shotClock}: it was at ${s.shotClockCap} and nothing reset it${resetsShotClock(ev) && rules.shotClockReset !== null ? ` beyond ${rules.shotClockReset}` : ""}`;
  }

  // a client that states the score it expects is checked against the rules
  if (p.expectedScore != null) {
    const e = p.expectedScore as Record<string, unknown>;
    if (typeof e !== "object" || !isNonNegInt(e.a) || !isNonNegInt(e.b)) return "expectedScore must be { a, b } in whole points";
    const change = scoreChange(ev, rules);
    const next = { ...s.score };
    if (change) next[change.side] += change.points;
    if (e.a !== next.a || e.b !== next.b) {
      return `Scoring inconsistency: ${s.score.a}-${s.score.b}${change ? ` plus ${change.points} for ${sideName(ctx, change.side)}` : " with no score change"} is ${next.a}-${next.b}, not ${e.a}-${e.b}`;
    }
  }
  return null;
}

function updateRules(s: BasketballState, evIn: EngineEvent, ctx: MatchContext, rules: BasketballRules): BasketballState {
  const c = canonical(evIn, rules);
  const ev0 = typeof c === "string" ? evIn : c;
  const p0 = ev0.payload;
  const side = p0.side as Side;
  const before = { ...s.score };
  const ballBefore = s.ball;
  const set = FT_EVENTS.has(ev0.type) ? s.freeThrows[0] ?? null : null;
  const attempt = set ? { n: set.taken + 1, of: set.total, oneAndOne: set.oneAndOne, technical: set.technical } : null;
  // a free throw belongs to the set being taken: its shooter and whether it is technical
  const ev: EngineEvent = set ? { ...ev0, payload: { ...p0, technical: set.technical, ...(p0.player == null && set.player ? { player: set.player } : {}) } } : ev0;

  // the team given the ball after a dead ball has it once it acts; a change of possession by rule ends it too
  const acting = ev.type === "GOALTENDING" ? otherSide(side) : side;
  if (s.dead && ((PLAY_EVENTS.has(ev.type) && acting === s.dead.to) || ["STEAL", "JUMP_BALL", "HELD_BALL", "PERIOD_END"].includes(ev.type))) s.dead = null;

  const cap = shotClockCapFor(s, ev, rules);
  updateBase(s, ev, ctx, rules);
  s.shotClockCap = isNonNegInt(ev.payload.shotClock) ? ev.payload.shotClock : cap;
  if (["PERIOD_START", "PERIOD_END", "SHOT_MADE", "FREE_THROW_MADE", "GOALTENDING", "TURNOVER", "VIOLATION", "OUT_OF_BOUNDS"].includes(ev.type) && !isNonNegInt(ev.payload.shotClock)) s.shotClockCap = null;

  if (set) {
    set.taken += 1;
    if (ev.type === "FREE_THROW_MADE") set.made += 1;
    if (set.taken >= set.total || (set.oneAndOne && set.taken === 1 && ev.type === "FREE_THROW_MISSED")) {
      s.freeThrows.shift();
      if (!s.freeThrows.length) s.freeThrowsDone = `${set.player ? `${playerName(ctx, set.player)}'s` : `${sideName(ctx, set.side)}'s`} ${set.oneAndOne && set.taken === 1 ? "one-and-one ended on the miss" : `${set.total === 1 ? "free throw has" : `${set.total} free throws have all`} been taken`}`;
    }
  } else if (!FT_EVENTS.has(ev.type)) {
    s.freeThrowsDone = null;
  }
  explain(s, ev, ctx, rules, before, ballBefore, attempt);
  return s;
}

/** The reason for a score or possession change, from the event that caused it. */
function explain(s: BasketballState, ev: EngineEvent, ctx: MatchContext, rules: BasketballRules, before: Record<Side, number>,
  ballBefore: Side | null, attempt: { n: number; of: number; oneAndOne: boolean; technical: boolean } | null): void {
  const p = ev.payload;
  const side = p.side as Side;
  if (!isSide(side) && ev.type !== "HELD_BALL") return;
  const who = str(p.player) ? playerName(ctx, str(p.player)) : isSide(side) ? sideName(ctx, side) : "";
  const ft = attempt ? `${attempt.technical ? "technical " : ""}free throw ${attempt.n} of ${attempt.of}` : `${p.technical ? "technical " : ""}free throw`;
  const value = (pts: number) => (pts === rules.threePointValue ? "three" : "two");
  const scored = (sc: Side, what: string) => {
    const pts = s.score[sc] - before[sc];
    pushRecent(s, { seq: ev.seq, kind: "score", side: sc, points: pts, text: `${sideName(ctx, sc)}'s score changed from ${before[sc]} to ${s.score[sc]} because ${what} (+${pts}).` });
  };
  switch (ev.type) {
    case "SHOT_MADE": scored(side, `${who} made a ${value(p.points as number)}-point field goal`); break;
    case "FREE_THROW_MADE": scored(side, `${who} made ${ft}${attempt ? "" : " (no foul was recorded for it)"}`); break;
    case "GOALTENDING": {
      const sc = otherSide(side);
      scored(sc, `goaltending was called on ${who}, so the ${value(p.points as number)}-point shot${str(p.shooter) ? ` by ${playerName(ctx, str(p.shooter))}` : ""} counts`);
      break;
    }
    case "SHOT_MISSED":
      pushRecent(s, { seq: ev.seq, kind: "no_score", side, points: 0, text: `The score did not change: ${who}'s ${value(p.points as number)}-point shot was recorded as missed.` });
      break;
    case "FREE_THROW_MISSED":
      pushRecent(s, { seq: ev.seq, kind: "no_score", side, points: 0, text: `The score did not change: ${who} missed ${ft}.${attempt?.oneAndOne && attempt.n === 1 ? " It was the front end of a one-and-one, so there is no second shot." : ""}` });
      break;
    case "VIOLATION": {
      const offensive = (OFFENSIVE_VIOLATIONS as readonly string[]).includes(p.kind as string);
      pushRecent(s, { seq: ev.seq, kind: "violation", side, points: 0, text: offensive
        ? `${sideName(ctx, otherSide(side))} get the ball: ${who} ${label(String(p.kind))}. A violation changes possession, never the score.`
        : `${sideName(ctx, otherSide(side))} keep the ball: ${who} ${label(String(p.kind))}. The score is unchanged.` });
      return;
    }
    case "OUT_OF_BOUNDS":
      pushRecent(s, { seq: ev.seq, kind: "violation", side, points: 0, text: `${sideName(ctx, otherSide(side))} get the ball: ${who} put it out of bounds. The score is unchanged.` });
      return;
  }
  if (s.ball && s.ball !== ballBefore) {
    const to = sideName(ctx, s.ball);
    const reason: Record<string, string> = {
      SHOT_MADE: `after ${sideName(ctx, side)}'s basket, ${to} inbound the ball`,
      FREE_THROW_MADE: `after the made free throw, ${to} inbound the ball`,
      GOALTENDING: `after the awarded basket, ${to} inbound the ball`,
      REBOUND: `${who} took the ${p.offensive ? "offensive" : "defensive"} rebound`,
      STEAL: `${who} stole the ball`,
      TURNOVER: `${who} turned the ball over`,
      JUMP_BALL: `${to} won the jump ball`,
      HELD_BALL: "held ball: the possession arrow decided it",
      FOUL: `${who} committed an offensive foul`,
    };
    if (reason[ev.type]) pushRecent(s, { seq: ev.seq, kind: "possession", side: s.ball, points: 0, text: `${to} have the ball because ${reason[ev.type]}.` });
  }
}

function shotRecord(s: BasketballState, ev: EngineEvent, side: Side, player: string | null, points: number, madeShot: boolean, clock: number | null): ShotRecord {
  const p = ev.payload;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  return {
    seq: ev.seq, side, player, points, made: madeShot,
    zone: (p.zone as ShotZone | undefined) ?? (p.paint ? "paint" : null),
    shotType: (p.shotType as ShotType | undefined) ?? null,
    x: num(p.x), y: num(p.y), period: s.period, clock,
    assisted: typeof p.assist === "string", fastBreak: p.fastBreak === true,
    clutch: false,
  };
}

function recordFoul(s: BasketballState, ev: EngineEvent, ctx: MatchContext, rules: BasketballRules, side: Side, who: string | null, clutch: boolean): void {
  const p = ev.payload;
  const kind = (p.kind ?? "personal") as FoulKind;
  const shooting = otherSide(side);
  const window = foulWindow(s.period, rules);
  const committedBefore = s.teamFouls[side][window] ?? 0;
  const inPenalty = committedBefore >= bonusThreshold(s.period, rules);
  const doubleBonus = rules.doubleBonusAfterFouls !== null && committedBefore >= rules.doubleBonusAfterFouls;
  // the shot this foul was committed on, when it is the event just before
  const last = s.shots[s.shots.length - 1];
  const onShot = last && last.seq === s.lastSeq && last.side === shooting ? last : null;
  const given = isNonNegInt(p.freeThrows) ? p.freeThrows : null;
  const fromShot = onShot ? (onShot.made ? 1 : onShot.points) : null;
  let awarded: number | null;
  let why: string;
  let oneAndOne = false;
  switch (kind) {
    case "offensive": awarded = 0; why = "an offensive foul gives no free throws"; break;
    case "technical": awarded = given ?? rules.technicalFreeThrows; why = "a technical foul"; break;
    case "unsportsmanlike": case "disqualifying":
      awarded = given ?? fromShot ?? rules.unsportsmanlikeFreeThrows; why = `${foulKindName(kind, rules)} foul`; break;
    case "shooting":
      awarded = given ?? fromShot;
      why = onShot ? (onShot.made ? "and-one: the basket counted and the shooter was fouled" : `fouled on a missed ${onShot.points}-point shot`) : "shooting foul";
      break;
    default:
      if (given !== null) { awarded = given; why = "personal foul"; }
      else if (inPenalty) {
        awarded = rules.bonusFreeThrows;
        oneAndOne = rules.oneAndOne && !doubleBonus && awarded === 2;
        why = `${sideName(ctx, side)} had ${committedBefore} team fouls: ${sideName(ctx, shooting)} ${oneAndOne ? "shoot a one-and-one" : doubleBonus ? "are in the double bonus" : "are in the bonus"}`;
      } else { awarded = 0; why = `${sideName(ctx, side)} are not in the penalty yet (${committedBefore + 1} team foul${committedBefore === 0 ? "" : "s"})`; }
  }
  // fouled while missing: the miss is not a field goal attempt, and the free throws decide the possession
  if (onShot && !onShot.made && (kind === "shooting" || kind === "unsportsmanlike" || kind === "disqualifying")) {
    onShot.fouled = true;
    credit(s, shooting, onShot.player, "fga", -1, onShot.clutch ?? false);
    if (onShot.points === rules.threePointValue) credit(s, shooting, onShot.player, "tpa", -1, onShot.clutch ?? false);
    if (s.ending === "miss") s.ending = null;
    s.ball = shooting;
  }
  const shooter = kind === "technical" ? null : str(p.on) ?? onShot?.player ?? null;
  if (awarded && awarded > 0) {
    const set: FreeThrowSet = { side: shooting, player: shooter, total: awarded, taken: 0, made: 0, technical: kind === "technical", oneAndOne, reason: why };
    // technical free throws are taken straight away
    if (set.technical) s.freeThrows.unshift(set); else s.freeThrows.push(set);
  }
  const fouler = who ? playerName(ctx, who) : kind === "technical" ? `${sideName(ctx, side)} bench` : sideName(ctx, side);
  const award = awarded === null ? "free throws not stated" : awarded === 0 ? "no free throws" : `${awarded} free throw${awarded === 1 ? "" : "s"} to ${shooter ? playerName(ctx, shooter) : sideName(ctx, shooting)}${oneAndOne ? " (one-and-one)" : ""}`;
  pushRecent(s, { seq: ev.seq, kind: "foul", side, points: 0, text: `${fouler}: ${kind === "personal" ? "" : `${foulKindName(kind, rules)} `}foul. ${award[0].toUpperCase()}${award.slice(1)}, because ${why}.` });
  if (awarded && awarded > 0) s.log.push({ seq: ev.seq, text: `${award[0].toUpperCase()}${award.slice(1)} (${why})` });

  const countsTowardLimit = kind !== "technical" || rules.technicalsCountTowardFoulLimit;
  if (countsTowardLimit) credit(s, side, who, "pf", 1, clutch);
  if (kind === "shooting") credit(s, side, who, "foulsShooting", 1, clutch);
  if (kind === "offensive") {
    credit(s, side, who, "foulsOffensive", 1, clutch);
    // an offensive foul is also a turnover
    credit(s, side, who, "tov", 1, clutch);
    s.ending = "turnover"; s.ball = otherSide(side);
  }
  if (kind === "technical") credit(s, side, who, who ? "techs" : "benchTechs", 1, clutch);
  if (kind === "unsportsmanlike") credit(s, side, who, "unsportsmanlike", 1, clutch);
  if (kind === "disqualifying") credit(s, side, who, "disqualifying", 1, clutch);
  if (str(p.on)) add((s.players[str(p.on)!] ??= {}), "pfd");

  const teamFoul = kind === "personal" || kind === "shooting" || kind === "unsportsmanlike" || kind === "disqualifying"
    || (kind === "offensive" && rules.offensiveFoulsAreTeamFouls)
    || (kind === "technical" && rules.technicalsAreTeamFouls && who !== null);
  if (teamFoul) s.teamFouls[side][window] = committedBefore + 1;
  if (awarded === null) add(s.team[side], "foulsFtUnknown");
  else add(s.team[side], "ftAwarded", awarded);

  if (!who) return;
  const pl = s.players[who] ?? {};
  const reason =
    kind === "disqualifying" ? "disqualified"
    : n0(pl, "pf") >= rules.foulLimit ? "fouled_out"
    : rules.technicalEjectAt !== null && n0(pl, "techs") >= rules.technicalEjectAt ? "disqualified"
    : rules.unsportsmanlikeEjectAt !== null && n0(pl, "unsportsmanlike") >= rules.unsportsmanlikeEjectAt ? "disqualified"
    : rules.combinedEjectAt !== null && n0(pl, "techs") + n0(pl, "unsportsmanlike") >= rules.combinedEjectAt ? "disqualified"
    : null;
  if (reason && !s.out[who]) {
    s.out[who] = reason;
    s.log.push({ seq: ev.seq, text: `${playerName(ctx, who)} ${reason === "fouled_out" ? "fouled out" : "is disqualified"}` });
    // they leave the floor; the scorer names the replacement with a substitution or lineup
    const court = s.onCourt[side];
    if (court) s.onCourt[side] = court.filter((id) => id !== who);
  }
}

// ── analytics ───────────────────────────────────────────────────────

function basketballAnalytics(s: BasketballState, ctx: MatchContext, rules: BasketballRules): Analytics {
  const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
  const lead = leadStats(s.scoring);
  const runs = scoringRunsOf(s.scoring, 6);
  const best = (side: Side) => runs.filter((r) => r.side === side).reduce((m, r) => Math.max(m, r.points), 0);
  const back = comebacks(s.scoring);
  const dry = droughts(s, rules);
  const periodLabels = Array.from({ length: s.period }, (_, i) => periodName(i + 1, rules));
  const tv = { a: teamValues(s, ctx, rules, "a"), b: teamValues(s, ctx, rules, "b") };
  const rows = playerRows(s, ctx, rules);
  const tracked = tracksShots(s, rules);
  const num = (v: StatValue) => (typeof v === "number" ? v : null);

  const cards: AnalyticsCard[] = [
    { label: "Lead changes", value: String(lead.leadChanges) },
    { label: "Times tied", value: String(lead.timesTied) },
    { label: "Largest lead", value: `${names.a} ${lead.largestLead.a}, ${names.b} ${lead.largestLead.b}` },
    { label: "Best run", value: `${names.a} ${best("a")}, ${names.b} ${best("b")}`, hint: "Most unanswered points, runs of 6 or more" },
    { label: "Biggest comeback", value: `${names.a} ${back.a}, ${names.b} ${back.b}`, hint: "Largest deficit overcome to take the lead" },
  ];
  if (tracked) {
    const inferred = s.possessions.filter((x) => x.inferred).length;
    cards.push({ label: "Possessions", value: `${names.a} ${tv.a.possessions ?? 0}, ${names.b} ${tv.b.possessions ?? 0}`, hint: inferred ? `Counted from play-by-play; ${inferred} worked out from the rules (the ball changes hands after a score)` : "Counted from play-by-play" });
    if (tv.a.pace !== null) cards.push({ label: "Pace", value: String(tv.a.pace), hint: `Possessions per ${rules.periods * rules.periodMinutes} minutes` });
    if (tv.a.ppp !== null || tv.b.ppp !== null) cards.push({ label: "Points per possession", value: `${names.a} ${tv.a.ppp ?? "n/a"}, ${names.b} ${tv.b.ppp ?? "n/a"}` });
  }

  // ── game leaders ──
  const leaderRows: StatRow[] = [];
  const cats: [string, string, (r: StatRow) => number | null][] = [
    ["pts", "Points", (r) => num(r.values.pts)], ["reb", "Rebounds", (r) => num(r.values.reb)], ["ast", "Assists", (r) => num(r.values.ast)],
    ["stl", "Steals", (r) => num(r.values.stl)], ["blk", "Blocks", (r) => num(r.values.blk)], ["tpm", "Three pointers made", (r) => num(r.values.tpm)],
    ["fgPct", "FG% (5 or more attempts)", (r) => (num(r.values.fga) ?? 0) >= 5 ? num(r.values.fgPct) : null], ["plusMinus", "Plus/minus", (r) => num(r.values.plusMinus)],
  ];
  for (const [key, title, get] of cats) {
    const ranked = rows.map((r) => ({ r, v: get(r) })).filter((x): x is { r: StatRow; v: number } => x.v !== null && (key === "plusMinus" || x.v > 0)).sort((x, y) => y.v - x.v);
    if (!ranked.length) continue;
    const top = ranked.filter((x) => x.v === ranked[0].v);
    leaderRows.push({ id: key, name: title, side: top.length === 1 ? top[0].r.side : null, values: { who: top.map((x) => x.r.name).join(", "), value: ranked[0].v } });
  }
  const doubles = rows.filter((r) => isDouble(withReb(s.players[r.id] ?? {}), 2));

  // ── shots ──
  // a fouled miss is not a field goal attempt
  const zoneShots = s.shots.filter((x) => x.zone && !x.fouled);
  const typedShots = s.shots.filter((x) => x.shotType && !x.fouled);
  const zoneRows: StatRow[] = SHOT_ZONES.flatMap((z) => SIDES.map((side) => {
    const list = zoneShots.filter((x) => x.zone === z && x.side === side);
    const m = list.filter((x) => x.made);
    return { id: `${z}-${side}`, name: `${label(z)}: ${names[side]}`, side, values: { fgm: m.length, fga: tracked ? list.length : null, fgPct: tracked ? round(pct(m.length, list.length), 1) : null, pts: m.reduce((t, x) => t + x.points, 0) } };
  })).filter((r) => (r.values.fgm as number) > 0 || (r.values.fga ?? 0) > 0);
  const typeRows: StatRow[] = SHOT_TYPES.flatMap((t) => SIDES.map((side) => {
    const list = typedShots.filter((x) => x.shotType === t && x.side === side);
    const m = list.filter((x) => x.made);
    return { id: `${t}-${side}`, name: `${label(t)}: ${names[side]}`, side, values: { fgm: m.length, fga: tracked ? list.length : null, fgPct: tracked ? round(pct(m.length, list.length), 1) : null } };
  })).filter((r) => (r.values.fgm as number) > 0 || (r.values.fga ?? 0) > 0);
  const assisted = SIDES.map((side) => {
    const m = s.shots.filter((x) => x.made && x.side === side);
    return { side, pct: round(pct(m.filter((x) => x.assisted).length, m.length), 1) };
  });

  // ── possessions ──
  const possBy = (side: Side) => s.possessions.filter((x) => x.side === side && x.endSeq !== null);
  const resultRows: StatRow[] = tracked ? (["score", "turnover", "miss", "held_ball", "period_end", "other"] as PossessionResult[]).map((res) => ({
    id: res, name: { score: "Scored", turnover: "Turnover", miss: "Missed, defensive rebound", held_ball: "Held or jump ball", period_end: "End of period", other: "Other" }[res], side: null,
    values: Object.fromEntries(SIDES.flatMap((side) => {
      const list = possBy(side).filter((x) => x.result === res);
      return [[`n_${side}`, list.length], [`pts_${side}`, list.reduce((t, x) => t + x.points, 0)]];
    })),
  })).filter((r) => SIDES.some((side) => (r.values[`n_${side}`] as number) > 0)) : [];
  const timedPoss = s.possessions.filter((x) => x.endSeq !== null && x.startClock !== null && x.endClock !== null && x.startClock >= x.endClock);
  const avgLen = (side: Side) => {
    const list = timedPoss.filter((x) => x.side === side);
    return list.length ? round(list.reduce((t, x) => t + (x.startClock! - x.endClock!), 0) / list.length, 1) : null;
  };

  // ── clutch ──
  const clutchOk = s.clutch.seen && !s.clutch.unknown;
  const clutchRows: StatRow[] = clutchOk ? SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
    const c = s.clutch.players[pl.id] ?? {};
    return {
      id: pl.id, name: pl.name, side,
      values: {
        pts: n0(c, "pts"), fg: made(c, "fgm", "fga"), fgPct: tracked ? round(pct(n0(c, "fgm"), c.fga), 1) : null,
        tpPct: tracked ? round(pct(n0(c, "tpm"), c.tpa), 1) : null, ftPct: tracked ? round(pct(n0(c, "ftm"), c.fta), 1) : null,
        reb: n0(c, "oreb") + n0(c, "dreb"), ast: n0(c, "ast"), tov: n0(c, "tov"), stl: n0(c, "stl"), blk: n0(c, "blk"),
        plusMinus: s.plusMinusValid && lineupsKnown(s) ? n0(c, "plusMinus") : null,
      },
    };
  }).filter((r) => Object.entries(r.values).some(([k, v]) => k !== "fg" && typeof v === "number" && v !== 0))) : [];

  // ── insights: plain sentences, each from a recorded figure ──
  const insights: string[] = [];
  if (s.period > 0) {
    const margin = Math.abs(s.score.a - s.score.b);
    const leader: Side | null = s.score.a === s.score.b ? null : s.score.a > s.score.b ? "a" : "b";
    insights.push(leader ? `${names[leader]} lead by ${margin} (${s.score.a}-${s.score.b}).` : `The score is level at ${s.score.a}.`);
    if (s.period > rules.periods) insights.push(`The game went to ${s.period - rules.periods === 1 ? "overtime" : `${s.period - rules.periods} overtimes`}.`);
    const bigRun = [...runs].sort((x, y) => y.points - x.points)[0];
    if (bigRun && bigRun.points >= RUN_ALERT) insights.push(`${names[bigRun.side]} had a ${bigRun.points}-0 run in ${periodName(bigRun.period, rules)}${bigRun.seconds !== null ? ` over ${formatClock(bigRun.seconds)}` : ""}.`);
    for (const side of SIDES) if (back[side] >= 5) insights.push(`${names[side]} came back from ${back[side]} points down to take the lead.`);
    if (lead.leadChanges >= 5) insights.push(`The lead changed hands ${lead.leadChanges} times.`);
    for (const side of SIDES) {
      const top = rows.filter((r) => r.side === side).sort((x, y) => (num(y.values.pts) ?? 0) - (num(x.values.pts) ?? 0))[0];
      if (top && (num(top.values.pts) ?? 0) > 0) insights.push(`${top.name} leads ${names[side]} with ${top.values.pts} points.`);
    }
    for (const r of doubles) insights.push(`${r.name} has a ${isDouble(withReb(s.players[r.id] ?? {}), 3) ? "triple" : "double"}-double.`);
    const t3 = { a: n0(s.team.a, "tpm"), b: n0(s.team.b, "tpm") };
    if (Math.abs(t3.a - t3.b) >= 3) { const more: Side = t3.a > t3.b ? "a" : "b"; insights.push(`${names[more]} made ${Math.abs(t3.a - t3.b)} more threes (${Math.abs(t3.a - t3.b) * rules.threePointValue} points from the difference).`); }
    if (tracked && tv.a.fgPct !== null && tv.b.fgPct !== null) insights.push(`Field goal shooting: ${names.a} ${tv.a.fgPct}%, ${names.b} ${tv.b.fgPct}%.`);
    for (const side of SIDES) {
      const off = num(tv[side].ptsOffTov);
      if (tracked && off !== null && off >= 6) insights.push(`${names[side]} scored ${off} points off ${n0(s.team[otherSide(side)], "tov")} ${names[otherSide(side)]} turnovers.`);
      const sc = num(tv[side].secondChancePts);
      if (tracked && sc !== null && sc >= 6) insights.push(`${names[side]} scored ${sc} second chance points from ${n0(s.team[side], "oreb")} offensive rebounds.`);
      const d = dry[side];
      if (d && d.seconds >= 180) insights.push(`${names[side]} went ${formatClock(d.seconds)} without scoring in ${periodName(d.period, rules)}.`);
    }
    for (const [id, why] of Object.entries(s.out)) insights.push(`${playerName(ctx, id)} ${why === "fouled_out" ? "fouled out" : "was disqualified"}.`);
    if (clutchOk) insights.push(`Clutch time was reached (last ${rules.clutchMinutes} minutes, within ${rules.clutchMargin} points).`);
  }

  const charts: Chart[] = [
    { key: "by-period", title: "Scoring by period", type: "bar", labels: periodLabels, series: SIDES.map((side) => ({ name: names[side], side, values: periodLabels.map((_, i) => s.byPeriod[side][i] ?? 0) })), format: "int" },
    { key: "progression", title: "Score progression", type: "line", labels: ["0", ...s.scoring.map((_, i) => String(i + 1))], series: SIDES.map((side) => ({ name: names[side], side, values: [0, ...s.scoring.map((e) => e[side])] })), format: "int" },
    { key: "margin", title: `Game flow (${names.a} lead)`, type: "line", labels: ["0", ...s.scoring.map((_, i) => String(i + 1))], series: [{ name: `${names.a} margin`, side: "a", values: [0, ...s.scoring.map((e) => e.a - e.b)] }], format: "int" },
  ];
  if (tracked) {
    charts.push({
      key: "shooting", title: "Shooting efficiency %", type: "bar", labels: ["FG%", "3P%", "FT%", "eFG%", "TS%"], format: "dec1",
      series: SIDES.map((side) => ({ name: names[side], side, values: ["fgPct", "tpPct", "ftPct", "efgPct", "tsPct"].map((k) => num(tv[side][k])) })),
    });
    charts.push({
      key: "ppp-by-period", title: "Points per possession by period", type: "bar", labels: periodLabels, format: "dec1",
      series: SIDES.map((side) => ({ name: names[side], side, values: periodLabels.map((_, i) => {
        const list = s.possessions.filter((x) => x.side === side && x.period === i + 1);
        return list.length ? round(list.reduce((t, x) => t + x.points, 0) / list.length, 2) : null;
      }) })),
    });
  }
  charts.push({
    key: "comparison", title: "Team comparison", type: "bar", labels: ["Rebounds", "Assists", "Turnovers", "Steals", "Blocks", "Fouls"], format: "int",
    series: SIDES.map((side) => ({ name: names[side], side, values: [n0(s.team[side], "oreb") + n0(s.team[side], "dreb"), n0(s.team[side], "ast"), n0(s.team[side], "tov"), n0(s.team[side], "stl"), n0(s.team[side], "blk"), n0(s.team[side], "pf")] })),
  });
  if (zoneShots.length) {
    const zones = SHOT_ZONES.filter((z) => zoneShots.some((x) => x.zone === z));
    charts.push({
      key: "zones", title: tracked ? "Shot distribution (attempts by zone)" : "Made shots by zone", type: "bar", labels: zones.map(label), format: "int",
      series: SIDES.map((side) => ({ name: names[side], side, values: zones.map((z) => zoneShots.filter((x) => x.zone === z && x.side === side && (tracked || x.made)).length) })),
    });
  }
  if (runs.length) {
    charts.push({
      key: "runs", title: "Scoring runs (6 or more unanswered)", type: "bar", labels: runs.map((r, i) => `${periodName(r.period, rules)} #${i + 1}`), format: "int",
      series: SIDES.map((side) => ({ name: names[side], side, values: runs.map((r) => (r.side === side ? r.points : null)) })),
    });
  }

  const tables: StatTable[] = [
    { key: "leaders", title: "Game leaders", columns: [col("who", "Player", "raw", "text"), col("value", "Value", "raw", "dec1")], rows: leaderRows },
    {
      key: "contribution", title: "Player contribution",
      columns: [col("pts", "PTS"), col("share", "Share of team points %", "derived", "pct")],
      rows: SIDES.flatMap((side) => playersOf(ctx, side)
        .map((pl) => ({ pl, pts: n0(s.players[pl.id], "pts") }))
        .filter((x) => x.pts > 0).sort((x, y) => y.pts - x.pts)
        .map((x) => ({ id: x.pl.id, name: x.pl.name, side, values: { pts: x.pts, share: round(pct(x.pts, s.score[side]), 1) } }))),
    },
    {
      key: "runs", title: "Scoring runs (6 or more unanswered)",
      columns: [col("period", "Period", "raw", "text"), col("points", "Points"), col("duration", "Game time", "derived", "text")],
      rows: runs.map((r, i) => ({ id: String(i), name: names[r.side], side: r.side, values: { period: periodName(r.period, rules), points: r.points, duration: r.seconds !== null ? formatClock(r.seconds) : null } })),
    },
    {
      key: "momentum", title: "Momentum",
      columns: [col("largestLead", "Largest lead"), col("bestRun", "Best run"), col("comeback", "Biggest comeback", "derived"), col("drought", "Longest scoring drought", "derived", "text"), col("assistedPct", "Assisted baskets %", "derived", "pct"), col("avgPoss", "Average possession (s)", "derived", "dec1")],
      rows: SIDES.map((side) => ({
        id: side, name: names[side], side,
        values: { largestLead: lead.largestLead[side], bestRun: best(side), comeback: back[side], drought: dry[side] ? `${formatClock(dry[side]!.seconds)} (${periodName(dry[side]!.period, rules)})` : null, assistedPct: assisted.find((x) => x.side === side)!.pct, avgPoss: avgLen(side) },
      })),
    },
  ];
  if (resultRows.length) {
    tables.push({
      key: "possessions", title: "How possessions ended",
      columns: [col("n_a", `${names.a} possessions`), col("pts_a", `${names.a} points`), col("n_b", `${names.b} possessions`), col("pts_b", `${names.b} points`)],
      rows: resultRows,
    });
  }
  if (zoneRows.length) tables.push({ key: "zones", title: "Shooting by zone", columns: [col("fgm", "FGM"), col("fga", "FGA"), col("fgPct", "FG%", "derived", "pct"), col("pts", "PTS")], rows: zoneRows });
  if (typeRows.length) tables.push({ key: "shotTypes", title: "Shooting by shot type", columns: [col("fgm", "FGM"), col("fga", "FGA"), col("fgPct", "FG%", "derived", "pct")], rows: typeRows });
  if (clutchRows.length) {
    tables.push({
      key: "clutch", title: `Clutch (last ${rules.clutchMinutes} minutes, within ${rules.clutchMargin} points)`,
      columns: [col("pts", "PTS"), col("fg", "FG", "raw", "text"), col("fgPct", "FG%", "derived", "pct"), col("tpPct", "3P%", "derived", "pct"), col("ftPct", "FT%", "derived", "pct"),
        col("reb", "REB"), col("ast", "AST"), col("tov", "TOV"), col("stl", "STL"), col("blk", "BLK"), col("plusMinus", "+/-", "derived")],
      rows: clutchRows,
    });
  }
  if (s.clutch.unknown && s.period >= rules.periods) insights.push(`Clutch figures need a clock on every event in the last ${rules.clutchMinutes} minutes; some events had none.`);

  return { cards, charts, tables, insights };
}
