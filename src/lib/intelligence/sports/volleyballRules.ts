// Volleyball's rules without the engine: the formats, what a valid set
// score is, how a table is scored and how a player is ranked. The result
// form and the league table use these directly; so does the engine, so a
// score the form accepts is one the server accepts.

import type { Side } from "../core/types";

export type VolleyballPreset = "indoor" | "indoor3" | "beach" | "custom";
export type VolleyballTiebreak = "wins" | "set_ratio" | "point_ratio" | "head_to_head";

export interface VolleyballRules {
  preset: VolleyballPreset;
  bestOf: number;
  setPoints: number;
  decidingSetPoints: number;
  winBy: number;
  /** a score no set goes past; null: deuce runs until someone leads by winBy */
  pointCap: number | null;
  playersOnCourt: number;
  timeoutsPerSet: number;
  substitutionsPerSet: number;
  /** a player only swaps with the one they first swapped with, at most there and back in a set */
  substitutionPairs: boolean;
  liberoAllowed: boolean;
  maxLiberos: number;
  decidingSetToss: boolean;
  // league table
  tableWinPoints: number;
  tableDecidingWinPoints: number;
  tableDecidingLossPoints: number;
  tableLossPoints: number;
  tableForfeitLossPoints: number;
  tiebreakers: VolleyballTiebreak[];
}

export const VOLLEYBALL_TIEBREAKS: readonly VolleyballTiebreak[] = ["wins", "set_ratio", "point_ratio", "head_to_head"];

const INDOOR: VolleyballRules = {
  preset: "indoor", bestOf: 5, setPoints: 25, decidingSetPoints: 15, winBy: 2, pointCap: null,
  playersOnCourt: 6, timeoutsPerSet: 2, substitutionsPerSet: 6, substitutionPairs: true,
  liberoAllowed: true, maxLiberos: 2, decidingSetToss: true,
  // FIVB: 3-0 or 3-1 is worth 3 and 0; a match that goes to the deciding set 2 and 1
  tableWinPoints: 3, tableDecidingWinPoints: 2, tableDecidingLossPoints: 1, tableLossPoints: 0, tableForfeitLossPoints: 0,
  tiebreakers: ["wins", "set_ratio", "point_ratio", "head_to_head"],
};

export const VOLLEYBALL_PRESETS: Record<VolleyballPreset, VolleyballRules> = {
  indoor: INDOOR,
  indoor3: { ...INDOOR, preset: "indoor3", bestOf: 3 },
  // no rotation order to keep beyond the two players alternating, no substitutes, no Libero
  beach: { ...INDOOR, preset: "beach", bestOf: 3, setPoints: 21, playersOnCourt: 2, timeoutsPerSet: 1, substitutionsPerSet: 0, substitutionPairs: false, liberoAllowed: false, maxLiberos: 0 },
  custom: { ...INDOOR, preset: "custom" },
};

/** The rules a tournament has saved over its format's, without validating them. */
export function volleyballRulesOf(input: unknown): VolleyballRules {
  const saved = (input && typeof input === "object" ? input : {}) as Partial<VolleyballRules>;
  const base = VOLLEYBALL_PRESETS[saved.preset as VolleyballPreset] ?? INDOOR;
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof VolleyballRules)[]) {
    if (saved[k] !== undefined) (out as Record<string, unknown>)[k] = saved[k];
  }
  return out;
}

export interface SetScore { a: number; b: number }

/** Who has won a set at this score, or null. */
export function setWinner(score: SetScore, target: number, winBy: number, cap: number | null): Side | null {
  for (const [mine, theirs, side] of [[score.a, score.b, "a"], [score.b, score.a, "b"]] as const) {
    if (cap !== null && mine >= cap && mine > theirs) return side;
    if (mine >= target && mine - theirs >= winBy) return side;
  }
  return null;
}

export interface SetCheck {
  /** one message per problem, in plain words, naming the set */
  errors: string[];
  winners: (Side | null)[];
  setsWon: Record<Side, number>;
  /** the match winner, only once the sets entered decide it and nothing is wrong */
  winner: Side | null;
}

/** Most sets an entered result can hold. */
export const MAX_ENTERED_SETS = 15;

/**
 * What an entered result must satisfy. The organiser decides how many sets
 * were played and what they ended at: no set target, winning margin or
 * best-of limit applies. A set goes to the side with more points, and the
 * match to the side that won more sets, so neither can be level.
 */
export function checkSetScores(sets: readonly SetScore[]): SetCheck {
  const errors: string[] = [];
  const winners: (Side | null)[] = [];
  const setsWon: Record<Side, number> = { a: 0, b: 0 };

  if (sets.length > MAX_ENTERED_SETS) errors.push(`A match can have up to ${MAX_ENTERED_SETS} sets.`);
  sets.forEach((g, i) => {
    const n = i + 1;
    if (!Number.isInteger(g.a) || !Number.isInteger(g.b) || g.a < 0 || g.b < 0) {
      errors.push(`Set ${n}: scores must be whole numbers, 0 or more.`);
      winners.push(null);
      return;
    }
    if (g.a === g.b) {
      errors.push(`Set ${n}: ${g.a}-${g.b} is level. One team must have more points.`);
      winners.push(null);
      return;
    }
    const won: Side = g.a > g.b ? "a" : "b";
    winners.push(won);
    setsWon[won] += 1;
  });

  if (!sets.length) errors.push("Enter the set scores.");
  else if (!errors.length && setsWon.a === setsWon.b) errors.push(`Sets are level at ${setsWon.a}-${setsWon.b}. One team must win more sets.`);
  const winner = !errors.length ? (setsWon.a > setsWon.b ? "a" : "b") : null;
  return { errors, winners, setsWon, winner };
}

// ── player figures ──────────────────────────────────────────────────

/** Everything a player's line can hold when entered by hand after the match. */
export const VOLLEYBALL_LINE_KEYS = [
  "manualPoints", "attacks", "kills", "attackErrors", "serves", "aces", "serviceErrors", "blocks", "blockErrors", "digs",
  "receptions", "receptionPositive", "receptionErrors", "assists", "settingErrors", "substitutions", "yellowCards", "redCards",
] as const;
export type VolleyballLineKey = (typeof VOLLEYBALL_LINE_KEYS)[number];

type Raw = Record<string, number | null | undefined>;
const n = (r: Raw, k: string): number => r[k] ?? 0;

/**
 * A player's points: kills, block points and aces, plus points the scorer
 * added to them by hand. These are the player's record, not the team's score.
 */
export const pointsScored = (r: Raw): number => n(r, "kills") + n(r, "blocks") + n(r, "aces") + n(r, "manualPoints");

/** Attack efficiency: (kills - attack errors) / attack attempts x 100, or null with no attempts. */
export function attackEfficiency(r: Raw): number | null {
  return n(r, "attacks") ? Math.round((1000 * (n(r, "kills") - n(r, "attackErrors"))) / n(r, "attacks")) / 10 : null;
}

/**
 * The tournament MVP's rating: one for every point won, a half for each
 * assist, dig and positive reception, minus a half for each error.
 */
export function mvpRating(r: Raw): number {
  const good = n(r, "assists") + n(r, "digs") + n(r, "receptionPositive");
  const bad = n(r, "attackErrors") + n(r, "serviceErrors") + n(r, "blockErrors") + n(r, "receptionErrors") + n(r, "settingErrors");
  return pointsScored(r) + (good - bad) / 2;
}

export interface VolleyballLeaderboard {
  key: string;
  title: string;
  /** what the number is, as a reader needs it explained */
  how: string;
  value: (r: Raw) => number | null;
  format?: "pct" | "dec1";
  /** ties go to the higher of this */
  then?: (r: Raw) => number;
  /** fewest attempts to appear, so one lucky swing doesn't top the table */
  minKey?: string;
  min?: number;
}

export const VOLLEYBALL_LEADERBOARDS: VolleyballLeaderboard[] = [
  { key: "scorer", title: "Top scorer", how: "Kills + block points + aces + points added by the scorer", value: pointsScored },
  { key: "attacker", title: "Best attacker", how: "(Kills - attack errors) / attacks, at least 10 attacks", value: attackEfficiency, format: "pct", minKey: "attacks", min: 10, then: (r) => n(r, "kills") },
  { key: "server", title: "Best server", how: "Most aces, then fewest service errors", value: (r) => n(r, "aces"), then: (r) => -n(r, "serviceErrors") },
  { key: "blocker", title: "Best blocker", how: "Most block points", value: (r) => n(r, "blocks") },
  { key: "defender", title: "Best defender", how: "Digs + positive receptions", value: (r) => n(r, "digs") + n(r, "receptionPositive") },
  { key: "setter", title: "Best setter", how: "Most assists", value: (r) => n(r, "assists") },
  { key: "mvp", title: "Tournament MVP", how: "Points won + half of assists, digs and positive receptions - half of errors", value: mvpRating, format: "dec1" },
];

// ── court ───────────────────────────────────────────────────────────

/** Position names, in rotation order: position 1 (the server's) first. */
export const COURT_POSITIONS = ["Right back", "Right front", "Middle front", "Left front", "Left back", "Middle back"] as const;
/** Indexes into the rotation order that are back-row positions (1, 5 and 6). */
export const BACK_ROW = [0, 4, 5] as const;
/** The index a player reaches when rotating out of the back row (position 4). */
export const FRONT_ROW_ENTRY = 3;
