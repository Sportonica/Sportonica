"use client";

// Basketball scoring, one hand on a phone. Pick the player (optional),
// then one tap records the event. Shot details (zone, shot type, fast
// break) are optional, apply to the next shot only, and clear after it.
// For a foul, the player selected on the other team is the one fouled.

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { benchOf, bonusFor, eligibleOf, freeThrowLabel, gameRosterOf, periodName, teamFoulsNow, timeoutsLeft, type BasketballRules, type BasketballState } from "@/lib/intelligence/sports/basketball";
import { DEFENSIVE_VIOLATIONS, OFFENSIVE_VIOLATIONS, SHOT_TYPES, SHOT_ZONES, THREE_POINT_ZONES, foulKindName, label, type ShotType, type ShotZone } from "@/lib/intelligence/sports/basketball/rules";
import { parseDuration } from "@/lib/intelligence/core/util";
import { LineupPicker, PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

const other = (s: Side): Side => (s === "a" ? "b" : "a");

export default function BasketballPad({ contest, send }: PadProps) {
  const s = contest.state as BasketballState;
  const rules = contest.rules as unknown as BasketballRules;
  const sides = contest.context.sides!;
  const [player, setPlayer] = useState<Record<Side, string | null>>({ a: null, b: null });
  const [detail, setDetail] = useState<{ zone: ShotZone | null; shotType: ShotType | null; fastBreak: boolean }>({ zone: null, shotType: null, fastBreak: false });
  const [clock, setClock] = useState("");
  const [shotClock, setShotClock] = useState("");
  const [sub, setSub] = useState<{ side: Side; in: string; out: string }>({ side: "a", in: "", out: "" });
  const [officials, setOfficials] = useState("");

  // "2:31" -> 151 seconds left; empty means the scorer is not running a clock
  const clockSeconds = (): Record<string, unknown> => {
    const text = clock.trim();
    const ms = text ? parseDuration(text.includes(":") ? text : `0:${text}`) : null;
    const sc = shotClock.trim() && rules.shotClockSeconds !== null ? Number(shotClock.trim()) : null;
    return { ...(ms === null ? {} : { clock: Math.round(ms / 1000) }), ...(sc !== null && Number.isInteger(sc) ? { shotClock: sc } : {}) };
  };
  const ev = (type: string, side: Side, extra: Record<string, unknown> = {}) =>
    send(type, { side, ...(player[side] ? { player: player[side] } : {}), ...clockSeconds(), ...extra });
  const shot = (type: "SHOT_MADE" | "SHOT_MISSED", side: Side, points: number) => {
    const three = points === rules.threePointValue;
    // a zone that contradicts the value is dropped rather than sent to be refused
    const zoneOk = detail.zone && THREE_POINT_ZONES.includes(detail.zone) === three;
    ev(type, side, { points, ...(zoneOk ? { zone: detail.zone } : {}), ...(detail.shotType ? { shotType: detail.shotType } : {}), ...(detail.fastBreak ? { fastBreak: true } : {}) });
    setDetail({ zone: null, shotType: null, fastBreak: false });
    setShotClock("");
  };
  // the common violations get a key; the rest are under More
  const quickViolations = ["traveling", "double_dribble", "three_seconds", ...(rules.shotClockSeconds !== null ? ["shot_clock"] : [])];
  const ftDue = s.freeThrows[0] ?? null;
  const foul = (side: Side, kind: string, freeThrows?: number) =>
    ev("FOUL", side, { kind, ...(player[other(side)] ? { on: player[other(side)] } : {}), ...(freeThrows !== undefined ? { freeThrows } : {}) });

  const next = s.period + 1;
  const level = s.score.a === s.score.b;
  const canStartPeriod = !s.periodOpen && (s.period < rules.periods || (level && !rules.allowTie));
  const fouls = (id: string) => s.players[id]?.pf ?? 0;
  const badge = (id: string) => (s.out[id] ? (s.out[id] === "fouled_out" ? "out" : "DQ") : fouls(id) ? `${fouls(id)}f` : null);
  const ctx = contest.context;
  const byIds = (side: Side, ids: string[]) => sides[side].players.filter((p) => ids.includes(p.id));
  const onCourt = (side: Side) => byIds(side, s.onCourt[side] ?? eligibleOf(s, ctx, side));
  const needsRoster = (side: Side) => s.period === 0 && !s.gameRoster[side] && sides[side].players.length > rules.gameRosterSize;

  return (
    <div className="si-pad">
      <div className="si-row">
        {s.periodOpen
          ? <button type="button" className="si-btn" onClick={() => send("PERIOD_END", clockSeconds())}>End {periodName(s.period, rules)}</button>
          : canStartPeriod
            ? <button type="button" className="si-btn primary" onClick={() => send("PERIOD_START")}>Start {periodName(next, rules)}</button>
            : <span className="si-info">All periods played. Complete the match.</span>}
        <label className="si-label" style={{ flex: "1 1 110px" }}>Game clock (optional)
          <input className="si-input" inputMode="numeric" placeholder="mm:ss" value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
        {rules.shotClockSeconds !== null ? (
          <label className="si-label" style={{ flex: "0 1 90px" }}>Shot clock
            <input className="si-input" inputMode="numeric" placeholder={String(rules.shotClockSeconds)} value={shotClock} onChange={(e) => setShotClock(e.target.value)} />
          </label>
        ) : null}
      </div>

      {SIDE_KEYS.some(needsRoster) ? (
        <div className="si-card si-grid" style={{ gap: 12 }}>
          <div className="si-info">
            A team dresses {rules.gameRosterSize} players for a game: {rules.playersOnCourt} on court and {rules.gameRosterSize - rules.playersOnCourt} substitutes.
            Choose them before tip-off.
          </div>
          {SIDE_KEYS.filter(needsRoster).map((side) => (
            <LineupPicker key={side} label={`${sides[side].name} game roster`} players={sides[side].players} size={rules.gameRosterSize} min={rules.playersOnCourt}
              action="Save game roster" onSave={(ids) => send("ROSTER", { side, players: ids })} />
          ))}
        </div>
      ) : null}

      {s.period > 0 ? (
        <div className="si-status-strip" aria-label="Fouls and timeouts">
          {SIDE_KEYS.map((side) => {
            const b = bonusFor(s, side, rules);
            return (
              <div key={side}>
                <span>{sides[side].name}{s.ball === side && s.periodOpen ? " · has the ball" : ""}</span>
                <span>Team fouls <b className={bonusFor(s, other(side), rules) ? "hot" : ""}>{teamFoulsNow(s, side, rules)}</b> · Timeouts <b>{timeoutsLeft(s, side, rules)}</b></span>
                {b ? <span className="hot">{b === "double" ? "Double bonus" : "In the bonus"}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {s.periodOpen && ftDue ? (
        <div className="si-card si-grid" style={{ gap: 8 }} aria-live="polite">
          <div className="si-pad-name">{freeThrowLabel(ftDue, contest.context)}</div>
          <div className="si-muted" style={{ fontSize: 12.5 }}>{ftDue.reason}</div>
          <div className="si-keys two">
            <button type="button" className="si-key-btn score big" onClick={() => send("FREE_THROW_MADE", { side: ftDue.side, ...(ftDue.player ? {} : player[ftDue.side] ? { player: player[ftDue.side] } : {}), ...clockSeconds() })}>Made +{rules.freeThrowValue}</button>
            <button type="button" className="si-key-btn big" onClick={() => send("FREE_THROW_MISSED", { side: ftDue.side, ...(ftDue.player ? {} : player[ftDue.side] ? { player: player[ftDue.side] } : {}), ...clockSeconds() })}>Missed</button>
          </div>
        </div>
      ) : null}

      {s.periodOpen ? (
        <>
          <details className="si-more">
            <summary>Shot details for the next shot (optional){detail.zone || detail.shotType || detail.fastBreak ? `: ${[detail.zone && label(detail.zone), detail.shotType && label(detail.shotType), detail.fastBreak && "fast break"].filter(Boolean).join(", ")}` : ""}</summary>
            <div className="si-grid" style={{ gap: 8 }}>
              <div className="si-chips" aria-label="Zone">
                {SHOT_ZONES.map((z) => <button type="button" key={z} className={`si-chip${detail.zone === z ? " on" : ""}`} onClick={() => setDetail({ ...detail, zone: detail.zone === z ? null : z })}>{label(z)}</button>)}
              </div>
              <div className="si-chips" aria-label="Shot type">
                {SHOT_TYPES.map((t) => <button type="button" key={t} className={`si-chip${detail.shotType === t ? " on" : ""}`} onClick={() => setDetail({ ...detail, shotType: detail.shotType === t ? null : t })}>{label(t)}</button>)}
              </div>
              <div className="si-chips">
                <button type="button" className={`si-chip${detail.fastBreak ? " on" : ""}`} onClick={() => setDetail({ ...detail, fastBreak: !detail.fastBreak })}>Fast break</button>
              </div>
            </div>
          </details>

          <div className="si-pad-sides">
            {SIDE_KEYS.map((side) => (
              <div key={side} className="si-pad-side">
                <div className="si-pad-name">{sides[side].name}</div>
                <PlayerChips players={onCourt(side)} value={player[side]} onChange={(id) => setPlayer({ ...player, [side]: id })} badge={badge} />
                <div className="si-keys">
                  <button type="button" className="si-key-btn score" onClick={() => ev("FREE_THROW_MADE", side)}>+{rules.freeThrowValue} FT</button>
                  <button type="button" className="si-key-btn score" onClick={() => shot("SHOT_MADE", side, rules.twoPointValue)}>+{rules.twoPointValue}</button>
                  <button type="button" className="si-key-btn score" onClick={() => shot("SHOT_MADE", side, rules.threePointValue)}>+{rules.threePointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("FREE_THROW_MISSED", side)}>Miss FT</button>
                  <button type="button" className="si-key-btn" onClick={() => shot("SHOT_MISSED", side, rules.twoPointValue)}>Miss {rules.twoPointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => shot("SHOT_MISSED", side, rules.threePointValue)}>Miss {rules.threePointValue}</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("REBOUND", side, { offensive: true })}>Off reb</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("REBOUND", side, { offensive: false })}>Def reb</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("ASSIST", side)}>Assist</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("STEAL", side)}>Steal</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("BLOCK", side)}>Block</button>
                  <button type="button" className="si-key-btn" onClick={() => ev("TURNOVER", side)}>Turnover</button>
                </div>
                <div className="si-keys" aria-label={`${sides[side].name} fouls`}>
                  <button type="button" className="si-key-btn warn" title="Free throws follow the bonus rules" onClick={() => foul(side, "personal")}>Foul</button>
                  <button type="button" className="si-key-btn warn" title="Record the shot first: a made shot gives 1 (and-one), a miss gives its value" onClick={() => foul(side, "shooting")}>Shooting foul</button>
                  <button type="button" className="si-key-btn warn" onClick={() => foul(side, "offensive", 0)}>Offensive</button>
                  <button type="button" className="si-key-btn warn" onClick={() => ev("FOUL", side, { kind: "technical" })}>Technical</button>
                </div>
                <div className="si-keys" aria-label={`${sides[side].name} violations`}>
                  {quickViolations.map((k) => (
                    <button type="button" key={k} className="si-key-btn" onClick={() => ev("VIOLATION", side, { kind: k })}>{label(k)}</button>
                  ))}
                  <button type="button" className="si-key-btn" onClick={() => ev("OUT_OF_BOUNDS", side)}>Out of bounds</button>
                </div>
                <button type="button" className="si-key-btn" disabled={timeoutsLeft(s, side, rules) <= 0} onClick={() => send("TIMEOUT", { side, ...clockSeconds() })}>
                  Timeout ({timeoutsLeft(s, side, rules)} left)
                </button>
              </div>
            ))}
          </div>

          <details className="si-more">
            <summary>More: jump ball, {foulKindName("unsportsmanlike", rules)} and {foulKindName("disqualifying", rules)} fouls, goaltending, other violations, technical free throws</summary>
            <div className="si-grid" style={{ gap: 10 }}>
              <div className="si-keys two">
                {SIDE_KEYS.map((side) => <button type="button" key={side} className="si-key-btn" onClick={() => send("JUMP_BALL", { side, ...clockSeconds() })}>Jump ball won by {sides[side].name}</button>)}
                {rules.alternatingPossession ? (
                  <button type="button" className="si-key-btn" disabled={!s.arrow} onClick={() => send("HELD_BALL", clockSeconds())}>
                    Held ball{s.arrow ? ` (arrow: ${sides[s.arrow].name})` : ""}
                  </button>
                ) : null}
              </div>
              <div className="si-keys two">
                {SIDE_KEYS.map((side) => (
                  <div key={side} className="si-grid" style={{ gap: 6 }}>
                    <span className="si-pad-name">{sides[side].name}</span>
                    <button type="button" className="si-key-btn warn" onClick={() => foul(side, "unsportsmanlike")}>{label(foulKindName("unsportsmanlike", rules))} foul</button>
                    <button type="button" className="si-key-btn warn" onClick={() => foul(side, "disqualifying")}>{label(foulKindName("disqualifying", rules))} foul</button>
                    <button type="button" className="si-key-btn warn" onClick={() => foul(side, "shooting", 2)}>Shooting foul, 2 FT</button>
                    <button type="button" className="si-key-btn warn" onClick={() => foul(side, "shooting", 3)}>Shooting foul, 3 FT</button>
                    {[rules.twoPointValue, rules.threePointValue].map((pts) => (
                      <button type="button" key={pts} className="si-key-btn warn" onClick={() => ev("GOALTENDING", side, { points: pts, ...(player[other(side)] ? { shooter: player[other(side)] } : {}) })}>
                        Goaltending: {pts} to {sides[other(side)].name}
                      </button>
                    ))}
                    {[...OFFENSIVE_VIOLATIONS, ...DEFENSIVE_VIOLATIONS].filter((k) => !quickViolations.includes(k)).map((k) => (
                      <button type="button" key={k} className="si-key-btn" onClick={() => ev("VIOLATION", side, { kind: k })}>{label(k)}</button>
                    ))}
                    <button type="button" className="si-key-btn" onClick={() => ev("FREE_THROW_MADE", side, { technical: true })}>Technical FT made</button>
                    <button type="button" className="si-key-btn" onClick={() => ev("FREE_THROW_MISSED", side, { technical: true })}>Technical FT missed</button>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </>
      ) : null}

      <details className="si-more">
        <summary>Lineups and substitutions (for minutes, plus/minus and on-court ratings)</summary>
        <div className="si-grid" style={{ gap: 12 }}>
          {SIDE_KEYS.map((side) => {
            const bench = benchOf(s, ctx, side);
            const size = Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length);
            return (
              <div key={side} className="si-grid" style={{ gap: 6 }}>
                <LineupPicker label={sides[side].name} players={byIds(side, eligibleOf(s, ctx, side))} size={size} onSave={(ids) => send("LINEUP", { side, players: ids })} />
                <div className="si-muted" style={{ fontSize: 12.5 }}>
                  {gameRosterOf(s, ctx, side).length} dressed{bench ? ` · on court ${s.onCourt[side]!.length} · bench ${bench.length}: ${byIds(side, bench).map((p) => p.name).join(", ") || "none"}` : ""}
                </div>
              </div>
            );
          })}
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
                {byIds(sub.side, benchOf(s, ctx, sub.side) ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" className="si-btn small" disabled={!sub.in || !sub.out} onClick={() => { send("SUBSTITUTION", { side: sub.side, in: sub.in, out: sub.out, ...clockSeconds() }); setSub({ ...sub, in: "", out: "" }); }}>Record substitution</button>
          <div className="si-muted" style={{ fontSize: 12.5 }}>Minutes are only calculated when both lineups are set and every substitution has a clock time.</div>
        </div>
      </details>

      <details className="si-more">
        <summary>Officials{s.officials.length ? `: ${s.officials.join(", ")}` : ""}</summary>
        <div className="si-row">
          <input className="si-input" style={{ flex: 1 }} placeholder="Names, separated by commas" value={officials} onChange={(e) => setOfficials(e.target.value)} />
          <button type="button" className="si-btn small" disabled={!officials.trim()} onClick={() => { send("OFFICIALS", { names: officials.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 5) }); setOfficials(""); }}>Save</button>
        </div>
      </details>
    </div>
  );
}
