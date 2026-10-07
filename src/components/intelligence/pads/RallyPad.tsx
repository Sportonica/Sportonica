"use client";

// Scorer pad for the rally sports. What differs between them (the
// outcomes a rally can have, whether lineups and touches exist) comes
// in as configuration from ./index; the rules themselves stay in the
// engines, which refuse anything impossible.

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import { LineupPicker, PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

export interface RallyPadConfig {
  // "Point" when every rally scores, "Rally" when only the server can score
  pointWord: (rules: Record<string, unknown>) => string;
  hows: { key: string; label: string }[];
  // volleyball: rotation lineups, timeouts and non-scoring touches
  court?: { sizeRule: string };
}

interface RallyState { serving: Side | null; decided: Side | null }

const TOUCHES: { kind: string; quality?: string; label: string }[] = [
  { kind: "attack", label: "Attack in play" }, { kind: "dig", label: "Dig" }, { kind: "assist", label: "Assist" },
  { kind: "reception", quality: "perfect", label: "Pass: perfect" }, { kind: "reception", quality: "good", label: "Pass: good" },
  { kind: "reception", quality: "poor", label: "Pass: poor" }, { kind: "reception", quality: "error", label: "Pass: error" },
];

export default function RallyPad({ contest, send, config }: PadProps & { config: RallyPadConfig }) {
  const state = contest.state as RallyState;
  const sides = contest.context.sides!;
  const [how, setHow] = useState<string | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [shots, setShots] = useState("");
  const [touchSide, setTouchSide] = useState<Side>("a");
  const word = config.pointWord(contest.rules);

  if (state.decided) return <div className="si-info">The match is decided. Complete it, or correct an event below if the last point was wrong.</div>;

  if (!state.serving) {
    return (
      <div className="si-pad">
        <div className="si-pad-name">Who serves first?</div>
        <div className="si-keys two">
          {SIDE_KEYS.map((s) => <button type="button" key={s} className="si-key-btn big" onClick={() => send("FIRST_SERVE", { side: s })}>{sides[s].name}</button>)}
        </div>
        {config.court ? <Lineups contest={contest} send={send} sizeRule={config.court.sizeRule} /> : null}
      </div>
    );
  }

  const point = (winner: Side) => {
    const n = Number(shots);
    send("RALLY_WON", { winner, ...(how ? { how } : {}), ...(player ? { player } : {}), ...(shots && Number.isInteger(n) && n > 0 ? { shots: n } : {}) });
    setHow(null); setPlayer(null); setShots("");
  };

  return (
    <div className="si-pad">
      <div className="si-keys two">
        {SIDE_KEYS.map((s) => (
          <button type="button" key={s} className="si-key-btn score big si-point" onClick={() => point(s)} aria-label={`${word} ${sides[s].name}${state.serving === s ? ", serving" : ""}`}>
            <small>{word}</small><b>{sides[s].name}</b>{state.serving === s ? <i>Serving</i> : null}
          </button>
        ))}
      </div>

      <div>
        <div className="si-pad-name" style={{ marginBottom: 6 }}>How it was won (optional, tap before the {word.toLowerCase()})</div>
        <div className="si-chips">
          {config.hows.map((h) => <button type="button" key={h.key} className={`si-chip${how === h.key ? " on" : ""}`} onClick={() => setHow(how === h.key ? null : h.key)}>{h.label}</button>)}
        </div>
      </div>

      <details className="si-more">
        <summary>Player and rally length</summary>
        <div className="si-grid" style={{ gap: 8 }}>
          {SIDE_KEYS.map((s) => (
            <div key={s}><div className="si-pad-name">{sides[s].name}</div><PlayerChips players={sides[s].players} value={player} onChange={setPlayer} none="No player" /></div>
          ))}
          <label className="si-label">Rally length (shots)
            <input className="si-input" inputMode="numeric" value={shots} onChange={(e) => setShots(e.target.value.replace(/\D/g, ""))} placeholder="Leave empty if not counted" />
          </label>
        </div>
      </details>

      {config.court ? (
        <details className="si-more">
          <summary>Timeouts, touches and lineups</summary>
          <div className="si-grid" style={{ gap: 10 }}>
            <div className="si-keys two">
              {SIDE_KEYS.map((s) => <button type="button" key={s} className="si-key-btn" onClick={() => send("TIMEOUT", { side: s })}>Timeout {sides[s].name}</button>)}
            </div>
            <div className="si-chips">
              {SIDE_KEYS.map((s) => <button type="button" key={s} className={`si-chip${touchSide === s ? " on" : ""}`} onClick={() => { setTouchSide(s); setPlayer(null); }}>{sides[s].name}</button>)}
            </div>
            <PlayerChips players={sides[touchSide].players} value={player} onChange={setPlayer} none="No player" />
            <div className="si-keys">
              {TOUCHES.map((t) => (
                <button type="button" key={t.label} className="si-key-btn"
                  onClick={() => send("TOUCH", { side: touchSide, kind: t.kind, ...(t.quality ? { quality: t.quality } : {}), ...(player ? { player } : {}) })}>{t.label}</button>
              ))}
            </div>
            <Lineups contest={contest} send={send} sizeRule={config.court.sizeRule} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Lineups({ contest, send, sizeRule }: PadProps & { sizeRule: string }) {
  const sides = contest.context.sides!;
  const size = Number(contest.rules[sizeRule] ?? 6);
  return (
    <details className="si-more">
      <summary>Set lineups (needed to name the server)</summary>
      <div className="si-grid" style={{ gap: 12 }}>
        {SIDE_KEYS.map((s) => <LineupPicker key={s} label={sides[s].name} players={sides[s].players} size={size} onSave={(ids) => send("LINEUP", { side: s, players: ids })} />)}
        <div className="si-muted" style={{ fontSize: 12.5 }}>Lineups can be set before the first rally of a set.</div>
      </div>
    </details>
  );
}
