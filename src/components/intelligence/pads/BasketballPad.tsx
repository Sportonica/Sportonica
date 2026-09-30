"use client";

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { periodName, type BasketballRules, type BasketballState } from "@/lib/intelligence/sports/basketball";
import { parseDuration } from "@/lib/intelligence/core/util";
import { LineupPicker, PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

export default function BasketballPad({ contest, send }: PadProps) {
  const s = contest.state as BasketballState;
  const rules = contest.rules as unknown as BasketballRules;
  const sides = contest.context.sides!;
  const [player, setPlayer] = useState<Record<Side, string | null>>({ a: null, b: null });
  const [flags, setFlags] = useState<{ paint: boolean; fastBreak: boolean; secondChance: boolean }>({ paint: false, fastBreak: false, secondChance: false });
  const [clock, setClock] = useState("");
  const [sub, setSub] = useState<{ side: Side; in: string; out: string }>({ side: "a", in: "", out: "" });

  // "2:31" -> 151 seconds left; empty means the scorer is not running a clock
  const clockSeconds = (): Record<string, unknown> => {
    const ms = clock.trim() ? parseDuration(clock.trim().includes(":") ? clock.trim() : `0:${clock.trim()}`) : null;
    return ms === null ? {} : { clock: Math.round(ms / 1000) };
  };
  const ev = (type: string, side: Side, extra: Record<string, unknown> = {}) =>
    send(type, { side, ...(player[side] ? { player: player[side] } : {}), ...clockSeconds(), ...extra });
  const made = (side: Side, points: number) => {
    const inside = points === rules.twoPointValue;
    ev("SHOT_MADE", side, { points, ...(flags.paint && inside ? { paint: true } : {}), ...(flags.fastBreak ? { fastBreak: true } : {}), ...(flags.secondChance ? { secondChance: true } : {}) });
    setFlags({ paint: false, fastBreak: false, secondChance: false });
  };

  const next = s.period + 1;
  const level = s.score.a === s.score.b;
  const canStartPeriod = !s.periodOpen && (s.period < rules.periods || level);

  return (
    <div className="si-pad">
      <div className="si-row">
        {s.periodOpen
          ? <button type="button" className="si-btn" onClick={() => send("PERIOD_END", clockSeconds())}>End {periodName(s.period, rules)}</button>
          : canStartPeriod
            ? <button type="button" className="si-btn primary" onClick={() => send("PERIOD_START")}>Start {periodName(next, rules)}</button>
            : <span className="si-info">All periods played. Complete the match.</span>}
        <label className="si-label" style={{ flex: "1 1 120px" }}>Clock left (optional)
          <input className="si-input" inputMode="numeric" placeholder="mm:ss" value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
      </div>

      {s.periodOpen ? (
        <>
          <div className="si-chips" aria-label="Applies to the next basket">
            {([["paint", "In the paint"], ["fastBreak", "Fast break"], ["secondChance", "Second chance"]] as const).map(([k, label]) => (
              <button type="button" key={k} className={`si-chip${flags[k] ? " on" : ""}`} onClick={() => setFlags({ ...flags, [k]: !flags[k] })}>{label}</button>
            ))}
          </div>
          <div className="si-pad-sides">
            {SIDE_KEYS.map((side) => (
              <div key={side} className="si-pad-side">
                <div className="si-pad-name">{sides[side].name}</div>
                <PlayerChips players={s.onCourt[side] ? sides[side].players.filter((p) => s.onCourt[side]!.includes(p.id)) : sides[side].players} value={player[side]} onChange={(id) => setPlayer({ ...player, [side]: id })} />
                <div className="si-keys">
                  <button type="button" className="si-key-btn score" onClick={() => ev("FREE_THROW_MADE", side)}>+{rules.freeThrowValue} FT</button>
                  <button type="button" className="si-key-btn score" onClick={() => made(side, rules.twoPointValue)}>+{rules.twoPointValue}</button>
                  <button type="button" className="si-key-btn score" onClick={() => made(side, rules.threePointValue)}>+{rules.threePointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("FREE_THROW_MISSED", side)}>Miss FT</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT_MISSED", side, { points: rules.twoPointValue })}>Miss {rules.twoPointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("SHOT_MISSED", side, { points: rules.threePointValue })}>Miss {rules.threePointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("REBOUND", side, { offensive: true })}>Off reb</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("REBOUND", side, { offensive: false })}>Def reb</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("ASSIST", side)}>Assist</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("STEAL", side)}>Steal</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("BLOCK", side)}>Block</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("TURNOVER", side)}>Turnover</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ev("FOUL", side, { kind: "personal" })}>Foul</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ev("FOUL", side, { kind: "technical" })}>Tech</button>
                  <button type="button" className="si-key-btn" onClick={() => send("TIMEOUT", { side })}>Timeout</button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <details className="si-more">
        <summary>Lineups and substitutions (for minutes and plus/minus)</summary>
        <div className="si-grid" style={{ gap: 12 }}>
          {SIDE_KEYS.map((side) => <LineupPicker key={side} label={sides[side].name} players={sides[side].players} size={rules.playersOnCourt} onSave={(ids) => send("LINEUP", { side, players: ids })} />)}
          <div className="si-form">
            <label className="si-label">Team
              <select className="si-input" value={sub.side} onChange={(e) => setSub({ side: e.target.value as Side, in: "", out: "" })}>
                {SIDE_KEYS.map((side) => <option key={side} value={side}>{sides[side].name}</option>)}
              </select>
            </label>
            <label className="si-label">Going off
              <select className="si-input" value={sub.out} onChange={(e) => setSub({ ...sub, out: e.target.value })}>
                <option value="">Choose</option>
                {(s.onCourt[sub.side] ?? []).map((id) => <option key={id} value={id}>{sides[sub.side].players.find((p) => p.id === id)?.name}</option>)}
              </select>
            </label>
            <label className="si-label">Coming on
              <select className="si-input" value={sub.in} onChange={(e) => setSub({ ...sub, in: e.target.value })}>
                <option value="">Choose</option>
                {sides[sub.side].players.filter((p) => !(s.onCourt[sub.side] ?? []).includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="si-btn small" disabled={!sub.in || !sub.out} onClick={() => { send("SUBSTITUTION", { side: sub.side, in: sub.in, out: sub.out, ...clockSeconds() }); setSub({ ...sub, in: "", out: "" }); }}>Record substitution</button>
          <div className="si-muted" style={{ fontSize: 12.5 }}>Minutes are only calculated when both lineups are set and every substitution has a clock time.</div>
        </div>
      </details>
    </div>
  );
}
