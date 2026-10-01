"use client";

// Tennis scoring, one hand on a phone: tap who won the point. How it
// ended and which serve was in are optional and clear after each point.

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { pointCall, type TennisRules, type TennisState } from "@/lib/intelligence/sports/tennis";
import { PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

const HOWS = [["ace", "Ace"], ["double_fault", "Double fault"], ["winner", "Winner"], ["forced_error", "Forced error"], ["unforced_error", "Unforced error"]] as const;
const other = (s: Side): Side => (s === "a" ? "b" : "a");

export default function TennisPad({ contest, send }: PadProps) {
  const s = contest.state as TennisState;
  const rules = contest.rules as unknown as TennisRules;
  const sides = contest.context.sides!;
  const [how, setHow] = useState<string | null>(null);
  const [serve, setServe] = useState<1 | 2 | null>(null);
  const [player, setPlayer] = useState<string | null>(null);

  if (!s.serving) {
    return (
      <div className="si-pad">
        <div className="si-info">Who serves first?</div>
        <div className="si-keys two">
          {SIDE_KEYS.map((side) => <button type="button" key={side} className="si-key-btn big" onClick={() => send("FIRST_SERVE", { side })}>{sides[side].name}</button>)}
        </div>
      </div>
    );
  }
  if (s.decided) return <div className="si-info">{sides[s.decided].name} have won the match. Complete it above.</div>;

  const srv = s.serving;
  // an ace can only go to the server, a double fault only to the receiver
  const allowed = (side: Side) => !(how === "ace" && side !== srv) && !(how === "double_fault" && side === srv);
  const point = (side: Side) => {
    // in singles the player who hit the ace, winner or error is the side's only player
    const solo = how && rules.format === "singles" ? sides[shotBy(side)].players : [];
    const who = player ?? (solo.length === 1 ? solo[0].id : null);
    send("POINT_WON", { side, ...(how ? { how } : {}), ...(serve && how !== "double_fault" ? { serve } : {}), ...(who ? { player: who } : {}) });
    setHow(null); setServe(null); setPlayer(null);
  };
  const shotBy = (side: Side): Side => (how === "double_fault" || how === "forced_error" || how === "unforced_error" ? other(side) : side);

  return (
    <div className="si-pad">
      <div className="si-card si-grid" style={{ gap: 4 }} aria-live="polite">
        <div className="si-pad-name">{pointCall(s, contest.context, rules)}</div>
        <div className="si-muted" style={{ fontSize: 12.5 }}>{sides[srv].name} serving{s.inTiebreak ? " · tiebreak" : ""}</div>
      </div>

      <div className="si-chips" aria-label="How the point ended (optional)">
        {HOWS.map(([k, label]) => <button type="button" key={k} className={`si-chip${how === k ? " on" : ""}`} onClick={() => { setHow(how === k ? null : k); setPlayer(null); }}>{label}</button>)}
      </div>
      <div className="si-chips" aria-label="Which serve was in (optional)">
        <button type="button" className={`si-chip${serve === 1 ? " on" : ""}`} disabled={how === "double_fault"} onClick={() => setServe(serve === 1 ? null : 1)}>1st serve in</button>
        <button type="button" className={`si-chip${serve === 2 ? " on" : ""}`} disabled={how === "double_fault"} onClick={() => setServe(serve === 2 ? null : 2)}>2nd serve</button>
      </div>
      {rules.format === "doubles" && how ? (
        <div className="si-grid" style={{ gap: 6 }}>
          <span className="si-muted" style={{ fontSize: 12.5 }}>Which player (optional)</span>
          {SIDE_KEYS.map((side) => <PlayerChips key={side} players={sides[side].players} value={player && sides[side].players.some((p) => p.id === player) ? player : null} onChange={setPlayer} none={sides[side].name} />)}
        </div>
      ) : null}

      <div className="si-keys two">
        {SIDE_KEYS.map((side) => (
          <button type="button" key={side} className="si-key-btn score big" disabled={!allowed(side)} onClick={() => point(side)}>
            Point {sides[side].name}
          </button>
        ))}
      </div>
      <div className="si-muted" style={{ fontSize: 12.5 }}>
        Choose how the point ended first if you want aces, double faults, winners and errors counted. Serve figures use only the points where the serve was recorded.
      </div>
    </div>
  );
}
