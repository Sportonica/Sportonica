"use client";

// The basketball scorer's play-by-play: every event of the game, newest
// first in game order, each with Edit (the stat events), Remove and Add
// before (an event that was missed). Plus "Fix a player": the wrong player
// picked, moved to the right one across the whole game.

import { useMemo, useState } from "react";
import type { MatchContext, Participant, Side } from "@/lib/intelligence/core/types";
import type { ContestView, TimelineEntry } from "@/lib/intelligence/types";
import type { BasketballRules } from "@/lib/intelligence/sports/basketball";
import type { CricketBulkEdit } from "@/lib/intelligence/sports/cricketEdits";
import { playersInEvents } from "@/lib/intelligence/sports/basketballEdits";
import { Choice, Field, JerseyPick, Sheet } from "../cricket/sheets";
import "../cricket/cricket.css";

// what the edit sheet can change; anything else can still be removed
const EDITABLE = ["SHOT_MADE", "SHOT_MISSED", "FREE_THROW_MADE", "FREE_THROW_MISSED", "REBOUND", "ASSIST", "STEAL", "BLOCK", "TURNOVER", "FOUL", "SUBSTITUTION", "TIMEOUT"] as const;
type EditType = (typeof EDITABLE)[number];
const TYPE_LABEL: Record<EditType, string> = {
  SHOT_MADE: "Basket made", SHOT_MISSED: "Shot missed", FREE_THROW_MADE: "Free throw made", FREE_THROW_MISSED: "Free throw missed",
  REBOUND: "Rebound", ASSIST: "Assist", STEAL: "Steal", BLOCK: "Block", TURNOVER: "Turnover", FOUL: "Foul", SUBSTITUTION: "Substitution", TIMEOUT: "Timeout",
};
const FOULS = ["personal", "shooting", "offensive", "technical", "unsportsmanlike", "disqualifying"] as const;
// game flow the scorer does not edit from here (the full event log can still reverse it)
const FIXED = new Set(["MATCH_START", "MATCH_PAUSE", "MATCH_RESUME", "MATCH_COMPLETE", "MATCH_REOPEN", "MATCH_RESTART", "MATCH_ABANDON", "MATCH_FORFEIT", "MATCH_CANCEL", "MATCH_POSTPONE", "CORRECTION_VOID", "PERIOD_START", "PERIOD_END", "PERIOD_REOPEN", "ROSTER", "OFFICIALS", "BOX_SCORE"]);
const isEditable = (t: string): t is EditType => (EDITABLE as readonly string[]).includes(t);

export function BasketballScorerSide({ contest, entries, busy, onEdit, onRemove, onInsert, onBulkFix, children }: {
  contest: ContestView; entries: TimelineEntry[]; busy: boolean;
  onEdit: (e: TimelineEntry, type: string, payload: Record<string, unknown>, reason: string) => void;
  onRemove: (e: TimelineEntry) => void;
  onInsert: (before: TimelineEntry, type: string, payload: Record<string, unknown>, reason: string) => void;
  onBulkFix: (edit: CricketBulkEdit, reason: string) => void;
  children?: React.ReactNode;
}) {
  const ctx = contest.context;
  const rules = contest.rules as unknown as BasketballRules;
  const [editing, setEditing] = useState<TimelineEntry | null>(null);
  const [inserting, setInserting] = useState<TimelineEntry | null>(null);
  const [fixing, setFixing] = useState(false);
  const editable = contest.status === "live" || contest.status === "paused" || contest.status === "completed";
  const list = useMemo(() => entries
    .filter((e) => !e.superseded && e.correction?.kind !== "void" && !FIXED.has(e.type))
    .sort((x, y) => (y.position ?? y.seq) - (x.position ?? x.seq)), [entries]);
  const nm = (id: unknown) => [...(ctx.sides?.a.players ?? []), ...(ctx.sides?.b.players ?? [])].find((p) => p.id === id)?.name ?? "";

  return (
    <div className="si-card ck-side">
      <div className="si-chart-head"><h2 className="si-h2" style={{ margin: 0 }}>Play by play</h2></div>
      {editable ? (
        <div className="ck-muted" style={{ fontSize: 12.5 }}>
          Tap Edit on any event to change it, Remove to take it out, or Add before for one that was missed. The game is worked out again from there.
        </div>
      ) : null}
      {editable && list.length ? (
        <button type="button" className="si-btn small" style={{ justifySelf: "start" }} disabled={busy} onClick={() => setFixing(true)}>Fix a player</button>
      ) : null}
      {list.length ? (
        <ol className="ck-comm compact">
          {list.map((e) => (
            <li key={e.id} className="ck-comm-ball">
              <span className="ck-comm-at" style={{ minWidth: 64 }}>{e.label?.replace(/, shot clock \d+/, "") ?? ""}</span>
              <div className="ck-comm-body">
                <b>{isEditable(e.type) ? TYPE_LABEL[e.type] : e.type.replace(/_/g, " ").toLowerCase()}</b>
                <p>{e.text}</p>
                {e.correction?.kind === "replace" ? <small className="ck-muted">Corrected by the scorer</small>
                  : typeof e.payload?.insertBefore === "string" ? <small className="ck-muted">Added later by the scorer</small> : null}
              </div>
              {editable && !busy ? (
                <span className="ck-comm-tools">
                  {isEditable(e.type) ? <button type="button" className="ck-link" onClick={() => setEditing(e)}>Edit</button> : null}
                  <button type="button" className="ck-link danger" onClick={() => onRemove(e)}>Remove</button>
                  <button type="button" className="ck-link" onClick={() => setInserting(e)}>Add before</button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : <div className="ck-empty">The play by play appears here once the game starts.</div>}
      {children}
      {editing ? (
        <BasketballEventSheet ctx={ctx} rules={rules} entry={editing} nm={nm} onClose={() => setEditing(null)}
          onSave={(type, payload, reason) => { onEdit(editing, type, payload, reason); setEditing(null); }} />
      ) : null}
      {inserting ? (
        <BasketballEventSheet insert ctx={ctx} rules={rules} entry={inserting} nm={nm} onClose={() => setInserting(null)}
          onSave={(type, payload, reason) => { onInsert(inserting, type, payload, reason); setInserting(null); }} />
      ) : null}
      {fixing ? (
        <FixPlayerSheet ctx={ctx} entries={list} onClose={() => setFixing(false)}
          onSave={(from, to, reason) => { onBulkFix({ kind: "player", from, to, role: "all" }, reason); setFixing(false); }} />
      ) : null}
    </div>
  );
}

/** Change one event, or (insert) record a missed one just before `entry`. */
function BasketballEventSheet({ ctx, rules, entry, nm, insert = false, onSave, onClose }: {
  ctx: MatchContext; rules: BasketballRules; entry: TimelineEntry; nm: (id: unknown) => string; insert?: boolean;
  onSave: (type: string, payload: Record<string, unknown>, reason: string) => void; onClose: () => void;
}) {
  const p = entry.payload ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const [type, setType] = useState<EditType>(insert ? "SHOT_MADE" : isEditable(entry.type) ? entry.type : "SHOT_MADE");
  const [side, setSide] = useState<Side>(p.side === "b" ? "b" : "a");
  const [player, setPlayer] = useState(insert ? "" : str(p.player));
  const [points, setPoints] = useState<number>(typeof p.points === "number" ? p.points : rules.twoPointValue);
  const [assist, setAssist] = useState(insert ? "" : str(p.assist));
  const [offensive, setOffensive] = useState(!!p.offensive);
  const [kind, setKind] = useState<string>(typeof p.kind === "string" && (FOULS as readonly string[]).includes(p.kind) ? p.kind : "personal");
  const [inP, setIn] = useState(insert ? "" : str(p.in));
  const [outP, setOut] = useState(insert ? "" : str(p.out));
  const [reason, setReason] = useState("");
  const sides = ctx.sides;
  if (!sides) return null;
  const roster: Participant[] = sides[side].players;

  const shot = type === "SHOT_MADE" || type === "SHOT_MISSED";
  const needsPlayer = !["TIMEOUT", "SUBSTITUTION", "REBOUND", "FREE_THROW_MADE", "FREE_THROW_MISSED"].includes(type);
  // the clock readings stay those of the event (or, for a missed one, of the event it goes before)
  const readings = Object.fromEntries(Object.entries(p).filter(([k]) => k === "clock" || k === "shotClock"));
  // details only the original kind of event had (fast break, zone, technical ...) stay when the kind is unchanged
  const kept = !insert && entry.type === type ? Object.fromEntries(Object.entries(p).filter(([k]) => !["side", "player", "points", "assist", "offensive", "kind", "in", "out", "insertBefore", "audit"].includes(k))) : {};
  const payload: Record<string, unknown> = {
    ...kept, ...readings, side,
    ...(type !== "TIMEOUT" && type !== "SUBSTITUTION" && player ? { player } : {}),
    ...(shot ? { points } : {}),
    ...(type === "SHOT_MADE" && assist ? { assist } : {}),
    ...(type === "REBOUND" ? { offensive } : {}),
    ...(type === "FOUL" ? { kind } : {}),
    ...(type === "SUBSTITUTION" ? { in: inP, out: outP } : {}),
  };
  const ready = (!needsPlayer || !!player) && (type !== "SUBSTITUTION" || (!!inP && !!outP && inP !== outP));
  const title = insert ? `Add a missed event before ${entry.label?.replace(/, shot clock \d+/, "") ?? "this one"}` : `Edit ${entry.label?.replace(/, shot clock \d+/, "") ?? "event"}`;

  return (
    <Sheet title={title} onClose={onClose}>
      {!insert ? <div className="ck-muted" style={{ fontSize: 13 }}>Was: {entry.text}</div> : null}
      <Field label="What happened">
        <select className="si-input" value={type} onChange={(e) => setType(e.target.value as EditType)}>
          {EDITABLE.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      <Field label="Team">
        <Choice value={side} onChange={(v) => { setSide(v); setPlayer(""); setAssist(""); setIn(""); setOut(""); }} options={(["a", "b"] as const).map((s) => ({ key: s, label: sides[s].name }))} />
      </Field>
      {shot ? (
        <Field label="Points">
          <Choice value={points} onChange={setPoints} options={[rules.twoPointValue, rules.threePointValue].map((v) => ({ key: v, label: String(v) }))} />
        </Field>
      ) : null}
      {type === "SUBSTITUTION" ? (
        <>
          <Field label="Coming on"><JerseyPick players={roster} side={side} value={inP} onPick={setIn} /></Field>
          <Field label="Going off"><JerseyPick players={roster.filter((x) => x.id !== inP)} side={side} value={outP} onPick={setOut} /></Field>
        </>
      ) : type !== "TIMEOUT" ? (
        <Field label={needsPlayer ? "Player" : "Player (optional)"}><JerseyPick players={roster} side={side} value={player} onPick={setPlayer} /></Field>
      ) : null}
      {type === "SHOT_MADE" ? (
        <Field label="Assist (optional)"><JerseyPick players={roster.filter((x) => x.id !== player)} side={side} value={assist} onPick={setAssist} /></Field>
      ) : null}
      {type === "REBOUND" ? (
        <Field label="Rebound">
          <Choice value={offensive ? "off" : "def"} onChange={(v) => setOffensive(v === "off")} options={[{ key: "off" as const, label: "Offensive" }, { key: "def" as const, label: "Defensive" }]} />
        </Field>
      ) : null}
      {type === "FOUL" ? (
        <Field label="Foul">
          <Choice value={kind} onChange={setKind} options={FOULS.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }))} />
        </Field>
      ) : null}
      <label className="ck-field">
        <span className="ck-label">Reason (kept in the record)</span>
        <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={insert ? "Missed by the scorer" : "Wrong player entered"} />
      </label>
      <button type="button" className="ck-cta" disabled={!ready}
        onClick={() => onSave(type, payload, reason.trim() || (insert ? "Missed event added" : "Edited by the scorer"))}>
        {insert ? "Add this event" : "Save this event"}{player ? ` (${nm(player)})` : ""}
      </button>
    </Sheet>
  );
}

/** The wrong player picked: everything they did in the game moves to the right one (or the two swap). */
function FixPlayerSheet({ ctx, entries, onSave, onClose }: {
  ctx: MatchContext; entries: TimelineEntry[];
  onSave: (from: string, to: string, reason: string) => void; onClose: () => void;
}) {
  const [side, setSide] = useState<Side>("a");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const sides = ctx.sides;
  if (!sides) return null;
  const roster = sides[side].players;
  const played = playersInEvents(entries, roster.map((p) => p.id));
  const appeared = roster.filter((p) => played.has(p.id));
  const name = (id: string) => roster.find((p) => p.id === id)?.name ?? "";
  return (
    <Sheet title="Fix a player" onClose={onClose}>
      <Field label="Team">
        <Choice value={side} onChange={(v) => { setSide(v); setFrom(""); setTo(""); }} options={(["a", "b"] as const).map((s) => ({ key: s, label: sides[s].name }))} />
      </Field>
      <Field label="Recorded as (the wrong name)">
        {appeared.length ? <JerseyPick players={appeared} side={side} value={from} onPick={(id) => { setFrom(id); setTo(""); }} /> : <div className="ck-muted">No one from this team has anything recorded yet.</div>}
      </Field>
      {from ? (
        <Field label="Should be">
          <JerseyPick players={roster.filter((p) => p.id !== from)} side={side} value={to} onPick={setTo} />
        </Field>
      ) : null}
      {from && to ? (
        <div className="ck-muted" style={{ fontSize: 13 }}>
          {played.has(to) ? <>Both played: {name(from)} and {name(to)} swap everything they did.</> : <>Everything {name(from)} did moves to {name(to)}.</>}
        </div>
      ) : null}
      <label className="ck-field">
        <span className="ck-label">Reason (kept in the record)</span>
        <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong player picked" />
      </label>
      <button type="button" className="ck-cta" disabled={!from || !to || !reason.trim()} onClick={() => onSave(from, to, reason.trim())}>Save the fix</button>
    </Sheet>
  );
}
