"use client";

// Basketball scoring, one hand on a phone. Pick the player (optional),
// then one tap records the event. Shot details (zone, shot type, fast
// break) are optional, apply to the next shot only, and clear after it.
// For a foul, the player selected on the other team is the one fouled.
// The game clock and shot clock run on this device and every event
// carries their readings (see useBasketballClock).

import { useEffect, useState } from "react";
import type { Participant, Side } from "@/lib/intelligence/core/types";
import { benchOf, bonusFor, eligibleOf, freeThrowLabel, gameRosterOf, periodName, substitutionsLeft, teamFoulsNow, timeoutsLeft, type BasketballRules, type BasketballState } from "@/lib/intelligence/sports/basketball";
import { DEFENSIVE_VIOLATIONS, OFFENSIVE_VIOLATIONS, SHOT_TYPES, SHOT_ZONES, THREE_POINT_ZONES, foulKindName, label, periodSeconds, type ShotType, type ShotZone } from "@/lib/intelligence/sports/basketball/rules";
import { clockReadings, clockText, parseClock } from "@/lib/intelligence/sports/basketball/clock";
import { Jersey, LineupPicker, PlayerChips, PlayerName, SIDE_KEYS, teamColor, type PadProps } from "./shared";
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
  // simple mode (the default): big +1/+2/+3, then who did it. Full stats adds rebounds, assists, misses and the rest.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { try { setFull(localStorage.getItem("si-bb-full") === "1"); } catch { /* default: simple */ } }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggleFull = () => { const v = !full; setFull(v); try { localStorage.setItem("si-bb-full", v ? "1" : "0"); } catch { /* not remembered */ } };
  // simple mode: the key tapped, waiting for who did it
  const [ask, setAsk] = useState<{ side: Side; what: "1" | "2" | "3" | "foul" } | null>(null);
  const [foulKind, setFoulKind] = useState<"personal" | "andone" | "shooting2" | "shooting3" | "technical">("personal");
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
  // starting a period starts its clock too: one tap
  const startPeriod = () => { send("PERIOD_START"); clk.periodStarted(s.period + 1, true); };
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
  const finishable = !s.periodOpen && s.period >= rules.periods && !canStartPeriod;
  // a game can be finished at any point once it has started: early if quarters are left (local games run short)
  const finishGame = () => {
    const score = `${sides.a.name} ${s.score.a} – ${s.score.b} ${sides.b.name}`;
    if (level && !rules.allowTie) { window.alert(`The score is level (${score}). A basketball game can't end level: play on until one team leads.`); return; }
    if (finishable) { if (window.confirm(`Finish the game? ${score}`)) send("MATCH_COMPLETE"); return; }
    const left = rules.periods - s.period + (s.periodOpen ? 1 : 0);
    if (!window.confirm(`End the game now at ${score}?\n${left} ${rules.periods === 4 ? "quarter" : "period"}${left === 1 ? "" : "s"} will not be played.`)) return;
    if (s.periodOpen) { fire("PERIOD_END"); clk.periodEnded(); }
    send("GAME_END_EARLY", { reason: "Ended early by the scorer" });
    send("MATCH_COMPLETE");
  };

  // a game to a target (3x3: 21, or 2 points in overtime) is over the moment a team gets there
  const overtime = s.period > rules.periods;
  const target = (overtime ? rules.overtimeTargetPoints : rules.targetScore) ?? null;
  const pointsNow = (side: Side) => (overtime ? s.byPeriod[side][s.period - 1] ?? 0 : s.score[side]);
  const reached = s.periodOpen && target ? SIDE_KEYS.find((x) => pointsNow(x) >= target) ?? null : null;
  const endAtTarget = () => {
    if (!reached) return;
    const why = overtime ? `${sides[reached].name} scored ${target} in overtime` : `${sides[reached].name} reached ${target}`;
    fire("PERIOD_END"); clk.periodEnded();
    send("GAME_END_EARLY", { reason: why });
    send("MATCH_COMPLETE");
  };

  // simple mode: record what was tapped, for the player picked (or nobody)
  const answer = (who: string | null, now: { side: Side; what: "1" | "2" | "3" | "foul" } | null = ask) => {
    if (!now) return;
    const { side, what } = now;
    const base = { side, ...(who ? { player: who } : {}) };
    if (what === "1") fire("FREE_THROW_MADE", base);
    else if (what === "2") fire("SHOT_MADE", { ...base, points: rules.twoPointValue });
    else if (what === "3") fire("SHOT_MADE", { ...base, points: rules.threePointValue });
    else if (foulKind === "technical") fire("FOUL", { ...base, kind: "technical" });
    else if (foulKind === "personal") fire("FOUL", { ...base, kind: "personal" });
    // on a basket that counted: the engine gives the one free throw
    else if (foulKind === "andone") fire("FOUL", { ...base, kind: "shooting" });
    else fire("FOUL", { ...base, kind: "shooting", freeThrows: foulKind === "shooting3" ? 3 : 2 });
    setAsk(null); setFoulKind("personal"); setPlayer((cur) => ({ ...cur, [side]: null }));
  };
  // +1/+2/+3: for the selected jersey, or ask who
  const key = (side: Side, what: "1" | "2" | "3" | "foul") => {
    if (what !== "foul" && player[side]) answer(player[side], { side, what });
    else setAsk({ side, what });
  };
  const jersey = (side: Side, p: Participant, onClick: () => void, on = false) => (
    <Jersey key={p.id} p={p} color={teamColor(side)} on={on} fouls={fouls(p.id)} out={!!s.out[p.id]} onClick={onClick} />
  );

  return (
    <div className="si-pad">
      {s.periodOpen ? (
        <ClockBar clk={clk} period={periodName(s.period, rules)} periodLength={periodSeconds(s.period, rules)} lastRecorded={s.clock}
          resets={rules.shotClockSeconds === null ? [] : [...new Set([rules.shotClockSeconds, rules.shotClockReset ?? rules.shotClockSeconds])]}
          onEnd={endPeriod} />
      ) : (
        <div className="si-row">
          {canStartPeriod && !s.endedEarly
            ? <button type="button" className="si-btn primary si-big-btn" onClick={startPeriod}>Start {periodName(next, rules)}</button>
            : finishable || s.endedEarly ? (
              <button type="button" className="si-btn primary si-big-btn" onClick={finishGame}>Finish game</button>
            ) : null}
          {finishable ? (
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

      {reached ? (
        <div className="si-info si-row" role="status" style={{ justifyContent: "space-between" }}>
          <span>{sides[reached].name} {overtime ? `scored ${target} in overtime` : `reached ${target}`}. The game is over.</span>
          <button type="button" className="si-btn primary small" onClick={endAtTarget}>End the game</button>
        </div>
      ) : null}

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
        <details className="si-card si-more" open={full}>
          <summary>Starting five (optional)</summary>
          <div className="si-info" style={{ marginBottom: 10 }}>
            Skip this if you only want the score. Minutes and plus/minus need it.
          </div>
          {SIDE_KEYS.filter(needsStarters).map((side) => (
            <LineupPicker key={side} label={`${sides[side].name} starting five`} players={byIds(side, eligibleOf(s, ctx, side))}
              size={Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length)} action="Save starting five"
              onSave={(ids) => send("LINEUP", { side, players: ids })} />
          ))}
        </details>
      ) : null}

      {s.period > 0 && full ? (
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

      {s.periodOpen && !full ? (
        <div className="si-pad-sides">
          {SIDE_KEYS.map((side) => (
            <div key={side} className="si-pad-side">
              <div className="si-pad-name">{sides[side].name}</div>
              {subbing?.side === side && !s.onCourt[side] ? (
                <div className="si-ask">
                  <LineupPicker label={`Who is on court for ${sides[side].name}?`} players={byIds(side, eligibleOf(s, ctx, side))}
                    size={Math.min(rules.playersOnCourt, eligibleOf(s, ctx, side).length)} action="Next: make the substitution"
                    onSave={(ids) => fire("LINEUP", { side, players: ids })} />
                  <button type="button" className="si-btn small" style={{ justifySelf: "start" }} onClick={() => setSubbing(null)}>Cancel</button>
                </div>
              ) : subbing?.side === side ? (
                <SubPanel court={onCourt(side)} bench={byIds(side, benchOf(s, ctx, side) ?? [])} picked={subbing} badge={badge} color={teamColor(side)}
                  left={subsLeft(side)} onPick={(role, id) => pickSub(side, role, id)} onDone={() => setSubbing(null)} />
              ) : (
                <>
                  {ask?.side === side ? (
                    <div className="si-ask" aria-live="polite">
                      <div className="si-pad-name">
                        {ask.what === "foul" ? "Who fouled? Tap the jersey" : `Who scored +${ask.what === "1" ? rules.freeThrowValue : ask.what === "2" ? rules.twoPointValue : rules.threePointValue}? Tap the jersey`}
                      </div>
                      {ask.what === "foul" ? (
                        <div className="si-chips wrap">
                          {([["personal", "Foul"], ["shooting2", "Shooting, 2 FT"], ["shooting3", "Shooting, 3 FT"], ["andone", "And-one, 1 FT"], ["technical", "Technical"]] as const).map(([k, l]) => (
                            <button type="button" key={k} className={`si-chip${foulKind === k ? " on" : ""}`} onClick={() => setFoulKind(k)}>{l}</button>
                          ))}
                        </div>
                      ) : null}
                      <div className="si-row">
                        <button type="button" className="si-btn small" onClick={() => answer(null)}>{ask.what === "foul" ? "Team / bench" : "Don't know"}</button>
                        <button type="button" className="si-btn small" onClick={() => setAsk(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : null}
                  <div className={`si-jerseys${ask?.side === side ? " asking" : ""}`}>
                    {onCourt(side).map((p) => jersey(side, p,
                      () => (ask?.side === side ? answer(p.id) : setPlayer({ ...player, [side]: player[side] === p.id ? null : p.id })),
                      player[side] === p.id))}
                  </div>
                  {benchOf(s, ctx, side)?.length ? (
                    <div className="si-muted" style={{ fontSize: 12 }}>
                      Bench: {byIds(side, benchOf(s, ctx, side)!).map((p, i) => <span key={p.id}>{i ? " · " : ""}<PlayerName p={p} /></span>)}
                    </div>
                  ) : null}
                  <div className="si-keys three">
                    {(["1", "2", "3"] as const).map((w) => (
                      <button type="button" key={w} className="si-key-btn score big" onClick={() => key(side, w)}>
                        +{w === "1" ? `${rules.freeThrowValue} FT` : w === "2" ? rules.twoPointValue : rules.threePointValue}
                      </button>
                    ))}
                  </div>
                  <div className="si-keys three">
                    <button type="button" className="si-key-btn warn" onClick={() => key(side, "foul")}>Foul</button>
                    <button type="button" className="si-key-btn" disabled={timeoutsLeft(s, side, rules) <= 0} onClick={() => fire("TIMEOUT", { side })}>Timeout</button>
                    <button type="button" className="si-key-btn" disabled={subsLeft(side) === 0}
                      onClick={() => setSubbing({ side, out: null, in: null })}>Sub</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {s.periodOpen && full ? (
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
                  <SubPanel court={onCourt(side)} bench={byIds(side, benchOf(s, ctx, side) ?? [])} picked={subbing} badge={badge} color={teamColor(side)}
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

      {s.period > 0 && !finishable && !s.endedEarly ? (
        <button type="button" className="si-btn" onClick={finishGame} style={{ justifySelf: "start" }}>Finish game now</button>
      ) : null}

      {s.period > 0 || full ? (
        <button type="button" className="si-link-btn" onClick={toggleFull} style={{ justifySelf: "start" }}>
          {full ? "Simple scoring (points, fouls, timeouts)" : "Full stats: rebounds, assists, steals, misses…"}
        </button>
      ) : null}

      {full ? (<>
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
      </>) : null}
    </div>
  );
}

/** Two taps: who goes off, who comes on (either order). Stays open for the next change. */
function SubPanel({ court, bench, picked, badge, left, color, onPick, onDone }: {
  court: Participant[]; bench: Participant[]; color: string;
  picked: { out: string | null; in: string | null }; badge: (id: string) => string | null; left: number | null;
  onPick: (role: "out" | "in", id: string) => void; onDone: () => void;
}) {
  const grid = (players: Participant[], role: "out" | "in") => (
    <div className="si-jerseys">
      {players.map((p) => (
        <Jersey key={p.id} p={p} color={color} on={picked[role] === p.id} fouls={Number(badge(p.id)?.replace("f", "")) || 0} out={false} onClick={() => onPick(role, p.id)} />
      ))}
    </div>
  );
  return (
    <div className="si-ask">
      <div className="si-pad-name">Going off</div>
      {grid(court, "out")}
      <div className="si-pad-name">Coming on</div>
      {bench.length ? grid(bench, "in") : <span className="si-info">Nobody left on the bench.</span>}
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
