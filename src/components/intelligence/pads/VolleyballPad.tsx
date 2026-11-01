"use client";

// The volleyball scorer. A big point button per team is all a rally needs;
// how it was won, who won it and everything else is optional and a tap
// away. The engine works out the serve, rotation and sets, and refuses
// anything impossible.

import { useState } from "react";
import type { Side } from "@/lib/intelligence/core/types";
import type { VolleyballRules, VolleyballState } from "@/lib/intelligence/sports/volleyball";
import { COURT_POSITIONS } from "@/lib/intelligence/sports/volleyballRules";
import { Court, MatchClock, playerOf, shortName } from "../volleyball/parts";
import { LineupPicker, PlayerChips, SIDE_KEYS, type PadProps } from "./shared";

const HOWS: { key: string; label: string; by: "winner" | "loser" }[] = [
  { key: "kill", label: "Attack kill", by: "winner" }, { key: "ace", label: "Ace", by: "winner" }, { key: "block", label: "Block", by: "winner" },
  { key: "attack_error", label: "Attack error", by: "loser" }, { key: "service_error", label: "Service error", by: "loser" }, { key: "foot_fault", label: "Foot fault", by: "loser" },
  { key: "reception_error", label: "Reception error", by: "loser" }, { key: "block_error", label: "Block error", by: "loser" }, { key: "setting_error", label: "Setting error", by: "loser" },
  { key: "net_fault", label: "Net fault", by: "loser" },
];

const TOUCHES: { kind: string; quality?: string; label: string }[] = [
  { kind: "attack", label: "Attack in play" }, { kind: "dig", label: "Dig" }, { kind: "assist", label: "Assist" },
  { kind: "reception", quality: "perfect", label: "Reception: perfect" }, { kind: "reception", quality: "good", label: "Reception: good" }, { kind: "reception", quality: "poor", label: "Reception: poor" },
];

type Sheet = "sub" | "libero" | "card" | "touch" | "officials" | null;

export default function VolleyballPad({ contest, send }: PadProps) {
  const s = contest.state as VolleyballState;
  const rules = contest.rules as unknown as VolleyballRules;
  const ctx = contest.context;
  const sides = ctx.sides!;
  const [how, setHow] = useState<string | null>(null);
  const [player, setPlayer] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const toggle = (x: Sheet) => { setSheet(sheet === x ? null : x); setPlayer(null); };
  const g = s.sets[s.sets.length - 1];

  if (s.manual) return <div className="si-info">The result was entered by hand. Change it with Enter match result on the Fixtures tab.</div>;

  const onCourt = (side: Side) => {
    const ids = s.rotation[side];
    return ids ? sides[side].players.filter((p) => ids.includes(p.id)) : sides[side].players;
  };
  const officials = <Officials state={s} send={send} />;

  if (s.decided) {
    return (
      <div className="si-pad">
        <div className="si-info">{sides[s.decided].name} won the match {s.setsWon[s.decided]}–{s.setsWon[s.decided === "a" ? "b" : "a"]}. Name the MVP if you wish, then tap Complete match.</div>
        <div className="vb-sheet">
          <div className="vb-sheet-t">Match MVP (optional)</div>
          {SIDE_KEYS.map((x) => <div key={x}><div className="si-pad-name">{sides[x].name}</div>
            <PlayerChips players={sides[x].players} value={s.mvp} onChange={(id) => send("MATCH_MVP", { player: id })} none={null} /></div>)}
        </div>
        {officials}
      </div>
    );
  }

  if (!s.serving) {
    return (
      <div className="si-pad">
        <div className="si-pad-name">Set {s.sets.length}: confirm the starting order, then who serves first</div>
        <div className="vb-courts">{SIDE_KEYS.map((x) => <Court key={x} state={s} context={ctx} side={x} />)}</div>
        {SIDE_KEYS.map((x) => (
          <details className="si-more" key={x} open={!s.rotation[x] && sides[x].players.length >= rules.playersOnCourt}>
            <summary>{sides[x].name}: {s.rotation[x] ? "change the starting order" : "set the starting order"}</summary>
            <div className="si-grid" style={{ gap: 10 }}>
              {rules.playersOnCourt === 6 ? <div className="si-muted" style={{ fontSize: 12.5 }}>Tap in rotation order: {COURT_POSITIONS.map((n, i) => `${i + 1} ${n}`).join(", ")}. Position 1 serves first.</div> : null}
              <LineupPicker label={sides[x].name} players={sides[x].players.filter((p) => !s.liberos[x].includes(p.id))} size={rules.playersOnCourt} onSave={(ids) => send("LINEUP", { side: x, players: ids })} action="Confirm starting order" />
              {rules.liberoAllowed && rules.playersOnCourt === 6 ? (
                <div className="si-grid" style={{ gap: 6 }}>
                  <div className="si-pad-name">Libero (up to {rules.maxLiberos})</div>
                  <div className="si-chips wrap">
                    {sides[x].players.filter((p) => !s.rotation[x]?.includes(p.id)).map((p) => {
                      const on = s.liberos[x].includes(p.id);
                      return <button type="button" key={p.id} className={`si-chip${on ? " on" : ""}`} onClick={() => send("LIBERO_SET", { side: x, players: on ? s.liberos[x].filter((id) => id !== p.id) : [...s.liberos[x], p.id] })}>{shortName(p)}</button>;
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        ))}
        <div className="si-pad-name">Who serves first?</div>
        <div className="si-keys two">
          {SIDE_KEYS.map((x) => <button type="button" key={x} className="si-key-btn big" onClick={() => send("FIRST_SERVE", { side: x })}>{sides[x].name}</button>)}
        </div>
        <div className="si-muted" style={{ fontSize: 12.5 }}>The starting order is optional, but without it the server and player statistics can&apos;t be tracked.</div>
        {officials}
      </div>
    );
  }

  const point = (winner: Side) => {
    send("RALLY_WON", { winner, ...(how ? { how } : {}), ...(player ? { player } : {}) });
    setHow(null); setPlayer(null);
  };
  const server = s.rotation[s.serving]?.[0];
  const serverName = server ? shortName(playerOf(ctx, s.serving, server)) : null;

  return (
    <div className="si-pad">
      <div className="si-pad-name">Set {s.sets.length} · {sides[s.serving].name} serving{serverName ? `: ${serverName}` : ""}{contest.startedAt ? " · " : ""}<MatchClock startedAt={contest.startedAt} completedAt={null} /></div>
      <div className="si-keys two">
        {SIDE_KEYS.map((x) => (
          <button type="button" key={x} className="si-key-btn score big si-point vb-point" onClick={() => point(x)} aria-label={`Point ${sides[x].name}${s.serving === x ? ", serving" : ""}`}>
            <small>+1</small><b>{sides[x].name}</b><span className="vb-score">{g[x]}</span>{s.serving === x ? <i>Serving</i> : null}
          </button>
        ))}
      </div>

      <div>
        <div className="si-pad-name" style={{ marginBottom: 6 }}>How it was won (optional, tap before the point)</div>
        <div className="si-chips wrap">
          {HOWS.map((h) => <button type="button" key={h.key} className={`si-chip${how === h.key ? " on" : ""}`} onClick={() => setHow(how === h.key ? null : h.key)}>{h.label}</button>)}
        </div>
      </div>
      {how ? (
        <div className="si-grid" style={{ gap: 8 }}>
          {SIDE_KEYS.map((x) => <div key={x}><div className="si-pad-name">{sides[x].name}</div><PlayerChips players={onCourt(x)} value={player} onChange={setPlayer} none="No player" /></div>)}
        </div>
      ) : null}

      <div className="vb-courts">{SIDE_KEYS.map((x) => <Court key={x} state={s} context={ctx} side={x} />)}</div>

      <div className="vb-tools">
        {SIDE_KEYS.map((x) => (
          <button type="button" key={x} className="si-key-btn" disabled={s.timeouts[x] >= rules.timeoutsPerSet} onClick={() => send("TIMEOUT", { side: x })}>
            Timeout {sides[x].name} ({Math.max(rules.timeoutsPerSet - s.timeouts[x], 0)} left)
          </button>
        ))}
        {rules.substitutionsPerSet > 0 ? <button type="button" className={`si-key-btn${sheet === "sub" ? " on" : ""}`} onClick={() => toggle("sub")}>Substitution</button> : null}
        {rules.liberoAllowed && (s.liberos.a.length > 0 || s.liberos.b.length > 0) ? <button type="button" className={`si-key-btn${sheet === "libero" ? " on" : ""}`} onClick={() => toggle("libero")}>Libero</button> : null}
        <button type="button" className={`si-key-btn${sheet === "card" ? " on" : ""}`} onClick={() => toggle("card")}>Card</button>
        <button type="button" className={`si-key-btn${sheet === "touch" ? " on" : ""}`} onClick={() => toggle("touch")}>Record event</button>
        {rules.playersOnCourt === 6 ? (
          <button type="button" className="si-key-btn warn" onClick={() => { if (window.confirm(`Rotation fault on ${sides[s.serving!].name}? The other team gets the point.`)) send("RALLY_WON", { winner: s.serving === "a" ? "b" : "a", how: "rotation_fault" }); }}>Rotation fault</button>
        ) : null}
        <button type="button" className={`si-key-btn${sheet === "officials" ? " on" : ""}`} onClick={() => toggle("officials")}>Officials</button>
      </div>

      {sheet === "sub" ? <Substitution state={s} sides={sides} rules={rules} send={send} done={() => setSheet(null)} /> : null}
      {sheet === "libero" ? <Libero state={s} sides={sides} send={send} done={() => setSheet(null)} /> : null}
      {sheet === "card" ? <Card sides={sides} send={send} done={() => setSheet(null)} /> : null}
      {sheet === "touch" ? <Touch sides={sides} onCourt={onCourt} send={send} /> : null}
      {sheet === "officials" ? officials : null}
    </div>
  );
}

type Sides = NonNullable<PadProps["contest"]["context"]["sides"]>;

function SideChoice({ sides, side, onChange }: { sides: Sides; side: Side; onChange: (s: Side) => void }) {
  return <div className="si-chips">{SIDE_KEYS.map((x) => <button type="button" key={x} className={`si-chip${side === x ? " on" : ""}`} onClick={() => onChange(x)}>{sides[x].name}</button>)}</div>;
}

function Substitution({ state: s, sides, rules, send, done }: { state: VolleyballState; sides: Sides; rules: VolleyballRules; send: PadProps["send"]; done: () => void }) {
  const [side, setSide] = useState<Side>("a");
  const [out, setOut] = useState<string | null>(null);
  const [inn, setInn] = useState<string | null>(null);
  const order = s.rotation[side];
  const on = order ? sides[side].players.filter((p) => order.includes(p.id) && !s.liberos[side].includes(p.id)) : sides[side].players;
  const bench = sides[side].players.filter((p) => !order?.includes(p.id) && !s.liberos[side].includes(p.id) && p.id !== s.liberoOn[side]?.player);
  return (
    <div className="vb-sheet">
      <div className="vb-sheet-t">Substitution ({Math.max(rules.substitutionsPerSet - s.subs[side], 0)} left this set)</div>
      <SideChoice sides={sides} side={side} onChange={(x) => { setSide(x); setOut(null); setInn(null); }} />
      <div className="si-pad-name">Going off</div>
      <PlayerChips players={on} value={out} onChange={setOut} none={null} />
      <div className="si-pad-name">Coming on</div>
      <PlayerChips players={bench} value={inn} onChange={setInn} none={null} />
      <button type="button" className="si-btn primary small" disabled={!out || !inn} onClick={() => { send("SUBSTITUTION", { side, in: inn, out }); done(); }}>Confirm substitution</button>
    </div>
  );
}

function Libero({ state: s, sides, send, done }: { state: VolleyballState; sides: Sides; send: PadProps["send"]; done: () => void }) {
  const [side, setSide] = useState<Side>(s.liberos.a.length ? "a" : "b");
  const [libero, setLibero] = useState<string | null>(s.liberos[side][0] ?? null);
  const on = s.liberoOn[side];
  const order = s.rotation[side] ?? [];
  // back row: positions 1, 5 and 6; the server stays on
  const can = [0, 4, 5].filter((at) => !(at === 0 && s.serving === side)).map((at) => order[at]).filter(Boolean);
  return (
    <div className="vb-sheet">
      <div className="vb-sheet-t">Libero replacement (doesn&apos;t use a substitution)</div>
      <SideChoice sides={sides} side={side} onChange={(x) => { setSide(x); setLibero(s.liberos[x][0] ?? null); }} />
      {on ? (
        <button type="button" className="si-key-btn" onClick={() => { send("LIBERO_OUT", { side }); done(); }}>
          Libero off, {shortName(sides[side].players.find((p) => p.id === on.player))} back on
        </button>
      ) : !s.liberos[side].length ? <div className="si-muted" style={{ fontSize: 13 }}>{sides[side].name} has no Libero named.</div> : (
        <>
          {s.liberos[side].length > 1 ? <PlayerChips players={sides[side].players.filter((p) => s.liberos[side].includes(p.id))} value={libero} onChange={setLibero} none={null} /> : null}
          <div className="si-pad-name">Replaces</div>
          <div className="si-chips wrap">
            {can.map((id) => <button type="button" key={id} className="si-chip" disabled={!libero} onClick={() => { send("LIBERO_IN", { side, libero, for: id }); done(); }}>{shortName(sides[side].players.find((p) => p.id === id))}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ sides, send, done }: { sides: Sides; send: PadProps["send"]; done: () => void }) {
  const [side, setSide] = useState<Side>("a");
  const [player, setPlayer] = useState<string | null>(null);
  const give = (card: string, label: string, note: string) => {
    if (!window.confirm(`${label} for ${player ? shortName(sides[side].players.find((p) => p.id === player)) : sides[side].name}?${note}`)) return;
    send("SANCTION", { side, card, ...(player ? { player } : {}) });
    done();
  };
  return (
    <div className="vb-sheet">
      <div className="vb-sheet-t">Card or sanction</div>
      <SideChoice sides={sides} side={side} onChange={(x) => { setSide(x); setPlayer(null); }} />
      <PlayerChips players={sides[side].players} value={player} onChange={setPlayer} none="Team" />
      <div className="si-keys two">
        <button type="button" className="si-key-btn" onClick={() => give("yellow", "Yellow card", "")}>Yellow card</button>
        <button type="button" className="si-key-btn warn" onClick={() => give("red", "Red card", " The other team gets a point and the serve.")}>Red card</button>
        <button type="button" className="si-key-btn warn" disabled={!player} onClick={() => give("expulsion", "Expulsion", " They are out for the rest of this set.")}>Expulsion</button>
        <button type="button" className="si-key-btn warn" disabled={!player} onClick={() => give("disqualification", "Disqualification", " They are out for the rest of the match.")}>Disqualification</button>
      </div>
    </div>
  );
}

function Touch({ sides, onCourt, send }: { sides: Sides; onCourt: (s: Side) => Sides[Side]["players"]; send: PadProps["send"] }) {
  const [side, setSide] = useState<Side>("a");
  const [player, setPlayer] = useState<string | null>(null);
  return (
    <div className="vb-sheet">
      <div className="vb-sheet-t">Record an event (no point)</div>
      <SideChoice sides={sides} side={side} onChange={(x) => { setSide(x); setPlayer(null); }} />
      <PlayerChips players={onCourt(side)} value={player} onChange={setPlayer} none="No player" />
      <div className="si-keys">
        {TOUCHES.map((t) => <button type="button" key={t.label} className="si-key-btn" onClick={() => send("TOUCH", { side, kind: t.kind, ...(t.quality ? { quality: t.quality } : {}), ...(player ? { player } : {}) })}>{t.label}</button>)}
      </div>
    </div>
  );
}

const ROLES = ["First referee", "Second referee", "Scorer", "Line judge"];

function Officials({ state, send }: { state: VolleyballState; send: PadProps["send"] }) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(state.officials.map((o) => [o.role, o.name])));
  return (
    <details className="si-more">
      <summary>Match officials</summary>
      <div className="si-grid" style={{ gap: 8 }}>
        {ROLES.map((r) => (
          <label key={r} className="si-label">{r}
            <input className="si-input" value={names[r] ?? ""} maxLength={80} onChange={(e) => setNames({ ...names, [r]: e.target.value })} />
          </label>
        ))}
        <button type="button" className="si-btn small" onClick={() => send("OFFICIALS", { officials: ROLES.filter((r) => names[r]?.trim()).map((r) => ({ role: r, name: names[r].trim() })) })}>Save officials</button>
      </div>
    </details>
  );
}
