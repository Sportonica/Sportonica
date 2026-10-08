// Basketball competition configuration. Every rule that differs between
// competitions is a value here, never a constant in the engine: FIBA,
// NBA and NCAA disagree on period length, foul-out limits, which fouls
// count toward the team penalty, when the bonus starts, how timeouts are
// allotted and how a league table is ranked. A preset is a complete,
// named set of values; "custom" starts from FIBA and is edited freely.
// Keys are flat (numbers, switches, choices) so the scoring-rules form
// can edit any of them without knowing the sport.
// Sources: FIBA Official Basketball Rules 2024, NBA Official Rules
// 2024-25, NCAA Men's Basketball Rules 2024-26. Simplifications are
// listed in docs/sports-intelligence/05-basketball.md.

import { RulesError } from "../../core/types";
import { isNonNegInt, isPosInt, mergeRules } from "../../core/util";

export const BASKETBALL_PRESETS_LIST = ["fiba", "nba", "ncaa", "3x3", "custom"] as const;
export type BasketballPreset = (typeof BASKETBALL_PRESETS_LIST)[number];

export interface BasketballRules {
  preset: BasketballPreset;

  // ── structure ──
  periods: number;
  periodMinutes: number;
  overtimeMinutes: number;
  allowTie: boolean;
  /** the game ends as soon as a team reaches this score in regulation (3x3: 21); null: played to the clock */
  targetScore: number | null;
  /** overtime ends as soon as a team scores this many points in it (3x3: 2); null: played to the clock */
  overtimeTargetPoints: number | null;
  playersOnCourt: number;
  /** players a team may dress for one game: on court plus bench (FIBA 12 = 5 + 7 substitutes) */
  gameRosterSize: number;
  /** null: the competition plays without a shot clock */
  shotClockSeconds: number | null;
  /** FIBA alternating-possession arrow for held balls (NBA uses a jump ball) */
  alternatingPossession: boolean;
  /** the interval between quarters and before each overtime, for the scorer's break timer */
  quarterBreakMinutes: number;
  /** the interval at half-time */
  halftimeMinutes: number;
  /** substitutions each team may make in a game; null: unlimited (every standard rulebook) */
  substitutionsPerGame: number | null;

  // ── scoring ──
  twoPointValue: number;
  threePointValue: number;
  freeThrowValue: number;
  /** whether misses are being recorded: percentages and possessions need them */
  trackShotAttempts: boolean;

  // ── fouls ──
  /** personal fouls (and technicals where they count) that disqualify a player */
  foulLimit: number;
  technicalsCountTowardFoulLimit: boolean;
  /** technical fouls that eject a player; null: no such rule */
  technicalEjectAt: number | null;
  /** unsportsmanlike (flagrant 1) fouls that eject a player */
  unsportsmanlikeEjectAt: number | null;
  /** technical + unsportsmanlike together that eject a player (FIBA: 2) */
  combinedEjectAt: number | null;
  /** team fouls are counted per period (FIBA, NBA) or per half (NCAA) */
  teamFoulWindow: "period" | "half";
  /** the opponent shoots free throws once a team has committed this many fouls in the window */
  bonusAfterFouls: number;
  /** NCAA double bonus (two shots instead of one-and-one); null: no double bonus */
  doubleBonusAfterFouls: number | null;
  /** overtime team fouls continue the last regulation window (FIBA, NCAA) or start again (NBA) */
  overtimeTeamFouls: "carry" | "reset";
  /** when overtime fouls reset: the bonus threshold in each overtime; null: same as regulation */
  bonusAfterFoulsOvertime: number | null;
  offensiveFoulsAreTeamFouls: boolean;
  technicalsAreTeamFouls: boolean;

  // ── free throws awarded by rule (a shooting foul's come from the shot: 1 if it went in, else its value) ──
  /** a common foul in the bonus */
  bonusFreeThrows: number;
  /** NCAA one-and-one: in the (single) bonus the second shot is only taken if the first goes in */
  oneAndOne: boolean;
  technicalFreeThrows: number;
  /** unsportsmanlike / flagrant and disqualifying fouls not on a shot */
  unsportsmanlikeFreeThrows: number;
  /** shot clock after an offensive rebound or a kicked ball; empty = full reset */
  shotClockReset: number | null;

  // ── timeouts ──
  /** one pool for all of regulation (NBA, NCAA); null: allotted per half (FIBA) */
  timeoutsPerGame: number | null;
  timeoutsFirstHalf: number;
  timeoutsSecondHalf: number;
  timeoutsPerOvertime: number;

  // ── clutch: last N minutes of the final period or overtime, margin at most M ──
  clutchMinutes: number;
  clutchMargin: number;

  // ── league table ──
  standingsWinPoints: number;
  standingsLossPoints: number;
  /** a team that forfeits (walkover) gets this instead of the loss points */
  standingsForfeitLossPoints: number;
  /** among teams level on points: games between them first (FIBA), or overall point difference first */
  standingsTiebreak: "head_to_head" | "point_difference";
}

const FIBA: BasketballRules = {
  preset: "fiba",
  periods: 4, periodMinutes: 10, overtimeMinutes: 5, allowTie: false, targetScore: null, overtimeTargetPoints: null, playersOnCourt: 5, gameRosterSize: 12,
  shotClockSeconds: 24, alternatingPossession: true,
  quarterBreakMinutes: 2, halftimeMinutes: 15, substitutionsPerGame: null,
  twoPointValue: 2, threePointValue: 3, freeThrowValue: 1, trackShotAttempts: true,
  foulLimit: 5, technicalsCountTowardFoulLimit: true,
  technicalEjectAt: 2, unsportsmanlikeEjectAt: 2, combinedEjectAt: 2,
  teamFoulWindow: "period", bonusAfterFouls: 4, doubleBonusAfterFouls: null,
  overtimeTeamFouls: "carry", bonusAfterFoulsOvertime: null,
  offensiveFoulsAreTeamFouls: true, technicalsAreTeamFouls: true,
  bonusFreeThrows: 2, oneAndOne: false, technicalFreeThrows: 1, unsportsmanlikeFreeThrows: 2, shotClockReset: 14,
  timeoutsPerGame: null, timeoutsFirstHalf: 2, timeoutsSecondHalf: 3, timeoutsPerOvertime: 1,
  clutchMinutes: 5, clutchMargin: 5,
  standingsWinPoints: 2, standingsLossPoints: 1, standingsForfeitLossPoints: 0, standingsTiebreak: "head_to_head",
};

export const BASKETBALL_PRESETS: Record<BasketballPreset, BasketballRules> = {
  fiba: FIBA,
  nba: {
    ...FIBA, preset: "nba",
    periodMinutes: 12, alternatingPossession: false, gameRosterSize: 13,
    foulLimit: 6, technicalsCountTowardFoulLimit: false,
    technicalEjectAt: 2, unsportsmanlikeEjectAt: 2, combinedEjectAt: null,
    overtimeTeamFouls: "reset", bonusAfterFoulsOvertime: 3,
    offensiveFoulsAreTeamFouls: false, technicalsAreTeamFouls: false,
    timeoutsPerGame: 7, timeoutsFirstHalf: 0, timeoutsSecondHalf: 0, timeoutsPerOvertime: 2,
    // the NBA ranks on winning percentage; 1 for a win, 0 for a loss gives the same order
    standingsWinPoints: 1, standingsLossPoints: 0, standingsForfeitLossPoints: 0,
  },
  ncaa: {
    ...FIBA, preset: "ncaa",
    periods: 2, periodMinutes: 20, shotClockSeconds: 30, alternatingPossession: true, gameRosterSize: 15,
    foulLimit: 5, technicalsCountTowardFoulLimit: true,
    technicalEjectAt: 2, unsportsmanlikeEjectAt: 2, combinedEjectAt: null,
    teamFoulWindow: "half", bonusAfterFouls: 6, doubleBonusAfterFouls: 9, oneAndOne: true, technicalFreeThrows: 2, shotClockReset: 20,
    overtimeTeamFouls: "carry", bonusAfterFoulsOvertime: null,
    timeoutsPerGame: 4, timeoutsFirstHalf: 0, timeoutsSecondHalf: 0, timeoutsPerOvertime: 1,
    standingsWinPoints: 1, standingsLossPoints: 0, standingsForfeitLossPoints: 0,
  },
  // FIBA 3x3: one 10-minute period or first to 21, baskets worth 1 and 2,
  // a 12-second shot clock, overtime won by the first team to score 2,
  // no personal foul-outs (99 stands for none), the bonus from the 7th
  // team foul and one timeout a team
  "3x3": {
    ...FIBA, preset: "3x3",
    periods: 1, periodMinutes: 10, overtimeMinutes: 5, targetScore: 21, overtimeTargetPoints: 2,
    playersOnCourt: 3, gameRosterSize: 4, shotClockSeconds: 12, shotClockReset: null, alternatingPossession: false,
    quarterBreakMinutes: 1, halftimeMinutes: 0,
    twoPointValue: 1, threePointValue: 2, freeThrowValue: 1,
    foulLimit: 99, technicalsCountTowardFoulLimit: false, technicalEjectAt: null, unsportsmanlikeEjectAt: 2, combinedEjectAt: null,
    teamFoulWindow: "period", bonusAfterFouls: 6, overtimeTeamFouls: "carry",
    timeoutsPerGame: 1, timeoutsFirstHalf: 0, timeoutsSecondHalf: 0, timeoutsPerOvertime: 0,
    clutchMinutes: 2, clutchMargin: 3,
    standingsWinPoints: 1, standingsLossPoints: 0, standingsForfeitLossPoints: 0, standingsTiebreak: "head_to_head",
  },
  custom: { ...FIBA, preset: "custom" },
};

export const BASKETBALL_RULE_CHOICES: Record<string, readonly string[]> = {
  preset: BASKETBALL_PRESETS_LIST,
  teamFoulWindow: ["period", "half"],
  overtimeTeamFouls: ["carry", "reset"],
  standingsTiebreak: ["head_to_head", "point_difference"],
};

const nullableInt = (v: unknown): boolean => v === null || isPosInt(v);

export function resolveBasketballRules(input: unknown): BasketballRules {
  const presetIn = input && typeof input === "object" ? (input as { preset?: unknown }).preset : undefined;
  const preset = presetIn ?? "fiba";
  if (typeof preset !== "string" || !(preset in BASKETBALL_PRESETS)) throw new RulesError("preset must be fiba, nba, ncaa, 3x3 or custom");
  const r = mergeRules(BASKETBALL_PRESETS[preset as BasketballPreset], input);

  for (const k of ["periods", "periodMinutes", "overtimeMinutes", "twoPointValue", "threePointValue", "freeThrowValue", "foulLimit", "playersOnCourt", "gameRosterSize", "clutchMinutes"] as const) {
    if (!isPosInt(r[k])) throw new RulesError(`${k} must be a positive whole number`);
  }
  for (const k of ["quarterBreakMinutes", "halftimeMinutes", "bonusFreeThrows", "technicalFreeThrows", "unsportsmanlikeFreeThrows", "bonusAfterFouls", "timeoutsFirstHalf", "timeoutsSecondHalf", "timeoutsPerOvertime", "clutchMargin", "standingsWinPoints", "standingsLossPoints", "standingsForfeitLossPoints"] as const) {
    if (!isNonNegInt(r[k])) throw new RulesError(`${k} must be a whole number, 0 or more`);
  }
  for (const k of ["shotClockSeconds", "shotClockReset", "technicalEjectAt", "unsportsmanlikeEjectAt", "combinedEjectAt", "doubleBonusAfterFouls", "bonusAfterFoulsOvertime", "targetScore", "overtimeTargetPoints"] as const) {
    if (!nullableInt(r[k])) throw new RulesError(`${k} must be a positive whole number, or empty for none`);
  }
  if (r.substitutionsPerGame !== null && !isNonNegInt(r.substitutionsPerGame)) throw new RulesError("substitutionsPerGame must be a whole number, or empty for unlimited");
  if (r.timeoutsPerGame !== null && !isNonNegInt(r.timeoutsPerGame)) throw new RulesError("timeoutsPerGame must be a whole number, or empty to allot timeouts by half");
  for (const k of ["allowTie", "alternatingPossession", "oneAndOne", "trackShotAttempts", "technicalsCountTowardFoulLimit", "offensiveFoulsAreTeamFouls", "technicalsAreTeamFouls"] as const) {
    if (typeof r[k] !== "boolean") throw new RulesError(`${k} must be yes or no`);
  }
  for (const [k, allowed] of Object.entries(BASKETBALL_RULE_CHOICES)) {
    if (!allowed.includes(r[k as keyof BasketballRules] as string)) throw new RulesError(`${k} must be one of ${allowed.join(", ")}`);
  }
  if (r.twoPointValue === r.threePointValue) throw new RulesError("the two field goal values must differ");
  if (r.gameRosterSize < r.playersOnCourt) throw new RulesError("the game roster must hold at least the players on court");
  if (r.clutchMinutes > r.periodMinutes) throw new RulesError("clutchMinutes cannot be longer than a period");
  if (r.doubleBonusAfterFouls !== null && r.doubleBonusAfterFouls <= r.bonusAfterFouls) throw new RulesError("the double bonus must start after the bonus");
  if (r.standingsWinPoints <= r.standingsLossPoints) throw new RulesError("a win must be worth more than a loss in the table");
  if (r.standingsForfeitLossPoints > r.standingsLossPoints) throw new RulesError("a forfeit cannot be worth more than a loss");
  if (r.shotClockSeconds !== null && r.shotClockSeconds > r.periodMinutes * 60) throw new RulesError("the shot clock cannot be longer than a period");
  // no shot clock: nothing to reset
  if (r.shotClockSeconds === null) r.shotClockReset = null;
  if (r.shotClockReset !== null && r.shotClockSeconds !== null && r.shotClockReset > r.shotClockSeconds) throw new RulesError("the shot clock reset cannot be longer than the shot clock");
  for (const k of ["bonusFreeThrows", "technicalFreeThrows", "unsportsmanlikeFreeThrows"] as const) if (r[k] > 3) throw new RulesError(`${k} must be 0 to 3`);
  return r;
}

// ── periods, windows, pools ─────────────────────────────────────────

export const isOvertime = (period: number, rules: BasketballRules): boolean => period > rules.periods;

export const periodSeconds = (period: number, rules: BasketballRules): number =>
  (isOvertime(period, rules) ? rules.overtimeMinutes : rules.periodMinutes) * 60;

export function periodName(period: number, rules: BasketballRules): string {
  if (period <= rules.periods) return rules.periods === 4 ? `Q${period}` : rules.periods === 2 ? `H${period}` : `P${period}`;
  return period - rules.periods === 1 ? "OT" : `OT${period - rules.periods}`;
}

/** Minutes of interval after `period` ends: half-time after the first half, a short break otherwise. */
export function breakAfter(period: number, rules: BasketballRules): { minutes: number; halftime: boolean } {
  const halftime = rules.periods > 1 && period === Math.ceil(rules.periods / 2) && !isOvertime(period, rules);
  // rules saved before the break settings existed fall back to FIBA's
  return halftime
    ? { minutes: rules.halftimeMinutes ?? 15, halftime }
    : { minutes: rules.quarterBreakMinutes ?? 2, halftime };
}

/** 1 or 2: which half of regulation a period belongs to (a single-period game is all first half). */
export const halfOf = (period: number, rules: BasketballRules): 1 | 2 =>
  period <= Math.ceil(rules.periods / 2) ? 1 : 2;

/** The window team fouls are counted in: "P3", "H2", or "OT1" when overtime starts afresh. */
export function foulWindow(period: number, rules: BasketballRules): string {
  if (isOvertime(period, rules)) {
    if (rules.overtimeTeamFouls === "reset") return `OT${period - rules.periods}`;
    return foulWindow(rules.periods, rules);
  }
  return rules.teamFoulWindow === "half" ? `H${halfOf(period, rules)}` : `P${period}`;
}

export function bonusThreshold(period: number, rules: BasketballRules): number {
  return isOvertime(period, rules) && rules.overtimeTeamFouls === "reset" && rules.bonusAfterFoulsOvertime !== null
    ? rules.bonusAfterFoulsOvertime : rules.bonusAfterFouls;
}

/** The pool a timeout is drawn from, and how many it holds. */
export function timeoutPool(period: number, rules: BasketballRules): { key: string; allowance: number } {
  if (isOvertime(period, rules)) return { key: `OT${period - rules.periods}`, allowance: rules.timeoutsPerOvertime };
  if (rules.timeoutsPerGame !== null) return { key: "G", allowance: rules.timeoutsPerGame };
  const half = halfOf(Math.max(1, period), rules);
  return { key: `H${half}`, allowance: half === 1 ? rules.timeoutsFirstHalf : rules.timeoutsSecondHalf };
}

// ── vocabulary that changes with the competition ────────────────────

export const FOUL_KINDS = ["personal", "shooting", "offensive", "technical", "unsportsmanlike", "disqualifying"] as const;
export type FoulKind = (typeof FOUL_KINDS)[number];

export function foulKindName(kind: FoulKind, rules: BasketballRules): string {
  if (rules.preset === "nba" || rules.preset === "ncaa") {
    if (kind === "unsportsmanlike") return "flagrant 1";
    if (kind === "disqualifying") return "flagrant 2";
  }
  return kind;
}

export const SHOT_ZONES = ["restricted_area", "paint", "mid_range", "corner_three", "above_break_three", "backcourt"] as const;
export type ShotZone = (typeof SHOT_ZONES)[number];
export const THREE_POINT_ZONES: readonly ShotZone[] = ["corner_three", "above_break_three", "backcourt"];
export const PAINT_ZONES: readonly ShotZone[] = ["restricted_area", "paint"];

export const SHOT_TYPES = ["layup", "dunk", "jump_shot", "pull_up", "catch_and_shoot", "floater", "hook", "tip_in", "alley_oop", "fadeaway"] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const label = (key: string): string => key.replace(/_/g, " ");

// Violations change possession and never the score. A defensive one
// (kicked ball, defensive three seconds) leaves the ball with the offence.
export const OFFENSIVE_VIOLATIONS = ["traveling", "double_dribble", "carrying", "backcourt", "three_seconds", "five_seconds", "eight_seconds", "shot_clock", "basket_interference"] as const;
export const DEFENSIVE_VIOLATIONS = ["kicked_ball", "defensive_three_seconds"] as const;
export const VIOLATIONS = [...OFFENSIVE_VIOLATIONS, ...DEFENSIVE_VIOLATIONS] as const;
export type Violation = (typeof VIOLATIONS)[number];

// Other spellings of the shot events, accepted from any client.
export const EVENT_ALIASES: Record<string, { type: "SHOT_MADE" | "SHOT_MISSED"; three: boolean }> = {
  TWO_POINT_MADE: { type: "SHOT_MADE", three: false }, TWO_POINT_MISSED: { type: "SHOT_MISSED", three: false },
  THREE_POINT_MADE: { type: "SHOT_MADE", three: true }, THREE_POINT_MISSED: { type: "SHOT_MISSED", three: true },
  "2PT_MADE": { type: "SHOT_MADE", three: false }, "2PT_MISSED": { type: "SHOT_MISSED", three: false },
  "3PT_MADE": { type: "SHOT_MADE", three: true }, "3PT_MISSED": { type: "SHOT_MISSED", three: true },
};
