// Football (futsal, sevens, eleven-a-side): events -> score -> stats.
// Every action is its own event: goals, shots, passes, fouls, cards,
// corners, offsides, tackles, substitutions, timeouts, extra time and a
// penalty shootout. Competition differences are settings (presets
// futsal, sevens, eleven, custom). Spec: docs/sports-intelligence/07-football.md.
//
// The fixture keeps working as before: when the match is completed the
// regular-time score, extra-time goals and shootout go to
// record_match_result(), and each player's goals, assists and cards to
// record_match_player_stats(), so top scorers and card fines still add up.

import {
  RulesError, SIDES, isSide, otherSide,
  type Analytics, type AnalyticsCard, type Chart, type EngineEvent, type Issue, type MatchContext, type MatchResult, type ScoreView,
  type Side, type SportIntelligenceEngine, type StatColumn, type StatLine, type StatRow, type StatTable, type StatValue,
} from "../core/types";
import { add, isNonNegInt, isPosInt, mergeRules, pct, playerName, playersOf, ratio, round, sideName, sideOfPlayer, str } from "../core/util";
import { askMatch } from "../core/ask";
import { FOOTBALL_KNOWLEDGE } from "../knowledge/football";

export const FOOTBALL_PRESETS_LIST = ["futsal", "sevens", "eleven", "custom"] as const;

export interface FootballRules {
  preset: (typeof FOOTBALL_PRESETS_LIST)[number];
  playersOnPitch: number;
  /** fewer than this and the match cannot go on */
  minPlayers: number;
  periods: number;
  periodMinutes: number;
  /** each extra-time period; 0: no extra time */
  extraTimeMinutes: number;
  /** a knockout match level at full time */
  knockoutDecider: "extra_time_then_penalties" | "penalties";
  shootoutKicks: number;
  /** null: rolling substitutions, no limit */
  maxSubstitutions: number | null;
  yellowsForRed: number;
  /** futsal: from this many team fouls in a half, each further foul gives a kick from the second penalty mark; null: no rule */
  accumulatedFoulLimit: number | null;
  timeoutsPerPeriod: number;
  /** set per match when it is opened: a knockout match cannot end level */
  knockout: boolean;
}

const FUTSAL: FootballRules = {
  preset: "futsal", playersOnPitch: 5, minPlayers: 3, periods: 2, periodMinutes: 20, extraTimeMinutes: 5,
  knockoutDecider: "extra_time_then_penalties", shootoutKicks: 5, maxSubstitutions: null, yellowsForRed: 2,
  accumulatedFoulLimit: 5, timeoutsPerPeriod: 1, knockout: false,
};

export const FOOTBALL_PRESETS: Record<FootballRules["preset"], FootballRules> = {
  futsal: FUTSAL,
  // local 7-a-side on futsal courts: rolling substitutions, straight to penalties
  sevens: { ...FUTSAL, preset: "sevens", playersOnPitch: 7, minPlayers: 5, periodMinutes: 25, extraTimeMinutes: 0, knockoutDecider: "penalties", accumulatedFoulLimit: null, timeoutsPerPeriod: 0 },
  // IFAB Laws of the Game
  eleven: { ...FUTSAL, preset: "eleven", playersOnPitch: 11, minPlayers: 7, periodMinutes: 45, extraTimeMinutes: 15, maxSubstitutions: 5, accumulatedFoulLimit: null, timeoutsPerPeriod: 0 },
  custom: { ...FUTSAL, preset: "custom" },
};

export const FOOTBALL_RULE_CHOICES: Record<string, readonly string[]> = {
  preset: FOOTBALL_PRESETS_LIST, knockoutDecider: ["extra_time_then_penalties", "penalties"],
};

export const GOAL_KINDS = ["open_play", "header", "penalty", "free_kick", "corner", "counter_attack", "second_penalty", "own_goal"] as const;
export const SHOT_OUTCOMES = ["on_target", "off_target", "blocked", "woodwork"] as const;

interface Goal { seq: number; side: Side; player: string | null; assist: string | null; minute: number | null; period: number; kind: string; ownGoal: boolean }
interface Kick { seq: number; side: Side; player: string | null; scored: boolean }
export interface FootballExplanation { seq: number; kind: "score" | "no_score" | "other"; text: string }

export interface FootballState {
  period: number;
  periodOpen: boolean;
  score: Record<Side, number>;
  byPeriod: Record<Side, number[]>;
  goals: Goal[];
  team: Record<Side, Record<string, number>>;
  players: Record<string, Record<string, number>>;
  sentOff: Record<string, true>;
  onPitch: Record<Side, string[] | null>;
  starters: Record<Side, string[] | null>;
  subsUsed: Record<Side, number>;
  /** team fouls per period, for futsal's accumulated-foul rule */
  periodFouls: Record<Side, number[]>;
  timeoutsUsed: Record<Side, number[]>;
  shootout: { first: Side; kicks: Kick[]; score: Record<Side, number>; decided: Side | null } | null;
  /** the minute each player came on / went off, when lineups and minutes are known */
  stints: Record<string, { on: number; off: number | null }[]>;
  minutesValid: boolean;
  lastMinute: number | null;
  recent: FootballExplanation[];
  log: { seq: number; text: string }[];
}

const regulationDone = (s: FootballState, r: FootballRules) => s.period >= r.periods && !s.periodOpen;
const extraPeriods = (r: FootballRules) => (r.knockoutDecider === "extra_time_then_penalties" && r.extraTimeMinutes > 0 ? 2 : 0);
const level = (s: FootballState) => s.score.a === s.score.b;
const periodLength = (p: number, r: FootballRules) => (p <= r.periods ? r.periodMinutes : r.extraTimeMinutes);
const minuteAtStart = (p: number, r: FootballRules) => { let m = 0; for (let i = 1; i < p; i++) m += periodLength(i, r); return m; };
const half = (p: number, r: FootballRules) => (p <= r.periods ? p : r.periods); // extra time continues the second half's fouls

export function periodName(p: number, r: FootballRules): string {
  if (p <= r.periods) return r.periods === 2 ? (p === 1 ? "1st half" : "2nd half") : `Period ${p}`;
  return p - r.periods === 1 ? "Extra time 1" : "Extra time 2";
}

function push(s: FootballState, e: FootballExplanation): void {
  s.recent.push(e);
  if (s.recent.length > 30) s.recent.splice(0, s.recent.length - 30);
}

function credit(s: FootballState, side: Side, player: string | null, key: string, n = 1): void {
  add(s.team[side], key, n);
  if (player) add((s.players[player] ??= {}), key, n);
}

/** Can the shootout still be won by the side behind? */
function shootoutDecided(sh: NonNullable<FootballState["shootout"]>, r: FootballRules): Side | null {
  const taken = { a: sh.kicks.filter((k) => k.side === "a").length, b: sh.kicks.filter((k) => k.side === "b").length };
  if (taken.a <= r.shootoutKicks && taken.b <= r.shootoutKicks) {
    for (const side of SIDES) {
      const o = otherSide(side);
      const left = r.shootoutKicks - taken[o];
      if (sh.score[side] > sh.score[o] + left) return side;
    }
    if (taken.a === r.shootoutKicks && taken.b === r.shootoutKicks && sh.score.a !== sh.score.b) return sh.score.a > sh.score.b ? "a" : "b";
    return null;
  }
  // sudden death: after each pair
  if (taken.a === taken.b && sh.score.a !== sh.score.b) return sh.score.a > sh.score.b ? "a" : "b";
  return null;
}

const nextKicker = (sh: NonNullable<FootballState["shootout"]>): Side => (sh.kicks.length % 2 === 0 ? sh.first : otherSide(sh.first));

const col = (key: string, label: string, kind: "raw" | "derived" = "raw", format?: StatColumn["format"]): StatColumn => ({ key, label, kind, ...(format ? { format } : {}) });
const n0 = (r: Record<string, number> | undefined, k: string) => r?.[k] ?? 0;

function derived(raw: Record<string, number>): Record<string, StatValue> {
  return {
    shotAccuracy: round(pct(n0(raw, "shotsOnTarget"), raw.shots), 1),
    conversion: round(pct(n0(raw, "goals"), raw.shots), 1),
    passAccuracy: round(pct(n0(raw, "passesCompleted"), raw.passes), 1),
    passes: raw.passes ? `${n0(raw, "passesCompleted")}/${raw.passes}` : null,
  };
}

/** Minutes on the pitch, when lineups and the minute of every substitution are known. */
function minutesPlayed(s: FootballState, id: string, r: FootballRules): number | null {
  if (!s.minutesValid || !s.onPitch.a || !s.onPitch.b) return null;
  const end = s.periodOpen ? s.lastMinute : minuteAtStart(s.period + 1, r);
  if (end === null) return null;
  return (s.stints[id] ?? []).reduce((t, x) => t + Math.max(0, (x.off ?? end) - x.on), 0);
}

export const footballEngine: SportIntelligenceEngine<FootballRules, FootballState> = {
  sport: "football",
  label: "Football",
  eventTypes: ["PERIOD_START", "PERIOD_END", "LINEUP", "SUBSTITUTION", "GOAL", "SHOT", "PASS", "FOUL", "CARD", "CORNER", "OFFSIDE", "TACKLE", "INTERCEPTION", "TIMEOUT", "SHOOTOUT_START", "SHOOTOUT_KICK"],
  ruleChoices: FOOTBALL_RULE_CHOICES,

  answerQuestion(s, ctx, rules, question) { return askMatch(this, s, ctx, rules, question, FOOTBALL_KNOWLEDGE); },
  rulesGuide: (rules) => FOOTBALL_KNOWLEDGE.guide(rules),

  resolveRules(input) {
    const presetIn = input && typeof input === "object" ? (input as { preset?: unknown }).preset : undefined;
    const preset = presetIn ?? "futsal";
    if (typeof preset !== "string" || !(preset in FOOTBALL_PRESETS)) throw new RulesError("preset must be futsal, sevens, eleven or custom");
    const r = mergeRules(FOOTBALL_PRESETS[preset as FootballRules["preset"]], input);
    for (const k of ["playersOnPitch", "minPlayers", "periods", "periodMinutes", "shootoutKicks", "yellowsForRed"] as const) if (!isPosInt(r[k])) throw new RulesError(`${k} must be a positive whole number`);
    for (const k of ["extraTimeMinutes", "timeoutsPerPeriod"] as const) if (!isNonNegInt(r[k])) throw new RulesError(`${k} must be a whole number, 0 or more`);
    if (r.maxSubstitutions !== null && !isNonNegInt(r.maxSubstitutions)) throw new RulesError("maxSubstitutions must be a whole number, or empty for rolling substitutions");
    if (r.accumulatedFoulLimit !== null && !isPosInt(r.accumulatedFoulLimit)) throw new RulesError("accumulatedFoulLimit must be a positive whole number, or empty");
    if (r.minPlayers > r.playersOnPitch) throw new RulesError("minPlayers cannot be more than playersOnPitch");
    if (!FOOTBALL_RULE_CHOICES.knockoutDecider.includes(r.knockoutDecider)) throw new RulesError("knockoutDecider must be extra_time_then_penalties or penalties");
    if (typeof r.knockout !== "boolean") throw new RulesError("knockout must be yes or no");
    return r;
  },

  initializeMatch() {
    return {
      period: 0, periodOpen: false, score: { a: 0, b: 0 }, byPeriod: { a: [], b: [] }, goals: [],
      team: { a: {}, b: {} }, players: {}, sentOff: {}, onPitch: { a: null, b: null }, starters: { a: null, b: null },
      subsUsed: { a: 0, b: 0 }, periodFouls: { a: [], b: [] }, timeoutsUsed: { a: [], b: [] }, shootout: null,
      stints: {}, minutesValid: true, lastMinute: null, recent: [], log: [],
    };
  },

  validateEvent(s, ev, ctx, r) {
    const p = ev.payload;
    if (p.minute != null && (!isNonNegInt(p.minute) || p.minute > 300)) return "The minute must be a whole number";
    const onSide = (id: unknown, side: Side, what: string): string | null => {
      if (id == null) return null;
      if (typeof id !== "string" || sideOfPlayer(ctx, id) !== side) return `${what} is not in ${sideName(ctx, side)}`;
      if (s.sentOff[id]) return `${playerName(ctx, id)} has been sent off`;
      if (s.onPitch[side] && !s.onPitch[side]!.includes(id)) return `${playerName(ctx, id)} is not on the pitch`;
      return null;
    };

    switch (ev.type) {
      case "PERIOD_START": {
        if (s.periodOpen) return `${periodName(s.period, r)} is still in progress`;
        if (s.shootout) return "The penalty shootout has started";
        if (s.period < r.periods) return null;
        if (!r.knockout) return "Full time: complete the match";
        if (s.period >= r.periods + extraPeriods(r)) return extraPeriods(r) ? "Extra time is over: complete the match, or start the penalty shootout if level" : "Start the penalty shootout";
        // the second half of extra time is played whatever the score; only going into extra time needs a level score
        if (s.period === r.periods && !level(s)) return "Extra time is only played when the score is level";
        return null;
      }
      case "PERIOD_END": return s.periodOpen ? null : "No period is in progress";
      case "LINEUP": {
        if (!isSide(p.side)) return "Say which side the lineup is for";
        const list = p.players;
        if (!Array.isArray(list) || list.length !== r.playersOnPitch) return `A lineup needs exactly ${r.playersOnPitch} players`;
        if (new Set(list).size !== list.length) return "A player appears twice in the lineup";
        if (list.some((id) => typeof id !== "string" || sideOfPlayer(ctx, id) !== p.side)) return "Every lineup player must belong to that side";
        if (list.some((id) => s.sentOff[id as string])) return "A sent-off player cannot be in the lineup";
        if (s.period > 0) return "Lineups are set before kick-off; use substitutions after that";
        return null;
      }
      case "SUBSTITUTION": {
        if (!isSide(p.side)) return "Say which side";
        const pitch = s.onPitch[p.side];
        if (!pitch) return "Set the lineup before recording substitutions";
        if (typeof p.in !== "string" || typeof p.out !== "string") return "Say who comes on and who goes off";
        if (sideOfPlayer(ctx, p.in) !== p.side) return "The player coming on is not in that team";
        if (!pitch.includes(p.out)) return "The player going off is not on the pitch";
        if (pitch.includes(p.in)) return "The player coming on is already on the pitch";
        if (s.sentOff[p.in]) return "A sent-off player cannot come back on";
        if (r.maxSubstitutions !== null && s.subsUsed[p.side] >= r.maxSubstitutions) return `${sideName(ctx, p.side)} have used all ${r.maxSubstitutions} substitutions`;
        if (r.maxSubstitutions !== null && s.stints[p.in]?.length) return "A player who was substituted off cannot return (no rolling substitutions)";
        return null;
      }
      case "SHOOTOUT_START": {
        if (s.shootout) return "The shootout has already started";
        if (s.periodOpen) return "End the period first";
        if (!r.knockout) return "Only a knockout match goes to penalties";
        if (s.period < r.periods + extraPeriods(r)) return extraPeriods(r) && s.period >= r.periods ? "Play extra time first" : "Finish normal time first";
        if (!level(s)) return "A shootout is only needed when the score is level";
        return isSide(p.first) ? null : "Say which team kicks first";
      }
      case "SHOOTOUT_KICK": {
        if (!s.shootout) return "Start the penalty shootout first";
        if (s.shootout.decided) return "The shootout is decided";
        if (!isSide(p.side)) return "Say which team kicked";
        if (p.side !== nextKicker(s.shootout)) return `It is ${sideName(ctx, nextKicker(s.shootout))}'s kick`;
        if (typeof p.scored !== "boolean") return "Say whether the kick was scored";
        if (p.player != null && (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== p.side)) return `That player is not in ${sideName(ctx, p.side)}`;
        if (typeof p.player === "string" && s.sentOff[p.player]) return `${playerName(ctx, p.player)} was sent off and cannot take a kick`;
        return null;
      }
      case "TIMEOUT":
        if (!isSide(p.side)) return "Say which side";
        if (!s.periodOpen) return "A timeout is taken during a period";
        if (r.timeoutsPerPeriod === 0) return "This competition has no timeouts";
        if ((s.timeoutsUsed[p.side][s.period - 1] ?? 0) >= r.timeoutsPerPeriod) return `${sideName(ctx, p.side)} have used their timeout in this period`;
        return null;
    }

    // play
    if (s.shootout) return "The match is in the penalty shootout";
    if (!s.periodOpen) return s.period === 0 ? "Kick off first: start the 1st half" : "Start the next period before recording play";
    if (!isSide(p.side)) return "Say which side";
    const side = p.side;
    switch (ev.type) {
      case "GOAL": {
        const own = p.ownGoal === true || p.kind === "own_goal";
        if (p.kind != null && !(GOAL_KINDS as readonly unknown[]).includes(p.kind)) return "Unknown kind of goal";
        // an own goal counts for `side` but was scored by an opponent
        const why = onSide(p.player, own ? otherSide(side) : side, "The scorer");
        if (why) return own ? `For an own goal, the player must be in ${sideName(ctx, otherSide(side))}` : why;
        if (p.assist != null) {
          if (own) return "An own goal has no assist";
          const a = onSide(p.assist, side, "The assist");
          if (a) return a;
          if (p.assist === p.player) return "A player cannot assist their own goal";
        }
        return null;
      }
      case "SHOT":
        if (!(SHOT_OUTCOMES as readonly unknown[]).includes(p.outcome)) return "Say where the shot went: on target, off target, blocked or woodwork";
        return onSide(p.player, side, "The shooter") ?? onSide(p.keeper, otherSide(side), "The goalkeeper");
      case "PASS":
        if (typeof p.completed !== "boolean") return "Say whether the pass was completed";
        if (p.to != null && p.completed === false) return "An incomplete pass has no receiver";
        return onSide(p.player, side, "The passer") ?? onSide(p.to, side, "The receiver");
      case "FOUL":
        return onSide(p.player, side, "The player") ?? onSide(p.on, otherSide(side), "The fouled player");
      case "CARD":
        if (p.color !== "yellow" && p.color !== "red") return "A card is yellow or red";
        if (p.player != null) {
          if (typeof p.player !== "string" || sideOfPlayer(ctx, p.player) !== side) return `That player is not in ${sideName(ctx, side)}`;
          if (s.sentOff[p.player]) return `${playerName(ctx, p.player)} has already been sent off`;
        }
        return null;
      case "OFFSIDE": case "TACKLE": case "INTERCEPTION":
        return onSide(p.player, side, "That player");
      case "CORNER": return null;
    }
    return null;
  },

  updateScore(s, ev, ctx, r) {
    const p = ev.payload;
    const side = p.side as Side;
    const who = str(p.player);
    const minute = isNonNegInt(p.minute) ? p.minute : null;
    if (minute !== null) s.lastMinute = minute;
    const name = (side_: Side, id: string | null) => (id ? playerName(ctx, id) : sideName(ctx, side_));
    const at = minute !== null ? ` (${minute}')` : "";

    switch (ev.type) {
      case "PERIOD_START":
        s.period += 1; s.periodOpen = true;
        for (const x of SIDES) { s.byPeriod[x][s.period - 1] = 0; s.periodFouls[x][s.period - 1] = 0; s.timeoutsUsed[x][s.period - 1] = 0; }
        if (s.lastMinute === null || s.lastMinute < minuteAtStart(s.period, r)) s.lastMinute = minuteAtStart(s.period, r);
        s.log.push({ seq: ev.seq, text: `${periodName(s.period, r)} started` });
        break;
      case "PERIOD_END":
        s.periodOpen = false;
        s.lastMinute = minuteAtStart(s.period + 1, r);
        s.log.push({ seq: ev.seq, text: `End of ${periodName(s.period, r)}: ${sideName(ctx, "a")} ${s.score.a}, ${sideName(ctx, "b")} ${s.score.b}` });
        break;
      case "LINEUP":
        s.onPitch[side] = [...(p.players as string[])];
        s.starters[side] = [...(p.players as string[])];
        for (const id of s.onPitch[side]!) s.stints[id] = [{ on: 0, off: null }];
        break;
      case "SUBSTITUTION": {
        const pitch = s.onPitch[side]!;
        pitch[pitch.indexOf(p.out as string)] = p.in as string;
        s.subsUsed[side] += 1;
        if (minute === null) s.minutesValid = false;
        const m = minute ?? 0;
        const outStints = s.stints[p.out as string] ?? [];
        if (outStints.length) outStints[outStints.length - 1].off = m;
        (s.stints[p.in as string] ??= []).push({ on: m, off: null });
        s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}${at}` });
        break;
      }
      case "GOAL": {
        const own = p.ownGoal === true || p.kind === "own_goal";
        const before = s.score[side];
        s.score[side] += 1;
        s.byPeriod[side][s.period - 1] = (s.byPeriod[side][s.period - 1] ?? 0) + 1;
        // the team's goals are its score; only players need a goal counter
        if (own) { if (who) add((s.players[who] ??= {}), "ownGoals"); add(s.team[otherSide(side)], "ownGoalsConceded"); }
        else {
          if (who) add((s.players[who] ??= {}), "goals");
          // a goal is a shot on target that went in
          credit(s, side, who, "shots"); credit(s, side, who, "shotsOnTarget");
          if (typeof p.assist === "string") credit(s, side, p.assist, "assists");
          if (p.kind === "penalty" || p.kind === "second_penalty") credit(s, side, who, "penaltiesScored");
        }
        s.goals.push({ seq: ev.seq, side, player: who, assist: str(p.assist), minute, period: s.period, kind: own ? "own_goal" : (p.kind as string) ?? "open_play", ownGoal: own });
        const tally = who && !own ? s.goals.filter((g) => g.player === who && !g.ownGoal).length : 0;
        if (tally === 2) s.log.push({ seq: ev.seq, text: `${playerName(ctx, who!)}: a brace` });
        if (tally === 3) s.log.push({ seq: ev.seq, text: `${playerName(ctx, who!)}: a hat-trick` });
        const how = own ? `an own goal by ${name(otherSide(side), who)}` : `a goal by ${name(side, who)}${typeof p.assist === "string" ? `, assisted by ${playerName(ctx, p.assist)}` : ""}${p.kind && p.kind !== "open_play" ? ` (${String(p.kind).replace(/_/g, " ")})` : ""}`;
        push(s, { seq: ev.seq, kind: "score", text: `${sideName(ctx, side)}'s score went from ${before} to ${s.score[side]} because of ${how}${at}. It is ${s.score.a}-${s.score.b}.` });
        break;
      }
      case "SHOT": {
        const outcome = p.outcome as string;
        credit(s, side, who, "shots");
        if (outcome === "on_target") {
          credit(s, side, who, "shotsOnTarget");
          // an on-target shot that is not a goal was saved
          credit(s, otherSide(side), str(p.keeper), "saves");
        }
        if (outcome === "woodwork") credit(s, side, who, "woodwork");
        if (outcome === "blocked") add(s.team[otherSide(side)], "blocks");
        if (p.penalty === true) credit(s, side, who, "penaltiesMissed");
        push(s, { seq: ev.seq, kind: "no_score", text: `No goal: ${name(side, who)}'s ${p.penalty ? "penalty" : "shot"} was ${outcome === "on_target" ? `saved${str(p.keeper) ? ` by ${playerName(ctx, str(p.keeper))}` : ""}` : outcome === "woodwork" ? "off the woodwork" : outcome === "blocked" ? "blocked" : "off target"}${at}. The score stays ${s.score.a}-${s.score.b}.` });
        break;
      }
      case "PASS":
        credit(s, side, who, "passes");
        if (p.completed) credit(s, side, who, "passesCompleted");
        if (p.key === true) credit(s, side, who, "keyPasses");
        break;
      case "FOUL": {
        credit(s, side, who, "fouls");
        if (str(p.on)) add((s.players[str(p.on)!] ??= {}), "foulsDrawn");
        const h = half(s.period, r);
        // futsal: team fouls in the half (extra time continues the second half's count)
        const count = (s.periodFouls[side][h - 1] = (s.periodFouls[side][h - 1] ?? 0) + 1);
        if (p.penalty === true) add(s.team[otherSide(side)], "penaltiesWon");
        if (r.accumulatedFoulLimit !== null && count > r.accumulatedFoulLimit) {
          s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)}'s ${count}th accumulated foul: a direct kick from the second penalty mark` });
          push(s, { seq: ev.seq, kind: "other", text: `${sideName(ctx, side)} have ${count} fouls this half, more than ${r.accumulatedFoulLimit}: ${sideName(ctx, otherSide(side))} get a free shot from the second penalty mark.` });
        }
        break;
      }
      case "CARD": {
        const color = p.color as "yellow" | "red";
        if (!who) { s.log.push({ seq: ev.seq, text: `${color === "red" ? "Red" : "Yellow"} card for ${sideName(ctx, side)}'s bench` }); break; }
        if (color === "yellow") credit(s, side, who, "yellowCards");
        const yellows = n0(s.players[who], "yellowCards");
        const sentOff = color === "red" || yellows >= r.yellowsForRed;
        if (sentOff) {
          credit(s, side, who, "redCards");
          s.sentOff[who] = true;
          const pitch = s.onPitch[side];
          if (pitch) {
            s.onPitch[side] = pitch.filter((id) => id !== who);
            const st = s.stints[who] ?? [];
            if (st.length) st[st.length - 1].off = minute ?? s.lastMinute ?? 0;
          }
          const left = s.onPitch[side]?.length ?? null;
          s.log.push({ seq: ev.seq, text: `${playerName(ctx, who)} sent off${color === "yellow" ? " (second yellow)" : ""}${at}` });
          push(s, { seq: ev.seq, kind: "other", text: `${playerName(ctx, who)} was sent off${color === "yellow" ? ` for a ${ordinal(yellows)} yellow card` : ""}${at}. ${sideName(ctx, side)} play on with ${left !== null ? left : "one player fewer"}${left !== null ? " players" : ""}.` });
          if (left !== null && left < r.minPlayers) s.log.push({ seq: ev.seq, text: `${sideName(ctx, side)} are below ${r.minPlayers} players: the match cannot continue` });
        }
        break;
      }
      case "CORNER": credit(s, side, null, "corners"); break;
      case "OFFSIDE": credit(s, side, who, "offsides"); break;
      case "TACKLE": credit(s, side, who, "tackles"); if (p.won !== false) credit(s, side, who, "tacklesWon"); break;
      case "INTERCEPTION": credit(s, side, who, "interceptions"); break;
      case "TIMEOUT":
        s.timeoutsUsed[side][s.period - 1] = (s.timeoutsUsed[side][s.period - 1] ?? 0) + 1;
        s.log.push({ seq: ev.seq, text: `Timeout ${sideName(ctx, side)}` });
        break;
      case "SHOOTOUT_START":
        s.shootout = { first: p.first as Side, kicks: [], score: { a: 0, b: 0 }, decided: null };
        s.log.push({ seq: ev.seq, text: `Penalty shootout: ${sideName(ctx, p.first as Side)} kick first` });
        break;
      case "SHOOTOUT_KICK": {
        const sh = s.shootout!;
        sh.kicks.push({ seq: ev.seq, side, player: who, scored: p.scored === true });
        if (p.scored === true) sh.score[side] += 1;
        sh.decided = shootoutDecided(sh, r);
        push(s, { seq: ev.seq, kind: p.scored ? "score" : "no_score", text: `${name(side, who)} ${p.scored ? "scored" : "missed"} in the shootout: ${sh.score.a}-${sh.score.b} on penalties.` });
        if (sh.decided) s.log.push({ seq: ev.seq, text: `${sideName(ctx, sh.decided)} win the shootout ${sh.score[sh.decided]}-${sh.score[otherSide(sh.decided)]}` });
        break;
      }
    }
    return s;
  },

  validateScore(s) {
    const issues: Issue[] = [];
    for (const side of SIDES) {
      if (s.goals.filter((g) => g.side === side).length !== s.score[side]) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "The score does not match the goals recorded" });
      const byP = s.byPeriod[side].reduce((t, v) => t + (v ?? 0), 0);
      if (byP !== s.score[side]) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "Period goals do not add up to the score" });
      if (n0(s.team[side], "shotsOnTarget") > n0(s.team[side], "shots")) issues.push({ severity: "error", code: "IMPOSSIBLE_SCORE", message: "More shots on target than shots" });
    }
    return issues;
  },

  getCurrentState(s, ctx, r) {
    const sh = s.shootout;
    const label = sh ? (sh.decided ? "Penalties: decided" : "Penalty shootout")
      : s.period === 0 ? "Not started"
      : s.periodOpen ? `${periodName(s.period, r)}${s.lastMinute !== null ? `, ${s.lastMinute}'` : ""}`
      : s.period === 1 && r.periods === 2 ? "Half-time"
      : regulationDone(s, r) ? (s.period > r.periods ? "End of extra time" : "Full time") : `End of ${periodName(s.period, r)}`;
    const notes: string[] = [];
    if (regulationDone(s, r) && level(s) && r.knockout && !sh) notes.push(s.period < r.periods + extraPeriods(r) ? "Level: extra time to follow" : "Level: penalties to follow");
    if (sh && !sh.decided) notes.push(`Next kick: ${sideName(ctx, nextKicker(sh))}`);
    const red = Object.keys(s.sentOff).map((id) => playerName(ctx, id));
    if (red.length) notes.push(`Sent off: ${red.join(", ")}`);
    const h = half(Math.max(1, s.period), r);
    const facts = s.period > 0 ? [
      { label: "Shots (on target)", a: `${n0(s.team.a, "shots")} (${n0(s.team.a, "shotsOnTarget")})`, b: `${n0(s.team.b, "shots")} (${n0(s.team.b, "shotsOnTarget")})` },
      { label: "Corners", a: String(n0(s.team.a, "corners")), b: String(n0(s.team.b, "corners")) },
      r.accumulatedFoulLimit !== null
        ? { label: "Fouls this half", a: String(s.periodFouls.a[h - 1] ?? 0), b: String(s.periodFouls.b[h - 1] ?? 0) }
        : { label: "Fouls", a: String(n0(s.team.a, "fouls")), b: String(n0(s.team.b, "fouls")) },
      { label: "Cards", a: `${n0(s.team.a, "yellowCards")}Y ${n0(s.team.a, "redCards")}R`, b: `${n0(s.team.b, "yellowCards")}Y ${n0(s.team.b, "redCards")}R` },
    ] : [];
    const view: ScoreView = {
      kind: "versus",
      score: { a: String(s.score.a), b: String(s.score.b) },
      subScore: sh ? { a: `(${sh.score.a} pens)`, b: `(${sh.score.b} pens)` } : null,
      periodLabel: label,
      brief: [s.goals.length ? s.goals.map((g) => `${g.minute !== null ? `${g.minute}' ` : ""}${g.ownGoal ? "OG " : ""}${g.player ? playerName(ctx, g.player) : sideName(ctx, g.side)}`).join(", ") : "", sh ? `pens ${sh.score.a}-${sh.score.b}` : ""].filter(Boolean).join("; "),
      serving: null,
      facts,
      periods: Array.from({ length: s.period }, (_, i) => ({ label: periodName(i + 1, r), a: String(s.byPeriod.a[i] ?? 0), b: String(s.byPeriod.b[i] ?? 0) })),
      notes,
    };
    return view;
  },

  getMatchSummary(s, ctx, r) {
    const lines = [`${sideName(ctx, "a")} ${s.score.a} - ${sideName(ctx, "b")} ${s.score.b}`];
    lines.push(this.getCurrentState(s, ctx, r).periodLabel);
    for (const side of SIDES) {
      const scorers = s.goals.filter((g) => g.side === side).map((g) => `${g.ownGoal ? "OG " : ""}${g.player ? playerName(ctx, g.player) : "unknown"}${g.minute !== null ? ` ${g.minute}'` : ""}`);
      if (scorers.length) lines.push(`${sideName(ctx, side)}: ${scorers.join(", ")}`);
    }
    return lines;
  },

  calculatePlayerStatistics(s, ctx, r) {
    const rows: StatRow[] = SIDES.flatMap((side) => playersOf(ctx, side).map((pl) => {
      const raw = s.players[pl.id] ?? {};
      return {
        id: pl.id, name: pl.number != null ? `${pl.number} ${pl.name}` : pl.name, side,
        values: {
          min: minutesPlayed(s, pl.id, r), goals: n0(raw, "goals"), assists: n0(raw, "assists"), shots: n0(raw, "shots"), shotsOnTarget: n0(raw, "shotsOnTarget"),
          ...derived(raw), keyPasses: n0(raw, "keyPasses"), tackles: n0(raw, "tackles"), interceptions: n0(raw, "interceptions"),
          fouls: n0(raw, "fouls"), foulsDrawn: n0(raw, "foulsDrawn"), offsides: n0(raw, "offsides"), saves: n0(raw, "saves"),
          yellowCards: n0(raw, "yellowCards"), redCards: n0(raw, "redCards"), ownGoals: n0(raw, "ownGoals"),
        } as Record<string, StatValue>,
      };
    }));
    return [{
      key: "players", title: "Players",
      columns: [col("min", "MIN", "derived"), col("goals", "G"), col("assists", "A"), col("shots", "Sh"), col("shotsOnTarget", "SoT"), col("passes", "Passes", "derived", "text"),
        col("passAccuracy", "Pass %", "derived", "pct"), col("keyPasses", "Key passes"), col("tackles", "Tkl"), col("interceptions", "Int"),
        col("fouls", "Fouls"), col("foulsDrawn", "Fouled"), col("offsides", "Off"), col("saves", "Saves"), col("yellowCards", "YC"), col("redCards", "RC")],
      rows,
    }];
  },

  calculateTeamStatistics(s, ctx) {
    const passTotal = n0(s.team.a, "passes") + n0(s.team.b, "passes");
    const rows: StatRow[] = SIDES.map((side) => {
      const raw = s.team[side];
      return {
        id: side, name: sideName(ctx, side), side,
        values: {
          goals: s.score[side], shots: n0(raw, "shots"), shotsOnTarget: n0(raw, "shotsOnTarget"), ...derived({ ...raw, goals: s.goals.filter((g) => g.side === side && !g.ownGoal).length }),
          // only from passes, and only when passes were recorded
          possession: passTotal ? round(pct(n0(raw, "passes"), passTotal), 1) : null,
          corners: n0(raw, "corners"), fouls: n0(raw, "fouls"), offsides: n0(raw, "offsides"), saves: n0(raw, "saves"),
          tackles: n0(raw, "tackles"), interceptions: n0(raw, "interceptions"), yellowCards: n0(raw, "yellowCards"), redCards: n0(raw, "redCards"),
          woodwork: n0(raw, "woodwork"),
        } as Record<string, StatValue>,
      };
    });
    return [{
      key: "team", title: "Team statistics",
      columns: [col("goals", "Goals"), col("shots", "Shots"), col("shotsOnTarget", "On target"), col("shotAccuracy", "Shot accuracy %", "derived", "pct"),
        col("conversion", "Conversion %", "derived", "pct"), col("possession", "Possession % (share of passes)", "derived", "pct"), col("passes", "Passes", "derived", "text"),
        col("passAccuracy", "Pass accuracy %", "derived", "pct"), col("corners", "Corners"), col("fouls", "Fouls"), col("offsides", "Offsides"), col("saves", "Saves"),
        col("tackles", "Tackles"), col("interceptions", "Interceptions"), col("woodwork", "Woodwork"), col("yellowCards", "Yellow cards"), col("redCards", "Red cards")],
      rows,
    }];
  },

  calculateStatistics(s, ctx, r) {
    const lines: StatLine[] = [];
    if (ctx.sides) {
      const win = s.score.a !== s.score.b ? (s.score.a > s.score.b ? "a" : "b") : s.shootout?.decided ?? null;
      for (const side of SIDES) {
        lines.push({
          subject: "team", subjectKey: ctx.sides[side].teamId, side, teamId: ctx.sides[side].teamId, teamPlayerId: null, userId: null, eventKey: null,
          raw: { ...s.team[side], goals: s.score[side], goalsAgainst: s.score[otherSide(side)], matches: 1, wins: win === side ? 1 : 0, draws: win === null ? 1 : 0, cleanSheets: s.score[otherSide(side)] === 0 ? 1 : 0 },
        });
        for (const pl of ctx.sides[side].players) {
          const raw = s.players[pl.id] ?? {};
          const min = minutesPlayed(s, pl.id, r);
          lines.push({
            subject: "player", subjectKey: pl.id, side, teamId: ctx.sides[side].teamId, teamPlayerId: pl.id, userId: pl.userId ?? null, eventKey: null,
            raw: { ...raw, matches: 1, ...(min !== null ? { minutes: min } : { minutesUnknown: 1 }) },
          });
        }
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, r), teams: this.calculateTeamStatistics(s, ctx, r), lines };
  },

  calculateAdvancedAnalytics(s, ctx, r) {
    const names = { a: sideName(ctx, "a"), b: sideName(ctx, "b") };
    const t = { a: s.team.a, b: s.team.b };
    const cards: AnalyticsCard[] = [
      { label: "Shots on target", value: `${names.a} ${n0(t.a, "shotsOnTarget")}/${n0(t.a, "shots")}, ${names.b} ${n0(t.b, "shotsOnTarget")}/${n0(t.b, "shots")}` },
      { label: "Saves", value: `${names.a} ${n0(t.a, "saves")}, ${names.b} ${n0(t.b, "saves")}` },
    ];
    const passTotal = n0(t.a, "passes") + n0(t.b, "passes");
    if (passTotal) cards.push({ label: "Possession (share of passes)", value: `${names.a} ${round(pct(n0(t.a, "passes"), passTotal), 0)}%, ${names.b} ${round(pct(n0(t.b, "passes"), passTotal), 0)}%`, hint: "Estimated from recorded passes" });

    // biggest deficit each side came back from
    const back: Record<Side, number> = { a: 0, b: 0 };
    let sc = { a: 0, b: 0 };
    const worst: Record<Side, number> = { a: 0, b: 0 };
    for (const g of s.goals) {
      sc = { ...sc, [g.side]: sc[g.side] + 1 };
      for (const side of SIDES) {
        const m = sc[side] - sc[otherSide(side)];
        if (m < 0) worst[side] = Math.max(worst[side], -m);
        else if (m >= 0 && worst[side] > 0) { back[side] = Math.max(back[side], worst[side]); if (m > 0) worst[side] = 0; }
      }
    }

    const insights: string[] = [];
    if (s.period > 0) {
      const lead: Side | null = s.score.a === s.score.b ? null : s.score.a > s.score.b ? "a" : "b";
      insights.push(lead ? `${names[lead]} lead ${s.score[lead]}-${s.score[otherSide(lead)]}.` : `Level at ${s.score.a}-${s.score.b}.`);
      const scorers = new Map<string, number>();
      for (const g of s.goals) if (g.player && !g.ownGoal) scorers.set(g.player, (scorers.get(g.player) ?? 0) + 1);
      for (const [id, n] of scorers) if (n >= 2) insights.push(`${playerName(ctx, id)} has ${n === 2 ? "a brace" : n === 3 ? "a hat-trick" : `${n} goals`}.`);
      for (const side of SIDES) {
        const sh = n0(t[side], "shots"), on = n0(t[side], "shotsOnTarget");
        const goals = s.goals.filter((g) => g.side === side && !g.ownGoal).length;
        if (sh >= 8 && goals <= 1) insights.push(`${names[side]} have had ${sh} shots (${on} on target) but scored ${goals}.`);
        if (back[side] >= 2) insights.push(`${names[side]} came back from ${back[side]} goals down.`);
        if (n0(t[side], "saves") >= 5) insights.push(`${names[otherSide(side)]}'s goalkeeper kept them in it: ${names[side]} made ${n0(t[side], "saves")} saves.`);
      }
      if (passTotal >= 40) {
        const share = round(pct(n0(t.a, "passes"), passTotal), 0)!;
        if (share >= 60 || share <= 40) { const dom: Side = share >= 60 ? "a" : "b"; insights.push(`${names[dom]} have most of the ball: ${dom === "a" ? share : 100 - share}% of the passes.`); }
      }
      for (const id of Object.keys(s.sentOff)) insights.push(`${playerName(ctx, id)} was sent off.`);
      const last = s.goals[s.goals.length - 1];
      const regEnd = minuteAtStart(r.periods + 1, r);
      if (last && last.minute !== null && last.minute >= regEnd - 5 && last.minute <= regEnd + 5 && lead === last.side && Math.abs(s.score.a - s.score.b) === 1) insights.push(`${names[last.side]} scored a late goal (${last.minute}') to lead by one.`);
      for (const side of SIDES) if (regulationDone(s, r) && s.score[otherSide(side)] === 0) insights.push(`${names[side]} kept a clean sheet.`);
      if (s.shootout?.decided) insights.push(`${names[s.shootout.decided]} won the penalty shootout ${s.shootout.score[s.shootout.decided]}-${s.shootout.score[otherSide(s.shootout.decided)]}.`);
    }

    const timeline = s.goals.map((g, i) => ({ label: g.minute !== null ? `${g.minute}'` : `#${i + 1}`, g }));
    const charts: Chart[] = [
      { key: "goals", title: "Goals through the match", type: "line", labels: ["0", ...timeline.map((x) => x.label)], format: "int",
        series: SIDES.map((side) => { let n = 0; return { name: names[side], side, values: [0, ...timeline.map((x) => (n += x.g.side === side ? 1 : 0))] }; }) },
      { key: "comparison", title: "Team comparison", type: "bar", labels: ["Shots", "On target", "Corners", "Fouls", "Saves"], format: "int",
        series: SIDES.map((side) => ({ name: names[side], side, values: [n0(t[side], "shots"), n0(t[side], "shotsOnTarget"), n0(t[side], "corners"), n0(t[side], "fouls"), n0(t[side], "saves")] })) },
    ];
    const tables: StatTable[] = [{
      key: "goals", title: "Goals",
      columns: [col("minute", "Minute", "raw", "text"), col("scorer", "Scorer", "raw", "text"), col("assist", "Assist", "raw", "text"), col("kind", "How", "raw", "text"), col("score", "Score", "raw", "text")],
      rows: (() => { let a = 0, b = 0; return s.goals.map((g, i) => { if (g.side === "a") a += 1; else b += 1; return { id: String(i), name: names[g.side], side: g.side, values: { minute: g.minute !== null ? `${g.minute}'` : null, scorer: g.player ? `${playerName(ctx, g.player)}${g.ownGoal ? " (OG)" : ""}` : null, assist: g.assist ? playerName(ctx, g.assist) : null, kind: g.kind.replace(/_/g, " "), score: `${a}-${b}` } }; }); })(),
    }];
    if (s.shootout?.kicks.length) {
      tables.push({ key: "shootout", title: "Penalty shootout", columns: [col("taker", "Taker", "raw", "text"), col("result", "Result", "raw", "text")],
        rows: s.shootout.kicks.map((k, i) => ({ id: String(i), name: names[k.side], side: k.side, values: { taker: k.player ? playerName(ctx, k.player) : null, result: k.scored ? "Scored" : "Missed" } })) });
    }
    return { cards, charts, tables, insights } satisfies Analytics;
  },

  validateMatchCompletion(s, ctx, r) {
    if (s.periodOpen) return `${periodName(s.period, r)} is still in progress. End it first`;
    if (s.period < r.periods) return `Only ${s.period} of ${r.periods} periods have been played`;
    if (r.knockout && level(s)) {
      if (!s.shootout) return s.period < r.periods + extraPeriods(r) ? "A knockout match cannot end level: play extra time" : "A knockout match cannot end level: take penalties";
      if (!s.shootout.decided) return `The shootout is not decided: ${sideName(ctx, "a")} ${s.shootout.score.a}, ${sideName(ctx, "b")} ${s.shootout.score.b}`;
    }
    return null;
  },

  finalizeMatch(s, _ctx, r): MatchResult {
    const aet = s.period > r.periods ? " a.e.t." : "";
    if (!level(s)) {
      const w: Side = s.score.a > s.score.b ? "a" : "b";
      return { outcome: "win", winner: w, method: "played", margin: `${s.score[w]}-${s.score[otherSide(w)]}${aet}` };
    }
    if (s.shootout?.decided) {
      const w = s.shootout.decided;
      return { outcome: "win", winner: w, method: "played", margin: `${s.score.a}-${s.score.b}${aet}, ${s.shootout.score[w]}-${s.shootout.score[otherSide(w)]} on penalties` };
    }
    return { outcome: "draw", winner: null, method: "played", margin: `${s.score.a}-${s.score.b}` };
  },

  mirrorScore(s, _ctx, r) {
    const reg = (side: Side) => s.goals.filter((g) => g.side === side && g.period <= r.periods).length;
    const et = s.period > r.periods;
    return {
      scoreA: s.score.a, scoreB: s.score.b,
      football: {
        regularA: reg("a"), regularB: reg("b"),
        extraA: et ? s.score.a - reg("a") : null, extraB: et ? s.score.b - reg("b") : null,
        pensA: s.shootout ? s.shootout.score.a : null, pensB: s.shootout ? s.shootout.score.b : null,
      },
    };
  },

  deriveStats(subject, raw) {
    const games = raw.matches ?? 0;
    const per = (k: string) => round(ratio(raw[k] ?? 0, games || null), 2);
    const base = { ...raw, ...derived(raw) };
    if (subject === "player") {
      return {
        columns: [col("matches", "Matches"), col("goals", "Goals"), col("assists", "Assists"), col("goalsPerMatch", "Goals per match", "derived", "dec2"),
          col("shots", "Shots"), col("shotsOnTarget", "On target"), col("conversion", "Conversion %", "derived", "pct"), col("passAccuracy", "Pass accuracy %", "derived", "pct"),
          col("tackles", "Tackles"), col("interceptions", "Interceptions"), col("saves", "Saves"), col("yellowCards", "Yellow cards"), col("redCards", "Red cards"),
          col("minutes", "Minutes")],
        values: { ...base, goalsPerMatch: per("goals"), minutes: (raw.minutesUnknown ?? 0) > 0 ? null : raw.minutes ?? 0 },
      };
    }
    return {
      columns: [col("matches", "Matches"), col("wins", "Wins"), col("draws", "Draws"), col("goals", "Goals"), col("goalsAgainst", "Goals against"),
        col("goalsPerMatch", "Goals per match", "derived", "dec2"), col("cleanSheets", "Clean sheets"), col("shots", "Shots"), col("conversion", "Conversion %", "derived", "pct"),
        col("corners", "Corners"), col("fouls", "Fouls"), col("yellowCards", "Yellow cards"), col("redCards", "Red cards")],
      values: { ...base, goalsPerMatch: per("goals") },
    };
  },

  derivedLog: (s) => [
    ...s.log,
    ...s.goals.map((g) => {
      const upTo = s.goals.filter((x) => x.seq <= g.seq);
      return { seq: g.seq, text: `Score ${upTo.filter((x) => x.side === "a").length}-${upTo.filter((x) => x.side === "b").length}` };
    }),
  ],

  eventLabel(s, ev, r) {
    if (ev.type === "PERIOD_START" || !s.periodOpen) return s.shootout ? "Shootout" : null;
    const m = isNonNegInt(ev.payload.minute) ? `${ev.payload.minute}'` : "";
    return `${periodName(s.period, r)}${m ? ` ${m}` : ""}`;
  },

  describeEvent(ev: EngineEvent, ctx: MatchContext) {
    const p = ev.payload;
    const side = isSide(p.side) ? sideName(ctx, p.side) : "";
    const who = str(p.player) ? playerName(ctx, str(p.player)) : side;
    const kind = typeof p.kind === "string" && p.kind !== "open_play" ? ` (${p.kind.replace(/_/g, " ")})` : "";
    switch (ev.type) {
      case "PERIOD_START": return "Period started";
      case "PERIOD_END": return "Period ended";
      case "LINEUP": return `${side} lineup set`;
      case "SUBSTITUTION": return `${side}: ${playerName(ctx, str(p.in))} on for ${playerName(ctx, str(p.out))}`;
      case "GOAL": return p.ownGoal === true || p.kind === "own_goal" ? `Own goal by ${who || "a defender"}, goal to ${side}` : `Goal ${side}: ${who}${kind}${str(p.assist) ? `, assist ${playerName(ctx, str(p.assist))}` : ""}`;
      case "SHOT": return `${who} ${p.penalty ? "penalty" : "shot"} ${String(p.outcome ?? "").replace(/_/g, " ")}`;
      case "PASS": return `${who} pass${p.completed ? `${str(p.to) ? ` to ${playerName(ctx, str(p.to))}` : ""}` : " (not completed)"}`;
      case "FOUL": return `Foul by ${who}${str(p.on) ? ` on ${playerName(ctx, str(p.on))}` : ""}${p.penalty ? ": penalty" : ""}`;
      case "CARD": return `${p.color === "red" ? "Red" : "Yellow"} card: ${who}`;
      case "CORNER": return `Corner ${side}`;
      case "OFFSIDE": return `Offside: ${who}`;
      case "TACKLE": return `Tackle: ${who}`;
      case "INTERCEPTION": return `Interception: ${who}`;
      case "TIMEOUT": return `Timeout ${side}`;
      case "SHOOTOUT_START": return `Penalty shootout: ${isSide(p.first) ? sideName(ctx, p.first) : ""} first`;
      case "SHOOTOUT_KICK": return `Shootout kick ${who}: ${p.scored ? "scored" : "missed"}`;
      default: return ev.type;
    }
  },
};

const ordinal = (n: number) => (n === 2 ? "second" : n === 3 ? "third" : `${n}th`);
