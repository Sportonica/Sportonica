"use client";

// Football / futsal scoring, one hand on a phone. Pick the player (and,
// for a foul or an assist, the other player), then one tap records the
// event. Goal details are optional and clear after the goal.

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { periodName, type FootballRules, type FootballState } from "@/lib/intelligence/sports/football";
import { LineupPicker, PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

const other = (s: Side): Side => (s === "a" ? "b" : "a");
const GOAL_KINDS: [string, string][] = [["header", "Header"], ["penalty", "Penalty"], ["free_kick", "Free kick"], ["corner", "From a corner"], ["counter_attack", "Counter attack"], ["second_penalty", "Second penalty mark"]];

export default function FootballPad({ contest, send }: PadProps) {
  const s = contest.state as FootballState;
  const rules = contest.rules as unknown as FootballRules;
  const sides = contest.context.sides!;
  const [player, setPlayer] = useState<Record<Side, string | null>>({ a: null, b: null });
  const [kind, setKind] = useState<string | null>(null);
  const [assist, setAssist] = useState<string | null>(null);
  const [minute, setMinute] = useState("");
  const [sub, setSub] = useState<{ side: Side; in: string; out: string }>({ side: "a", in: "", out: "" });

  const min = (): Record<string, unknown> => (/^\d{1,3}$/.test(minute.trim()) ? { minute: Number(minute.trim()) } : {});
  const ev = (type: string, side: Side, extra: Record<string, unknown> = {}) =>
    send(type, { side, ...(player[side] ? { player: player[side] } : {}), ...min(), ...extra });
  const goal = (side: Side) => {
    ev("GOAL", side, { ...(kind ? { kind } : {}), ...(assist && assist !== player[side] ? { assist } : {}) });
    setKind(null); setAssist(null);
  };
  const ownGoal = (bySide: Side) => send("GOAL", { side: other(bySide), ownGoal: true, ...(player[bySide] ? { player: player[bySide] } : {}), ...min() });
  const foul = (side: Side, extra: Record<string, unknown> = {}) => ev("FOUL", side, { ...(player[other(side)] ? { on: player[other(side)] } : {}), ...extra });

  const pitch = (side: Side) => sides[side].players.filter((p) => !s.sentOff[p.id] && (!s.onPitch[side] || s.onPitch[side]!.includes(p.id)));
  const extra = rules.knockoutDecider === "extra_time_then_penalties" && rules.extraTimeMinutes > 0 ? 2 : 0;
  const level = s.score.a === s.score.b;
  const canStart = !s.periodOpen && !s.shootout && (s.period < rules.periods || (rules.knockout && level && s.period < rules.periods + extra));
  const shootoutDue = !s.periodOpen && !s.shootout && rules.knockout && level && s.period >= rules.periods + extra;
  const sh = s.shootout;
  const nextKick: Side | null = sh && !sh.decided ? (sh.kicks.length % 2 === 0 ? sh.first : other(sh.first)) : null;

  return (
    <div className="si-pad">
      <div className="si-row">
        {s.periodOpen
          ? <button type="button" className="si-btn" onClick={() => send("PERIOD_END", min())}>End {periodName(s.period, rules)}</button>
          : canStart
            ? <button type="button" className="si-btn primary" onClick={() => send("PERIOD_START")}>{s.period === 0 ? "Kick off" : `Start ${periodName(s.period + 1, rules)}`}</button>
            : shootoutDue ? <span className="si-info">Level: penalty shootout. Who kicks first?</span>
            : !sh ? <span className="si-info">Full time. Complete the match.</span> : null}
        <label className="si-label" style={{ flex: "0 1 100px" }}>Minute
          <input className="si-input" inputMode="numeric" placeholder="e.g. 34" value={minute} onChange={(e) => setMinute(e.target.value)} />
        </label>
      </div>

      {shootoutDue ? (
        <div className="si-keys two">
          {SIDE_KEYS.map((side) => <button type="button" key={side} className="si-key-btn big" onClick={() => send("SHOOTOUT_START", { first: side })}>{sides[side].name} first</button>)}
        </div>
      ) : null}

      {sh ? (
        <div className="si-card si-grid" style={{ gap: 8 }} aria-live="polite">
          <div className="si-pad-name">Penalties {sh.score.a}-{sh.score.b}{sh.decided ? `: ${sides[sh.decided].name} win` : ""}</div>
          {nextKick ? (
            <>
              <span className="si-muted" style={{ fontSize: 12.5 }}>{sides[nextKick].name} to kick</span>
              <PlayerChips players={pitch(nextKick)} value={player[nextKick]} onChange={(id) => setPlayer({ ...player, [nextKick]: id })} />
              <div className="si-keys two">
                <button type="button" className="si-key-btn score big" onClick={() => { send("SHOOTOUT_KICK", { side: nextKick, scored: true, ...(player[nextKick] ? { player: player[nextKick] } : {}) }); setPlayer({ ...player, [nextKick]: null }); }}>Scored</button>
                <button type="button" className="si-key-btn big" onClick={() => { send("SHOOTOUT_KICK", { side: nextKick, scored: false, ...(player[nextKick] ? { player: player[nextKick] } : {}) }); setPlayer({ ...player, [nextKick]: null }); }}>Missed or saved</button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {s.periodOpen ? (
        <>
          <details className="si-more">
            <summary>Goal details for the next goal (optional){kind ? `: ${GOAL_KINDS.find(([k]) => k === kind)?.[1]}` : ""}</summary>
            <div className="si-chips">
              {GOAL_KINDS.filter(([k]) => k !== "second_penalty" || rules.accumulatedFoulLimit !== null).map(([k, label]) => (
                <button type="button" key={k} className={`si-chip${kind === k ? " on" : ""}`} onClick={() => setKind(kind === k ? null : k)}>{label}</button>
              ))}
            </div>
            <div className="si-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Assist by (same team as the scorer)</div>
            {SIDE_KEYS.map((side) => <PlayerChips key={side} players={pitch(side)} value={assist && pitch(side).some((p) => p.id === assist) ? assist : null} onChange={setAssist} none={sides[side].name} />)}
          </details>

          <div className="si-pad-sides">
            {SIDE_KEYS.map((side) => (
              <div key={side} className="si-pad-side">
                <div className="si-pad-name">{sides[side].name}</div>
                <PlayerChips players={pitch(side)} value={player[side]} onChange={(id) => setPlayer({ ...player, [side]: id })} />
                <button type="button" className="si-key-btn score big" onClick={() => goal(side)}>Goal</button>
                <div className="si-keys">
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "on_target" })}>Shot saved</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "off_target" })}>Shot wide</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "blocked" })}>Blocked</button>
                  <button type="button" className="si-key-btn warn" onClick={() => foul(side)}>Foul</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ev("CARD", side, { color: "yellow" })}>Yellow</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ev("CARD", side, { color: "red" })}>Red</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("CORNER", side)}>Corner</button>
                  {rules.preset !== "futsal" ? <button type="button" className="si-key-btn" onClick={() => ev("OFFSIDE", side)}>Offside</button> : null}
                  <button type="button" className="si-key-btn" onClick={() => ev("PASS", side, { completed: true })}>Pass ✓</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("PASS", side, { completed: false })}>Pass lost</button>
                  {rules.timeoutsPerPeriod ? <button type="button" className="si-key-btn" onClick={() => send("TIMEOUT", { side, ...min() })}>Timeout</button> : null}
                </div>
              </div>
            ))}
          </div>

          <details className="si-more">
            <summary>More: penalties, own goals, woodwork, tackles, interceptions</summary>
            <div className="si-keys two">
              {SIDE_KEYS.map((side) => (
                <div key={side} className="si-grid" style={{ gap: 6 }}>
                  <span className="si-pad-name">{sides[side].name}</span>
                  <button type="button" className="si-key-btn warn" onClick={() => foul(side, { penalty: true })}>Foul: penalty to {sides[other(side)].name}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "on_target", penalty: true })}>Penalty saved</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "off_target", penalty: true })}>Penalty missed</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT", side, { outcome: "woodwork" })}>Hit the woodwork</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ownGoal(side)}>Own goal (by {sides[side].name})</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("TACKLE", side)}>Tackle</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("INTERCEPTION", side)}>Interception</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("PASS", side, { completed: true, key: true })}>Key pass</button>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}

      <details className="si-more">
        <summary>Lineups and substitutions (for minutes played)</summary>
        <div className="si-grid" style={{ gap: 12 }}>
          {s.period === 0 ? SIDE_KEYS.map((side) => <LineupPicker key={side} label={sides[side].name} players={sides[side].players} size={rules.playersOnPitch} onSave={(ids) => send("LINEUP", { side, players: ids })} />)
            : <div className="si-muted" style={{ fontSize: 12.5 }}>Lineups are set before kick-off.</div>}
          <div className="si-form">
            <label className="si-label">Team
              <select className="si-input" value={sub.side} onChange={(e) => setSub({ side: e.target.value as Side, in: "", out: "" })}>
                {SIDE_KEYS.map((side) => <option key={side} value={side}>{sides[side].name}</option>)}
              </select>
            </label>
            <label className="si-label">Going off
              <select className="si-input" value={sub.out} onChange={(e) => setSub({ ...sub, out: e.target.value })}>
                <option value="">Choose</option>
                {(s.onPitch[sub.side] ?? []).map((id) => <option key={id} value={id}>{sides[sub.side].players.find((p) => p.id === id)?.name}</option>)}
              </select>
            </label>
            <label className="si-label">Coming on
              <select className="si-input" value={sub.in} onChange={(e) => setSub({ ...sub, in: e.target.value })}>
                <option value="">Choose</option>
                {sides[sub.side].players.filter((p) => !(s.onPitch[sub.side] ?? []).includes(p.id) && !s.sentOff[p.id]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="si-btn small" disabled={!sub.in || !sub.out} onClick={() => { send("SUBSTITUTION", { side: sub.side, in: sub.in, out: sub.out, ...min() }); setSub({ ...sub, in: "", out: "" }); }}>Record substitution</button>
          <div className="si-muted" style={{ fontSize: 12.5 }}>{rules.maxSubstitutions === null ? "Rolling substitutions: no limit." : `Up to ${rules.maxSubstitutions} substitutions each.`} Minutes played need lineups and a minute on every substitution.</div>
        </div>
      </details>
    </div>
  );
}
