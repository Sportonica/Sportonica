"use client";

// Cricket scoring, ball by ball. The batters and bowler are always on
// screen, a ball is one tap on its runs, extras apply to the next tap,
// and a wicket opens a sheet. Players are jersey tiles, not lists.

import { useState } from "react";
import type { MatchContext, Participant, Side } from "@/lib/intelligence/core/types";
import type { TimelineEntry } from "@/lib/intelligence/types";
import { superOverBatting, type CricketRules, type CricketState } from "@/lib/intelligence/sports/cricket";
import { bowlerLine, describeDelivery, openInnings, overComplete, parseBallLabel, thisOver, type DeliveryPayload } from "@/lib/intelligence/sports/cricketView";
import { Balls, BattersPanel, BowlerPanel } from "../cricket/parts";
import { EXTRA_LABEL, WicketSheet, deliveryPayload, type Extra, type WicketInput } from "../cricket/sheets";
import { Jersey, SIDE_KEYS, teamColor, type PadProps } from "./shared";

const other = (s: Side): Side => (s === "a" ? "b" : "a");
const EXTRA_KEYS: { key: Extra; short: string }[] = [
  { key: "wide", short: "WD" }, { key: "no_ball", short: "NB" }, { key: "bye", short: "B" }, { key: "leg_bye", short: "LB" },
];

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

/** "Undo last ball", with the ball named on a second tap instead of a pop-up. */
function UndoButton({ undo, ctx }: { undo: NonNullable<PadProps["undo"]>; ctx: MatchContext }) {
  const [pending, setPending] = useState<TimelineEntry | null>(null);
  const [looking, setLooking] = useState(false);
  if (pending) {
    const at = parseBallLabel(pending.label);
    const what = pending.type === "DELIVERY" ? `${at ? `${at.ball} ` : ""}${describeDelivery(pending.payload as DeliveryPayload, ctx).headline.toLowerCase()}` : pending.text;
    return (
      <div className="ck-undo-confirm">
        <button type="button" className="ck-undo on" onClick={() => { undo.run(pending); setPending(null); }}>Undo {what}</button>
        <button type="button" className="ck-link" onClick={() => setPending(null)}>Keep</button>
      </div>
    );
  }
  return (
    <button type="button" className="ck-undo" disabled={undo.disabled || looking}
      onClick={async () => { setLooking(true); try { setPending(await undo.last()); } finally { setLooking(false); } }}>
      {looking ? "Finding last ball…" : "Undo last ball"}
    </button>
  );
}

/**
 * Overs per innings for this match. Before the first ball it replaces the
 * tournament's number; during the first innings it shortens (or extends)
 * this innings and the next one. Recorded as an event, so Undo reverses it.
 */
function OversEditor({ current, bowledBalls, ballsPerOver, onSave }: {
  current: number; bowledBalls: number; ballsPerOver: number; onSave: (overs: number, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [overs, setOvers] = useState(current);
  const [reason, setReason] = useState("");
  const min = Math.max(1, Math.ceil(bowledBalls / ballsPerOver));
  if (!open) {
    return (
      <div className="ck-overs-line">
        <span><span className="ck-label">Overs per innings</span> <b>{current}</b></span>
        <button type="button" className="ck-link" onClick={() => { setOvers(current); setOpen(true); }}>Change</button>
      </div>
    );
  }
  const ends = bowledBalls > 0 && overs * ballsPerOver === bowledBalls;
  return (
    <div className="si-ask">
      <div className="si-pad-name">Overs per innings for this match</div>
      <div className="ck-stepper">
        <button type="button" className="ck-key small" disabled={overs <= min} onClick={() => setOvers((o) => Math.max(min, o - 1))} aria-label="One over fewer">−</button>
        <input className="si-input" inputMode="numeric" value={overs} aria-label="Overs per innings"
          onChange={(e) => setOvers(Math.min(200, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)))} />
        <button type="button" className="ck-key small" disabled={overs >= 200} onClick={() => setOvers((o) => Math.min(200, o + 1))} aria-label="One over more">+</button>
      </div>
      {bowledBalls ? <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional): rain delay" /> : null}
      {ends ? <div className="si-error">That is the overs already bowled: the innings ends now.</div> : null}
      <div className="si-row">
        <button type="button" className="si-btn primary" disabled={overs < min || overs === current}
          onClick={() => { onSave(overs, reason.trim()); setOpen(false); setReason(""); }}>Set {overs} over{overs === 1 ? "" : "s"}</button>
        <button type="button" className="ck-link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** The two batters for a super over; the batting side is the rules' (superOverBatting). */
function SuperOverStart({ side, sides, second, onStart }: {
  side: Side; sides: NonNullable<PadProps["contest"]["context"]["sides"]>; second: boolean; onStart: (striker: string, nonStriker: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur));
  return (
    <div className="si-ask">
      <div className="si-pad-name">{second ? "Super over, second half" : "Super over"}: {sides[side].name} bat. Tap their two batters, striker first</div>
      <Pick players={sides[side].players} side={side} picked={picked} onPick={toggle}
        note={(id) => (picked[0] === id ? "on strike" : picked[1] === id ? "non-striker" : null)} />
      <div className="ck-muted" style={{ fontSize: 12.5 }}>One over each, two wickets end it. It decides the winner but adds nothing to the match totals or anyone&apos;s figures.</div>
      <button type="button" className="si-btn primary si-big-btn" disabled={picked.length !== 2} onClick={() => { onStart(picked[0], picked[1]); setPicked([]); }}>
        Start super over
      </button>
    </div>
  );
}

export default function CricketPad({ contest, send, undo }: PadProps) {
  const s = contest.state as CricketState;
  const rules = contest.rules as unknown as CricketRules;
  const ctx = contest.context;
  const sides = ctx.sides!;
  const inn = openInnings(s);
  const [superOver, setSuperOver] = useState(false);

  const [batting, setBatting] = useState<Side | null>(null);
  const [openers, setOpeners] = useState<string[]>([]);
  const [followOn, setFollowOn] = useState(false);
  const [bowler, setBowler] = useState("");
  const [swapped, setSwapped] = useState(false);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [wicketOpen, setWicketOpen] = useState(false);
  const [note, setNote] = useState("");

  const matchOvers = rules.oversPerInnings === null ? null : s.oversLimit ?? rules.oversPerInnings;
  const changeOvers = (overs: number, reason: string) => send("OVERS_CHANGE", { overs, ...(reason ? { reason } : {}) });
  const undoRow = undo ? <div className="ck-pad-foot"><UndoButton undo={undo} ctx={ctx} /></div> : null;

  const soBat = superOverBatting(s);
  const startSuperOver = (striker: string, nonStriker: string) => { send("SUPER_OVER_START", { batting: soBat, striker, nonStriker }); setSuperOver(false); setBowler(""); };

  // level scores in a limited-overs match: settle it with a super over, or accept the tie
  if (s.result?.outcome === "tie" && rules.oversPerInnings !== null && soBat) {
    return (
      <div className="si-pad">
        <div className="ck-tied">
          <b>{s.superOvers?.length ? "The super over is tied too." : "Scores level: the match is tied."}</b>
          <span className="ck-muted" style={{ fontSize: 13 }}>Play {s.superOvers?.length ? "another" : "a"} super over to find a winner, or tap Complete match to leave it as a tie.</span>
          {!superOver ? <button type="button" className="si-btn primary" style={{ justifySelf: "start" }} onClick={() => setSuperOver(true)}>Play a super over</button> : null}
        </div>
        {superOver ? <SuperOverStart side={soBat} sides={sides} second={false} onStart={startSuperOver} /> : null}
        {undoRow}
      </div>
    );
  }
  if (s.result) return <><div className="si-info">The match is decided. Tap Complete match, or edit a ball in the commentary if the result is wrong.</div>{undoRow}</>;

  // between the two halves of a super over
  if (!inn && s.superOvers?.length && soBat) {
    return <div className="si-pad"><SuperOverStart side={soBat} sides={sides} second onStart={startSuperOver} />{undoRow}</div>;
  }

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
        {!s.innings.length && matchOvers !== null ? <OversEditor current={matchOvers} bowledBalls={0} ballsPerOver={rules.ballsPerOver} onSave={changeOvers} /> : null}
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
        {undoRow}
      </div>
    );
  }

  const bat = sides[inn.batting].players, field = sides[other(inn.batting)].players;
  const name = (id: string | null) => [...bat, ...field].find((p) => p.id === id)?.name ?? "";
  const available = bat.filter((p) => !inn.batters[p.id]?.out && p.id !== inn.striker && p.id !== inn.nonStriker);

  // ── a batter is needed ──
  if (!inn.striker || !inn.nonStriker) {
    return (
      <div className="si-pad">
        <div className="si-ask">
          <div className="si-pad-name">Who comes in? Tap the next batter</div>
          <Pick players={available} side={inn.batting} picked={[]} onPick={(id) => send("NEW_BATTER", { player: id })}
            note={(id) => (inn.batters[id]?.retiredHurt ? "returning" : null)} />
          <button type="button" className="si-btn" style={{ justifySelf: "start" }} onClick={() => send("INNINGS_END", { reason: "No batters left" })}>No batters left: end innings</button>
        </div>
        {undoRow}
      </div>
    );
  }

  // the engine says who is on strike; the scorer can swap before the ball
  const striker = (swapped ? inn.nonStriker : inn.striker)!;
  const nonStriker = (swapped ? inn.striker : inn.nonStriker)!;
  const shown = { ...inn, striker, nonStriker };
  const over = thisOver(inn);
  const midOver = !!over && !overComplete(over, rules);
  // the bowler picked for the last over cannot bowl the next one: ask again rather than keep a stale pick
  const currentBowler = midOver ? over.bowler : bowler && bowler !== inn.lastOverBowler ? bowler : "";
  const base = { striker, nonStriker, bowler: currentBowler };

  const reset = () => { setExtra(null); setNote(""); setSwapped(false); };
  const deliver = (runs: number) => { send("DELIVERY", deliveryPayload(base, runs, extra, null, note)); reset(); };
  const recordWicket = (w: WicketInput) => {
    send("DELIVERY", deliveryPayload(base, w.runs, extra, { type: w.type, player: w.player, fielder: w.fielder }, note));
    if (w.newBatter) send("NEW_BATTER", { player: w.newBatter });
    setWicketOpen(false); reset();
  };
  // a new batter is asked for only when this ball cannot end the innings
  const canBringIn = (w: WicketInput) => {
    if (inn.wickets + 1 >= (inn.maxWickets ?? rules.wicketsPerInnings)) return false;
    const legal = !((extra === "wide" && rules.wideRebowled) || (extra === "no_ball" && rules.noBallRebowled));
    if (legal && inn.maxBalls !== null && inn.balls + 1 >= inn.maxBalls) return false;
    const penalty = extra === "wide" ? rules.wideRuns : extra === "no_ball" ? rules.noBallRuns : 0;
    if (inn.target !== null && inn.runs + w.runs + penalty >= inn.target) return false;
    return true;
  };

  const maxBalls = rules.maxOversPerBowler === null ? null : rules.maxOversPerBowler * rules.ballsPerOver;
  const canBowl = field.filter((p) => p.id !== inn.lastOverBowler && (maxBalls === null || (inn.bowlers[p.id]?.balls ?? 0) < maxBalls));
  const runLabel = extra === "wide" ? "Runs run on the wide" : extra === "bye" || extra === "leg_bye" ? `Runs run (${EXTRA_LABEL[extra].toLowerCase()}s)` : extra === "no_ball" ? "Runs off the bat on the no ball" : null;

  return (
    <div className="si-pad ck-pad">
      <div className="ck-pad-info">
        <BattersPanel inn={shown} ctx={ctx} onSwap={() => setSwapped((v) => !v)} />
        <BowlerPanel inn={{ ...shown, bowler: currentBowler || null }} ctx={ctx} rules={rules} />
      </div>

      {!currentBowler ? (
        <>
          {over && overComplete(over, rules) ? (
            <section className="ck-endover">
              <div className="ck-label">End of over {over.n}</div>
              <div className="ck-endover-row">
                <span className="ck-endover-score">{sides[inn.batting].name} <b>{inn.runs}/{inn.wickets}</b> <span className="ck-muted">after {inn.overs.length} ov</span></span>
                <span><b>{over.runs}</b> run{over.runs === 1 ? "" : "s"}{over.wickets ? `, ${over.wickets} wkt` : ""}</span>
              </div>
              <Balls balls={over.balls} />
            </section>
          ) : null}
          <div className="si-ask">
            <div className="si-pad-name">Who bowls {over && overComplete(over, rules) ? `over ${over.n + 1}` : "this over"}? Tap the bowler</div>
            <Pick players={canBowl} side={other(inn.batting)} picked={[]} onPick={setBowler}
              note={(id) => { const b = bowlerLine(inn, id, ctx, rules); return b ? `${b.overs}-${b.runs}-${b.wickets}` : null; }} />
            {canBowl.length < field.length ? (
              <div className="ck-muted" style={{ fontSize: 12.5 }}>
                Not shown: {field.filter((p) => !canBowl.includes(p)).map((p) => `${p.name} (${p.id === inn.lastOverBowler ? "bowled the last over" : "no overs left"})`).join(", ")}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {!midOver ? (
            <div className="ck-muted" style={{ fontSize: 13 }}>
              New over from <b>{name(currentBowler)}</b> <button type="button" className="ck-link" onClick={() => setBowler("")}>change</button>
            </div>
          ) : null}

          <div className={`ck-runs${extra ? " with-extra" : ""}`}>
            {runLabel ? <div className="ck-runs-label">{runLabel}</div> : null}
            {[0, 1, 2, 3, 4, 6].map((r) => (
              <button type="button" key={r} className={`ck-key r${r}`} disabled={(extra === "bye" || extra === "leg_bye") && r === 0} onClick={() => deliver(r)}>
                {extra ? <small>{EXTRA_KEYS.find((x) => x.key === extra)!.short}{r ? "+" : ""}</small> : null}{extra && r === 0 ? "" : r}
              </button>
            ))}
          </div>

          <div className="ck-extras-keys">
            {EXTRA_KEYS.map((x) => (
              <button type="button" key={x.key} aria-pressed={extra === x.key} className={`ck-key small${extra === x.key ? " on" : ""}`} onClick={() => setExtra(extra === x.key ? null : x.key)}>
                {EXTRA_LABEL[x.key]}
              </button>
            ))}
            <button type="button" className="ck-key small wicket" onClick={() => setWicketOpen(true)}>Wicket</button>
          </div>
          {extra ? <div className="ck-muted" style={{ fontSize: 12.5 }}>{EXTRA_LABEL[extra]} applies to the next tap. Tap it again to cancel.</div> : null}
        </>
      )}

      {undoRow}

      <details className="si-more">
        <summary>{inn.target === null && matchOvers !== null && !inn.superOver ? "Change overs, commentary, retirements, penalties" : "Commentary note, retirements, penalties and innings"}</summary>
        <div className="si-grid" style={{ gap: 10 }}>
          {inn.target === null && matchOvers !== null && !inn.superOver ? (
            <OversEditor current={inn.maxBalls === null ? matchOvers : inn.maxBalls / rules.ballsPerOver} bowledBalls={inn.balls} ballsPerOver={rules.ballsPerOver} onSave={changeOvers} />
          ) : null}
          <label className="si-label">Commentary for the next ball
            <input className="si-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional: driven through the covers" />
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

      {wicketOpen ? (
        <WicketSheet striker={striker} nonStriker={nonStriker} extra={extra}
          fielders={field} fieldingSide={other(inn.batting)} battingSide={inn.batting} available={available}
          name={name} canBringIn={canBringIn} onRecord={recordWicket} onClose={() => setWicketOpen(false)} />
      ) : null}
    </div>
  );
}
