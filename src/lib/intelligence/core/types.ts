// ================================================================
// Sports Intelligence: the sport-neutral contracts.
//
// Nothing in this folder knows a sport's rules. A sport is one file in
// ../sports implementing SportIntelligenceEngine; the state it keeps is
// its own shape (quarters, innings, lanes ...). What every sport shares
// is the event envelope, the match lifecycle and this interface.
// See docs/sports-intelligence/01-architecture.md.
// ================================================================

export type Side = "a" | "b";
export const SIDES: readonly Side[] = ["a", "b"];
export const otherSide = (s: Side): Side => (s === "a" ? "b" : "a");
export const isSide = (v: unknown): v is Side => v === "a" || v === "b";

export const SPORT_KEYS = ["basketball", "pickleball", "cricket", "volleyball", "badminton", "swimming", "tennis"] as const;
export type SportKey = (typeof SPORT_KEYS)[number];

export const CONTEST_STATUS = ["scheduled", "live", "paused", "completed", "abandoned", "postponed", "cancelled"] as const;
export type ContestStatus = (typeof CONTEST_STATUS)[number];

// Shared by every sport; handled in core/lifecycle.ts, never by an engine.
export const LIFECYCLE_EVENTS = [
  "MATCH_START", "MATCH_PAUSE", "MATCH_RESUME", "MATCH_POSTPONE", "MATCH_CANCEL",
  "MATCH_ABANDON", "MATCH_FORFEIT", "MATCH_RESTART", "MATCH_COMPLETE", "MATCH_REOPEN",
] as const;
export type LifecycleEventType = (typeof LIFECYCLE_EVENTS)[number];
export const CORRECTION_VOID = "CORRECTION_VOID";

export interface Participant {
  id: string;
  name: string;
  number?: number | null;
  userId?: string | null;
}

export interface SideContext {
  teamId: string;
  name: string;
  players: Participant[];
}

// Frozen when a contest is opened. Swimming has no sides (its entries
// live in the rules), so `sides` is null there.
export interface MatchContext {
  sport: SportKey;
  sides: Record<Side, SideContext> | null;
}

export type Payload = Record<string, unknown>;

// One row of si_events.
export interface StoredEvent {
  id: string;
  seq: number;
  type: string;
  payload: Payload;
  occurredAt: string;
  recordedBy?: string | null;
  clientId?: string | null;
  voidsEventId?: string | null;
  replacesEventId?: string | null;
  reason?: string | null;
}

// What an engine sees: just the fact, no bookkeeping.
export interface EngineEvent {
  id: string;
  seq: number;
  type: string;
  payload: Payload;
  occurredAt: string;
}

export interface Issue {
  severity: "error" | "warning";
  code: string;
  message: string;
  seq?: number;
  eventId?: string;
}

export interface MatchResult {
  outcome: "win" | "tie" | "draw" | "no_result" | "ranked";
  winner: Side | null;
  method: "played" | "forfeit" | "walkover" | "abandoned";
  margin: string | null;
}

// ── Read models: what the generic UI renders. An engine fills these in;
// the components never branch on the sport. ─────────────────────────

export interface ScoreView {
  kind: "versus" | "race";
  // versus: the two headline scores ("87", "164/6", "2")
  score?: Record<Side, string>;
  // second line under each score ("(17.3 ov)", "18")
  subScore?: Record<Side, string> | null;
  // "Q4 · 02:31", "Set 4", "Game 2", "Heat 3 · 100m Freestyle"
  periodLabel: string;
  // one short line for a compact score card, in the sport's own terms:
  // the current game's points, the set scores, the overs and target ...
  brief?: string;
  serving?: Side | null;
  // who has the ball, where the sport tracks it (basketball)
  possession?: Side | null;
  // live side-by-side figures under the score: team fouls, bonus, timeouts left ...
  facts?: { label: string; a: string; b: string }[];
  periods?: { label: string; a: string; b: string }[];
  // race: one row per lane, already ranked where possible
  lanes?: { lane: number; name: string; status: string; time: string | null; rank: number | null; detail: string | null }[];
  notes: string[];
}

export type StatValue = number | string | null;

export interface StatColumn {
  key: string;
  label: string;
  // raw = counted straight from events; derived = calculated from raw
  kind: "raw" | "derived";
  format?: "int" | "pct" | "dec1" | "dec2" | "time" | "text";
}

export interface StatRow {
  id: string;
  name: string;
  side: Side | null;
  values: Record<string, StatValue>;
}

export interface StatTable {
  key: string;
  title: string;
  columns: StatColumn[];
  rows: StatRow[];
}

export interface ChartSeries { name: string; side: Side | null; values: (number | null)[] }

export interface Chart {
  key: string;
  title: string;
  type: "line" | "bar";
  // category labels along the x axis
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  format?: "int" | "time" | "dec1";
}

export interface AnalyticsCard { label: string; value: string; hint?: string }

export interface Analytics {
  cards: AnalyticsCard[];
  charts: Chart[];
  tables: StatTable[];
  // plain-language observations, each worked out from a recorded figure
  insights?: string[];
}

// One section of "How scoring works", in the competition's own terms.
export interface GuideSection { title: string; lines: string[] }

// An answer to a question about one match, from its recorded data only.
export interface MatchAnswer {
  answer: string;
  // "data": read from the match; "glossary": a term explained; "unknown": not answerable from the data
  kind: "data" | "glossary" | "unknown";
}

// Raw counters for one player or team in one contest: what si_stat_lines
// stores, and the only thing historical aggregation reads.
export interface StatLine {
  subject: "player" | "team";
  subjectKey: string;
  side: Side | null;
  teamId: string | null;
  teamPlayerId: string | null;
  userId: string | null;
  eventKey: string | null;
  raw: Record<string, number>;
}

export interface Statistics {
  players: StatTable[];
  teams: StatTable[];
  lines: StatLine[];
}

// What tournament_matches shows for an event-scored match, so the
// existing home rail / fixtures / bracket need no changes.
export interface MirrorScore {
  scoreA: number;
  scoreB: number;
  cricket?: { wicketsA: number | null; wicketsB: number | null; oversA: number | null; oversB: number | null; target: number | null };
}

export class RulesError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SportIntelligenceEngine<R = any, S = any> {
  readonly sport: SportKey;
  readonly label: string;
  readonly eventTypes: readonly string[];
  /** Rules whose value is one of a fixed set (preset, foul window ...), for the rules form. */
  readonly ruleChoices?: Record<string, readonly string[]>;

  /** competition.rules merged over the sport's defaults; throws RulesError if invalid. */
  resolveRules(input: unknown): R;
  initializeMatch(ctx: MatchContext, rules: R): S;
  /** null when the event is possible, otherwise why it is not. */
  validateEvent(state: S, ev: EngineEvent, ctx: MatchContext, rules: R): string | null;
  /** The reducer. Mutates and returns the draft it is given; assumes validateEvent passed. */
  updateScore(state: S, ev: EngineEvent, ctx: MatchContext, rules: R): S;
  /** Invariants that must hold for any reachable state. */
  validateScore(state: S, ctx: MatchContext, rules: R): Issue[];
  getCurrentState(state: S, ctx: MatchContext, rules: R): ScoreView;
  /** The score reader: the current state in plain lines. */
  getMatchSummary(state: S, ctx: MatchContext, rules: R): string[];
  calculatePlayerStatistics(state: S, ctx: MatchContext, rules: R): StatTable[];
  calculateTeamStatistics(state: S, ctx: MatchContext, rules: R): StatTable[];
  calculateStatistics(state: S, ctx: MatchContext, rules: R): Statistics;
  calculateAdvancedAnalytics(state: S, ctx: MatchContext, rules: R): Analytics;
  /** null when the match can be completed, otherwise why not. */
  validateMatchCompletion(state: S, ctx: MatchContext, rules: R): string | null;
  finalizeMatch(state: S, ctx: MatchContext, rules: R): MatchResult;
  mirrorScore(state: S, ctx: MatchContext, rules: R): MirrorScore | null;
  /** Derived figures from summed raw counters, for historical aggregation. */
  deriveStats(subject: "player" | "team", raw: Record<string, number>): { columns: StatColumn[]; values: Record<string, StatValue> };
  /** Things the rules worked out rather than the scorer entered (game won, side out, innings closed). */
  derivedLog(state: S): { seq: number; text: string }[];
  /** Where an event falls in the match, worked out from the state before it (cricket: "1st innings 17.4"). */
  eventLabel?(state: S, ev: EngineEvent, rules: R): string | null;
  /** A one-line description of an event for the timeline. */
  describeEvent(ev: EngineEvent, ctx: MatchContext, rules: R): string;
  /** "How scoring works": the competition's rules in plain words. */
  rulesGuide?(rules: R): GuideSection[];
  /** Answer a plain-language question about the match from its state; never invents a figure. */
  answerQuestion?(state: S, ctx: MatchContext, rules: R, question: string): MatchAnswer;
}
