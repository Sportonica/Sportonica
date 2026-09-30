// Basketball: events -> points -> periods -> match.
// Rules: docs/sports-intelligence/02-sport-rules.md (defaults are FIBA).
//
// A derived figure is only reported when the data behind it was really
// recorded: shooting percentages need misses to be tracked, minutes need
// lineups and a clock on every substitution, plus/minus needs both
// lineups before the first basket. Otherwise it is null ("n/a"), never 0.

import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type EngineEvent, type Issue, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { add, formatClock, isNonNegInt, isPosInt, mergeRules, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";

export interface BasketballRules {
  periods: number;
  periodMinutes: number;
  overtimeMinutes: number;
  allowTie: boolean;
  twoPointValue: number;
  threePointValue: number;
  freeThrowValue: number;
  foulLimit: number;
  playersOnCourt: number;
  trackShotAttempts: boolean;
}

const DEFAULTS: BasketballRules = {
  periods: 4, periodMinutes: 10, overtimeMinutes: 5, allowTie: false,
  twoPointValue: 2, threePointValue: 3, freeThrowValue: 1,
  foulLimit: 5, playersOnCourt: 5, trackShotAttempts: true,
};

const FOUL_KINDS = ["personal", "technical", "unsportsmanlike"] as const;
// events a player takes part in: they must be on the team, not fouled out, and on court when lineups are known
const PLAYER_EVENTS = new Set(["SHOT_MADE", "SHOT_MISSED", "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL"]);

interface ScoreEntry { seq: number; side: Side; pts: number; period: number; a: number; b: number }

export interface BasketballState {
  period: number;
  periodOpen: boolean;
  /** seconds left in the period, when the scorer is sending a clock */
  clock: number | null;
  score: Record<Side, number>;
  byPeriod: Record<Side, number[]>;
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  onCourt: Record<Side, string[] | null>;
  starters: Record<Side, string[] | null>;
  scoring: ScoreEntry[];
  /** false once a basket was scored without both lineups known */
  plusMinusValid: boolean;
  /** false once a substitution was recorded without a clock */
  minutesValid: boolean;
  log: { seq: number; text: string }[];
}

const periodSeconds = (period: number, rules: BasketballRules): number =>
  (period > rules.periods ? rules.overtimeMinutes : rules.periodMinutes) * 60;

export const periodName = (period: number, rules: BasketballRules): string => {
  if (period <= rules.periods) return rules.periods === 4 ? `Q${period}` : rules.periods === 2 ? `H${period}` : `P${period}`;
  return period - rules.periods === 1 ? "OT" : `OT${period - rules.periods}`;
};

const fouls = (s: BasketballState, id: string): number => s.players[id]?.pf ?? 0;
const lineupsKnown = (s: BasketballState): boolean => !!s.onCourt.a && !!s.onCourt.b;

// Credit elapsed clock time to everyone on court.
function runClock(s: BasketballState, to: number): void {
  if (s.clock === null) return;
  const elapsed = s.clock - to;
  if (elapsed > 0) for (const side of SIDES) for (const id of s.onCourt[side] ?? []) add((s.players[id] ??= {}), "secs", elapsed);
  s.clock = to;
}

function credit(s: BasketballState, side: Side, player: string | null, key: string, n = 1): void {
  add(s.team[side], key, n);
  if (player) add((s.players[player] ??= {}), key, n);
}

function addPoints(s: BasketballState, ev: EngineEvent, side: Side, player: string | null, pts: number): void {
  s.score[side] += pts;
  const arr = s.byPeriod[side];
  arr[s.period - 1] = (arr[s.period - 1] ?? 0) + pts;
  credit(s, side, player, "pts", pts);
  if (!lineupsKnown(s)) s.plusMinusValid = false;
  else for (const x of SIDES) for (const id of s.onCourt[x]!) add((s.players[id] ??= {}), "plusMinus", x === side ? pts : -pts);
  if (player && s.starters[side] && !s.starters[side]!.includes(player)) add(s.team[side], "benchPts", pts);
  s.scoring.push({ seq: ev.seq, side, pts, period: s.period, a: s.score.a, b: s.score.b });
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

/** Runs of unanswered points. */
export function scoringRunsOf(scoring: ScoreEntry[], min: number): { side: Side; points: number; period: number }[] {
  const out: { side: Side; points: number; period: number }[] = [];
  let side: Side | null = null, points = 0, period = 0;
  const flush = () => { if (side && points >= min) out.push({ side, points, period }); };
  for (const e of scoring) {
    if (e.side === side) points += e.pts;
    else { flush(); side = e.side; points = e.pts; period = e.period; }
  }
  flush();
  return out;
}

// ── statistics ──────────────────────────────────────────────────────

const BOX_RAW: StatColumn[] = [
  { key: "pts", label: "PTS", kind: "raw" },
  { key: "fgm", label: "FGM", kind: "raw" }, { key: "fga", label: "FGA", kind: "raw" },
  { key: "tpm", label: "3PM", kind: "raw" }, { key: "tpa", label: "3PA", kind: "raw" },
  { key: "ftm", label: "FTM", kind: "raw" }, { key: "fta", label: "FTA", kind: "raw" },
  { key: "oreb", label: "OREB", kind: "raw" }, { key: "dreb", label: "DREB", kind: "raw" },
  { key: "reb", label: "REB", kind: "raw" },
  { key: "ast", label: "AST", kind: "raw" }, { key: "stl", label: "STL", kind: "raw" },
  { key: "blk", label: "BLK", kind: "raw" }, { key: "tov", label: "TOV", kind: "raw" },
  { key: "pf", label: "PF", kind: "raw" },
];

const SHOOTING_DERIVED: StatColumn[] = [
  { key: "fgPct", label: "FG%", kind: "derived", format: "pct" },
  { key: "tpPct", label: "3P%", kind: "derived", format: "pct" },
  { key: "ftPct", label: "FT%", kind: "derived", format: "pct" },
  { key: "astTov", label: "AST/TOV", kind: "derived", format: "dec2" },
];

const TEAM_RAW: StatColumn[] = [
  { key: "paintPts", label: "Points in the paint", kind: "raw" },
  { key: "secondChancePts", label: "Second chance points", kind: "raw" },
  { key: "fastBreakPts", label: "Fast break points", kind: "raw" },
  { key: "timeouts", label: "Timeouts", kind: "raw" },
];

const TEAM_DERIVED: StatColumn[] = [
  { key: "efgPct", label: "eFG%", kind: "derived", format: "pct" },
  { key: "tsPct", label: "TS%", kind: "derived", format: "pct" },
  { key: "possessions", label: "Possessions (est.)", kind: "derived", format: "dec1" },
  { key: "offRating", label: "Offensive efficiency", kind: "derived", format: "dec1" },
  { key: "defRating", label: "Defensive efficiency", kind: "derived", format: "dec1" },
  { key: "tovRate", label: "Turnover rate %", kind: "derived", format: "pct" },
  { key: "orebRate", label: "Offensive rebound %", kind: "derived", format: "pct" },
  { key: "ptsPerPeriod", label: "Points per period", kind: "derived", format: "dec1" },
];

const n0 = (raw: Record<string, number>, k: string): number => raw[k] ?? 0;

/** Shooting figures; null unless misses were being tracked. */
function shooting(raw: Record<string, number>, tracked: boolean): Record<string, StatValue> {
  return {
    fgPct: tracked ? round(pct(raw.fgm ?? 0, raw.fga), 1) : null,
    tpPct: tracked ? round(pct(raw.tpm ?? 0, raw.tpa), 1) : null,
    ftPct: tracked ? round(pct(raw.ftm ?? 0, raw.fta), 1) : null,
    astTov: round(ratio(raw.ast ?? 0, raw.tov), 2),
  };
}

/** The standard box-score estimate. Only meaningful when attempts are tracked. */
export const possessions = (raw: Record<string, number>): number =>
  n0(raw, "fga") + 0.44 * n0(raw, "fta") - n0(raw, "oreb") + n0(raw, "tov");

function teamDerived(own: Record<string, number>, opp: Record<string, number> | null, tracked: boolean, periodsPlayed: number): Record<string, StatValue> {
  const poss = tracked ? possessions(own) : null;
  const oppPoss = tracked && opp ? possessions(opp) : null;
  return {
    ...shooting(own, tracked),
    efgPct: tracked ? round(pct(n0(own, "fgm") + 0.5 * n0(own, "tpm"), own.fga), 1) : null,
    tsPct: tracked ? round(pct(n0(own, "pts"), 2 * (n0(own, "fga") + 0.44 * n0(own, "fta"))), 1) : null,
    possessions: poss !== null && poss > 0 ? round(poss, 1) : null,
    offRating: poss !== null && poss > 0 ? round((100 * n0(own, "pts")) / poss, 1) : null,
    defRating: oppPoss !== null && oppPoss > 0 && opp ? round((100 * n0(opp, "pts")) / oppPoss, 1) : null,
    tovRate: poss !== null && poss > 0 ? round(pct(n0(own, "tov"), poss), 1) : null,
    orebRate: opp ? round(pct(n0(own, "oreb"), n0(own, "oreb") + n0(opp, "dreb")), 1) : null,
    ptsPerPeriod: round(ratio(n0(own, "pts"), periodsPlayed), 1),
  };
}

const withReb = (raw: Record<string, number>): Record<string, number> => ({ ...raw, reb: n0(raw, "oreb") + n0(raw, "dreb") });

export const basketballEngine: SportIntelligenceEngine<BasketballRules, BasketballState> = {
  sport: "basketball",
  label: "Basketball",
  eventTypes: [
    "PERIOD_START", "PERIOD_END", "LINEUP", "SUBSTITUTION", "SHOT_MADE", "SHOT_MISSED",
    "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL", "TIMEOUT",
  ],

  resolveRules(input) {
    const r = mergeRules(DEFAULTS, input);
    for (const k of ["periods", "periodMinutes", "overtimeMinutes", "twoPointValue", "threePointValue", "freeThrowValue", "foulLimit", "playersOnCourt"] as const) {
      if (!isPosInt(r[k])) throw new RulesError(`${k} must be a positive whole number`);
    }
    if (r.twoPointValue === r.threePointValue) throw new RulesError("the two field goal values must differ");
    return r;
  },

  initializeMatch() {
    return {
      period: 0, periodOpen: false, clock: null, score: { a: 0, b: 0 }, byPeriod: { a: [], b: [] },
      team: { a: {}, b: {} }, players: {}, onCourt: { a: null, b: null }, starters: { a: null, b: null },
      scoring: [], plusMinusValid: true, minutesValid: true, log: [],
    };
  },

  validateEvent(s, ev, ctx, rules) {
    const p = ev.payload;
    if (p.clock != null) {
      if (!isNonNegInt(p.clock)) return "The clock must be whole seconds";
      if (s.periodOpen && p.clock > periodSeconds(s.period, rules)) return "The clock is longer than the period";
      if (s.periodOpen && s.clock !== null && p.clock > s.clock) return "The clock cannot run backwards";
    }

    switch (ev.type) {
      case "PERIOD_START":
        if (s.periodOpen) return `${periodName(s.period, rules)} is still in progress`;
        if (s.period >= rules.periods && s.score.a !== s.score.b) return "Overtime is only played when the score is level";
        return null;
      case "PERIOD_END":
        return s.periodOpen ? null : "No period is in progress";
      case "LINEUP": {
        if (!isSide(p.side)) return "Say which side the lineup is for";
        const list = p.players;
        if (!Array.isArray(list) || list.length !== rules.playersOnCourt) return `A lineup needs exactly ${rules.playersOnCourt} players`;
        if (new Set(list).size !== list.length) return "A player appears twice in the lineup";
        if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every lineup player must belong to that side";
        if (list.some((id) => fouls(s, id as string) >= rules.foulLimit)) return "A fouled out player cannot be in the lineup";
        return null;
      }
      case "SUBSTITUTION": {
        if (!isSide(p.side)) return "Say which side";
        const court = s.onCourt[p.side];
        if (!court) return "Set the lineup before recording substitutions";
        if (typeof p.in !== "string" || typeof p.out !== "string") return "Say who comes on and who goes off";
        if (sideOfPlayer(ctx, p.in) !== p.side) return "The player coming on is not in that team";
        if (!court.includes(p.out)) return "The player going off is not on court";
        if (court.includes(p.in)) return "The player coming on is already on court";
        if (fouls(s, p.in) >= rules.foulLimit) return "A fouled out player cannot come back on";
        return null;
      }
      case "TIMEOUT":
        return isSide(p.side) ? null : "Say which side";
    }

    // play events
    if (!s.periodOpen) return "Start the period before recording play";
    if (!isSide(p.side)) return "Say which side";
    const side = p.side;
    if (PLAYER_EVENTS.has(ev.type) && p.player != null) {
      if (typeof p.player !== "string") return "player must be a player id";
      if (sideOfPlayer(ctx, p.player) !== side) return `That player is not in ${sideName(ctx, side)}`;
      if (fouls(s, p.player) >= rules.foulLimit) return `${playerName(ctx, p.player)} has fouled out`;
      if (s.onCourt[side] && !s.onCourt[side]!.includes(p.player)) return `${playerName(ctx, p.player)} is not on court`;
    }
    if (ev.type === "SHOT_MADE" || ev.type === "SHOT_MISSED") {
      if (p.points !== rules.twoPointValue && p.points !== rules.threePointValue) return `A field goal is worth ${rules.twoPointValue} or ${rules.threePointValue}`;
      if (p.assist != null) {
        if (ev.type === "SHOT_MISSED") return "A missed shot has no assist";
        if (typeof p.assist !== "string" || sideOfPlayer(ctx, p.assist) !== side) return "The assist must come from a team mate";
        if (p.assist === p.player) return "A player cannot assist their own basket";
      }
      if (p.paint && p.points === rules.threePointValue) return "A shot from outside the arc is not in the paint";
    }
    if (ev.type === "FOUL" && p.kind != null && !(FOUL_KINDS as readonly unknown[]).includes(p.kind)) return "Unknown foul type";
    if (ev.type === "REBOUND" && typeof p.offensive !== "boolean") return "Say whether the rebound was offensive or defensive";
    return null;
  },

  updateScore(s, ev, ctx, rules) {
    const p = ev.payload;
    if (isNonNegInt(p.clock) && s.periodOpen) runClock(s, p.clock);
    const side = p.side as Side;
    const who = str(p.player);

    switch (ev.type) {
      case "PERIOD_START":
        s.period += 1; s.periodOpen = true; s.clock = periodSeconds(s.period, rules);
        for (const x of SIDES) s.byPeriod[x][s.period - 1] = 0;
        s.log.push({ seq: ev.seq, text: `${periodName(s.period, rules)} started` });
        break;
      case "PERIOD_END":
        runClock(s, 0);
        s.periodOpen = false; s.clock = null;
        s.log.push({ seq: ev.seq, text: `End of ${periodName(s.period, rules)}: ${sideName(ctx, "a")} ${s.score.a}, ${sideName(ctx, "b")} ${s.score.b}` });
        break;
      case "LINEUP":
        s.onCourt[side] = [...(p.players as string[])];
        if (!s.starters[side]) s.starters[side] = [...(p.players as string[])];
        break;
      case "SUBSTITUTION": {
        const court = s.onCourt[side]!;
        court[court.indexOf(p.out as string)] = p.in as string;
        if (!isNonNegInt(p.clock)) s.minutesValid = false;
        break;
      }
      case "TIMEOUT": add(s.team[side], "timeouts"); break;
      case "SHOT_MADE": {
        const pts = p.points as number;
        credit(s, side, who, "fgm"); credit(s, side, who, "fga");
        if (pts === rules.threePointValue) { credit(s, side, who, "tpm"); credit(s, side, who, "tpa"); }
        if (p.paint) add(s.team[side], "paintPts", pts);
        if (p.fastBreak) add(s.team[side], "fastBreakPts", pts);
        if (p.secondChance) add(s.team[side], "secondChancePts", pts);
        if (typeof p.assist === "string") credit(s, side, p.assist, "ast");
        addPoints(s, ev, side, who, pts);
        break;
      }
      case "SHOT_MISSED":
        credit(s, side, who, "fga");
        if (p.points === rules.threePointValue) credit(s, side, who, "tpa");
        break;
      case "FREE_THROW_MADE":
        credit(s, side, who, "ftm"); credit(s, side, who, "fta");
        addPoints(s, ev, side, who, rules.freeThrowValue);
        break;
      case "FREE_THROW_MISSED": credit(s, side, who, "fta"); break;
      case "REBOUND": credit(s, side, who, p.offensive ? "oreb" : "dreb"); break;
      case "ASSIST": credit(s, side, who, "ast"); break;
      case "STEAL": credit(s, side, who, "stl"); break;
      case "BLOCK": credit(s, side, who, "blk"); break;
      case "TURNOVER": credit(s, side, who, "tov"); break;
      case "FOUL":
        credit(s, side, who, "pf");
        if (who && fouls(s, who) >= rules.foulLimit) {
          s.log.push({ seq: ev.seq, text: `${playerName(ctx, who)} fouled out` });
          // a fouled out player leaves the floor; the scorer names the replacement with a lineup
          const court = s.onCourt[side];
          if (court) s.onCourt[side] = court.filter((id) => id !== who);
        }
        break;
    }
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    for (const side of SIDES) {
      const sum = s.byPeriod[side].reduce((t, v) => t + (v ?? 0), 0);
      if (sum !== s.score[side]) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "Period scores do not add up to the total" });
      const t = s.team[side];
      const fromShots = (n0(t, "fgm") - n0(t, "tpm")) * rules.twoPointValue + n0(t, "tpm") * rules.threePointValue + n0(t, "ftm") * rules.freeThrowValue;
      if (fromShots !== s.score[side]) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "The score does not match the baskets recorded" });
      if (n0(t, "fgm") > n0(t, "fga") || n0(t, "tpm") > n0(t, "tpa") || n0(t, "ftm") > n0(t, "fta")) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "More shots made than attempted" });
    }
    return issues;
  },

  getCurrentState(s, _ctx, rules) {
    const label = s.period === 0 ? "Not started"
      : s.periodOpen ? `${periodName(s.period, rules)}${s.clock !== null ? `, ${formatClock(s.clock)} remaining` : ""}`
      : s.period === rules.periods / 2 ? "Halftime" : `End of ${periodName(s.period, rules)}`;
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.score.a), b: String(s.score.b) },
      subScore: null,
      periodLabel: label,
      serving: null,
      periods: Array.from({ length: s.period }, (_, i) => ({ label: periodName(i + 1, rules), a: String(s.byPeriod.a[i] ?? 0), b: String(s.byPeriod.b[i] ?? 0) })),
      notes: [],
    };
    if (!s.periodOpen && s.period >= rules.periods && s.score.a === s.score.b && !rules.allowTie) view.notes.push("Scores level: overtime to follow");
    return view;
  },

  getMatchSummary(s, ctx, rules) {
    const lines = [`${sideName(ctx, "a")} ${s.score.a} - ${sideName(ctx, "b")} ${s.score.b}`];
    if (s.period === 0) lines.push("Not started");
    else if (s.periodOpen) lines.push(`${periodName(s.period, rules)}${s.clock !== null ? `, ${formatClock(s.clock)} remaining` : ""}`);
    else lines.push(s.period === rules.periods / 2 ? "Halftime" : `End of ${periodName(s.period, rules)}`);
    return lines;
  },

  calculatePlayerStatistics(s, ctx, rules) {
    const minutesOk = s.minutesValid && lineupsKnown(s);
    const columns: StatColumn[] = [
      { key: "min", label: "MIN", kind: "derived", format: "dec1" }, ...BOX_RAW, ...SHOOTING_DERIVED,
      { key: "ptsPerMin", label: "PTS/MIN", kind: "derived", format: "dec2" },
      { key: "plusMinus", label: "+/-", kind: "derived" },
    ];
    const rows = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
      const raw = withReb(s.players[pl.id] ?? {});
      const min = minutesOk ? n0(raw, "secs") / 60 : null;
      return {
        id: pl.id, name: pl.name, side,
        values: {
          ...Object.fromEntries(BOX_RAW.map((c) => [c.key, n0(raw, c.key)])),
          ...shooting(raw, rules.trackShotAttempts),
          min: round(min, 1),
          ptsPerMin: round(ratio(n0(raw, "pts"), min), 2),
          plusMinus: s.plusMinusValid && lineupsKnown(s) ? n0(raw, "plusMinus") : null,
        } as Record<string, StatValue>,
      };
    }));
    return [{ key: "box", title: "Box score", columns, rows }];
  },

  calculateTeamStatistics(s, ctx, rules) {
    const played = s.period;
    const rows = SIDES.map((side) => {
      const own = withReb(s.team[side]), opp = withReb(s.team[otherSide(side)]);
      return {
        id: side, name: sideName(ctx, side), side,
        values: {
          ...Object.fromEntries([...BOX_RAW, ...TEAM_RAW].map((c) => [c.key, n0(own, c.key)])),
          benchPts: s.starters[side] ? n0(own, "benchPts") : null,
          ...teamDerived(own, opp, rules.trackShotAttempts, played),
        } as Record<string, StatValue>,
      };
    });
    return [{
      key: "team", title: "Team statistics",
      columns: [...BOX_RAW, ...TEAM_RAW, { key: "benchPts", label: "Bench points", kind: "raw" }, ...SHOOTING_DERIVED, ...TEAM_DERIVED],
      rows,
    }];
  },

  calculateStatistics(s, ctx, rules) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      const winner = s.score.a === s.score.b ? null : s.score.a > s.score.b ? "a" : "b";
      for (const side of SIDES) {
        const opp = s.team[otherSide(side)];
        lines.push({
          subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...s.team[side], matches: 1, wins: winner === side ? 1 : 0, periods: s.period, oppPts: n0(opp, "pts"), oppDreb: n0(opp, "dreb"), oppPoss: round(possessions(opp), 2) ?? 0, tracked: rules.trackShotAttempts ? 1 : 0 },
        });
        for (const pl of ctx.sides[side].players) {
          const raw = s.players[pl.id] ?? {};
          lines.push({
            subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            raw: { ...raw, matches: 1, tracked: rules.trackShotAttempts ? 1 : 0, ...(s.minutesValid && lineupsKnown(s) ? {} : { secs: 0, secsUnknown: 1 }) },
          });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: this.calculateTeamStatistics(s, ctx, rules), lines };
  },

  calculateAdvancedAnalytics(s, ctx, rules) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const lead = leadStats(s.scoring);
    const runs = scoringRunsOf(s.scoring, 6);
    const best = (side: Side) => runs.filter((r) => r.side === side).reduce((m, r) => Math.max(m, r.points), 0);
    const periodLabels = Array.from({ length: s.period }, (_, i) => periodName(i + 1, rules));

    const contribution: StatTable = {
      key: "contribution", title: "Player contribution",
      columns: [{ key: "pts", label: "PTS", kind: "raw" }, { key: "share", label: "Share of team points %", kind: "derived", format: "pct" }],
      rows: SIDES.flatMap((side) => playersOf(ctx, side)
        .map((pl) => ({ pl, pts: n0(s.players[pl.id] ?? {}, "pts") }))
        .filter((x) => x.pts > 0).sort((x, y) => y.pts - x.pts)
        .map((x) => ({ id: x.pl.id, name: x.pl.name, side, values: { pts: x.pts, share: round(pct(x.pts, s.score[side]), 1) } }))),
    };
    const runTable: StatTable = {
      key: "runs", title: "Scoring runs (6 or more unanswered)",
      columns: [{ key: "period", label: "Period", kind: "raw", format: "text" }, { key: "points", label: "Points", kind: "raw" }],
      rows: runs.map((r, i) => ({ id: String(i), name: names[r.side], side: r.side, values: { period: periodName(r.period, rules), points: r.points } })),
    };

    return {
      cards: [
        { label: "Lead changes", value: String(lead.leadChanges) },
        { label: "Times tied", value: String(lead.timesTied) },
        { label: "Largest lead", value: `${names.a} ${lead.largestLead.a}, ${names.b} ${lead.largestLead.b}` },
        { label: "Best run", value: `${names.a} ${best("a")}, ${names.b} ${best("b")}`, hint: "Most unanswered points, runs of 6 or more" },
      ],
      charts: [
        { key: "by-period", title: "Scoring by period", type: "bar", labels: periodLabels, series: SIDES.map((side) => ({ name: names[side], side, values: periodLabels.map((_, i) => s.byPeriod[side][i] ?? 0) })), format: "int" },
        { key: "progression", title: "Score progression", type: "line", labels: ["0", ...s.scoring.map((_, i) => String(i + 1))], series: SIDES.map((side) => ({ name: names[side], side, values: [0, ...s.scoring.map((e) => e[side])] })), format: "int" },
      ],
      tables: [contribution, runTable],
    } satisfies Analytics;
  },

  validateMatchCompletion(s, _ctx, rules) {
    if (s.periodOpen) return `${periodName(s.period, rules)} is still in progress. End the period first`;
    if (s.period < rules.periods) return `Only ${s.period} of ${rules.periods} periods have been played`;
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
    // percentages only if every match in the sum tracked misses
    const tracked = n0(raw, "matches") > 0 && n0(raw, "tracked") === n0(raw, "matches");
    const per = (k: string) => round(ratio(n0(raw, k), raw.matches), 1);
    const perGame: StatColumn[] = [
      { key: "ppg", label: "Points per game", kind: "derived", format: "dec1" },
      { key: "apg", label: "Assists per game", kind: "derived", format: "dec1" },
      { key: "rpg", label: "Rebounds per game", kind: "derived", format: "dec1" },
    ];
    const base = { ...raw, ppg: per("pts"), apg: per("ast"), rpg: per("reb") };
    if (subject === "player") {
      const min = n0(raw, "secsUnknown") > 0 ? null : n0(raw, "secs") / 60;
      return {
        columns: [{ key: "matches", label: "Games", kind: "raw" }, ...perGame, ...BOX_RAW, ...SHOOTING_DERIVED, { key: "ptsPerMin", label: "PTS/MIN", kind: "derived", format: "dec2" }],
        values: { ...base, ...shooting(raw, tracked), ptsPerMin: round(ratio(n0(raw, "pts"), min), 2) },
      };
    }
    const opp = { pts: n0(raw, "oppPts"), dreb: n0(raw, "oppDreb") };
    const d = teamDerived(raw, opp, tracked, n0(raw, "periods"));
    const oppPoss = n0(raw, "oppPoss");
    return {
      columns: [{ key: "matches", label: "Games", kind: "raw" }, { key: "wins", label: "Wins", kind: "raw" }, ...perGame, ...BOX_RAW, ...TEAM_RAW, ...SHOOTING_DERIVED, ...TEAM_DERIVED],
      values: { ...base, ...d, defRating: tracked && oppPoss > 0 ? round((100 * opp.pts) / oppPoss, 1) : null },
    };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, ctx, rules) {
    const p = ev.payload;
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    const who = str(p.player) ? playerName(ctx, str(p.player)) : side;
    switch (ev.type) {
      case "PERIOD_START": return "Period started";
      case "PERIOD_END": return "Period ended";
      case "LINEUP": return `${side} lineup set`;
      case "SUBSTITUTION": return `${side}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}`;
      case "TIMEOUT": return `Timeout ${side}`;
      case "SHOT_MADE": return `${who} scores ${p.points === rules.threePointValue ? "a three" : String(p.points)}${str(p.assist) ? ` (assist ${playerName(ctx, str(p.assist))})` : ""}`;
      case "SHOT_MISSED": return `${who} misses${p.points === rules.threePointValue ? " a three" : ""}`;
      case "FREE_THROW_MADE": return `${who} makes a free throw`;
      case "FREE_THROW_MISSED": return `${who} misses a free throw`;
      case "REBOUND": return `${who} ${p.offensive ? "offensive" : "defensive"} rebound`;
      case "ASSIST": return `${who} assist`;
      case "STEAL": return `${who} steal`;
      case "BLOCK": return `${who} block`;
      case "TURNOVER": return `${who} turnover`;
      case "FOUL": return `${who} ${typeof p.kind === "string" && p.kind !== "personal" ? `${p.kind} ` : ""}foul`;
      default: return ev.type;
    }
  },
};
