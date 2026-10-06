"use client";

// Basketball scoring, one hand on a phone. Pick the player (optional),
// then one tap records the event. Shot details (zone, shot type, fast
// break) are optional, apply to the next shot only, and clear after it.
// For a foul, the player selected on the other team is the one fouled.
// The game clock and shot clock run on this device and every event
// carries their readings (see useBasketballClock).

import { useState } from "react";
import type { Participant, Side } from "@/lib/intelligence/core/types";
import { benchOf, bonusFor, eligibleOf, freeThrowLabel, gameRosterOf, periodName, substitutionsLeft, teamFoulsNow, timeoutsLeft, type BasketballRules, type BasketballState } from "@/lib/intelligence/sports/basketball";
import { DEFENSIVE_VIOLATIONS, OFFENSIVE_VIOLATIONS, SHOT_TYPES, SHOT_ZONES, THREE_POINT_ZONES, foulKindName, label, periodSeconds, type ShotType, type ShotZone } from "@/lib/intelligence/sports/basketball/rules";
import { clockReadings, clockText, parseClock } from "@/lib/intelligence/sports/basketball/clock";
import { LineupPicker, PlayerChips, PlayerName, SIDE_KEYS, type PadProps } from "./shared";
import { useBasketballClock, type BasketballClock } from "./useBasketballClock";

const other = (s: Side): Side => (s === "a" ? "b" : "a");

export default function BasketballPad({ contest, send }: PadProps) {
  const s = contest.state as BasketballState;
  const rules = contest.rules as unknown as BasketballRules;
  const sides = contest.context.sides!;
  const [player, setPlayer] = useState<Record<Side, string | null>>({ a: null, b: null });
  const [detail, setDetail] = useState<{ zone: ShotZone | null; shotType: ShotType | null; fastBreak: boolean }>({ zone: null, shotType: null, fastBreak: false });
  // quick substitution: the side being changed, and who was tapped so far
  const [subbing, setSubbing] = useState<{ side: Side; out: string | null; in: string | null } | null>(null);
  const [officials, setOfficials] = useState("");
  const clk = useBasketballClock(contest.id, s, rules);

  // every event carries the clock readings the engine will accept, then the clocks react to it
  const fire = (type: string, payload: Record<string, unknown> = {}) => {
    const readings = clockReadings(s, rules, type, payload, clk.used ? clk.game : null, clk.shotOff ? null : clk.shot);
    send(type, { ...payload, ...readings });
    clk.afterEvent(type, payload);
  };
  const ev = (type: string, side: Side, extra: Record<string, unknown> = {}) =>
    fire(type, { side, ...(player[side] ? { player: player[side] } : {}), ...extra });
  const shot = (type: "SHOT_MADE" | "SHOT_MISSED", side: Side, points: number) => {
    const three = points === rules.threePointValue;
    // a zone that contradicts the value is dropped rather than sent to be refused
    const zoneOk = detail.zone && THREE_POINT_ZONES.includes(detail.zone) === three;
    ev(type, side, { points, ...(zoneOk ? { zone: detail.zone } : {}), ...(detail.shotType ? { shotType: detail.shotType } : {}), ...(detail.fastBreak ? { fastBreak: true } : {}) });
    setDetail({ zone: null, shotType: null, fastBreak: false });
  };
  const startPeriod = () => { send("PERIOD_START"); clk.periodStarted(s.period + 1); };
  const endPeriod = () => { fire("PERIOD_END"); clk.periodEnded(); };
  // both players chosen: record it, and stay open for the next change
  const pickSub = (side: Side, role: "out" | "in", id: string) => {
    const cur = subbing && subbing.side === side ? subbing : { side, out: null, in: null };
    const next = { ...cur, [role]: cur[role] === id ? null : id };
    if (next.out && next.in) {
      fire("SUBSTITUTION", { side, in: next.in, out: next.out });
      if (player[side] === next.out) setPlayer({ ...player, [side]: null });
      setSubbing({ side, out: null, in: null });
    } else setSubbing(next);
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
  // the starting five, chosen once the game roster is settled and before tip-off
  const needsStarters = (side: Side) => s.period === 0 && !needsRoster(side) && !s.onCourt[side] && eligibleOf(s, ctx, side).length > 0;
  const subsLeft = (side: Side) => substitutionsLeft(s, side, rules);

  return (
    <div className="si-pad">
      {s.periodOpen ? (
        <ClockBar clk={clk} period={periodName(s.period, rules)} periodLength={periodSeconds(s.period, rules)} lastRecorded={s.clock}
          resets={rules.shotClockSeconds === null ? [] : [...new Set([rules.shotClockSeconds, rules.shotClockReset ?? rules.shotClockSeconds])]}
          onEnd={endPeriod} />
      ) : (
        <div className="si-row">
          {canStartPeriod
            ? <button type="button" className="si-btn primary" onClick={startPeriod}>Start {periodName(next, rules)}</button>
            : s.period > 0 ? <span className="si-info">All periods played. Complete the match.</span> : null}
          {s.period > 0 ? (
            <button type="button" className="si-btn small" title="To add something that was missed before it ended" onClick={() => send("PERIOD_REOPEN")}>
              Reopen {periodName(s.period, rules)}
            </button>
          ) : null}
          {clk.breakLeft !== null && canStartPeriod ? (
            <span className="si-pad-name" style={clk.breakLeft <= 0 ? { color: "var(--si-live)" } : undefined} aria-live="polite">
              {clk.breakHalftime ? "Half-time" : "Break"} {clk.breakLeft > 0 ? clockText(clk.breakLeft) : "over"}
            </span>
          ) : null}
        </div>
      )}

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

      {SIDE_KEYS.some(needsStarters) ? (
        <div className="si-card si-grid" style={{ gap: 12 }}>
          <div className="si-info">
            Choose each team&apos;s starting five. Optional, but minutes, plus/minus and on-court ratings need lineups.
          </div>
          {SIDE_KEYS.filter(needsStarters).map((side) => (
            <LineupPicker key={side} label={`${sides[side].name} starting five`} players={byIds(side, eligibleOf(s, ctx, side))}
              size={Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length)} action="Save starting five"
              onSave={(ids) => send("LINEUP", { side, players: ids })} />
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
                <span>Team fouls <b className={bonusFor(s, other(side), rules) ? "hot" : ""}>{teamFoulsNow(s, side, rules)}</b> · Timeouts <b>{timeoutsLeft(s, side, rules)}</b>{subsLeft(side) !== null ? <> · Subs <b>{subsLeft(side)}</b></> : null}</span>
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
            <button type="button" className="si-key-btn score big" onClick={() => fire("FREE_THROW_MADE", { side: ftDue.side, ...(ftDue.player ? {} : player[ftDue.side] ? { player: player[ftDue.side] } : {}) })}>Made +{rules.freeThrowValue}</button>
            <button type="button" className="si-key-btn big" onClick={() => fire("FREE_THROW_MISSED", { side: ftDue.side, ...(ftDue.player ? {} : player[ftDue.side] ? { player: player[ftDue.side] } : {}) })}>Missed</button>
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
                {subbing?.side === side ? (
                  <SubPanel court={onCourt(side)} bench={byIds(side, benchOf(s, ctx, side) ?? [])} picked={subbing} badge={badge}
                    left={subsLeft(side)} onPick={(role, id) => pickSub(side, role, id)} onDone={() => setSubbing(null)} />
                ) : (
                  <>
                    <PlayerChips players={onCourt(side)} value={player[side]} onChange={(id) => setPlayer({ ...player, [side]: id })} badge={badge} />
                    {benchOf(s, ctx, side)?.length ? (
                      <div className="si-muted" style={{ fontSize: 12 }}>
                        Bench: {byIds(side, benchOf(s, ctx, side)!).map((p, i) => <span key={p.id}>{i ? ", " : ""}<PlayerName p={p} />{badge(p.id) ? ` (${badge(p.id)})` : ""}</span>)}
                      </div>
                    ) : null}
                  </>
                )}
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
                <div className="si-keys two">
                  <button type="button" className="si-key-btn" disabled={timeoutsLeft(s, side, rules) <= 0} onClick={() => fire("TIMEOUT", { side })}>
                    Timeout ({timeoutsLeft(s, side, rules)} left)
                  </button>
                  <button type="button" className={`si-key-btn${subbing?.side === side ? " on" : ""}`} disabled={!s.onCourt[side] || subsLeft(side) === 0}
                    title={s.onCourt[side] ? undefined : "Set the lineup first (Lineups, below)"}
                    onClick={() => setSubbing(subbing?.side === side ? null : { side, out: null, in: null })}>
                    Substitution{subsLeft(side) !== null ? ` (${subsLeft(side)} left)` : ""}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <details className="si-more">
            <summary>More: jump ball, {foulKindName("unsportsmanlike", rules)} and {foulKindName("disqualifying", rules)} fouls, goaltending, other violations, technical free throws</summary>
            <div className="si-grid" style={{ gap: 10 }}>
              <div className="si-keys two">
                {SIDE_KEYS.map((side) => <button type="button" key={side} className="si-key-btn" onClick={() => fire("JUMP_BALL", { side })}>Jump ball won by {sides[side].name}</button>)}
                {rules.alternatingPossession ? (
                  <button type="button" className="si-key-btn" disabled={!s.arrow} onClick={() => fire("HELD_BALL")}>
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
        <summary>Lineups (for minutes, plus/minus and on-court ratings)</summary>
        <div className="si-grid" style={{ gap: 12 }}>
          {SIDE_KEYS.map((side) => {
            const bench = benchOf(s, ctx, side);
            const size = Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length);
            return (
              <div key={side} className="si-grid" style={{ gap: 6 }}>
                <LineupPicker label={sides[side].name} players={byIds(side, eligibleOf(s, ctx, side))} size={size} onSave={(ids) => fire("LINEUP", { side, players: ids })} />
                <div className="si-muted" style={{ fontSize: 12.5 }}>
                  {gameRosterOf(s, ctx, side).length} dressed{bench ? ` · on court ${s.onCourt[side]!.length} · bench ${bench.length}` : ""}
                </div>
              </div>
            );
          })}
          <div className="si-muted" style={{ fontSize: 12.5 }}>Set a whole new lineup here. For one player at a time, use the Substitution key.</div>
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

/** Two taps: who goes off, who comes on (either order). Stays open for the next change. */
function SubPanel({ court, bench, picked, badge, left, onPick, onDone }: {
  court: Participant[]; bench: Participant[];
  picked: { out: string | null; in: string | null }; badge: (id: string) => string | null; left: number | null;
  onPick: (role: "out" | "in", id: string) => void; onDone: () => void;
}) {
  return (
    <div className="si-grid" style={{ gap: 8 }}>
      <div className="si-muted" style={{ fontSize: 12.5 }}>Going off</div>
      <PlayerChips players={court} value={picked.out} onChange={(id) => id && onPick("out", id)} none={null} badge={badge} />
      <div className="si-muted" style={{ fontSize: 12.5 }}>Coming on</div>
      {bench.length
        ? <PlayerChips players={bench} value={picked.in} onChange={(id) => id && onPick("in", id)} none={null} badge={badge} />
        : <span className="si-info">Nobody left on the bench.</span>}
      <div className="si-row">
        <button type="button" className="si-btn small" onClick={onDone}>Done</button>
        {left !== null ? <span className="si-muted" style={{ fontSize: 12.5 }}>{left} substitution{left === 1 ? "" : "s"} left</span> : null}
      </div>
    </div>
  );
}

/** The period, the running game clock and shot clock, and their controls. Tap a clock to set it. */
function ClockBar({ clk, period, periodLength, lastRecorded, resets, onEnd }: {
  clk: BasketballClock; period: string; periodLength: number; lastRecorded: number | null; resets: number[]; onEnd: () => void;
}) {
  const [editing, setEditing] = useState<"game" | "shot" | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const begin = (which: "game" | "shot") => { setEditing(which); setText(which === "game" ? clockText(clk.game) : String(Math.ceil(clk.shot ?? 0))); setNote(null); };
  const commit = () => {
    const v = parseClock(text);
    if (v === null) { setNote("Type a time like 6:42 or 42"); return; }
    if (editing === "game") {
      clk.setGame(Math.min(v, periodLength));
      setNote(lastRecorded !== null && v > lastRecorded ? `Events already went in at ${clockText(lastRecorded)}. Until the clock runs below that, events are recorded without a time.` : null);
    } else clk.setShot(v);
    setEditing(null);
  };
  const out = clk.game <= 0;
  return (
    <div className="si-grid" style={{ gap: 6 }}>
      <div className="si-clock" aria-label="Game clock">
        <span className="si-clock-period">{period}</span>
        <div className="si-clock-main">
          {editing ? (
            <form className="si-row" onSubmit={(e) => { e.preventDefault(); commit(); }}>
              <input className="si-input si-clock-input" autoFocus inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label={editing === "game" ? "Game clock" : "Shot clock"} />
              <button type="submit" className="si-btn small primary">Set</button>
              <button type="button" className="si-btn small" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : (
            <>
              <button type="button" className={`si-clock-game${out ? " zero" : ""}`} title="Tap to set the game clock" onClick={() => begin("game")}>{clockText(clk.game)}</button>
              {clk.shot !== null ? (
                <button type="button" className={`si-clock-shot${clk.shotOff ? " off" : clk.shot <= 0 ? " zero" : ""}`} title="Tap to set the shot clock" onClick={() => begin("shot")}>
                  {clk.shotOff ? "shot clock off" : Math.ceil(clk.shot)}
                </button>
              ) : null}
            </>
          )}
        </div>
        {out
          ? <button type="button" className="si-btn primary" onClick={onEnd}>End {period}</button>
          : <button type="button" className={`si-btn${clk.running ? "" : " primary"}`} onClick={clk.toggle}>{clk.running ? "Stop" : clk.used ? "Start" : "Start clock"}</button>}
      </div>
      <div className="si-clock-tools">
        {resets.map((r) => <button type="button" key={r} className="si-btn small" onClick={() => clk.setShot(r)}>Shot clock {r}</button>)}
        {!out ? <button type="button" className="si-btn small" onClick={onEnd}>End {period}</button> : null}
      </div>
      {clk.shot !== null && !clk.shotOff && clk.shot <= 0 ? <div className="si-error" role="alert">Shot clock expired. Record the violation, or reset the shot clock.</div> : null}
      {note ? <div className="si-info">{note}</div> : null}
    </div>
  );
}
