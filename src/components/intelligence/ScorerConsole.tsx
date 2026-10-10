"use client";

// The scorer's screen: one page, the score always visible, the pad for
// this sport, undo, corrections and the audit trail underneath.
//
// Taps go into a queue and are sent one at a time in order. Each
// carries an id made on this device, so a tap that is retried after a
// dropped connection (or sent twice) is stored once. If the connection
// is lost the queue waits and resumes on its own.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { bulkCorrectContest, correctContestEvent, getContestEvents, getRuleDefaults, recalculateContest, recordContestEvent, setContestRules } from "@/lib/intelligence/actions";
import type { CricketBulkEdit } from "@/lib/intelligence/sports/cricketEdits";
import { isActionError } from "@/lib/actionError";
import type { Issue } from "@/lib/intelligence/core/types";
import { withQueued, type QueuedEvent as Queued } from "@/lib/intelligence/optimistic";
import type { ContestView, TimelineEntry } from "@/lib/intelligence/types";
import { useLiveContest } from "./useLiveContest";
import { ScoreCard, Timeline } from "./views";
import { PADS } from "./pads";
import { CricketScorerHeader, CricketScorerSide, EndMatchEarly } from "./cricket/scorer";
import { getEngine } from "@/lib/intelligence/registry";
import { SIDE_KEYS } from "./pads/shared";
import RuleFields from "./RuleFields";
import "./intelligence.css";

const newId = (): string => crypto.randomUUID();
const LIFECYCLE = new Set(["MATCH_START", "MATCH_PAUSE", "MATCH_RESUME", "MATCH_POSTPONE", "MATCH_CANCEL", "MATCH_ABANDON", "MATCH_FORFEIT", "MATCH_RESTART", "MATCH_COMPLETE", "MATCH_REOPEN"]);

export default function ScorerConsole({ initial, tournamentName }: { initial: ContestView; tournamentName: string }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  // pushes wait while our own taps are on their way: they are already on screen
  const [contest, setContest] = useLiveContest(initial, queue.length > 0);
  const shown = useMemo(() => withQueued(contest, queue), [contest, queue]);
  const storageKey = `si-queue-${initial.id}`;
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [replacing, setReplacing] = useState<TimelineEntry | null>(null);
  const [report, setReport] = useState<{ issues: Issue[]; drift: boolean; events: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const queueRef = useRef<Queued[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // events left unsent by a closed tab or a lost connection
  useEffect(() => {
    const restore = () => {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Queued[];
        if (Array.isArray(saved) && saved.length) setQueue((q) => (q.length ? q : saved));
      } catch { /* storage unavailable: the queue simply does not survive a reload */ }
    };
    const t = setTimeout(restore, 0);
    return () => clearTimeout(t);
  }, [storageKey]);
  const restored = useRef(false);
  useEffect(() => {
    // do not wipe what a previous session left before it has been read back
    if (!restored.current) { restored.current = true; if (!queue.length) return; }
    try { localStorage.setItem(storageKey, JSON.stringify(queue)); } catch { /* as above */ }
  }, [queue, storageKey]);

  const refreshTimeline = useCallback(async () => {
    // cricket's commentary lists the balls, so it reads further back
    const res = await getContestEvents(initial.id, { limit: initial.sport === "cricket" ? 120 : 30 });
    if (!isActionError(res)) setEntries(res.entries);
  }, [initial.id, initial.sport]);
  // Server actions from one tab run one at a time, so a timeline fetch
  // after every tap would queue in front of the next tap. Refresh once
  // the scorer pauses, and never while taps are still waiting to send.
  useEffect(() => {
    if (queue.length) return;
    const t = setTimeout(() => { void refreshTimeline(); }, 900);
    return () => clearTimeout(t);
  }, [refreshTimeline, contest.lastSeq, queue.length]);

  // drain the queue, strictly in order
  useEffect(() => {
    if (!queue.length || sending.current) return;
    // No cancellation here on purpose: a tap made while this one is in
    // flight re-runs the effect, and the in-flight result must still land.
    sending.current = true;
    (async () => {
      const next = queue[0];
      try {
        const res = await recordContestEvent(initial.id, next);
        setOffline(false);
        if (isActionError(res)) {
          // Refused by the rules: it will never succeed, and what was tapped
          // after it assumed it had, so those are dropped too. Say so: a
          // scorer must never lose a tap without being told.
          const dropped = queueRef.current.length - 1; // includes taps made while this one was in flight
          setError(dropped > 0 ? `${res.message}. ${dropped} later tap${dropped === 1 ? " was" : "s were"} not recorded. Check the score and enter ${dropped === 1 ? "it" : "them"} again.` : res.message);
          setQueue([]);
        } else {
          setWarning(res.warning);
          setContest(res.contest);
          setQueue((q) => q.slice(1));
        }
      } catch {
        // no connection: keep everything and try again shortly with the same ids
        setOffline(true); setTimeout(() => setQueue((q) => [...q]), 4000);
      } finally {
        sending.current = false;
      }
    })();
  }, [queue, initial.id, setContest]);

  useEffect(() => {
    const retry = () => setQueue((q) => [...q]);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  const correct = async (target: TimelineEntry, reason: string, replacement?: { type: string; payload: Record<string, unknown> }) => {
    setBusy(true);
    try {
      const res = await correctContestEvent(initial.id, target.id, reason, newId(), replacement);
      if (isActionError(res)) setError(res.message);
      else { setError(null); setWarning(res.warning); setContest(res.contest); await refreshTimeline(); }
    } catch { setError("No connection. The correction was not saved. Try again."); }
    setBusy(false);
  };

  // cricket: the wrong player or bowler fixed across many balls at once
  const bulkFix = async (edit: CricketBulkEdit, reason: string) => {
    setBusy(true);
    try {
      const res = await bulkCorrectContest(initial.id, edit, reason, newId());
      if (isActionError(res)) setError(res.message);
      else { setError(null); setWarning(res.warning); setContest(res.contest); await refreshTimeline(); }
    } catch { setError("No connection. The fix was not saved. Try again."); }
    setBusy(false);
  };

  const send = (type: string, payload: Record<string, unknown> = {}) => {
    if (replacing) {
      const target = replacing;
      setReplacing(null);
      const reason = window.prompt(`Why is event #${target.seq} being replaced?`);
      if (reason?.trim()) void correct(target, reason.trim(), { type, payload });
      return;
    }
    setQueue((q) => [...q, { type, payload, clientId: newId(), occurredAt: new Date().toISOString() }]);
  };

  const withReason = (type: string, question: string, extra: Record<string, unknown> = {}, required = false) => {
    const reason = window.prompt(question);
    if (reason === null || (required && !reason.trim())) return;
    send(type, { ...extra, ...(reason.trim() ? { reason: reason.trim() } : {}) });
  };

  // never from the list on screen: it may be a tap behind, and undoing
  // the wrong event is worse than waiting for a fresh read
  const findLast = async (): Promise<TimelineEntry | null> => {
    const fresh = await getContestEvents(initial.id, { limit: 30 });
    if (isActionError(fresh)) { setError(fresh.message); return null; }
    setEntries(fresh.entries);
    return fresh.entries.find((e) => !e.superseded && !e.correction && e.type !== "CORRECTION_VOID") ?? null;
  };

  const undo = async () => {
    const last = await findLast();
    if (!last) return;
    if (!window.confirm(`Undo "${last.text}"?`)) return;
    void correct(last, "Undone by the scorer");
  };

  const onCorrect = (e: TimelineEntry) => {
    if (LIFECYCLE.has(e.type)) {
      const reason = window.prompt(`Reverse "${e.text}"? Give the reason.`);
      if (reason?.trim()) void correct(e, reason.trim());
      return;
    }
    if (window.confirm(`"${e.text}"\n\nOK: replace it with the right event (tap it on the pad next).\nCancel: choose to reverse it instead.`)) {
      setReplacing(e);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const reason = window.prompt("Reason for reversing this event (leave empty to do nothing)");
    if (reason?.trim()) void correct(e, reason.trim());
  };

  const recalc = async () => {
    setBusy(true);
    const res = await recalculateContest(initial.id);
    if (isActionError(res)) setError(res.message);
    else { setContest(res.contest); setReport({ issues: res.issues, drift: res.drift, events: res.events }); }
    setBusy(false);
  };

  const Pad = PADS[contest.sport];
  const st = shown.status;
  const sides = contest.context.sides;
  const inPlay = st === "live" || st === "paused";
  const cricket = contest.sport === "cricket";
  // cricket ends early with a result the organiser names; elsewhere Complete match says why it cannot yet
  const undecided = cricket && inPlay && !!completionBlocked(shown);
  const padUndo = { last: findLast, run: (e: TimelineEntry) => void correct(e, "Undone by the scorer"), disabled: busy || queue.length > 0 || contest.lastSeq === 0 };

  return (
    <div className="si">
      <div className="si-wrap si-grid">
        <div>
          <Link href={`/tournaments/${contest.tournamentId}/score`} className="si-back"><ChevronLeft size={16} /> {tournamentName}: scoring</Link>
          <h1 className="si-h1">{contest.label ?? "Scorer"}</h1>
        </div>

        <div className="si-sticky">{cricket ? <CricketScorerHeader contest={shown} /> : <ScoreCard summary={shown.summary} context={shown.context} />}</div>

        {offline ? <div className="si-error">No connection. {queue.length} event{queue.length === 1 ? "" : "s"} waiting. They will be sent in order when the connection returns.</div>
          : queue.length > 1 ? <div className="si-info">Sending {queue.length} events…</div> : null}
        {/* stays until dismissed: the next successful tap must not hide it */}
        {error ? (
          <div className="si-error" role="alert">
            {error}{" "}
            <button type="button" className="si-link-btn" onClick={() => setError(null)}>Dismiss</button>
          </div>
        ) : null}
        {warning ? <div className="si-error" role="status">{warning}</div> : null}
        {replacing ? (
          <div className="si-error" role="status">
            Replacing event #{replacing.seq} ({replacing.text}). Tap the correct event on the pad.{" "}
            <button type="button" className="si-link-btn" onClick={() => setReplacing(null)}>Cancel</button>
          </div>
        ) : null}

        <div className="si-grid si-two">
          <div className="si-card si-grid">
            <div className="si-row">
              {st === "scheduled" || st === "postponed" ? <button type="button" className="si-btn primary" onClick={() => send("MATCH_START")}>Start match</button> : null}
              {st === "live" ? <button type="button" className="si-btn" onClick={() => withReason("MATCH_PAUSE", "Reason for the pause (optional)")}>Pause</button> : null}
              {st === "paused" ? <button type="button" className="si-btn primary" onClick={() => send("MATCH_RESUME")}>Resume</button> : null}
              {/* basketball finishes from its pad ("Finish game"), which appears once the last quarter is over */}
              {undecided ? <EndMatchEarly contest={shown} onEnd={(result, reason) => send("MATCH_COMPLETE", { result, reason })} /> : null}
              {inPlay && contest.sport !== "basketball" && !undecided ? <button type="button" className="si-btn primary" onClick={() => { if (window.confirm("Complete the match? The result becomes final.")) send("MATCH_COMPLETE"); }}>Complete match</button> : null}
              {/* cricket's pad has its own "Undo last ball" by the run keys */}
              {cricket && st === "live" ? null : <button type="button" className="si-btn" disabled={busy || queue.length > 0 || contest.lastSeq === 0} onClick={() => void undo()}>Undo last</button>}
            </div>

            {st === "live" || (replacing && inPlay) ? <Pad contest={shown} send={send} undo={padUndo} />
              : st === "paused" ? <div className="si-info">The match is paused. Resume it to keep scoring.</div>
              : st === "scheduled" ? <div className="si-info">Start the match to begin scoring.</div>
              : st === "postponed" ? <div className="si-info">This match is postponed. Start it when it is played.</div>
              : (
                <div className="si-grid" style={{ gap: 8 }}>
                  <div className="si-info">This match is over. Events can still be corrected{cricket ? ": tap Edit on any ball" : " below"}; every correction is recorded. To add something that was missed, reopen it.</div>
                  {st === "completed" ? (
                    <div className="si-row">
                      <button type="button" className="si-btn" onClick={() => withReason("MATCH_REOPEN", "Why is the match being reopened? Its result stays on the fixture until you complete it again.", {}, true)}>Reopen to edit</button>
                    </div>
                  ) : null}
                </div>
              )}

            <details className="si-more">
              <summary>Postpone, cancel, abandon, forfeit, restart</summary>
              <div className="si-keys two">
                {st === "scheduled" ? <button type="button" className="si-key-btn" onClick={() => withReason("MATCH_POSTPONE", "Reason for postponing (optional)")}>Postpone</button> : null}
                {st === "scheduled" || st === "postponed" ? <button type="button" className="si-key-btn warn" onClick={() => withReason("MATCH_CANCEL", "Reason for cancelling (optional)")}>Cancel match</button> : null}
                {inPlay ? <button type="button" className="si-key-btn warn" onClick={() => withReason("MATCH_ABANDON", "Reason for abandoning (optional). The match ends with no result.")}>Abandon (no result)</button> : null}
                {inPlay ? <button type="button" className="si-key-btn warn" onClick={() => withReason("MATCH_RESTART", "Reason for restarting. The score returns to the start; earlier events stay in the record.")}>Restart match</button> : null}
                {sides && st !== "completed" && st !== "cancelled" && st !== "abandoned" ? SIDE_KEYS.map((s) => (
                  <button type="button" key={s} className="si-key-btn warn" onClick={() => { if (window.confirm(`${sides[s].name} ${inPlay ? "forfeits" : "does not play (walkover)"}?`)) send("MATCH_FORFEIT", { side: s }); }}>
                    {sides[s].name} {inPlay ? "forfeits" : "walkover against"}
                  </button>
                )) : null}
              </div>
            </details>

            {contest.sport !== "swimming" ? (
              <MatchRules key={JSON.stringify(contest.rules)} contest={contest} busy={busy || queue.length > 0}
                onSaved={(res) => { setContest(res.contest); setWarning(res.warning); setError(null); void refreshTimeline(); }} onError={setError} />
            ) : null}
          </div>

          {cricket ? (
            <CricketScorerSide contest={shown} entries={entries} busy={busy}
              onEdit={(e, payload, reason) => void correct(e, reason, { type: "DELIVERY", payload })}
              onRemove={(e) => { if (window.confirm(`Remove "${e.text}" from the match? It stays in the record as removed.`)) void correct(e, "Removed by the scorer"); }}
              onBulkFix={(edit, reason) => void bulkFix(edit, reason)}>
              <details className="si-more">
                <summary>Full event log and recalculation</summary>
                <Timeline entries={entries} onCorrect={busy ? undefined : onCorrect} />
                <div className="si-row" style={{ marginTop: 12 }}>
                  <button type="button" className="si-btn small" disabled={busy} onClick={recalc}>Recalculate from events</button>
                </div>
                {report ? <RecalcReport report={report} /> : null}
              </details>
            </CricketScorerSide>
          ) : (
          <div className="si-card">
            <div className="si-chart-head">
              <h2 className="si-h2" style={{ margin: 0 }}>Recent events</h2>
              <Link className="si-link-btn" href={`/tournaments/${contest.tournamentId}/live/${contest.id}`}>Match centre</Link>
            </div>
            <Timeline entries={entries} onCorrect={busy ? undefined : onCorrect} />
            <div className="si-row" style={{ marginTop: 12 }}>
              <button type="button" className="si-btn small" disabled={busy} onClick={recalc}>Recalculate from events</button>
            </div>
            {report ? <RecalcReport report={report} /> : null}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Why the engine would refuse Complete match now, or null when it would accept. */
function completionBlocked(c: ContestView): string | null {
  try {
    const engine = getEngine(c.sport);
    return engine.validateMatchCompletion(c.state, c.context, engine.resolveRules(c.rules));
  } catch {
    return null;
  }
}

// This match's own rules: fixed when it was set up, changed here when they
// were wrong. Every event is replayed under the new rules on save, and the
// change is refused if anything already recorded no longer fits.
function MatchRules({ contest, busy, onSaved, onError }: {
  contest: ContestView; busy: boolean;
  onSaved: (res: { contest: ContestView; warning: string | null }) => void; onError: (m: string) => void;
}) {
  const [rules, setRules] = useState<Record<string, unknown>>(contest.rules);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(rules) !== JSON.stringify(contest.rules);
  const pickPreset = async (preset: string) => {
    const d = await getRuleDefaults(contest.sport, preset);
    if (isActionError(d)) onError(d.message);
    else setRules("table" in rules ? { ...d, table: rules.table } : d);
  };
  const save = async () => {
    if (!window.confirm("Change this match's rules? The whole match is rebuilt from its events under the new rules.")) return;
    setSaving(true);
    try {
      const res = await setContestRules(contest.id, rules);
      if (isActionError(res)) onError(res.message); else onSaved(res);
    } catch { onError("No connection. The rules were not changed. Try again."); }
    setSaving(false);
  };
  return (
    <details className="si-more">
      <summary>Rules for this match</summary>
      <div className="si-grid" style={{ gap: 12 }}>
        <div className="si-muted" style={{ fontSize: 12.5 }}>Fixed when this match was set up. Change them here if they were wrong; the tournament&apos;s rules for other matches stay as they are.</div>
        <RuleFields sport={contest.sport} look="scorer" rules={rules} onChange={setRules} onPreset={(p) => void pickPreset(p)} />
        <div className="si-row">
          <button type="button" className="si-btn primary small" disabled={busy || saving || !changed} onClick={() => void save()}>Save match rules</button>
          {changed ? <button type="button" className="si-btn small" disabled={saving} onClick={() => setRules(contest.rules)}>Discard changes</button> : null}
        </div>
      </div>
    </details>
  );
}

function RecalcReport({ report }: { report: { issues: Issue[]; drift: boolean; events: number } }) {
  return (
    <div className="si-info" style={{ marginTop: 10 }}>
      Rebuilt from {report.events} events. {report.drift ? "The stored score did not match and has been corrected." : "The stored score matched."}
      {report.issues.length ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{report.issues.map((i, k) => <li key={k}>{i.severity === "error" ? "Error" : "Note"}: {i.message}</li>)}</ul>
      ) : " No problems found in the event log."}
    </div>
  );
}
