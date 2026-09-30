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

export function PlayerChips({ players, value, onChange, none = "Team" }: {
  players: Participant[]; value: string | null; onChange: (id: string | null) => void; none?: string;
}) {
  return (
    <div className="si-chips" role="listbox" aria-label="Player">
      <button type="button" className={`si-chip${value === null ? " on" : ""}`} onClick={() => onChange(null)}>{none}</button>
      {players.map((p) => (
        <button type="button" key={p.id} className={`si-chip${value === p.id ? " on" : ""}`} onClick={() => onChange(value === p.id ? null : p.id)}>
          {p.number != null ? `${p.number} ` : ""}{p.name}
        </button>
      ))}
    </div>
  );
}

/** Tap players in order to build a lineup of exactly `size`. */
export function LineupPicker({ players, size, label, onSave }: { players: Participant[]; size: number; label: string; onSave: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < size ? [...cur, id] : cur));
  return (
    <div className="si-grid" style={{ gap: 8 }}>
      <div className="si-pad-name">{label}: tap {size} players in order ({picked.length}/{size})</div>
      <div className="si-chips">
        {players.map((p) => {
          const at = picked.indexOf(p.id);
          return <button type="button" key={p.id} className={`si-chip${at >= 0 ? " on" : ""}`} onClick={() => toggle(p.id)}>{at >= 0 ? `${at + 1}. ` : ""}{p.name}</button>;
        })}
      </div>
      <div className="si-row">
        <button type="button" className="si-btn small primary" disabled={picked.length !== size} onClick={() => { onSave(picked); setPicked([]); }}>Save lineup</button>
        {players.length < size ? <span className="si-muted" style={{ fontSize: 12.5 }}>This team has only {players.length} players on its roster.</span> : null}
      </div>
    </div>
  );
}
