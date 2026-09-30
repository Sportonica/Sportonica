// Swimming: an event and performance system, not a match.
// Rules: docs/sports-intelligence/02-sport-rules.md.
//
// A contest is one race (one event, one round, one heat). There are no
// sides and no score. Every time is an integer number of milliseconds:
// "01:02.45" is 62 450 ms, never the decimal 1.0245.

import {
  RulesError,
  type Analytics, type Issue, type MatchResult, type ScoreView,
  type SportIntelligenceEngine, type StatColumn, type StatLine, type StatTable, type StatValue,
} from "../core/types";
import { formatDuration, isInt, isPosInt, mergeRules, pct, ratio, round, str } from "../core/util";

export const STROKES = ["freestyle", "backstroke", "breaststroke", "butterfly", "medley"] as const;
export const ROUNDS = ["heat", "semi", "final", "timed_final"] as const;
const ROUND_LABEL: Record<string, string> = { heat: "Heat", semi: "Semi-final", final: "Final", timed_final: "Timed final" };

export interface SwimEntry {
  lane: number;
  /** what identifies the entry across races: a tournament team (an athlete or a relay team) */
  entryId: string;
  name: string;
  teamId?: string | null;
  teamPlayerId?: string | null;
  userId?: string | null;
  /** relay only, in swimming order */
  swimmers?: { name: string; teamPlayerId?: string | null; userId?: string | null }[];
}

export interface SwimmingRules {
  distance: number;
  stroke: (typeof STROKES)[number];
  course: number;
  relay: boolean;
  relayLegs: number;
  round: (typeof ROUNDS)[number];
  heat: number;
  lanes: number;
  entries: SwimEntry[];
  falseStartRule: "one_start" | "two_start";
  rankPrecisionMs: number;
  minMsPer50: number;
}

const DEFAULTS: SwimmingRules = {
  distance: 0, stroke: "freestyle", course: 50, relay: false, relayLegs: 4, round: "heat", heat: 1, lanes: 8,
  entries: [], falseStartRule: "one_start", rankPrecisionMs: 10, minMsPer50: 15000,
};

type LaneStatus = "entered" | "swimming" | "finished" | "dq" | "dns" | "dnf";
interface Split { distance: number; timeMs: number; strokeRate?: number }
interface Lane { status: LaneStatus; reactionMs: number | null; splits: Split[]; finalMs: number | null; dqReason: string | null }

export interface SwimmingState {
  started: boolean;
  startAt: string | null;
  falseStarts: number;
  lanes: Record<string, Lane>;
  log: { seq: number; text: string }[];
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function swimEventName(rules: Pick<SwimmingRules, "distance" | "stroke" | "relay" | "relayLegs">): string {
  const stroke = rules.stroke === "medley" ? (rules.relay ? "Medley" : "Individual Medley") : titleCase(rules.stroke);
  return rules.relay ? `${rules.relayLegs}x${rules.distance / rules.relayLegs}m ${stroke} Relay` : `${rules.distance}m ${stroke}`;
}

/** Same distance, stroke and course: times are only comparable within one of these. */
export function swimEventKey(rules: Pick<SwimmingRules, "distance" | "stroke" | "course" | "relay">): string {
  return `${rules.distance}-${rules.stroke}-${rules.course}${rules.relay ? "-relay" : ""}`;
}

const entryOf = (rules: SwimmingRules, lane: unknown): SwimEntry | null =>
  (isInt(lane) ? rules.entries.find((e) => e.lane === lane) : null) ?? null;

const lastSplit = (l: Lane): Split | null => l.splits[l.splits.length - 1] ?? null;

/** A time at the precision results are ranked at (hundredths by default), in ms. */
const official = (ms: number, rules: SwimmingRules): number => Math.floor(ms / rules.rankPrecisionMs) * rules.rankPrecisionMs;

/** The winning time at ranking precision, or null when nobody has finished. */
function winningTime(s: SwimmingState, rules: SwimmingRules): number | null {
  const times = rules.entries.filter((e) => s.lanes[e.lane].status === "finished" && s.lanes[e.lane].finalMs !== null).map((e) => official(s.lanes[e.lane].finalMs!, rules));
  return times.length ? Math.min(...times) : null;
}

/** Competition ranking: equal times (at the ranking precision) share a place, the next place is skipped. */
export function rankTimes<T extends { timeMs: number }>(results: T[], precisionMs: number): (T & { rank: number })[] {
  const q = (ms: number) => Math.floor(ms / precisionMs);
  const sorted = [...results].sort((x, y) => q(x.timeMs) - q(y.timeMs));
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || q(r.timeMs) !== q(sorted[i - 1].timeMs)) rank = i + 1;
    return { ...r, rank };
  });
}

function ranking(s: SwimmingState, rules: SwimmingRules): Map<number, number> {
  const finished = rules.entries
    .map((e) => ({ lane: e.lane, timeMs: s.lanes[e.lane]?.status === "finished" ? s.lanes[e.lane].finalMs : null }))
    .filter((x): x is { lane: number; timeMs: number } => x.timeMs !== null);
  return new Map(rankTimes(finished, rules.rankPrecisionMs).map((r) => [r.lane, r.rank]));
}

/** Lap times: the difference between consecutive cumulative splits, the finish included. */
function laps(l: Lane, rules: SwimmingRules): { distance: number; ms: number }[] {
  const points = [...l.splits.map((x) => ({ distance: x.distance, timeMs: x.timeMs }))];
  if (l.finalMs !== null) points.push({ distance: rules.distance, timeMs: l.finalMs });
  return points.map((pt, i) => ({ distance: pt.distance, ms: pt.timeMs - (i ? points[i - 1].timeMs : 0) }));
}

/** Cumulative time at a distance, from a split or the finish. */
function timeAt(l: Lane, rules: SwimmingRules, distance: number): number | null {
  if (distance === rules.distance) return l.finalMs;
  return l.splits.find((x) => x.distance === distance)?.timeMs ?? null;
}

// ── performance against history ─────────────────────────────────────

export interface SwimHistoryEntry { timeMs: number; date: string }

export interface SwimPerformance {
  personalBestMs: number | null;
  seasonBestMs: number | null;
  isPersonalBest: boolean;
  isSeasonBest: boolean;
  diffFromPersonalBestMs: number | null;
  improvementMs: number | null;
  improvementPct: number | null;
}

/**
 * Compare one swim with the athlete's earlier swims of the same event
 * (same distance, stroke and course). "Best" values are the bests
 * BEFORE this swim; a season is the calendar year.
 */
export function swimPerformance(current: SwimHistoryEntry, history: SwimHistoryEntry[]): SwimPerformance {
  const earlier = history.filter((h) => h.date < current.date).sort((x, y) => (x.date < y.date ? -1 : 1));
  const season = current.date.slice(0, 4);
  const min = (list: SwimHistoryEntry[]) => (list.length ? Math.min(...list.map((h) => h.timeMs)) : null);
  const pb = min(earlier);
  const sb = min(earlier.filter((h) => h.date.slice(0, 4) === season));
  const previous = earlier.length ? earlier[earlier.length - 1].timeMs : null;
  const improvement = previous === null ? null : previous - current.timeMs;
  return {
    personalBestMs: pb, seasonBestMs: sb,
    // a first recorded swim is by definition the best so far
    isPersonalBest: pb === null || current.timeMs < pb,
    isSeasonBest: sb === null || current.timeMs < sb,
    diffFromPersonalBestMs: pb === null ? null : current.timeMs - pb,
    improvementMs: improvement,
    improvementPct: improvement === null || previous === null ? null : round(pct(improvement, previous), 2),
  };
}

export const swimmingEngine: SportIntelligenceEngine<SwimmingRules, SwimmingState> = {
  sport: "swimming",
  label: "Swimming",
  eventTypes: ["RACE_START", "FALSE_START", "REACTION", "SPLIT", "RACE_FINISH", "DISQUALIFICATION", "DNS", "DNF"],

  resolveRules(input) {
    const r = mergeRules(DEFAULTS, input);
    if (!isPosInt(r.distance)) throw new RulesError("distance is required, in metres");
    if (!(STROKES as readonly unknown[]).includes(r.stroke)) throw new RulesError("unknown stroke");
    if (!isPosInt(r.course)) throw new RulesError("course must be the pool length in metres");
    if (r.distance % r.course !== 0) throw new RulesError("the distance must be a whole number of pool lengths");
    if (!(ROUNDS as readonly unknown[]).includes(r.round)) throw new RulesError("unknown round");
    if (!isPosInt(r.heat) || !isPosInt(r.lanes)) throw new RulesError("heat and lanes must be positive whole numbers");
    if (r.relay) {
      if (!isPosInt(r.relayLegs) || r.distance % r.relayLegs !== 0 || (r.distance / r.relayLegs) % r.course !== 0) throw new RulesError("each relay leg must be a whole number of pool lengths");
    }
    if (r.falseStartRule !== "one_start" && r.falseStartRule !== "two_start") throw new RulesError("falseStartRule must be one_start or two_start");
    if (!isPosInt(r.rankPrecisionMs) || !isPosInt(r.minMsPer50)) throw new RulesError("rankPrecisionMs and minMsPer50 must be positive");
    if (!Array.isArray(r.entries) || r.entries.length === 0) throw new RulesError("a race needs at least one entry");
    const lanes = new Set<number>();
    for (const e of r.entries) {
      if (!e || !isPosInt(e.lane) || e.lane > r.lanes) throw new RulesError(`every entry needs a lane from 1 to ${r.lanes}`);
      if (lanes.has(e.lane)) throw new RulesError(`lane ${e.lane} is assigned twice`);
      lanes.add(e.lane);
      if (!str(e.entryId) || !str(e.name)) throw new RulesError("every entry needs an id and a name");
      if (r.relay && e.swimmers && e.swimmers.length !== r.relayLegs) throw new RulesError(`a relay team needs ${r.relayLegs} swimmers in order`);
    }
    return r;
  },

  initializeMatch(_ctx, rules) {
    const lanes: Record<string, Lane> = {};
    for (const e of rules.entries) lanes[e.lane] = { status: "entered", reactionMs: null, splits: [], finalMs: null, dqReason: null };
    return { started: false, startAt: null, falseStarts: 0, lanes, log: [] };
  },

  validateEvent(s, ev, _ctx, rules) {
    const p = ev.payload;
    if (ev.type === "RACE_START") return s.started ? "The race has already started" : null;

    const entry = entryOf(rules, p.lane);
    if (!entry) return "There is no entry in that lane";
    const lane = s.lanes[entry.lane];
    const floor = (distance: number) => Math.ceil((distance / 50) * rules.minMsPer50);

    switch (ev.type) {
      case "FALSE_START":
        if (lane.status !== "entered" && lane.status !== "swimming") return "That lane is no longer in the race";
        return null;
      case "DNS":
        if (lane.status !== "entered" && !(lane.status === "swimming" && !lane.splits.length)) return "Only a swimmer who has not swum can be marked as did not start";
        return null;
      case "DISQUALIFICATION":
        if (lane.status === "dq") return "That lane is already disqualified";
        if (lane.status === "dns") return "A swimmer who did not start cannot be disqualified";
        return str(p.reason) ? null : "Give the reason for the disqualification";
    }

    if (!s.started) return "Start the race before recording times";
    if (lane.status !== "swimming") {
      return lane.status === "finished" ? "That lane has already finished" : lane.status === "dq" ? "That lane is disqualified" : "That lane is not in the race";
    }
    if (ev.type === "DNF") return null;

    if (!isInt(p.timeMs)) return "A time must be a whole number of milliseconds";
    const time = p.timeMs;
    if (ev.type === "REACTION") return time < 0 || time > 5000 ? "That is not a plausible reaction time" : null;
    if (time <= 0) return "A time must be greater than zero";

    const prev = lastSplit(lane);
    if (ev.type === "SPLIT") {
      if (!isPosInt(p.distance)) return "A split needs its distance";
      if (p.distance % rules.course !== 0) return `Splits are taken every ${rules.course} m`;
      if (p.distance >= rules.distance) return "The last length is the finish, not a split";
      if (prev && p.distance <= prev.distance) return "That split distance has already been recorded";
      if (prev && time <= prev.timeMs) return "A split cannot be earlier than the one before it";
      if (time < floor(p.distance)) return `${formatDuration(time)} is too fast for ${p.distance} m. Check the time`;
      if (p.strokeRate != null && (typeof p.strokeRate !== "number" || p.strokeRate <= 0)) return "Stroke rate must be a positive number";
      return null;
    }
    // RACE_FINISH
    if (prev && time <= prev.timeMs) return "The finish cannot be earlier than the last split";
    if (time < floor(rules.distance)) return `${formatDuration(time)} is too fast for ${rules.distance} m. Check the time`;
    return null;
  },

  updateScore(s, ev, _ctx, rules) {
    const p = ev.payload;
    if (ev.type === "RACE_START") {
      s.started = true; s.startAt = ev.occurredAt;
      for (const l of Object.values(s.lanes)) if (l.status === "entered") l.status = "swimming";
      return s;
    }
    const entry = entryOf(rules, p.lane)!;
    const lane = s.lanes[entry.lane];
    switch (ev.type) {
      case "FALSE_START": {
        s.falseStarts += 1;
        const disqualify = rules.falseStartRule === "one_start" || s.falseStarts > 1;
        if (disqualify) { lane.status = "dq"; lane.dqReason = "False start"; }
        s.log.push({ seq: ev.seq, text: `False start, lane ${entry.lane}${disqualify ? ": disqualified" : ": warning"}` });
        if (p.recall === true) {
          // the start is recalled: nothing swum so far counts
          s.started = false; s.startAt = null;
          for (const l of Object.values(s.lanes)) if (l.status === "swimming") { l.status = "entered"; l.splits = []; l.reactionMs = null; }
        }
        break;
      }
      case "REACTION": lane.reactionMs = p.timeMs as number; break;
      case "SPLIT":
        lane.splits.push({ distance: p.distance as number, timeMs: p.timeMs as number, ...(typeof p.strokeRate === "number" ? { strokeRate: p.strokeRate } : {}) });
        break;
      case "RACE_FINISH": lane.status = "finished"; lane.finalMs = p.timeMs as number; break;
      case "DISQUALIFICATION": lane.status = "dq"; lane.dqReason = str(p.reason); break;
      case "DNS": lane.status = "dns"; break;
      case "DNF": lane.status = "dnf"; break;
    }
    return s;
  },

  validateScore(s, _ctx, rules) {
    const issues: Issue[] = [];
    for (const e of rules.entries) {
      const l = s.lanes[e.lane];
      let prev = 0;
      for (const sp of l.splits) {
        if (sp.timeMs <= prev) issues.push({ severity: "error", code: "INVALID_TIME", message: `Lane ${e.lane}: splits are not in increasing order` });
        prev = sp.timeMs;
      }
      if (l.finalMs !== null && (!Number.isInteger(l.finalMs) || l.finalMs <= prev)) issues.push({ severity: "error", code: "INVALID_TIME", message: `Lane ${e.lane}: the final time is not later than the last split` });
      if (l.status === "finished" && l.finalMs === null) issues.push({ severity: "error", code: "INVALID_TIME", message: `Lane ${e.lane}: finished without a time` });
    }
    return issues;
  },

  getCurrentState(s, _ctx, rules) {
    const ranks = ranking(s, rules);
    const winner = winningTime(s, rules);
    const rows = rules.entries.map((e) => {
      const l = s.lanes[e.lane];
      const last = lastSplit(l);
      return {
        lane: e.lane, name: e.name,
        status: l.status === "dq" ? "DSQ" : l.status === "dns" ? "DNS" : l.status === "dnf" ? "DNF" : l.status === "finished" ? "Finished" : l.status === "swimming" ? "Swimming" : "Entered",
        time: l.finalMs !== null ? formatDuration(l.finalMs) : null,
        rank: ranks.get(e.lane) ?? null,
        detail: l.status === "dq" ? l.dqReason
          : l.status === "finished" && winner !== null ? (official(l.finalMs!, rules) > winner ? `+${formatDuration(official(l.finalMs!, rules) - winner)}` : null)
          : last ? `${last.distance} m in ${formatDuration(last.timeMs)}` : null,
      };
    });
    // ranked finishers first, then by lane
    rows.sort((x, y) => (x.rank ?? 999) - (y.rank ?? 999) || x.lane - y.lane);
    const view: ScoreView = {
      kind: "race",
      periodLabel: `${swimEventName(rules)}, ${ROUND_LABEL[rules.round]}${rules.round === "heat" || rules.round === "semi" ? ` ${rules.heat}` : ""}`,
      lanes: rows,
      notes: [`${rules.course} m pool`],
    };
    return view;
  },

  getMatchSummary(s, _ctx, rules) {
    const ranks = ranking(s, rules);
    const lines = [swimEventName(rules), `${ROUND_LABEL[rules.round]} ${rules.heat}`];
    const ordered = [...rules.entries].sort((x, y) => (ranks.get(x.lane) ?? 999) - (ranks.get(y.lane) ?? 999) || x.lane - y.lane);
    for (const e of ordered) {
      const l = s.lanes[e.lane];
      const what = l.finalMs !== null && l.status === "finished" ? formatDuration(l.finalMs) : l.status === "dq" ? "DSQ" : l.status === "dns" ? "DNS" : l.status === "dnf" ? "DNF" : l.status;
      lines.push(`Lane ${e.lane}: ${e.name}, ${what}`);
    }
    return lines;
  },

  calculatePlayerStatistics(s, _ctx, rules) {
    const ranks = ranking(s, rules);
    const winner = winningTime(s, rules);
    const columns: StatColumn[] = [
      { key: "lane", label: "Lane", kind: "raw" },
      { key: "place", label: "Place", kind: "derived" },
      { key: "final", label: "Final time", kind: "raw", format: "time" },
      { key: "reaction", label: "Reaction", kind: "raw", format: "time" },
      { key: "gap", label: "Behind winner", kind: "derived", format: "time" },
      { key: "pace", label: "Pace per 100 m", kind: "derived", format: "time" },
      { key: "avgSplit", label: `Average ${rules.course} m`, kind: "derived", format: "time" },
      { key: "strokeRate", label: "Stroke rate", kind: "derived", format: "dec1" },
      { key: "status", label: "Status", kind: "raw", format: "text" },
    ];
    const lengths = rules.distance / rules.course;
    const results: StatTable = {
      key: "results", title: "Results", columns,
      rows: rules.entries.map((e) => {
        const l = s.lanes[e.lane];
        const done = l.status === "finished" && l.finalMs !== null;
        const rates = l.splits.map((x) => x.strokeRate).filter((x): x is number => x !== undefined);
        return {
          id: String(e.lane), name: e.name, side: null,
          values: {
            lane: e.lane, place: ranks.get(e.lane) ?? null,
            final: l.finalMs, reaction: l.reactionMs,
            gap: done && winner !== null ? official(l.finalMs!, rules) - winner : null,
            pace: done ? Math.round(l.finalMs! / (rules.distance / 100)) : null,
            avgSplit: done ? Math.round(l.finalMs! / lengths) : null,
            strokeRate: round(ratio(rates.reduce((t, x) => t + x, 0), rates.length), 1),
            status: l.status === "dq" ? `DSQ: ${l.dqReason ?? ""}` : l.status.toUpperCase(),
          } as Record<string, StatValue>,
        };
      }).sort((x, y) => ((x.values.place as number | null) ?? 999) - ((y.values.place as number | null) ?? 999) || (x.values.lane as number) - (y.values.lane as number)),
    };

    const distances = [...new Set(rules.entries.flatMap((e) => laps(s.lanes[e.lane], rules).map((x) => x.distance)))].sort((x, y) => x - y);
    const splits: StatTable = {
      key: "splits", title: "Split times (each length)",
      columns: distances.map((d) => ({ key: `d${d}`, label: `${d} m`, kind: "derived" as const, format: "time" as const })),
      rows: rules.entries.map((e) => {
        const byDist = new Map(laps(s.lanes[e.lane], rules).map((x) => [x.distance, x.ms]));
        return { id: String(e.lane), name: e.name, side: null, values: Object.fromEntries(distances.map((d) => [`d${d}`, byDist.get(d) ?? null])) };
      }),
    };

    const tables = [results, splits];
    if (rules.relay) {
      const leg = rules.distance / rules.relayLegs;
      tables.push({
        key: "relay", title: "Relay legs",
        columns: Array.from({ length: rules.relayLegs }, (_, i) => ({ key: `leg${i + 1}`, label: `Leg ${i + 1}`, kind: "derived" as const, format: "text" as const })),
        rows: rules.entries.map((e) => {
          const l = s.lanes[e.lane];
          return {
            id: String(e.lane), name: e.name, side: null,
            values: Object.fromEntries(Array.from({ length: rules.relayLegs }, (_, i) => {
              const end = timeAt(l, rules, leg * (i + 1)), start = i === 0 ? 0 : timeAt(l, rules, leg * i);
              const swimmer = e.swimmers?.[i]?.name;
              const time = end !== null && start !== null ? formatDuration(end - start) : null;
              return [`leg${i + 1}`, time ? `${swimmer ? `${swimmer} ` : ""}${time}` : swimmer ?? null];
            })),
          };
        }),
      });
    }
    return tables;
  },

  // swimming has no sides; team results are the relay rows above
  calculateTeamStatistics() {
    return [];
  },

  calculateStatistics(s, ctx, rules) {
    const ranks = ranking(s, rules);
    const key = swimEventKey(rules);
    const lines: StatLine[] = [];
    for (const e of rules.entries) {
      const l = s.lanes[e.lane];
      const done = l.status === "finished" && l.finalMs !== null;
      const raw: Record<string, number> = { swims: 1, lane: e.lane, distance: rules.distance };
      if (done) { raw.finishes = 1; raw.totalMs = l.finalMs!; raw.fastestMs = l.finalMs!; raw.place = ranks.get(e.lane) ?? 0; }
      if (l.reactionMs !== null) raw.reactionMs = l.reactionMs;
      if (l.status === "dq") raw.disqualified = 1;
      if (l.status === "dns") raw.didNotStart = 1;
      if (l.status === "dnf") raw.didNotFinish = 1;
      lines.push({
        subject: rules.relay ? "team" : "player", subjectKey: e.teamPlayerId ?? e.entryId, side: null,
        teamId: e.teamId ?? null, teamPlayerId: e.teamPlayerId ?? null, userId: e.userId ?? null, eventKey: key, raw,
      });
      if (rules.relay && e.swimmers) {
        const leg = rules.distance / rules.relayLegs;
        e.swimmers.forEach((sw, i) => {
          const end = timeAt(l, rules, leg * (i + 1)), start = i === 0 ? 0 : timeAt(l, rules, leg * i);
          if (end === null || start === null || l.status === "dq" || !sw.teamPlayerId) return;
          const ms = end - start;
          lines.push({
            subject: "player", subjectKey: sw.teamPlayerId, side: null, teamId: e.teamId ?? null, teamPlayerId: sw.teamPlayerId, userId: sw.userId ?? null,
            // a relay leg is its own event: a flying start is not comparable with a flat start
            eventKey: `${leg}-${rules.stroke}-${rules.course}-relayleg`, raw: { swims: 1, finishes: 1, totalMs: ms, fastestMs: ms, distance: leg },
          });
        });
      }
    }
    return { players: this.calculatePlayerStatistics(s, ctx, rules), teams: [], lines };
  },

  calculateAdvancedAnalytics(s, _ctx, rules) {
    const finished = rules.entries.filter((e) => s.lanes[e.lane].status === "finished" && s.lanes[e.lane].finalMs !== null);
    const ranked = rankTimes(finished.map((e) => ({ e, timeMs: s.lanes[e.lane].finalMs! })), rules.rankPrecisionMs);
    const reactions = rules.entries.map((e) => ({ e, ms: s.lanes[e.lane].reactionMs })).filter((x): x is { e: SwimEntry; ms: number } => x.ms !== null).sort((x, y) => x.ms - y.ms);
    const cards: Analytics["cards"] = [];
    if (ranked[0]) cards.push({ label: "Winning time", value: formatDuration(ranked[0].timeMs), hint: ranked[0].e.name });
    if (ranked[1]) cards.push({ label: "Winning margin", value: formatDuration(official(ranked[1].timeMs, rules) - official(ranked[0].timeMs, rules)) });
    if (reactions[0]) cards.push({ label: "Fastest reaction", value: formatDuration(reactions[0].ms), hint: reactions[0].e.name });
    cards.push({ label: "Finishers", value: `${finished.length} of ${rules.entries.length}` });

    const distances = [...new Set(rules.entries.flatMap((e) => laps(s.lanes[e.lane], rules).map((x) => x.distance)))].sort((x, y) => x - y);
    const charts: Analytics["charts"] = [];
    if (distances.length > 1) {
      charts.push({
        key: "splits", title: `Split comparison (time for each ${rules.course} m)`, type: "line", labels: distances.map((d) => `${d} m`),
        series: rules.entries.map((e) => { const by = new Map(laps(s.lanes[e.lane], rules).map((x) => [x.distance, x.ms])); return { name: e.name, side: null, values: distances.map((d) => by.get(d) ?? null) }; }),
        format: "time",
      });
    }
    if (ranked.length) {
      charts.push({ key: "finals", title: "Final times", type: "bar", labels: ranked.map((r) => r.e.name), series: [{ name: "Final time", side: null, values: ranked.map((r) => r.timeMs) }], format: "time" });
    }
    return { cards, charts, tables: [] };
  },

  validateMatchCompletion(s, _ctx, rules) {
    const waiting = rules.entries.filter((e) => ["entered", "swimming"].includes(s.lanes[e.lane].status));
    return waiting.length ? `Lane${waiting.length === 1 ? "" : "s"} ${waiting.map((e) => e.lane).join(", ")} still ${waiting.length === 1 ? "has" : "have"} no result` : null;
  },

  finalizeMatch(s, _ctx, rules): MatchResult {
    const ranks = ranking(s, rules);
    const first = rules.entries.filter((e) => ranks.get(e.lane) === 1);
    const margin = first.length ? `${first.map((e) => e.name).join(" and ")} won in ${formatDuration(s.lanes[first[0].lane].finalMs)}` : "No finishers";
    return { outcome: "ranked", winner: null, method: "played", margin };
  },

  mirrorScore: () => null,

  deriveStats(_subject, raw) {
    return {
      columns: [
        { key: "swims", label: "Swims", kind: "raw" }, { key: "finishes", label: "Finishes", kind: "raw" },
        { key: "fastestMs", label: "Best time", kind: "raw", format: "time" },
        { key: "averageMs", label: "Average time", kind: "derived", format: "time" },
        { key: "disqualified", label: "Disqualified", kind: "raw" },
      ],
      values: {
        swims: raw.swims ?? 0, finishes: raw.finishes ?? 0, fastestMs: raw.fastestMs ?? null, disqualified: raw.disqualified ?? 0,
        averageMs: raw.finishes ? Math.round((raw.totalMs ?? 0) / raw.finishes) : null,
      },
    };
  },

  derivedLog: (s) => s.log,

  describeEvent(ev, _ctx, rules) {
    const p = ev.payload;
    const e = entryOf(rules, p.lane);
    const who = e ? `Lane ${e.lane}, ${e.name}` : "";
    const t = typeof p.timeMs === "number" ? formatDuration(p.timeMs) : "";
    switch (ev.type) {
      case "RACE_START": return "Race started";
      case "FALSE_START": return `${who}: false start${p.recall === true ? " (start recalled)" : ""}`;
      case "REACTION": return `${who}: reaction ${t}`;
      case "SPLIT": return `${who}: ${String(p.distance)} m in ${t}`;
      case "RACE_FINISH": return `${who}: finished in ${t}`;
      case "DISQUALIFICATION": return `${who}: disqualified (${str(p.reason) ?? ""})`;
      case "DNS": return `${who}: did not start`;
      case "DNF": return `${who}: did not finish`;
      default: return ev.type;
    }
  },
};
