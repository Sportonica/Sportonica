"use client";

// Cricket scoring, ball by ball, with taps instead of lists: players are
// jersey tiles (openers, the bowler, the next batter, who was out), and
// a ball is one tap on its runs. Extras and wickets are chips that apply
// to the next ball only.

import { useState } from "react";
import type { Participant, Side } from "@/lib/intelligence/core/types";
import { oversText, type CricketRules, type CricketState } from "@/lib/intelligence/sports/cricket";
import { Jersey, SIDE_KEYS, teamColor, type PadProps } from "./shared";

type Extra = "wide" | "no_ball" | "bye" | "leg_bye";
const EXTRAS: { key: Extra; label: string }[] = [
  { key: "wide", label: "Wide" }, { key: "no_ball", label: "No ball" }, { key: "bye", label: "Bye" }, { key: "leg_bye", label: "Leg bye" },
];
// the common ways out first; the rare ones under More
const WICKETS: { key: string; label: string; fielder?: boolean; rare?: boolean }[] = [
  { key: "bowled", label: "Bowled" }, { key: "caught", label: "Caught", fielder: true }, { key: "lbw", label: "LBW" },
  { key: "run_out", label: "Run out", fielder: true }, { key: "stumped", label: "Stumped", fielder: true },
  { key: "hit_wicket", label: "Hit wicket", rare: true }, { key: "obstructing_field", label: "Obstructing the field", rare: true }, { key: "hit_ball_twice", label: "Hit the ball twice", rare: true },
];
const other = (s: Side): Side => (s === "a" ? "b" : "a");

/** Jersey tiles to pick one player (or several, in order). */
function Pick({ players, side, picked, onPick, note }: {
  players: Participant[]; side: Side; picked: string[]; onPick: (id: string) => void; note?: (id: string) => string | null;
}) {
  return (
    <div className="si-jerseys">
      {players.map((p) => (
        <Jersey key={p.id} p={p} color={teamColor(side)} on={picked.includes(p.id)} note={note?.(p.id) ?? null} onClick={() => onPick(p.id)} />
      ))}
    </div>
  );
}

export default function CricketPad({ contest, send }: PadProps) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const sides = contest.context.sides!;
  const inn = s.innings.length && !s.innings[s.innings.length - 1].closed ? s.innings[s.innings.length - 1] : null;

  const [batting, setBatting] = useState<Side | null>(null);
  const [openers, setOpeners] = useState<string[]>([]);
  const [followOn, setFollowOn] = useState(false);
  const [bowler, setBowler] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [wicket, setWicket] = useState<{ type: string; player: string; fielder: string } | null>(null);
  const [moreOut, setMoreOut] = useState(false);
  const [note, setNote] = useState("");

  if (s.result) return <div className="si-info">The match is decided. Tap Complete match, or correct a ball below if the result is wrong.</div>;

  // ── between innings: who bats, and the two openers ──
  if (!inn) {
    const bat = batting ?? (s.innings.length ? other(s.innings[s.innings.length - 1].batting) : null);
    const pickOpener = (id: string) => setOpeners((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur));
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
        <div className="si-pad-name">{s.innings.length ? `Innings ${s.innings.length + 1}: who bats?` : "Who bats first?"}</div>
        <div className="si-keys two">
          {SIDE_KEYS.map((side) => (
            <button type="button" key={side} className={`si-key-btn big${bat === side ? " on" : ""}`} onClick={() => { setBatting(side); setOpeners([]); }}>{sides[side].name}</button>
          ))}
        </div>
        {bat ? (
          <div className="si-ask">
            <div className="si-pad-name">Tap the two openers: the first one tapped is on strike</div>
            <Pick players={sides[bat].players} side={bat} picked={openers} onPick={pickOpener}
              note={(id) => (openers[0] === id ? "on strike" : openers[1] === id ? "non-striker" : null)} />
            {s.innings.length === 2 && rules.followOnLead !== null ? (
              <label className="si-row" style={{ fontSize: 13.5 }}><input type="checkbox" checked={followOn} onChange={(e) => setFollowOn(e.target.checked)} /> Enforce the follow-on</label>
            ) : null}
            <button type="button" className="si-btn primary si-big-btn" disabled={openers.length !== 2}
              onClick={() => { send("INNINGS_START", { batting: bat, striker: openers[0], nonStriker: openers[1], ...(followOn ? { followOn: true } : {}) }); setBowler(""); setFollowOn(false); setOpeners([]); setBatting(null); }}>
              Start innings
            </button>
            {sides[bat].players.length < 2 ? <div className="si-error">{sides[bat].name} needs at least two players on its roster to bat.</div> : null}
          </div>
        ) : null}
      </div>
    );
  }

  const bat = sides[inn.batting].players, field = sides[other(inn.batting)].players;
  const name = (id: string | null) => [...bat, ...field].find((p) => p.id === id)?.name ?? "";
  // the score card above has the score; this adds what the scorer needs next to it
  const scoreboard = inn.target !== null || inn.freeHit || rules.oversPerInnings ? (
    <div className="si-pad-name">
      {oversText(inn.balls, rules.ballsPerOver)}{rules.oversPerInnings ? ` of ${rules.oversPerInnings}` : ""} overs
      {inn.target !== null ? ` · need ${Math.max(0, inn.target - inn.runs)} to win` : ""}
      {inn.freeHit ? <span style={{ color: "var(--si-live)" }}> · FREE HIT</span> : null}
    </div>
  ) : null;

  // ── a batter is needed ──
  if (!inn.striker || !inn.nonStriker) {
    const available = bat.filter((p) => !inn.batters[p.id]?.out && p.id !== inn.striker && p.id !== inn.nonStriker);
    return (
      <div className="si-pad">
        {scoreboard}
        <div className="si-ask">
          <div className="si-pad-name">Who comes in? Tap the next batter</div>
          <Pick players={available} side={inn.batting} picked={[]} onPick={(id) => send("NEW_BATTER", { player: id })}
            note={(id) => (inn.batters[id]?.retiredHurt ? "returning" : null)} />
          <button type="button" className="si-btn" style={{ justifySelf: "start" }} onClick={() => send("INNINGS_END", { reason: "No batters left" })}>No batters left: end innings</button>
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
  const wk = WICKETS.find((w) => w.key === wicket?.type);

  const deliver = (runs: number) => {
    const payload: Record<string, unknown> = { striker, nonStriker, bowler: currentBowler };
    if (extra === "wide" || extra === "bye" || extra === "leg_bye") payload.extraRuns = runs; else payload.runsBat = runs;
    if (extra) payload.extra = extra;
    if (wicket) payload.wicket = { type: wicket.type, player: wicket.player || striker, ...(wicket.fielder ? { fielder: wicket.fielder } : {}) };
    if (note.trim()) payload.commentary = note.trim();
    send("DELIVERY", payload);
    setExtra(null); setWicket(null); setNote(""); setSwapped(false); setMoreOut(false);
  };

  return (
    <div className="si-pad">
      {scoreboard}

      <div className="si-cricket-crease">
        <div><span className="si-muted">On strike</span><b>{name(striker)}{inn.batters[striker!] ? ` ${inn.batters[striker!].runs} (${inn.batters[striker!].balls})` : ""}</b></div>
        <div><span className="si-muted">Non-striker</span><b>{name(nonStriker)}{inn.batters[nonStriker!] ? ` ${inn.batters[nonStriker!].runs} (${inn.batters[nonStriker!].balls})` : ""}</b></div>
        <button type="button" className="si-btn small" onClick={() => setSwapped((v) => !v)}>Swap strike</button>
      </div>

      {!currentBowler ? (
        <div className="si-ask">
          <div className="si-pad-name">Who bowls this over? Tap the bowler</div>
          <Pick players={field.filter((p) => p.id !== inn.lastOverBowler)} side={other(inn.batting)} picked={[]} onPick={setBowler} />
        </div>
      ) : (
        <>
          <div className="si-row" style={{ fontSize: 13.5 }}>
            Bowling: <b>{name(currentBowler)}</b>
            {!midOver ? <button type="button" className="si-link-btn" onClick={() => setBowler("")}>change</button> : null}
          </div>

          <div className="si-chips wrap">
            {EXTRAS.map((x) => <button type="button" key={x.key} className={`si-chip${extra === x.key ? " on" : ""}`} onClick={() => setExtra(extra === x.key ? null : x.key)}>{x.label}</button>)}
            <button type="button" className={`si-chip${wicket ? " on" : ""}`} style={{ color: wicket ? undefined : "var(--si-live)" }} onClick={() => setWicket(wicket ? null : { type: "bowled", player: "", fielder: "" })}>Wicket</button>
          </div>

          {wicket ? (
            <div className="si-ask">
              <div className="si-pad-name">How out?</div>
              <div className="si-chips wrap">
                {WICKETS.filter((w) => moreOut || !w.rare).map((w) => (
                  <button type="button" key={w.key} className={`si-chip${wicket.type === w.key ? " on" : ""}`} onClick={() => setWicket({ ...wicket, type: w.key, fielder: w.fielder ? wicket.fielder : "" })}>{w.label}</button>
                ))}
                {!moreOut ? <button type="button" className="si-chip" onClick={() => setMoreOut(true)}>More…</button> : null}
              </div>
              <div className="si-pad-name">Who is out?</div>
              <div className="si-keys two">
                {[striker!, nonStriker!].map((id) => (
                  <button type="button" key={id} className={`si-key-btn${(wicket.player || striker) === id ? " on" : ""}`} onClick={() => setWicket({ ...wicket, player: id === striker ? "" : id })}>{name(id)}</button>
                ))}
              </div>
              {wk?.fielder ? (
                <>
                  <div className="si-pad-name">{wicket.type === "caught" ? "Caught by" : wicket.type === "stumped" ? "Stumped by" : "Run out by"} (optional)</div>
                  <Pick players={field} side={other(inn.batting)} picked={wicket.fielder ? [wicket.fielder] : []}
                    onPick={(id) => setWicket({ ...wicket, fielder: wicket.fielder === id ? "" : id })} />
                </>
              ) : null}
              <div className="si-muted" style={{ fontSize: 12.5 }}>Then tap the runs completed on this ball (usually 0).</div>
            </div>
          ) : null}

          <div className="si-pad-name">
            {extra === "wide" ? "Runs run on the wide (as well as the penalty)" : extra === "bye" || extra === "leg_bye" ? "Runs run" : extra === "no_ball" ? "Runs off the bat on the no-ball" : "Runs off the bat"}
          </div>
          <div className="si-keys three">
            {[0, 1, 2, 3, 4, 6].map((r) => (
              <button type="button" key={r} className={`si-key-btn big ${wicket ? "warn" : "score"}`} disabled={(extra === "bye" || extra === "leg_bye") && r === 0} onClick={() => deliver(r)}>
                {wicket ? (r ? `OUT +${r}` : "OUT") : r}
              </button>
            ))}
          </div>
        </>
      )}

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
