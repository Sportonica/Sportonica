// A cricket competition's league table: points for each result, how
// teams level on points are separated, and how many go through. Saved
// with the competition's cricket rules (scoring_rules.table); kept in its
// own module so the standings can read it without loading the engine.

export const CRICKET_TIEBREAKERS = ["nrr", "head_to_head", "wins", "runs_for"] as const;
export type CricketTiebreaker = (typeof CRICKET_TIEBREAKERS)[number];

export const TIEBREAKER_LABEL: Record<CricketTiebreaker, string> = {
  nrr: "net run rate",
  head_to_head: "results between the tied teams",
  wins: "most wins",
  runs_for: "most runs scored",
};

export interface CricketTable {
  win: number;
  tie: number;
  noResult: number;
  loss: number;
  /** after points, in this order */
  tiebreakers: CricketTiebreaker[];
  /** teams that go through from the table (each group); null when not set */
  qualifiers: number | null;
  /**
   * A bonus point for a convincing win: the winner's run rate at least
   * this many times the loser's (1.25 is the usual). Null: no bonus points.
   * Never for a super over win, a walkover or a match without both innings.
   */
  bonusRatio: number | null;
}

export const DEFAULT_CRICKET_TABLE: CricketTable = { win: 2, tie: 1, noResult: 1, loss: 0, tiebreakers: ["nrr", "wins"], qualifiers: null, bonusRatio: null };
const okRatio = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 3;

const points = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 20 ? v : fallback);

/** Lenient: whatever is missing or malformed falls back to the default. */
export function cricketTableOf(input: unknown): CricketTable {
  const t = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof CricketTable, unknown>>;
  const tb = Array.isArray(t.tiebreakers)
    ? [...new Set(t.tiebreakers.filter((x): x is CricketTiebreaker => (CRICKET_TIEBREAKERS as readonly unknown[]).includes(x)))]
    : DEFAULT_CRICKET_TABLE.tiebreakers;
  return {
    win: points(t.win, DEFAULT_CRICKET_TABLE.win),
    tie: points(t.tie, DEFAULT_CRICKET_TABLE.tie),
    noResult: points(t.noResult, DEFAULT_CRICKET_TABLE.noResult),
    loss: points(t.loss, DEFAULT_CRICKET_TABLE.loss),
    tiebreakers: tb,
    qualifiers: typeof t.qualifiers === "number" && Number.isInteger(t.qualifiers) && t.qualifiers > 0 && t.qualifiers <= 64 ? t.qualifiers : null,
    bonusRatio: okRatio(t.bonusRatio) ? Math.round(t.bonusRatio * 100) / 100 : null,
  };
}

/** Strict, for saving: names what is wrong instead of quietly fixing it. */
export function cricketTableProblem(input: unknown): string | null {
  if (input === undefined) return null;
  if (!input || typeof input !== "object") return "The points table settings are not valid";
  const t = input as Record<string, unknown>;
  for (const k of ["win", "tie", "noResult", "loss"] as const) {
    if (t[k] !== undefined && !(typeof t[k] === "number" && Number.isInteger(t[k]) && (t[k] as number) >= 0 && (t[k] as number) <= 20)) return "Table points must be whole numbers from 0 to 20";
  }
  if (typeof t.win === "number" && typeof t.loss === "number" && t.win <= t.loss) return "A win must be worth more points than a loss";
  if (t.tiebreakers !== undefined && (!Array.isArray(t.tiebreakers) || t.tiebreakers.some((x) => !(CRICKET_TIEBREAKERS as readonly unknown[]).includes(x)))) return "Unknown tiebreaker";
  if (t.bonusRatio !== undefined && t.bonusRatio !== null && !okRatio(t.bonusRatio)) return "The bonus point run rate must be between 1 and 3 times the opponent's";
  if (t.qualifiers !== undefined && t.qualifiers !== null && !(typeof t.qualifiers === "number" && Number.isInteger(t.qualifiers) && t.qualifiers > 0 && t.qualifiers <= 64)) return "Teams going through must be a whole number";
  return null;
}
