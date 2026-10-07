"use client";

import { useState } from "react";
import type { Participant, Side } from "@/lib/intelligence/core/types";
import type { ContestView } from "@/lib/intelligence/types";

export interface PadProps {
  contest: ContestView;
  // queue an event; the console sends it and shows any refusal
  send: (type: string, payload?: Record<string, unknown>) => void;
}

export const SIDE_KEYS: Side[] = ["a", "b"];

// a roster longer than this gets a search box
const SEARCH_FROM = 8;

/** Matches a jersey number exactly ("7", "#7") or any part of the name. */
export function matchesPlayer(p: Participant, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  return (p.number != null && String(p.number) === q) || p.name.toLowerCase().includes(q);
}

export function PlayerName({ p }: { p: Participant }) {
  return <>{p.number != null ? <b className="si-chip-num">#{p.number}</b> : null}{p.name}</>;
}

export function PlayerChips({ players, value, onChange, none = "Team", badge }: {
  players: Participant[]; value: string | null; onChange: (id: string | null) => void; none?: string | null;
  // a short note after the name: fouls, "out"
  badge?: (id: string) => string | null;
}) {
  const [query, setQuery] = useState("");
  const shown = players.filter((p) => matchesPlayer(p, query) || p.id === value);
  return (
    <div className="si-grid" style={{ gap: 6 }}>
      {players.length > SEARCH_FROM ? (
        <input className="si-input si-search" type="search" placeholder="Search name or jersey #" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />
      ) : null}
      <div className="si-chips" role="listbox" aria-label="Player">
        {none !== null ? <button type="button" className={`si-chip${value === null ? " on" : ""}`} onClick={() => onChange(null)}>{none}</button> : null}
        {shown.map((p) => (
          <button type="button" key={p.id} className={`si-chip${value === p.id ? " on" : ""}`} onClick={() => onChange(value === p.id ? null : p.id)}>
            <PlayerName p={p} />{badge?.(p.id) ? <span className="si-chip-badge"> · {badge(p.id)}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Tap players in order to build a lineup of exactly `size` (or between `min` and `size`). */
export function LineupPicker({ players, size, min = size, label, onSave, action = "Save lineup" }: {
  players: Participant[]; size: number; min?: number; label: string; onSave: (ids: string[]) => void; action?: string;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < size ? [...cur, id] : cur));
  return (
    <div className="si-grid" style={{ gap: 8 }}>
      <div className="si-pad-name">{label}: tap {min === size ? size : `up to ${size}`} players in order ({picked.length}/{size})</div>
      {players.length > SEARCH_FROM ? (
        <input className="si-input si-search" type="search" placeholder="Search name or jersey #" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />
      ) : null}
      <div className="si-chips wrap">
        {players.filter((p) => matchesPlayer(p, query) || picked.includes(p.id)).map((p) => {
          const at = picked.indexOf(p.id);
          return <button type="button" key={p.id} className={`si-chip${at >= 0 ? " on" : ""}`} onClick={() => toggle(p.id)}>{at >= 0 ? `${at + 1}. ` : ""}<PlayerName p={p} /></button>;
        })}
      </div>
      <div className="si-row">
        <button type="button" className="si-btn small primary" disabled={picked.length < min || picked.length > size} onClick={() => { onSave(picked); setPicked([]); }}>{action}</button>
        {players.length < size ? <span className="si-muted" style={{ fontSize: 12.5 }}>This team has only {players.length} players on its roster.</span> : null}
      </div>
    </div>
  );
}

/** Side A's colour and side B's, the same as in the charts. */
export const teamColor = (side: Side): string => (side === "a" ? "var(--si-series-1)" : "var(--si-series-2)");

/** A player as a team vest in the team's colour: the number big, the name and position under it. */
export function Jersey({ p, color, on, fouls = 0, out = false, note, onClick }: { p: Participant; color: string; on: boolean; fouls?: number; out?: boolean; note?: string | null; onClick: () => void }) {
  const first = p.name.split(" ")[0];
  return (
    <button type="button" className={`si-jersey${on ? " on" : ""}${out ? " out" : ""}`} style={{ ["--team" as string]: color }} onClick={onClick}
      aria-pressed={on} aria-label={`${p.number != null ? `#${p.number} ` : ""}${p.name}${p.position ? `, ${p.position}` : ""}${fouls ? `, ${fouls} fouls` : ""}`}>
      <span className="si-vest">
        <svg viewBox="0 0 60 66" aria-hidden="true"><path d="M17 3 Q30 15 43 3 L52 6 Q49 19 57 26 L57 63 L3 63 L3 26 Q11 19 8 6 Z" /></svg>
        <b>{p.number ?? "–"}</b>
      </span>
      <span className="si-jersey-name">{first}</span>
      {p.position || fouls || note ? <span className="si-jersey-meta">{[note, p.position, fouls ? `${fouls}f` : null].filter(Boolean).join(" · ")}</span> : null}
    </button>
  );
}

