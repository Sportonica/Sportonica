"use server";

// ================================================================
// Sports Intelligence API. Server actions, like the rest of the app
// (see docs/sports-intelligence/01-architecture.md for how these map
// to the endpoints in the brief).
//
// A scoring event goes:
//   validate (engine) -> score -> statistics -> one RPC that stores the
//   event and the resulting snapshot -> Realtime pushes the row to viewers.
// A normal event never replays history; only corrections and
// recalculateContest() do.
// ================================================================

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { actionError, isActionError, safeActionError, type ActionError } from "@/lib/actionError";
import { friendlyTournamentError, type TournamentMatch } from "@/lib/tournaments/types";
import {
  EngineError, applyCorrection, describe, effectiveEvents, newEnvelope, reconstruct, recordEvent, summarize,
  type MatchEnvelope,
} from "./core/engine";
import {
  CORRECTION_VOID, RulesError,
  type EngineEvent, type MatchAnswer, type MatchContext, type MirrorScore, type Side, type SideContext, type SportIntelligenceEngine, type SportKey, type StatLine, type StoredEvent,
} from "./core/types";
import { getEngine, isSportKey, listIntelligenceSportsSync, sportKeyFor } from "./registry";
import { aggregate } from "./aggregate";
import { toView, type ContestRow } from "./view";
import { swimEventKey, swimEventName, swimPerformance, type SwimEntry, type SwimmingRules } from "./sports/swimming";
import {
  friendlyIntelligenceError,
  type ContestIntelligence, type ContestView, type HistoryReport, type HistoryRow, type LeaderRow,
  type HistoryFilter, type RecalculationReport, type RecordEventInput, type RecordEventResult,
  type SwimEventPerformance, type TimelineEntry, type TournamentLeaders,
} from "./types";

type Sb = Awaited<ReturnType<typeof createClient>>;

interface EventRow {
  id: string;
  contest_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  // when the server stored it (occurred_at is when the scorer tapped)
  recorded_at?: string;
  recorded_by: string | null;
  client_id: string;
  voids_event_id: string | null;
  replaces_event_id: string | null;
  reason: string | null;
}

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

const fail = (message: string): ActionError => actionError(friendlyIntelligenceError(friendlyTournamentError(message)));

// One spelling for an instant. Postgres returns "+00:00" where the
// scorer's device sent "Z"; the engines copy the event time into the
// state (start and finish times), so without this a replay differs from
// the live state by text alone and recalculation reports false drift.
const iso = (t: string): string => new Date(t).toISOString();

const toStored = (r: EventRow): StoredEvent => ({
  id: r.id, seq: r.seq, type: r.type, payload: r.payload ?? {}, occurredAt: iso(r.occurred_at), recordedBy: r.recorded_by,
  clientId: r.client_id, voidsEventId: r.voids_event_id, replacesEventId: r.replaces_event_id, reason: r.reason,
});

// Everything the snapshot RPCs store alongside the state.
function snapshot(engine: SportIntelligenceEngine, env: MatchEnvelope, ctx: MatchContext, rules: unknown) {
  const summary = summarize(engine, env, ctx, rules);
  const mirror: MirrorScore | null = engine.mirrorScore(env.sport, ctx, rules);
  // raw counters are kept for finished contests only
  const lines: StatLine[] | null = env.status === "completed" ? engine.calculateStatistics(env.sport, ctx, rules).lines : null;
  return { summary, mirror, lines };
}

async function loadContest(sb: Sb, contestId: string): Promise<ContestRow | ActionError> {
  const { data, error } = await sb.from("si_contests").select("*").eq("id", contestId).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return fail("CONTEST_NOT_FOUND");
  if (!isSportKey(data.sport)) return actionError("This match uses a sport that has no scoring engine.");
  return data as ContestRow;
}

async function loadEvents(sb: Sb, contestId: string): Promise<EventRow[] | ActionError> {
  const all: EventRow[] = [];
  // PostgREST caps a response at 1000 rows; a long match has more events than that
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("si_events").select("*").eq("contest_id", contestId).order("seq", { ascending: true }).range(from, from + 999);
    if (error) return fail(error.message);
    all.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

// ── GET /sports ─────────────────────────────────────────────────

export async function listIntelligenceSports() {
  return listIntelligenceSportsSync();
}

// ── reading a contest ───────────────────────────────────────────

/** The score before and after a correction, as stored with it. */
function auditOf(payload: Record<string, unknown> | null | undefined): { scoreBefore?: string; scoreAfter?: string } {
  const a = payload?.audit as { scoreBefore?: unknown; scoreAfter?: unknown } | undefined;
  return {
    ...(typeof a?.scoreBefore === "string" ? { scoreBefore: a.scoreBefore } : {}),
    ...(typeof a?.scoreAfter === "string" ? { scoreAfter: a.scoreAfter } : {}),
  };
}

/** GET /matches/:id, /live, /score. Public: RLS decides what is visible. */
export async function getContest(contestId: string): Promise<ContestView | ActionError> {
  const sb = await createClient();
  const row = await loadContest(sb, contestId);
  return isActionError(row) ? row : toView(row);
}

export async function getContestForMatch(matchId: string): Promise<ContestView | null | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("si_contests").select("*").eq("match_id", matchId).maybeSingle();
  if (error) return fail(error.message);
  return data ? toView(data as ContestRow) : null;
}

/** Every contest of a tournament, newest activity first (score cards, scorer hub). */
export async function listTournamentContests(tournamentId: string): Promise<ContestView[] | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("si_contests").select("*").eq("tournament_id", tournamentId).order("created_at", { ascending: true });
  if (error) return fail(error.message);
  return ((data ?? []) as ContestRow[]).filter((r) => isSportKey(r.sport)).map(toView);
}

export async function canScoreTournament(tournamentId: string): Promise<boolean> {
  const { sb, user } = await requireUser();
  if (!user) return false;
  const { data, error } = await sb.rpc("si_can_score", { p_tournament_id: tournamentId });
  return !error && data === true;
}

/** GET /matches/:id/statistics and /analytics, computed from the cached state. */
export async function getContestIntelligence(contestId: string): Promise<ContestIntelligence | ActionError> {
  const sb = await createClient();
  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  const engine = getEngine(row.sport as SportKey);
  try {
    const rules = engine.resolveRules(row.rules);
    const stats = engine.calculateStatistics(row.state.sport, row.context, rules);
    return {
      players: stats.players, teams: stats.teams, analytics: engine.calculateAdvancedAnalytics(row.state.sport, row.context, rules),
      ...(engine.rulesGuide ? { guide: engine.rulesGuide(rules) } : {}),
    };
  } catch (e) {
    return safeActionError(e, "The statistics for this match could not be calculated.");
  }
}

/**
 * Ask a plain-language question about one match ("Who has the most
 * rebounds?", "What is an and-one?"). Answered by the sport's engine from
 * the match's recorded state only; nothing is estimated or invented.
 */
export async function askContest(contestId: string, question: string): Promise<MatchAnswer | ActionError> {
  const q = typeof question === "string" ? question.trim().slice(0, 300) : "";
  if (!q) return actionError("Ask a question about the match.");
  const sb = await createClient();
  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  const engine = getEngine(row.sport as SportKey);
  if (!engine.answerQuestion) return actionError("Questions are not available for this sport yet.");

  // "why was this basket cancelled?": corrections live in the event log, not the game state
  if (/(cancel|void|revers|undo|undone|removed|taken (away|off)|disallow|correct|wiped)/i.test(q)) {
    const loaded = await loadEvents(sb, contestId);
    if (isActionError(loaded)) return loaded;
    const fix = [...loaded].reverse().find((e) => e.voids_event_id || e.replaces_event_id);
    if (!fix) return { kind: "data", answer: "Nothing has been corrected or undone in this match." };
    const target = loaded.find((e) => e.id === (fix.voids_event_id ?? fix.replaces_event_id));
    try {
      const rules = engine.resolveRules(row.rules);
      const what = target ? describe(engine, toStored(target), row.context, rules) : "an event";
      const now = fix.replaces_event_id ? `replaced by "${describe(engine, toStored(fix), row.context, rules)}"` : "reversed";
      const { scoreBefore, scoreAfter } = auditOf(fix.payload);
      const when = new Date(fix.recorded_at ?? fix.occurred_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kathmandu" });
      const score = scoreBefore && scoreAfter && scoreBefore !== scoreAfter ? ` The score went from ${scoreBefore} to ${scoreAfter}.` : "";
      return { kind: "data", answer: `"${what}" (event ${target?.seq ?? "?"}) was ${now} by a scorer at ${when}. Reason given: ${fix.reason ?? "none"}.${score}` };
    } catch (e) {
      return safeActionError(e, "That question could not be answered.");
    }
  }
  try {
    return engine.answerQuestion(row.state.sport, row.context, engine.resolveRules(row.rules), q);
  } catch (e) {
    return safeActionError(e, "That question could not be answered.");
  }
}

/** GET /matches/:id/events. Newest first, `limit` at a time; pass the last seq seen as `before` for the next page. */
export async function getContestEvents(
  contestId: string, opts: { before?: number; limit?: number } = {},
): Promise<{ entries: TimelineEntry[]; hasMore: boolean } | ActionError> {
  const sb = await createClient();
  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  const engine = getEngine(row.sport as SportKey);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  let rules: unknown;
  try { rules = engine.resolveRules(row.rules); } catch (e) { return safeActionError(e, "This match has invalid rules."); }

  let page: EventRow[];
  let all: EventRow[] | null = null;
  let labels: Record<number, string> = {};
  let hasMore: boolean;

  if (engine.eventLabel) {
    // numbering an event (cricket's "17.4") needs the state before it, so replay the log
    const loaded = await loadEvents(sb, contestId);
    if (isActionError(loaded)) return loaded;
    all = loaded;
    labels = reconstruct(engine, row.context, rules, loaded.map(toStored)).labels;
    const desc = [...loaded].reverse().filter((e) => opts.before === undefined || e.seq < opts.before);
    page = desc.slice(0, limit);
    hasMore = desc.length > limit;
  } else {
    let q = sb.from("si_events").select("*").eq("contest_id", contestId).order("seq", { ascending: false }).limit(limit + 1);
    if (opts.before !== undefined) q = q.lt("seq", opts.before);
    const { data, error } = await q;
    if (error) return fail(error.message);
    const rows = (data ?? []) as EventRow[];
    hasMore = rows.length > limit;
    page = rows.slice(0, limit);
  }

  // which of these were later corrected
  const ids = page.map((e) => e.id);
  let corrections: EventRow[] = [];
  if (all) corrections = all.filter((e) => e.voids_event_id || e.replaces_event_id);
  else if (ids.length) {
    const [v, r] = await Promise.all([
      sb.from("si_events").select("*").eq("contest_id", contestId).in("voids_event_id", ids),
      sb.from("si_events").select("*").eq("contest_id", contestId).in("replaces_event_id", ids),
    ]);
    corrections = [...((v.data ?? []) as EventRow[]), ...((r.data ?? []) as EventRow[])];
  }
  const supersededIds = new Set(corrections.map((c) => c.voids_event_id ?? c.replaces_event_id).filter((x): x is string => !!x));

  const targetIds = page.map((e) => e.voids_event_id ?? e.replaces_event_id).filter((x): x is string => !!x);
  const targetSeq = new Map<string, number>();
  if (targetIds.length) {
    const known = (all ?? page).filter((e) => targetIds.includes(e.id));
    for (const e of known) targetSeq.set(e.id, e.seq);
    const missing = targetIds.filter((id) => !targetSeq.has(id));
    if (missing.length) {
      const { data } = await sb.from("si_events").select("id, seq").in("id", missing);
      for (const e of (data ?? []) as { id: string; seq: number }[]) targetSeq.set(e.id, e.seq);
    }
  }

  const recorderIds = [...new Set(page.map((e) => e.recorded_by).filter((x): x is string => !!x))];
  const { data: profiles } = recorderIds.length
    ? await sb.from("profiles").select("id, full_name, name").in("id", recorderIds)
    : { data: [] as { id: string; full_name: string | null; name: string | null }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.name ?? "Scorer"]));

  const derived = new Map<number, string[]>();
  for (const d of engine.derivedLog(row.state.sport)) derived.set(d.seq, [...(derived.get(d.seq) ?? []), d.text]);

  const entries: TimelineEntry[] = page.map((e) => {
    const ev: EngineEvent = { id: e.id, seq: e.seq, type: e.type, payload: e.payload ?? {}, occurredAt: e.occurred_at };
    const target = e.voids_event_id ?? e.replaces_event_id;
    return {
      id: e.id, seq: e.seq, type: e.type,
      text: describe(engine, ev, row.context, rules),
      label: labels[e.seq] ?? null,
      occurredAt: e.occurred_at,
      recordedBy: e.recorded_by ? nameOf.get(e.recorded_by) ?? "Scorer" : null,
      superseded: supersededIds.has(e.id),
      correction: target ? {
        kind: e.voids_event_id ? "void" : "replace", targetSeq: targetSeq.get(target) ?? null, reason: e.reason ?? "",
        ...auditOf(e.payload),
      } : null,
      derived: derived.get(e.seq) ?? [],
      payload: e.payload ?? {},
    };
  });
  return { entries, hasMore };
}

// ── opening a contest ───────────────────────────────────────────

async function sideContext(sb: Sb, teamId: string): Promise<SideContext | ActionError> {
  const [{ data: team, error: tErr }, { data: rows, error: pErr }] = await Promise.all([
    sb.from("tournament_teams").select("id, name").eq("id", teamId).maybeSingle(),
    sb.from("tournament_team_players").select("id, user_id, guest_name, jersey_number, joined_at").eq("team_id", teamId).order("joined_at", { ascending: true }),
  ]);
  if (tErr || pErr) return fail((tErr ?? pErr)!.message);
  if (!team) return fail("TEAM_NOT_FOUND");
  const players = (rows ?? []) as { id: string; user_id: string | null; guest_name: string | null; jersey_number: number | null }[];
  const userIds = players.map((p) => p.user_id).filter((x): x is string => !!x);
  const { data: profiles } = userIds.length
    ? await sb.from("profiles").select("id, full_name, name, username").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null; name: string | null; username: string | null }[] };
  const prof = new Map((profiles ?? []).map((p) => [p.id, p]));
  return {
    teamId: team.id, name: team.name,
    players: players.map((p) => {
      const pr = p.user_id ? prof.get(p.user_id) : undefined;
      return { id: p.id, name: pr?.full_name ?? pr?.name ?? pr?.username ?? p.guest_name ?? "Player", number: p.jersey_number, userId: p.user_id };
    }),
  };
}

function reval(tournamentId: string, contestId?: string) {
  revalidatePath("/");
  revalidatePath(`/tournaments/${tournamentId}`);
  revalidatePath(`/tournaments/${tournamentId}/score`);
  if (contestId) revalidatePath(`/tournaments/${tournamentId}/live/${contestId}`);
}

/**
 * initializeMatch for a fixture: freezes the two rosters and the
 * competition's rules, and creates the contest. Opening a fixture that
 * already has a contest returns it.
 */
export async function openMatchContest(matchId: string, rulesOverride?: Record<string, unknown>): Promise<ContestView | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");

  const existing = await sb.from("si_contests").select("*").eq("match_id", matchId).maybeSingle();
  if (existing.error) return fail(existing.error.message);
  if (existing.data) return toView(existing.data as ContestRow);

  const { data: match, error: mErr } = await sb.from("tournament_matches").select("*").eq("id", matchId).maybeSingle();
  if (mErr) return fail(mErr.message);
  if (!match) return fail("MATCH_NOT_FOUND");
  const m = match as TournamentMatch;
  if (!m.team_a_id || !m.team_b_id) return fail("TEAMS_NOT_SET");

  const { data: t, error: tErr } = await sb.from("tournaments").select("id, sport, scoring_rules").eq("id", m.tournament_id).maybeSingle();
  if (tErr) return fail(tErr.message);
  if (!t) return fail("TOURNAMENT_NOT_FOUND");
  const sport = sportKeyFor(t.sport);
  if (!sport || sport === "swimming") return actionError(`${t.sport} matches are scored from the fixtures tab, not the live scorer.`);

  const engine = getEngine(sport);
  let rules: unknown;
  try { rules = engine.resolveRules({ ...(t.scoring_rules ?? {}), ...(rulesOverride ?? {}) }); }
  catch (e) { return actionError(e instanceof RulesError ? `Scoring rules: ${e.message}` : "The tournament's scoring rules are invalid."); }

  const [a, b] = await Promise.all([sideContext(sb, m.team_a_id), sideContext(sb, m.team_b_id)]);
  if (isActionError(a)) return a;
  if (isActionError(b)) return b;
  const ctx: MatchContext = { sport, sides: { a, b } };
  const env = newEnvelope(engine, ctx, rules);

  const { data, error } = await sb.rpc("si_open_contest", {
    p_tournament_id: m.tournament_id, p_match_id: matchId, p_race_category_id: null, p_sport: sport,
    p_label: `${a.name} v ${b.name}`, p_rules: rules, p_context: ctx, p_state: env, p_summary: summarize(engine, env, ctx, rules),
  });
  if (error) return fail(error.message);
  reval(m.tournament_id);
  return toView(data as ContestRow);
}

/** initializeMatch for a swimming race: one event, one round, one heat. */
export async function openSwimRace(
  tournamentId: string,
  input: Partial<SwimmingRules> & { entries: SwimEntry[]; raceCategoryId?: string | null },
): Promise<ContestView | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const engine = getEngine("swimming");
  const { raceCategoryId, ...rulesInput } = input;
  let rules: SwimmingRules;
  try { rules = engine.resolveRules(rulesInput) as SwimmingRules; }
  catch (e) { return actionError(e instanceof RulesError ? `Race setup: ${e.message}` : "The race setup is invalid."); }

  const ctx: MatchContext = { sport: "swimming", sides: null };
  const env = newEnvelope(engine, ctx, rules);
  const summary = summarize(engine, env, ctx, rules);
  const { data, error } = await sb.rpc("si_open_contest", {
    p_tournament_id: tournamentId, p_match_id: null, p_race_category_id: raceCategoryId ?? null, p_sport: "swimming",
    p_label: summary.view.periodLabel, p_rules: rules, p_context: ctx, p_state: env, p_summary: summary,
  });
  if (error) return fail(error.message);
  reval(tournamentId);
  return toView(data as ContestRow);
}

// ── keeping the fixture row in step ─────────────────────────────

// While a match is live the snapshot RPC mirrors the score. When it
// ends, the result goes through the existing RPCs so that bracket
// progression and standings behave exactly as for a hand-entered score.
async function syncFixture(sb: Sb, row: ContestRow, env: MatchEnvelope, mirror: MirrorScore | null): Promise<string | null> {
  if (!row.match_id || !row.context.sides) return null;
  const teamOf = (s: Side | null) => (s ? row.context.sides![s].teamId : null);
  const warn = (message: string) => message.includes("CASCADE_CONFIRMATION_REQUIRED")
    // never forced from here: a cascade resets later rounds' results
    ? "The match was saved, but the fixture still shows the old result: the new one changes who advances, and a later round already involves the old winner. Sort out that round in the Fixtures tab, then reopen and complete this match again."
    : `The match was saved, but the fixture could not be updated: ${friendlyTournamentError(message)}`;

  if (env.status === "postponed" || env.status === "cancelled" || env.status === "abandoned") {
    const { error } = await sb.rpc("set_match_status", { p_match_id: row.match_id, p_status: env.status === "postponed" ? "postponed" : "cancelled" });
    return error ? warn(error.message) : null;
  }
  if (env.status !== "completed" || !env.result) return null;

  const base = {
    p_match_id: row.match_id, p_score_a: null as number | null, p_score_b: null as number | null, p_winner_team_id: null as string | null,
    p_score_a_et: null, p_score_b_et: null, p_score_a_pens: null, p_score_b_pens: null, p_confirm_cascade: false,
  };
  if (env.result.method === "forfeit" || env.result.method === "walkover") {
    const { error } = await sb.rpc("record_match_result", { ...base, p_winner_team_id: teamOf(env.result.winner) });
    return error ? warn(error.message) : null;
  }
  if (!mirror) return null;
  if (mirror.cricket) {
    const { error } = await sb.rpc("record_cricket_result", {
      p_match_id: row.match_id, p_runs_a: mirror.scoreA, p_wickets_a: mirror.cricket.wicketsA, p_overs_a: mirror.cricket.oversA,
      p_runs_b: mirror.scoreB, p_wickets_b: mirror.cricket.wicketsB, p_overs_b: mirror.cricket.oversB,
      p_toss_winner_team_id: null, p_toss_decision: null, p_target_runs: mirror.cricket.target,
      p_winner_team_id: teamOf(env.result.winner), p_confirm_cascade: false,
    });
    return error ? warn(error.message) : null;
  }
  const { error } = await sb.rpc("record_match_result", { ...base, p_score_a: mirror.scoreA, p_score_b: mirror.scoreB });
  return error ? warn(error.message) : null;
}

// ── POST /matches/:id/events (and start, pause, resume, complete) ──



const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordContestEvent(contestId: string, input: RecordEventInput): Promise<RecordEventResult | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!UUID.test(input.clientId)) return actionError("Missing event id. Reload and try again.");
  if (input.type === CORRECTION_VOID) return actionError("Use a correction to reverse an event.");
  const occurredAt = input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : new Date().toISOString();

  // Two scorers at once: the loser of the race gets SEQ_CONFLICT, and
  // is retried once against the fresh state before being told.
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await loadContest(sb, contestId);
    if (isActionError(row)) return row;
    const engine = getEngine(row.sport as SportKey);

    let rules: unknown, env: MatchEnvelope;
    try {
      rules = engine.resolveRules(row.rules);
      const ev: EngineEvent = { id: input.clientId, seq: row.last_seq + 1, type: input.type, payload: input.payload ?? {}, occurredAt };
      env = recordEvent(engine, row.state, ev, row.context, rules);
    } catch (e) {
      if (e instanceof EngineError || e instanceof RulesError) return actionError(e.message);
      return safeActionError(e, "That event could not be recorded.");
    }

    const snap = snapshot(engine, env, row.context, rules);
    const { data, error } = await sb.rpc("si_append_event", {
      p_contest_id: contestId, p_expected_seq: row.last_seq, p_type: input.type, p_payload: input.payload ?? {},
      p_client_id: input.clientId, p_occurred_at: occurredAt, p_voids_event_id: null, p_replaces_event_id: null, p_reason: null,
      p_status: env.status, p_state: env, p_summary: snap.summary, p_lines: snap.lines, p_mirror: snap.mirror,
    });
    if (error) {
      if (error.message.includes("SEQ_CONFLICT") && attempt === 0) continue;
      return fail(error.message);
    }
    const res = data as { duplicate: boolean; contest: ContestRow };
    if (res.duplicate) return { contest: toView(res.contest), duplicate: true, warning: null };

    const before = engine.mirrorScore(row.state.sport, row.context, rules);
    const statusChanged = env.status !== row.status;
    const warning = statusChanged ? await syncFixture(sb, row, env, snap.mirror) : null;
    // the cached pages only show the mirrored score, so only bust them when it moved
    if (statusChanged || JSON.stringify(before) !== JSON.stringify(snap.mirror)) reval(row.tournament_id, contestId);
    return { contest: toView(res.contest), duplicate: false, warning };
  }
  return fail("SEQ_CONFLICT");
}

// ── corrections ─────────────────────────────────────────────────

/**
 * Reverse an event, or replace it with a corrected one. Nothing is
 * deleted: the correction is a new event naming the one it corrects,
 * with who made it, when and why. Refused if it would leave any later
 * event impossible.
 */
export async function correctContestEvent(
  contestId: string, targetEventId: string, reason: string, clientId: string,
  replacement?: { type: string; payload: Record<string, unknown> },
): Promise<RecordEventResult | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!UUID.test(clientId)) return actionError("Missing event id. Reload and try again.");
  if (!reason.trim()) return fail("REASON_REQUIRED");

  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  const loaded = await loadEvents(sb, contestId);
  if (isActionError(loaded)) return loaded;
  const engine = getEngine(row.sport as SportKey);
  const now = new Date().toISOString();

  const target = loaded.find((e) => e.id === targetEventId);
  const correction: StoredEvent = {
    id: randomUUID(), seq: row.last_seq + 1, occurredAt: replacement && target ? iso(target.occurred_at) : now, recordedBy: user.id, clientId, reason: reason.trim(),
    ...(replacement
      ? { type: replacement.type, payload: replacement.payload, replacesEventId: targetEventId }
      : { type: CORRECTION_VOID, payload: {}, voidsEventId: targetEventId }),
  };

  let rules: unknown, env: MatchEnvelope;
  try {
    rules = engine.resolveRules(row.rules);
    env = applyCorrection(engine, row.context, rules, loaded.map(toStored), correction).envelope;
  } catch (e) {
    if (e instanceof EngineError || e instanceof RulesError) return actionError(e.message);
    return safeActionError(e, "That correction could not be applied.");
  }

  const snap = snapshot(engine, env, row.context, rules);
  // the audit trail keeps the score before and after the correction
  const scoreOf = (v: { score?: Record<Side, string> } | undefined) => (v?.score ? `${v.score.a}-${v.score.b}` : null);
  const audit = { scoreBefore: scoreOf(row.summary?.view), scoreAfter: scoreOf(snap.summary.view) };
  correction.payload = { ...correction.payload, audit };
  const { data, error } = await sb.rpc("si_append_event", {
    p_contest_id: contestId, p_expected_seq: row.last_seq, p_type: correction.type, p_payload: correction.payload,
    p_client_id: clientId, p_occurred_at: correction.occurredAt,
    p_voids_event_id: correction.voidsEventId ?? null, p_replaces_event_id: correction.replacesEventId ?? null, p_reason: correction.reason,
    p_status: env.status, p_state: env, p_summary: snap.summary, p_lines: snap.lines, p_mirror: snap.mirror,
  });
  if (error) return fail(error.message);
  const res = data as { duplicate: boolean; contest: ContestRow };
  // a corrected result has to reach the fixture too
  const warning = res.duplicate ? null : await syncFixture(sb, row, env, snap.mirror);
  reval(row.tournament_id, contestId);
  return { contest: toView(res.contest), duplicate: res.duplicate, warning };
}

// ── recalculateScore(matchId) ───────────────────────────────────

/**
 * Rebuild the contest from its events and overwrite the cached
 * snapshot with the result. Reports every problem found in the log
 * (duplicates, gaps, impossible events, broken invariants) and whether
 * the snapshot had drifted from what the events say.
 */
export async function recalculateContest(contestId: string): Promise<RecalculationReport | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  const loaded = await loadEvents(sb, contestId);
  if (isActionError(loaded)) return loaded;
  const engine = getEngine(row.sport as SportKey);

  let rules: unknown;
  try { rules = engine.resolveRules(row.rules); } catch (e) { return safeActionError(e, "This match has invalid rules."); }
  const rebuilt = reconstruct(engine, row.context, rules, loaded.map(toStored));
  const env = rebuilt.envelope as MatchEnvelope;
  // compare as stored JSON: undefined keys and key order do not survive the database
  const drift = JSON.stringify(sortKeys(JSON.parse(JSON.stringify(env)))) !== JSON.stringify(sortKeys(row.state));

  const snap = snapshot(engine, env, row.context, rules);
  const { data, error } = await sb.rpc("si_save_snapshot", {
    p_contest_id: contestId, p_expected_seq: row.last_seq, p_status: env.status, p_state: env,
    p_summary: snap.summary, p_lines: snap.lines, p_mirror: snap.mirror,
  });
  if (error) return fail(error.message);
  if (drift) reval(row.tournament_id, contestId);
  return { contest: toView(data as ContestRow), issues: rebuilt.issues, drift, events: effectiveEvents(loaded.map(toStored)).list.length };
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

// ── historical statistics ───────────────────────────────────────


interface LineRow {
  contest_id: string; tournament_id: string; sport: string; subject: string; subject_key: string;
  team_id: string | null; team_player_id: string | null; user_id: string | null; event_key: string | null;
  raw: Record<string, number>; played_at: string;
}

async function history(sb: Sb, column: "user_id" | "team_id", id: string, subject: "player" | "team", sport: SportKey, f: HistoryFilter): Promise<HistoryReport | ActionError> {
  let q = sb.from("si_stat_lines").select("*").eq(column, id).eq("subject", subject).eq("sport", sport)
    .order("played_at", { ascending: false }).limit(Math.min(f.limit ?? 500, 1000));
  if (f.tournamentId) q = q.eq("tournament_id", f.tournamentId);
  if (f.from) q = q.gte("played_at", f.from);
  if (f.to) q = q.lte("played_at", f.to);
  if (f.eventKey) q = q.eq("event_key", f.eventKey);
  const { data, error } = await q;
  if (error) return fail(error.message);
  const lines = (data ?? []) as LineRow[];
  const agg = aggregate(getEngine(sport), subject, lines.map((l) => l.raw));
  const rows: HistoryRow[] = lines.map((l) => ({ contestId: l.contest_id, tournamentId: l.tournament_id, playedAt: l.played_at, eventKey: l.event_key, raw: l.raw }));
  return { sport, contests: agg.contests, columns: agg.columns, values: agg.values, rows };
}

/** GET /players/:id/statistics: a linked account's record in one sport, across matches, tournaments or a date range. */
export async function getPlayerHistory(userId: string, sport: SportKey, filter: HistoryFilter = {}): Promise<HistoryReport | ActionError> {
  if (!isSportKey(sport)) return actionError("Unknown sport.");
  return history(await createClient(), "user_id", userId, "player", sport, filter);
}

/** GET /teams/:id/statistics. */
export async function getTeamHistory(teamId: string, sport: SportKey, filter: HistoryFilter = {}): Promise<HistoryReport | ActionError> {
  if (!isSportKey(sport)) return actionError("Unknown sport.");
  return history(await createClient(), "team_id", teamId, "team", sport, filter);
}

/** Tournament leaderboard: every player's totals and derived figures for one tournament. */
export async function getTournamentLeaders(tournamentId: string): Promise<TournamentLeaders | null | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("si_stat_lines").select("*").eq("tournament_id", tournamentId).eq("subject", "player").limit(5000);
  if (error) return fail(error.message);
  const lines = (data ?? []) as LineRow[];
  if (!lines.length || !isSportKey(lines[0].sport)) return null;
  const sport = lines[0].sport;
  const engine = getEngine(sport);

  const groups = new Map<string, LineRow[]>();
  for (const l of lines) {
    // swimming: one row per athlete per event, since times only compare within an event
    const key = l.event_key ? `${l.subject_key}|${l.event_key}` : l.subject_key;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  // Names come from the rosters frozen into each contest, which are
  // public with the contest (the roster table itself is not).
  const { data: contests } = await sb.from("si_contests").select("context, rules").eq("tournament_id", tournamentId);
  const playerName = new Map<string, string>();
  const teamName = new Map<string, string>();
  for (const c of (contests ?? []) as { context: MatchContext; rules: { entries?: SwimEntry[] } }[]) {
    for (const side of Object.values(c.context?.sides ?? {})) {
      teamName.set(side.teamId, side.name);
      for (const pl of side.players) playerName.set(pl.id, pl.name);
    }
    for (const e of c.rules?.entries ?? []) {
      if (e.teamId) teamName.set(e.teamId, e.name);
      if (e.teamPlayerId) playerName.set(e.teamPlayerId, e.name);
      for (const sw of e.swimmers ?? []) if (sw.teamPlayerId) playerName.set(sw.teamPlayerId, sw.name);
    }
  }

  let columns = engine.deriveStats("player", {}).columns;
  const rows: LeaderRow[] = [...groups.entries()].map(([key, ls]) => {
    const agg = aggregate(engine, "player", ls.map((l) => l.raw));
    columns = agg.columns;
    const first = ls[0];
    const who = (first.team_player_id && playerName.get(first.team_player_id)) || (first.team_id && teamName.get(first.team_id)) || "Player";
    return {
      subjectKey: key,
      name: first.event_key ? `${who} (${eventKeyName(first.event_key)})` : who,
      teamName: (first.team_id && teamName.get(first.team_id)) || "",
      contests: agg.contests, values: agg.values,
    };
  });
  return { sport, columns, rows };
}

function eventKeyName(key: string): string {
  const [distance, stroke, , tag] = key.split("-");
  if (tag === "relayleg") return `${distance}m ${stroke} relay leg`;
  return swimEventName({ distance: Number(distance), stroke: stroke as SwimmingRules["stroke"], relay: tag === "relay", relayLegs: 4 });
}

/** GET /athletes/:id/performance: personal bests, season bests and progression per swimming event. */
export async function getAthletePerformance(userId: string): Promise<SwimEventPerformance[] | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("si_stat_lines").select("*").eq("user_id", userId).eq("sport", "swimming").eq("subject", "player")
    .order("played_at", { ascending: true }).limit(2000);
  if (error) return fail(error.message);
  const byEvent = new Map<string, LineRow[]>();
  for (const l of (data ?? []) as LineRow[]) {
    if (!l.event_key || typeof l.raw.fastestMs !== "number") continue; // unfinished swims have no time
    byEvent.set(l.event_key, [...(byEvent.get(l.event_key) ?? []), l]);
  }
  const season = String(new Date().getUTCFullYear());
  return [...byEvent.entries()].map(([eventKey, ls]) => {
    const swims = ls.map((l) => ({ timeMs: l.raw.fastestMs, date: l.played_at }));
    const latest = swims[swims.length - 1];
    const perf = swimPerformance(latest, swims.slice(0, -1));
    const inSeason = swims.filter((s) => s.date.slice(0, 4) === season).map((s) => s.timeMs);
    return {
      eventKey, eventName: eventKeyName(eventKey), swims: swims.length,
      personalBestMs: Math.min(...swims.map((s) => s.timeMs)),
      seasonBestMs: inSeason.length ? Math.min(...inSeason) : null,
      averageMs: Math.round(swims.reduce((t, s) => t + s.timeMs, 0) / swims.length),
      latestMs: latest.timeMs,
      latestImprovementMs: perf.improvementMs,
      latestImprovementPct: perf.improvementPct,
      latestIsPersonalBest: swims.length > 1 && perf.isPersonalBest,
      progression: swims,
    };
  });
}

/** For one finished race: each entry's time against that athlete's history in the same event. */
export async function getRacePerformance(contestId: string): Promise<Record<string, ReturnType<typeof swimPerformance>> | ActionError> {
  const sb = await createClient();
  const row = await loadContest(sb, contestId);
  if (isActionError(row)) return row;
  if (row.sport !== "swimming") return {};
  const rules = row.rules as unknown as SwimmingRules;
  const key = swimEventKey(rules);
  const { data: mine, error } = await sb.from("si_stat_lines").select("*").eq("contest_id", contestId).eq("event_key", key);
  if (error) return fail(error.message);
  const out: Record<string, ReturnType<typeof swimPerformance>> = {};
  for (const l of (mine ?? []) as LineRow[]) {
    if (typeof l.raw.fastestMs !== "number") continue;
    // history follows the account when the athlete is linked, otherwise the roster entry
    let q = sb.from("si_stat_lines").select("raw, played_at").eq("sport", "swimming").eq("event_key", key).neq("contest_id", contestId).lt("played_at", l.played_at).limit(500);
    q = l.user_id ? q.eq("user_id", l.user_id) : q.eq("subject_key", l.subject_key);
    const { data: past } = await q;
    const hist = ((past ?? []) as { raw: Record<string, number>; played_at: string }[])
      .filter((h) => typeof h.raw.fastestMs === "number").map((h) => ({ timeMs: h.raw.fastestMs, date: h.played_at }));
    out[String(l.raw.lane ?? l.subject_key)] = swimPerformance({ timeMs: l.raw.fastestMs, date: l.played_at }, hist);
  }
  return out;
}

// ── competition.rules ───────────────────────────────────────────

/** The rules a new contest in this tournament would be opened with. */
export async function getScoringRules(tournamentId: string): Promise<{ sport: SportKey; rules: Record<string, unknown> } | null | ActionError> {
  const sb = await createClient();
  const { data, error } = await sb.from("tournaments").select("sport, scoring_rules").eq("id", tournamentId).maybeSingle();
  if (error) return fail(error.message);
  const sport = sportKeyFor(data?.sport);
  if (!data || !sport || sport === "swimming") return null; // a swimming race carries its own rules
  try { return { sport, rules: getEngine(sport).resolveRules(data.scoring_rules ?? {}) as Record<string, unknown> }; }
  catch { return { sport, rules: getEngine(sport).resolveRules({}) as Record<string, unknown> }; }
}

/** A sport's defaults (for cricket, the defaults of one preset). */
export async function getRuleDefaults(sport: SportKey, preset?: string): Promise<Record<string, unknown> | ActionError> {
  if (!isSportKey(sport) || sport === "swimming") return actionError("Unknown sport.");
  try { return getEngine(sport).resolveRules(preset ? { preset } : {}) as Record<string, unknown>; }
  catch (e) { return actionError(e instanceof RulesError ? e.message : "Unknown preset."); }
}

/**
 * Save the competition's scoring rules. They apply to matches opened
 * for scoring from now on: a match already being scored keeps the rules
 * it started with.
 */
export async function saveScoringRules(tournamentId: string, input: Record<string, unknown>): Promise<Record<string, unknown> | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  if (!(await canScoreTournament(tournamentId))) return fail("FORBIDDEN");
  const { data: t, error: tErr } = await sb.from("tournaments").select("sport").eq("id", tournamentId).maybeSingle();
  if (tErr) return fail(tErr.message);
  const sport = sportKeyFor(t?.sport);
  if (!sport || sport === "swimming") return actionError("This sport has no tournament-wide scoring rules.");
  let rules: Record<string, unknown>;
  try { rules = getEngine(sport).resolveRules(input) as Record<string, unknown>; }
  catch (e) { return actionError(e instanceof RulesError ? e.message : "Those rules are not valid."); }
  // not a direct update: row security lets only venue managers and super
  // admins update tournaments, and a refused update fails silently
  const { error } = await sb.rpc("si_set_scoring_rules", { p_tournament_id: tournamentId, p_rules: rules });
  if (error) return fail(error.message);
  revalidatePath(`/tournaments/${tournamentId}/score`);
  return rules;
}
