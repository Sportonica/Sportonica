"use client";

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { oversText, type CricketRules, type CricketState } from "@/lib/intelligence/sports/cricket";
import { SIDE_KEYS, type PadProps } from "./shared";

type Extra = "wide" | "no_ball" | "bye" | "leg_bye";
const EXTRAS: { key: Extra; label: string }[] = [
  { key: "wide", label: "Wide" }, { key: "no_ball", label: "No ball" }, { key: "bye", label: "Bye" }, { key: "leg_bye", label: "Leg bye" },
];
const WICKETS: { key: string; label: string }[] = [
  { key: "bowled", label: "Bowled" }, { key: "caught", label: "Caught" }, { key: "lbw", label: "LBW" }, { key: "stumped", label: "Stumped" },
  { key: "run_out", label: "Run out" }, { key: "hit_wicket", label: "Hit wicket" }, { key: "obstructing_field", label: "Obstructing the field" }, { key: "hit_ball_twice", label: "Hit the ball twice" },
];

export default function CricketPad({ contest, send }: PadProps) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const sides = contest.context.sides!;
  const inn = s.innings.length && !s.innings[s.innings.length - 1].closed ? s.innings[s.innings.length - 1] : null;

  const [batting, setBatting] = useState<Side>("a");
  const [openers, setOpeners] = useState({ striker: "", nonStriker: "" });
  const [followOn, setFollowOn] = useState(false);
  const [bowler, setBowler] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [wicket, setWicket] = useState<{ type: string; player: string; fielder: string } | null>(null);
  const [note, setNote] = useState("");
  const [nextBatter, setNextBatter] = useState("");

  if (s.result) return <div className="si-info">The match is decided. Complete it, or correct a ball below if the result is wrong.</div>;

  // ── between innings ──
  if (!inn) {
    const team = sides[batting].players;
    return (
      <div className="si-pad">
        {!s.innings.length && !s.toss ? (
          <details className="si-more">
            <summary>Record the toss (optional)</summary>
            <div className="si-keys two">
              {SIDE_KEYS.flatMap((side) => (["bat", "bowl"] as const).map((d) => (
                <button type="button" key={`${side}-${d}`} className="si-key-btn" onClick={() => send("TOSS", { winner: side, decision: d })}>{sides[side].name} won, chose to {d}</button>
              )))}
            </div>
          </details>
        ) : null}
        <div className="si-pad-name">Start innings {s.innings.length + 1}</div>
        <div className="si-form">
          <label className="si-label">Batting
            <select className="si-input" value={batting} onChange={(e) => { setBatting(e.target.value as Side); setOpeners({ striker: "", nonStriker: "" }); }}>
              {SIDE_KEYS.map((side) => <option key={side} value={side}>{sides[side].name}</option>)}
            </select>
          </label>
          <label className="si-label">On strike
            <select className="si-input" value={openers.striker} onChange={(e) => setOpeners({ ...openers, striker: e.target.value })}>
              <option value="">Choose</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="si-label">Non-striker
            <select className="si-input" value={openers.nonStriker} onChange={(e) => setOpeners({ ...openers, nonStriker: e.target.value })}>
              <option value="">Choose</option>{team.filter((p) => p.id !== openers.striker).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {s.innings.length === 2 && rules.followOnLead !== null ? (
          <label className="si-row" style={{ fontSize: 13.5 }}><input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} /> Enforce the follow-on</label>
        ) : null}
        <button type="button" className="si-btn primary" disabled={!openers.striker || !openers.nonStriker}
          onClick={() => { send("INNINGS_START", { batting, striker: openers.striker, nonStriker: openers.nonStriker, ...(followOn ? { followOn: true } : {}) }); setBowler(""); setFollowOn(false); }}>
          Start innings
        </button>
        {team.length < 2 ? <div className="si-error">{sides[batting].name} needs at least two players on its roster to bat.</div> : null}
      </div>
    );
  }

  const bat = sides[inn.batting].players, field = sides[inn.batting === "a" ? "b" : "a"].players;
  const name = (id: string | null) => [...bat, ...field].find((p) => p.id === id)?.name ?? "";

  // ── a batter is needed ──
  if (!inn.striker || !inn.nonStriker) {
    const available = bat.filter((p) => !inn.batters[p.id]?.out && p.id !== inn.striker && p.id !== inn.nonStriker);
    return (
      <div className="si-pad">
        <div className="si-pad-name">New batter</div>
        <select className="si-input" value={nextBatter} onChange={(e) => setNextBatter(e.target.value)}>
          <option value="">Choose the next batter</option>
          {available.map((p) => <option key={p.id} value={p.id}>{p.name}{inn.batters[p.id]?.retiredHurt ? " (returning)" : ""}</option>)}
        </select>
        <div className="si-row">
          <button type="button" className="si-btn primary" disabled={!nextBatter} onClick={() => { send("NEW_BATTER", { player: nextBatter }); setNextBatter(""); }}>Send in</button>
          <button type="button" className="si-btn" onClick={() => send("INNINGS_END", { reason: "No batters left" })}>No batters left: end innings</button>
        </div>
      </div>
    );
  }

  // the engine suggests who is on strike; the scorer can swap before the ball
  const striker = swapped ? inn.nonStriker : inn.striker;
  const nonStriker = swapped ? inn.striker : inn.nonStriker;
  const over = inn.overs[inn.overs.length - 1];
  const midOver = !!over && over.legal < rules.ballsPerOver;
  const currentBowler = midOver ? over.bowler : bowler;

  const deliver = (runs: number) => {
    const payload: Record<string, unknown> = { striker, nonStriker, bowler: currentBowler };
    if (extra === "wide" || extra === "bye" || extra === "leg_bye") payload.extraRuns = runs; else payload.runsBat = runs;
    if (extra) payload.extra = extra;
    if (wicket) payload.wicket = { type: wicket.type, player: wicket.player || striker, ...(wicket.fielder ? { fielder: wicket.fielder } : {}) };
    if (note.trim()) payload.commentary = note.trim();
    send("DELIVERY", payload);
    setExtra(null); setWicket(null); setNote(""); setSwapped(false);
  };

  return (
    <div className="si-pad">
      <div className="si-info">
        {sides[inn.batting].name} {inn.runs}/{inn.wickets} ({oversText(inn.balls, rules.ballsPerOver)} ov){inn.freeHit ? " · Free hit" : ""}
        <br />On strike: <b>{name(striker)}</b> · Non-striker: {name(nonStriker)}
      </div>
      <div className="si-row">
        <button type="button" className="si-btn small" onClick={() => setSwapped((v) => !v)}>Swap strike</button>
        <label className="si-label" style={{ flex: "1 1 160px" }}>Bowler{midOver ? " (this over)" : ""}
          <select className="si-input" value={currentBowler} disabled={midOver} onChange={(e) => setBowler(e.target.value)}>
            <option value="">Choose the bowler</option>
            {field.filter((p) => midOver || p.id !== inn.lastOverBowler).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <div className="si-chips">
        {EXTRAS.map((x) => <button type="button" key={x.key} className={`si-chip${extra === x.key ? " on" : ""}`} onClick={() => setExtra(extra === x.key ? null : x.key)}>{x.label}</button>)}
        <button type="button" className={`si-chip${wicket ? " on" : ""}`} onClick={() => setWicket(wicket ? null : { type: "bowled", player: "", fielder: "" })}>Wicket</button>
      </div>

      {wicket ? (
        <div className="si-form">
          <label className="si-label">How out
            <select className="si-input" value={wicket.type} onChange={(e) => setWicket({ ...wicket, type: e.target.value })}>{WICKETS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}</select>
          </label>
          <label className="si-label">Batter out
            <select className="si-input" value={wicket.player} onChange={(e) => setWicket({ ...wicket, player: e.target.value })}>
              <option value="">{name(striker)} (striker)</option><option value={nonStriker}>{name(nonStriker)}</option>
            </select>
          </label>
          <label className="si-label">Fielder (optional)
            <select className="si-input" value={wicket.fielder} onChange={(e) => setWicket({ ...wicket, fielder: e.target.value })}>
              <option value="">None</option>{field.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      <div className="si-pad-name">
        {extra === "wide" ? "Runs run on the wide (as well as the penalty)" : extra === "bye" || extra === "leg_bye" ? "Runs run" : extra === "no_ball" ? "Runs off the bat on the no-ball" : "Runs off the bat"}
      </div>
      <div className="si-keys six">
        {[0, 1, 2, 3, 4, 6].map((r) => (
          <button type="button" key={r} className={`si-key-btn ${wicket ? "warn" : "score"}`} disabled={!currentBowler || ((extra === "bye" || extra === "leg_bye") && r === 0)} onClick={() => deliver(r)}>
            {wicket ? (r ? `W+${r}` : "W") : r}
          </button>
        ))}
      </div>
      {!currentBowler ? <div className="si-muted" style={{ fontSize: 12.5 }}>Choose the bowler for this over first.</div> : null}

      <details className="si-more">
        <summary>Commentary, retirements, penalties and innings</summary>
        <div className="si-grid" style={{ gap: 10 }}>
          <label className="si-label">Commentary for the next ball
            <input className="si-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          <div className="si-keys two">
            <button type="button" className="si-key-btn" onClick={() => send("RETIRE", { player: striker, kind: "hurt" })}>{name(striker)} retired hurt</button>
            <button type="button" className="si-key-btn" onClick={() => send("RETIRE", { player: nonStriker, kind: "hurt" })}>{name(nonStriker)} retired hurt</button>
            <button type="button" className="si-key-btn warn" onClick={() => send("RETIRE", { player: striker, kind: "out" })}>{name(striker)} retired out</button>
            <button type="button" className="si-key-btn warn" onClick={() => send("RETIRE", { player: nonStriker, kind: "out" })}>{name(nonStriker)} retired out</button>
            {SIDE_KEYS.map((side) => <button type="button" key={side} className="si-key-btn" onClick={() => send("PENALTY_RUNS", { side, runs: 5 })}>5 penalty runs to {sides[side].name}</button>)}
            {rules.allowDeclaration ? <button type="button" className="si-key-btn" onClick={() => { if (window.confirm("Declare the innings closed?")) send("DECLARE"); }}>Declare</button> : null}
            <button type="button" className="si-key-btn" onClick={() => { if (window.confirm("End this innings now?")) send("INNINGS_END", { reason: "Ended by the scorer" }); }}>End innings</button>
            {inn.target !== null ? (
              <button type="button" className="si-key-btn" onClick={() => {
                const t = Number(window.prompt("Revised target (runs needed to win)"));
                if (!Number.isInteger(t) || t <= 0) return;
                const o = Number(window.prompt("Revised overs for this innings (leave empty to keep)") || 0);
                send("TARGET_REVISED", { target: t, ...(Number.isInteger(o) && o > 0 ? { maxOvers: o } : {}) });
              }}>Revise target</button>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}
