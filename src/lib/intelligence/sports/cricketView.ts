// What the cricket screens show, worked out from the engine's state.
// Read-only: nothing here changes the score. The scorer console and the
// public match centre both use it, so a figure reads the same on each.

import type { MatchContext, Participant, Side } from "../core/types";
import { playerName, ratio, round } from "../core/util";
import { dismissalText, oversText, runRate, type CricketInnings, type CricketRules, type CricketState } from "./cricket";

type Bat = CricketInnings["batters"][string];
type Over = CricketInnings["overs"][number];

export const ordinal = (n: number): string => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/** The match's innings then any super overs (CricketState.superOvers). */
export function allInnings(s: CricketState): CricketInnings[] {
  return [...s.innings, ...(s.superOvers ?? [])];
}

/** The innings being played, or the last one played (a super over once one starts). */
export function latestInnings(s: CricketState): CricketInnings | null {
  return allInnings(s).at(-1) ?? null;
}

/** "Super over", "Super over 2", or "2nd innings". */
export function inningsName(inn: CricketInnings, s?: CricketState): string {
  if (!inn.superOver) return `${ordinal(inn.n)} innings`;
  const many = s ? (s.superOvers?.length ?? 0) > 2 : inn.superOver > 1;
  return many ? `Super over ${inn.superOver}` : "Super over";
}

/** The innings being played, if one is open. */
export function openInnings(s: CricketState): CricketInnings | null {
  const i = latestInnings(s);
  return i && !i.closed ? i : null;
}

export interface LiveNumbers {
  runs: number;
  wickets: number;
  overs: string;
  maxOvers: number | null;
  crr: number | null;
  target: number | null;
  need: number | null;
  ballsLeft: number | null;
  rrr: number | null;
}

export function liveNumbers(inn: CricketInnings, rules: CricketRules): LiveNumbers {
  const need = inn.target === null ? null : Math.max(0, inn.target - inn.runs);
  const ballsLeft = inn.maxBalls === null ? null : Math.max(0, inn.maxBalls - inn.balls);
  return {
    runs: inn.runs, wickets: inn.wickets,
    overs: oversText(inn.balls, rules.ballsPerOver),
    maxOvers: inn.maxBalls === null ? null : inn.maxBalls / rules.ballsPerOver,
    crr: round(runRate(inn.runs, inn.balls, rules.ballsPerOver), 2),
    target: inn.target, need, ballsLeft,
    rrr: need === null || ballsLeft === null ? null : round(runRate(need, ballsLeft, rules.ballsPerOver), 2),
  };
}

export const strikeRate = (runs: number, balls: number): number | null => round(ratio(runs * 100, balls), 2);
export const economy = (runs: number, balls: number, ballsPerOver = 6): number | null => round(runRate(runs, balls, ballsPerOver), 2);
export const fmt = (n: number | null, places = 2): string => (n === null ? "–" : n.toFixed(places));

export function participant(ctx: MatchContext, id: string | null | undefined): Participant | null {
  if (!id || !ctx.sides) return null;
  return [...ctx.sides.a.players, ...ctx.sides.b.players].find((p) => p.id === id) ?? null;
}

// ── batting ─────────────────────────────────────────────────────

export interface BatterLine {
  id: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  sr: number | null;
  out: boolean;
  /** "c Bikash b Suman", "not out", "retired hurt" */
  how: string;
  atCrease: boolean;
  onStrike: boolean;
}

function batterLine(inn: CricketInnings, id: string, b: Bat, ctx: MatchContext): BatterLine {
  return {
    id, name: playerName(ctx, id), runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes,
    sr: strikeRate(b.runs, b.balls), out: b.out,
    how: b.out ? dismissalText(b, ctx) : b.retiredHurt ? "retired hurt" : "not out",
    atCrease: inn.striker === id || inn.nonStriker === id, onStrike: inn.striker === id,
  };
}

/** The two batters at the crease, striker first. */
export function crease(inn: CricketInnings, ctx: MatchContext): BatterLine[] {
  return [inn.striker, inn.nonStriker].filter((id): id is string => !!id && !!inn.batters[id]).map((id) => batterLine(inn, id, inn.batters[id], ctx));
}

export function battingCard(inn: CricketInnings, ctx: MatchContext): { lines: BatterLine[]; yetToBat: Participant[] } {
  const lines = Object.entries(inn.batters).sort((x, y) => x[1].order - y[1].order).map(([id, b]) => batterLine(inn, id, b, ctx));
  const yetToBat = (ctx.sides?.[inn.batting].players ?? []).filter((p) => !inn.batters[p.id]);
  return { lines, yetToBat };
}

// ── bowling ─────────────────────────────────────────────────────

export interface BowlerLine {
  id: string;
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  noBalls: number;
  dots: number;
  econ: number | null;
  /** "2.2-0-18-2" */
  figures: string;
}

const isDot = (tag: string) => tag === "0" || tag === "W";

export function bowlerLine(inn: CricketInnings, id: string, ctx: MatchContext, rules: CricketRules): BowlerLine | null {
  const b = inn.bowlers[id];
  if (!b) return null;
  const overs = oversText(b.balls, rules.ballsPerOver);
  const dots = inn.overs.filter((o) => o.bowler === id).reduce((t, o) => t + o.balls.filter(isDot).length, 0);
  return {
    id, name: playerName(ctx, id), overs, maidens: b.maidens, runs: b.runs, wickets: b.wickets, wides: b.wides, noBalls: b.noBalls, dots,
    econ: economy(b.runs, b.balls, rules.ballsPerOver), figures: `${overs}-${b.maidens}-${b.runs}-${b.wickets}`,
  };
}

/** In the order they first bowled. */
export function bowlingCard(inn: CricketInnings, ctx: MatchContext, rules: CricketRules): BowlerLine[] {
  const order = [...new Set(inn.overs.map((o) => o.bowler))];
  for (const id of Object.keys(inn.bowlers)) if (!order.includes(id)) order.push(id);
  return order.map((id) => bowlerLine(inn, id, ctx, rules)).filter((x): x is BowlerLine => !!x);
}

// ── overs and balls ─────────────────────────────────────────────

/** The over in progress, or the one just finished (so "this over" never goes blank between overs). */
export function thisOver(inn: CricketInnings): Over | null {
  return inn.overs[inn.overs.length - 1] ?? null;
}

export function overComplete(o: Over | null, rules: CricketRules): boolean {
  return !!o && o.legal >= rules.ballsPerOver;
}

export type BallTone = "dot" | "run" | "four" | "six" | "wicket" | "extra";

/** The engine's ball tags ("0", "4", "1wd", "2nb", "1lb", "W", "1+W") as a badge. */
export function ballBadge(tag: string): { text: string; tone: BallTone } {
  if (tag === "W" || tag.endsWith("+W")) return { text: "W", tone: "wicket" };
  const m = /^(\d+)(wd|nb|b|lb)$/.exec(tag);
  if (m) {
    const n = Number(m[1]);
    const kind = m[2] === "wd" ? "WD" : m[2] === "nb" ? "NB" : m[2] === "b" ? "B" : "LB";
    // a wide or no-ball shows its runs beyond the one-run penalty: "WD", "2WD"
    const extra = kind === "WD" || kind === "NB" ? n - 1 : n;
    return { text: extra > 0 ? `${extra}${kind}` : kind, tone: "extra" };
  }
  if (tag === "0") return { text: "0", tone: "dot" };
  if (tag === "4") return { text: "4", tone: "four" };
  if (tag === "6") return { text: "6", tone: "six" };
  return { text: tag, tone: "run" };
}

export interface OverSummary {
  n: number;
  bowler: string;
  runs: number;
  wickets: number;
  balls: string[];
  /** the batting side's score at the end of the over */
  score: string;
}

export function overSummaries(inn: CricketInnings, ctx: MatchContext): OverSummary[] {
  let runs = 0, wkts = 0;
  return inn.overs.map((o) => {
    runs += o.runs; wkts += o.wickets;
    return { n: o.n, bowler: playerName(ctx, o.bowler), runs: o.runs, wickets: o.wickets, balls: o.balls, score: `${runs}/${wkts}` };
  });
}

// ── extras, wickets, partnerships ───────────────────────────────

export function extrasOf(inn: CricketInnings): { wides: number; noBalls: number; byes: number; legByes: number; penalty: number; total: number } {
  const e = inn.extras;
  return { ...e, total: e.wides + e.noBalls + e.byes + e.legByes + e.penalty };
}

export function fallOfWickets(inn: CricketInnings, ctx: MatchContext, rules: CricketRules): { wicket: number; score: string; over: string; name: string }[] {
  return inn.fow.map((f) => ({ wicket: f.wicket, score: `${f.runs}-${f.wicket}`, over: oversText(f.balls, rules.ballsPerOver), name: playerName(ctx, f.player) }));
}

export interface PartnershipLine {
  wicket: number;
  runs: number;
  /** legal balls: a wide or no-ball adds runs but no ball */
  balls: number;
  /** each batter's own runs and balls faced in this partnership; null for a match scored before these were kept */
  batters: { id: string; name: string; runs: number | null; balls: number | null }[];
  /** the partnership's runs not off either bat: wides, no-balls, byes, leg byes */
  extras: number | null;
  fours: number | null;
  sixes: number | null;
  /** runs an over, from legal balls (32 balls is 5.33 overs, never "5.2") */
  runRate: number | null;
  /** "38/1" and "5.4" when it began and ended (end: so far, for the one in progress) */
  from: { score: string; over: string } | null;
  to: { score: string; over: string } | null;
  current: boolean;
  /** ended without a wicket: retired, overs used up, target reached */
  unbroken: boolean;
}

export function partnerships(inn: CricketInnings, ctx: MatchContext, rules?: CricketRules): PartnershipLine[] {
  const bpo = rules?.ballsPerOver ?? 6;
  const all = [...inn.partnerships.map((p) => ({ p, current: false })), ...(inn.closed ? [] : [{ p: inn.stand, current: true }])];
  return all.filter(({ p }) => p.batters.length).map(({ p, current }) => {
    const ids = [...new Set([...p.batters, ...Object.keys(p.contrib ?? {})])];
    const kept = !!p.contrib;
    const fromBat = kept ? Object.values(p.contrib!).reduce((t, c) => t + c.runs, 0) : null;
    const end = current ? { runs: inn.runs, balls: inn.balls } : p.end;
    const wktsAtEnd = current || p.unbroken ? p.wicket - 1 : p.wicket;
    return {
      wicket: p.wicket, runs: p.runs, balls: p.balls, current, unbroken: !current && !!p.unbroken,
      batters: ids.map((id) => ({ id, name: playerName(ctx, id), runs: kept ? p.contrib![id]?.runs ?? 0 : null, balls: kept ? p.contrib![id]?.balls ?? 0 : null })),
      extras: fromBat === null ? null : p.runs - fromBat,
      fours: p.fours ?? null, sixes: p.sixes ?? null,
      runRate: round(runRate(p.runs, p.balls, bpo), 2),
      from: p.start ? { score: `${p.start.runs}/${p.wicket - 1}`, over: oversText(p.start.balls, bpo) } : null,
      to: end ? { score: `${end.runs}/${wktsAtEnd}`, over: oversText(end.balls, bpo) } : null,
    };
  });
}

/** "1st", "2nd" … wicket, for "2nd wicket partnership". */
export const wicketName = (n: number): string => `${ordinal(n)} wicket`;

// ── a side's line in the header ─────────────────────────────────

export interface SideScore {
  side: Side;
  name: string;
  /** "82/4", "150/9d & 96/3", or null before the side has batted */
  score: string | null;
  overs: string | null;
  batting: boolean;
}

export function sideScores(s: CricketState, ctx: MatchContext, rules: CricketRules): SideScore[] {
  const live = openInnings(s);
  return (["a", "b"] as const).map((side) => {
    const mine = s.innings.filter((i) => i.batting === side);
    const last = mine[mine.length - 1];
    return {
      side, name: ctx.sides?.[side].name ?? side.toUpperCase(),
      score: mine.length ? mine.map((i) => `${i.runs}/${i.wickets}${i.closed === "declared" ? "d" : ""}`).join(" & ") : null,
      overs: last ? oversText(last.balls, rules.ballsPerOver) : null,
      batting: live?.batting === side,
    };
  });
}

// ── commentary ──────────────────────────────────────────────────

export interface DeliveryPayload {
  striker?: string; nonStriker?: string; bowler?: string;
  runsBat?: number; extraRuns?: number; extra?: "wide" | "no_ball" | "bye" | "leg_bye" | null;
  boundary?: boolean;
  wicket?: { type: string; player?: string; fielder?: string } | null;
  commentary?: string;
}

const HOW: Record<string, string> = {
  bowled: "bowled", caught: "caught", lbw: "LBW", stumped: "stumped", run_out: "run out",
  hit_wicket: "hit wicket", obstructing_field: "obstructing the field", hit_ball_twice: "hit the ball twice",
};

/** "1st innings 6.2" -> { innings: 1, ball: "6.2" }; "Super over 3 0.4" -> { innings: 3, ball: "0.4", superOver: true } */
export function parseBallLabel(label: string | null): { innings: number; ball: string; superOver?: boolean } | null {
  if (!label) return null;
  const so = /^Super over (\d+) (\d+\.\d+)$/.exec(label);
  if (so) return { innings: Number(so[1]), ball: so[2], superOver: true };
  const m = /^(\d+)\w*\s+innings\s+(\d+\.\d+)$/.exec(label);
  return m ? { innings: Number(m[1]), ball: m[2] } : null;
}

/** One ball as commentary: a badge, a headline and a plain sentence from what was recorded. */
export function describeDelivery(p: DeliveryPayload, ctx: MatchContext): { badge: string; tone: BallTone; headline: string; text: string } {
  const bowler = playerName(ctx, p.bowler), striker = playerName(ctx, p.striker);
  const bat = p.runsBat ?? 0, ex = p.extraRuns ?? 0;
  const lead = `${bowler} to ${striker}`;
  let badge: string, tone: BallTone, headline: string, what: string;

  if (p.wicket) {
    const out = playerName(ctx, p.wicket.player ?? p.striker);
    const fielder = p.wicket.fielder ? playerName(ctx, p.wicket.fielder) : "";
    const how = dismissalText({ how: p.wicket.type, by: p.bowler ?? null, fielder: p.wicket.fielder ?? null }, ctx);
    badge = "W"; tone = "wicket"; headline = "WICKET";
    what = p.wicket.type === "run_out"
      ? `${out} is run out${fielder ? ` by ${fielder}` : ""}${bat + ex ? ` after ${bat + ex} run${bat + ex === 1 ? "" : "s"}` : ""}`
      : p.wicket.type === "bowled" ? `${out} is bowled by ${bowler}`
      : p.wicket.type in HOW && !how.includes(" b ") && !how.startsWith("b ") && !how.startsWith("c & b") ? `${out} is out, ${HOW[p.wicket.type]}`
      : `${out} ${how}`;
  } else if (p.extra === "wide") {
    badge = ex ? `${ex}WD` : "WD"; tone = "extra"; headline = ex ? `WIDE + ${ex}` : "WIDE";
    what = ex ? `wide, and they run ${ex}` : "wide";
  } else if (p.extra === "no_ball") {
    badge = "NB"; tone = "extra"; headline = bat ? `NO BALL + ${bat}` : "NO BALL";
    what = bat === 4 ? "no ball, and it goes for four" : bat === 6 ? "no ball, and it's hit for six" : bat ? `no ball, ${bat} off the bat` : ex ? `no ball, ${ex} bye${ex === 1 ? "" : "s"}` : "no ball";
  } else if (p.extra === "bye" || p.extra === "leg_bye") {
    const k = p.extra === "bye" ? "bye" : "leg bye";
    badge = p.extra === "bye" ? `${ex}B` : `${ex}LB`; tone = "extra"; headline = `${ex} ${k.toUpperCase()}${ex === 1 ? "" : "S"}`;
    what = `${ex} ${k}${ex === 1 ? "" : "s"}`;
  } else if (bat === 4 && p.boundary !== false) {
    badge = "4"; tone = "four"; headline = "FOUR"; what = `four, ${striker} finds the boundary`;
  } else if (bat === 6 && p.boundary !== false) {
    badge = "6"; tone = "six"; headline = "SIX"; what = `six, ${striker} clears the rope`;
  } else if (bat === 0) {
    badge = "0"; tone = "dot"; headline = "DOT BALL"; what = "no run";
  } else {
    badge = String(bat); tone = "run"; headline = `${bat} RUN${bat === 1 ? "" : "S"}`; what = `${bat} run${bat === 1 ? "" : "s"}`;
  }
  const note = p.commentary?.trim();
  return { badge, tone, headline, text: `${lead}, ${what}.${note ? ` ${note}` : ""}` };
}

// ── the match's best figures ────────────────────────────────────

export interface Performer { id: string; name: string; side: Side; line: string; detail: string }

/** The top scorer and the best bowler of the match (most wickets, then fewest runs). */
export function topPerformers(s: CricketState, ctx: MatchContext, rules: CricketRules): { bat: Performer | null; bowl: Performer | null } {
  const bats = new Map<string, { side: Side; runs: number; balls: number; fours: number; sixes: number; out: boolean }>();
  const bowls = new Map<string, { side: Side; balls: number; runs: number; wickets: number }>();
  for (const inn of s.innings) {
    for (const [id, b] of Object.entries(inn.batters)) {
      const t = bats.get(id) ?? { side: inn.batting, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
      t.runs += b.runs; t.balls += b.balls; t.fours += b.fours; t.sixes += b.sixes; t.out = b.out;
      bats.set(id, t);
    }
    for (const [id, b] of Object.entries(inn.bowlers)) {
      const t = bowls.get(id) ?? { side: inn.batting === "a" ? "b" : "a", balls: 0, runs: 0, wickets: 0 };
      t.balls += b.balls; t.runs += b.runs; t.wickets += b.wickets;
      bowls.set(id, t);
    }
  }
  const topBat = [...bats.entries()].sort((x, y) => y[1].runs - x[1].runs || x[1].balls - y[1].balls)[0];
  const topBowl = [...bowls.entries()].filter(([, b]) => b.wickets > 0).sort((x, y) => y[1].wickets - x[1].wickets || x[1].runs - y[1].runs)[0];
  return {
    bat: topBat && topBat[1].runs > 0 ? {
      id: topBat[0], name: playerName(ctx, topBat[0]), side: topBat[1].side,
      line: `${topBat[1].runs}${topBat[1].out ? "" : "*"} (${topBat[1].balls})`,
      detail: [`${topBat[1].fours} four${topBat[1].fours === 1 ? "" : "s"}`, `${topBat[1].sixes} six${topBat[1].sixes === 1 ? "" : "es"}`, `SR ${fmt(strikeRate(topBat[1].runs, topBat[1].balls))}`].join(" · "),
    } : null,
    bowl: topBowl ? {
      id: topBowl[0], name: playerName(ctx, topBowl[0]), side: topBowl[1].side,
      line: `${topBowl[1].wickets}/${topBowl[1].runs}`,
      detail: `${oversText(topBowl[1].balls, rules.ballsPerOver)} ov · Econ ${fmt(economy(topBowl[1].runs, topBowl[1].balls, rules.ballsPerOver))}`,
    } : null,
  };
}

/** One player's figures in this match, for the squads list. */
export function playerMatchLine(s: CricketState, id: string, rules: CricketRules): { bat: string | null; bowl: string | null } {
  let runs = 0, balls = 0, batted = false, out = false, bb = 0, br = 0, bw = 0, bowled = false;
  for (const inn of s.innings) {
    const b = inn.batters[id];
    if (b) { batted = true; runs += b.runs; balls += b.balls; out = b.out; }
    const w = inn.bowlers[id];
    if (w) { bowled = true; bb += w.balls; br += w.runs; bw += w.wickets; }
  }
  return {
    bat: batted ? `${runs}${out ? "" : "*"} (${balls})` : null,
    bowl: bowled ? `${bw}/${br} (${oversText(bb, rules.ballsPerOver)})` : null,
  };
}

// ── a player's career, from their stat lines ────────────────────

export interface CricketCareer {
  matches: number; runs: number; best: string | null; average: number | null; strikeRate: number | null;
  fours: number; sixes: number; wickets: number; bestBowling: string | null; economy: number | null; catches: number;
}

/** Totals come from the aggregate; the best innings and best bowling from the match lines. */
export function cricketCareer(values: Record<string, unknown>, rows: { raw: Record<string, number> }[]): CricketCareer {
  const n = (k: string) => (typeof values[k] === "number" ? (values[k] as number) : 0);
  const r = (k: string) => (typeof values[k] === "number" ? (values[k] as number) : null);
  let best: { runs: number; notOut: boolean } | null = null;
  let bowl: { w: number; r: number } | null = null;
  for (const { raw } of rows) {
    if (raw.batInnings) {
      const runs = raw.batRuns ?? 0, notOut = (raw.notOuts ?? 0) > 0 && !(raw.dismissals ?? 0);
      if (!best || runs > best.runs || (runs === best.runs && notOut && !best.notOut)) best = { runs, notOut };
    }
    if (raw.bowlBalls) {
      const w = raw.wickets ?? 0, rr = raw.bowlRuns ?? 0;
      if (!bowl || w > bowl.w || (w === bowl.w && rr < bowl.r)) bowl = { w, r: rr };
    }
  }
  return {
    matches: n("matches"), runs: n("batRuns"), best: best ? `${best.runs}${best.notOut ? "*" : ""}` : null,
    average: r("batAvg"), strikeRate: r("batSr"), fours: n("fours"), sixes: n("sixes"),
    wickets: n("wickets"), bestBowling: bowl ? `${bowl.w}/${bowl.r}` : null, economy: r("econ"), catches: n("catches"),
  };
}
