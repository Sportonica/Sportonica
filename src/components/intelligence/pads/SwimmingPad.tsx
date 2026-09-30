"use client";

import { useEffect, useState } from "react";
import { formatDuration, parseDuration } from "@/lib/intelligence/core/util";
import type { SwimmingRules, SwimmingState } from "@/lib/intelligence/sports/swimming";
import type { PadProps } from "./shared";

export default function SwimmingPad({ contest, send }: PadProps) {
  const s = contest.state as SwimmingState;
  const rules = contest.rules as unknown as SwimmingRules;
  const [now, setNow] = useState(() => Date.now());
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [bad, setBad] = useState<number | null>(null);

  const startMs = s.startAt ? Date.parse(s.startAt) : null;
  const running = s.started && startMs !== null && Object.values(s.lanes).some((l) => l.status === "swimming");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(t);
  }, [running]);
  const elapsed = startMs !== null ? Math.max(0, now - startMs) : 0;

  // a typed time wins; otherwise the running clock is used
  const timeFor = (lane: number): number | null => {
    const text = (typed[lane] ?? "").trim();
    if (!text) return Math.round(elapsed);
    return parseDuration(text);
  };
  const timed = (lane: number, type: string, extra: Record<string, unknown> = {}) => {
    const timeMs = timeFor(lane);
    if (timeMs === null) { setBad(lane); return; }
    setBad(null);
    send(type, { lane, timeMs, ...extra });
    setTyped({ ...typed, [lane]: "" });
  };

  if (!s.started) {
    return (
      <div className="si-pad">
        <button type="button" className="si-key-btn score big" onClick={() => send("RACE_START")}>Start</button>
        <div className="si-muted" style={{ fontSize: 12.5 }}>Mark anyone who is not swimming before the start.</div>
        {rules.entries.map((e) => (
          <div key={e.lane} className="si-row" style={{ justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700 }}>Lane {e.lane}: {e.name}{s.lanes[e.lane].status !== "entered" ? ` (${s.lanes[e.lane].status.toUpperCase()})` : ""}</span>
            {s.lanes[e.lane].status === "entered" ? <button type="button" className="si-btn small" onClick={() => send("DNS", { lane: e.lane })}>Did not start</button> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="si-pad">
      <div className="si-clock" aria-label="Race clock">{formatDuration(elapsed)}</div>
      <div className="si-muted" style={{ fontSize: 12.5 }}>Tap Split or Finish to take the clock time, or type a time (for example 1:02.45) first to enter it exactly.</div>
      {rules.entries.map((e) => {
        const l = s.lanes[e.lane];
        const last = l.splits[l.splits.length - 1];
        const nextSplit = (last?.distance ?? 0) + rules.course;
        const swimming = l.status === "swimming";
        return (
          <div key={e.lane} className="si-lane-row">
            <div className="si-row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontWeight: 800 }}>Lane {e.lane}: {e.name}</span>
              <span className="si-muted" style={{ fontSize: 12.5 }}>
                {l.status === "finished" ? `Finished ${formatDuration(l.finalMs)}` : l.status === "dq" ? `DSQ: ${l.dqReason ?? ""}` : l.status === "swimming" ? (last ? `${last.distance} m in ${formatDuration(last.timeMs)}` : "Swimming") : l.status.toUpperCase()}
              </span>
            </div>
            {swimming ? (
              <>
                <input className="si-input" inputMode="decimal" placeholder="Time (optional), e.g. 52.34" value={typed[e.lane] ?? ""} onChange={(ev) => setTyped({ ...typed, [e.lane]: ev.target.value })} aria-label={`Time for lane ${e.lane}`} />
                {bad === e.lane ? <div className="si-error">That is not a time. Use seconds (52.34) or minutes and seconds (1:02.45).</div> : null}
                <div className="si-keys">
                  {nextSplit < rules.distance ? <button type="button" className="si-key-btn" onClick={() => timed(e.lane, "SPLIT", { distance: nextSplit })}>Split {nextSplit} m</button> : null}
                  <button type="button" className="si-key-btn score" onClick={() => timed(e.lane, "RACE_FINISH")}>Finish</button>
                  <button type="button" className="si-key-btn" onClick={() => { const ms = parseDuration((typed[e.lane] ?? "").trim()); if (ms === null) { setBad(e.lane); return; } setBad(null); send("REACTION", { lane: e.lane, timeMs: ms }); setTyped({ ...typed, [e.lane]: "" }); }}>Reaction</button>
                  <button type="button" className="si-key-btn warn" onClick={() => send("FALSE_START", { lane: e.lane })}>False start</button>
                  <button type="button" className="si-key-btn warn" onClick={() => send("DNF", { lane: e.lane })}>DNF</button>
                  <button type="button" className="si-key-btn warn" onClick={() => { const reason = window.prompt(`Reason for disqualifying lane ${e.lane}`); if (reason?.trim()) send("DISQUALIFICATION", { lane: e.lane, reason: reason.trim() }); }}>Disqualify</button>
                </div>
              </>
            ) : l.status === "finished" ? (
              <div className="si-row">
                <button type="button" className="si-btn small danger" onClick={() => { const reason = window.prompt(`Reason for disqualifying lane ${e.lane}`); if (reason?.trim()) send("DISQUALIFICATION", { lane: e.lane, reason: reason.trim() }); }}>Disqualify</button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
