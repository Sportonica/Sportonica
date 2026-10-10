"use client";

// The two pop-up sheets of the cricket scorer: recording a wicket, and
// editing a ball already bowled. Both build an ordinary DELIVERY payload;
// the engine's rules decide whether it stands.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MatchContext, Participant, Side } from "@/lib/intelligence/core/types";
import type { TimelineEntry } from "@/lib/intelligence/types";
import { describeDelivery, parseBallLabel, participant, type DeliveryPayload } from "@/lib/intelligence/sports/cricketView";
import type { CricketState } from "@/lib/intelligence/sports/cricket";
import type { CricketBulkEdit, OverRef, PlayerRole } from "@/lib/intelligence/sports/cricketEdits";
import { Jersey, teamColor } from "../pads/shared";

export type Extra = "wide" | "no_ball" | "bye" | "leg_bye";
export const EXTRA_LABEL: Record<Extra, string> = { wide: "Wide", no_ball: "No ball", bye: "Bye", leg_bye: "Leg bye" };

export const DISMISSALS: { key: string; label: string; fielder?: string; anyBatter?: boolean; onWide?: boolean; onNoBall?: boolean; rare?: boolean }[] = [
  { key: "bowled", label: "Bowled" },
  { key: "caught", label: "Caught", fielder: "Caught by" },
  { key: "run_out", label: "Run out", fielder: "Run out by", anyBatter: true, onWide: true, onNoBall: true },
  { key: "stumped", label: "Stumped", fielder: "Stumped by", onWide: true },
  { key: "lbw", label: "LBW" },
  { key: "hit_wicket", label: "Hit wicket", onWide: true },
  { key: "obstructing_field", label: "Obstructing the field", anyBatter: true, onWide: true, onNoBall: true, rare: true },
  { key: "hit_ball_twice", label: "Hit the ball twice", onNoBall: true, rare: true },
];

/** Runs entered on a key go off the bat, or as extras on a wide, bye or leg bye. */
export function deliveryPayload(base: { striker: string; nonStriker: string; bowler: string }, runs: number, extra: Extra | null,
  wicket: { type: string; player?: string; fielder?: string } | null, note?: string): Record<string, unknown> {
  const p: Record<string, unknown> = { ...base };
  if (extra === "wide" || extra === "bye" || extra === "leg_bye") p.extraRuns = runs; else p.runsBat = runs;
  if (extra) p.extra = extra;
  if (wicket) p.wicket = { type: wicket.type, player: wicket.player || base.striker, ...(wicket.fielder ? { fielder: wicket.fielder } : {}) };
  if (note?.trim()) p.commentary = note.trim();
  return p;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  // on document.body: a transformed ancestor would otherwise pin "fixed" to itself, and the app's bottom bar would cover it
  return createPortal(
    <div className="si ck-sheet-bg" onClick={onClose}>
      <div className="ck-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ck-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="ck-link" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { key: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="ck-choice" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.key)} type="button" role="radio" aria-checked={value === o.key} disabled={o.disabled}
          className={value === o.key ? "on" : ""} onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="ck-field"><span className="ck-label">{label}</span>{children}</div>;
}

function JerseyPick({ players, side, value, onPick }: { players: Participant[]; side: Side; value: string; onPick: (id: string) => void }) {
  return (
    <div className="si-jerseys">
      {players.map((p) => <Jersey key={p.id} p={p} color={teamColor(side)} on={value === p.id} onClick={() => onPick(value === p.id ? "" : p.id)} />)}
    </div>
  );
}

export interface WicketInput { type: string; player: string; fielder: string; runs: number; newBatter: string }

export function WicketSheet({ striker, nonStriker, extra, fielders, fieldingSide, battingSide, available, name, canBringIn, onRecord, onClose }: {
  striker: string; nonStriker: string; extra: Extra | null;
  fielders: Participant[]; fieldingSide: Side; battingSide: Side;
  /** who could walk in next */
  available: Participant[];
  name: (id: string) => string;
  /** false when this wicket ends the innings, so nobody is asked to come in */
  canBringIn: (w: WicketInput) => boolean;
  onRecord: (w: WicketInput) => void; onClose: () => void;
}) {
  const allowed = DISMISSALS.filter((d) => (extra === "wide" ? d.onWide : extra === "no_ball" ? d.onNoBall : true));
  const [type, setType] = useState(allowed[0]?.key ?? "bowled");
  const [rare, setRare] = useState(false);
  const [player, setPlayer] = useState(striker);
  const [fielder, setFielder] = useState("");
  const [runs, setRuns] = useState(0);
  const [newBatter, setNewBatter] = useState("");
  const d = DISMISSALS.find((x) => x.key === type)!;
  const out = d.anyBatter ? player : striker;
  const input: WicketInput = { type, player: out, fielder: d.fielder ? fielder : "", runs: d.anyBatter ? runs : 0, newBatter };
  const bringIn = available.length > 0 && canBringIn(input);
  return (
    <Sheet title={extra ? `Wicket on a ${EXTRA_LABEL[extra].toLowerCase()}` : "Wicket"} onClose={onClose}>
      <Field label="Dismissal">
        <Choice value={type} onChange={(v) => { setType(v); setFielder(""); setRuns(0); setPlayer(striker); }}
          options={[...allowed.filter((x) => rare || !x.rare).map((x) => ({ key: x.key, label: x.label }))]} />
        {!rare && allowed.some((x) => x.rare) ? <button type="button" className="ck-link" onClick={() => setRare(true)}>Other dismissals</button> : null}
      </Field>
      {d.anyBatter ? (
        <>
          <Field label="Who is out?">
            <Choice value={player} onChange={setPlayer} options={[{ key: striker, label: `${name(striker)} (striker)` }, { key: nonStriker, label: name(nonStriker) }]} />
          </Field>
          <Field label="Runs completed before the wicket">
            <Choice value={runs} onChange={setRuns} options={[0, 1, 2, 3].map((r) => ({ key: r, label: String(r) }))} />
          </Field>
        </>
      ) : null}
      {d.fielder ? (
        <Field label={`${d.fielder} (optional)`}>
          <JerseyPick players={fielders} side={fieldingSide} value={fielder} onPick={setFielder} />
        </Field>
      ) : null}
      {bringIn ? (
        <Field label="New batter (optional, or pick next)">
          <JerseyPick players={available} side={battingSide} value={newBatter} onPick={setNewBatter} />
        </Field>
      ) : null}
      <button type="button" className="ck-cta danger" onClick={() => onRecord(bringIn ? input : { ...input, newBatter: "" })}>
        Record wicket: {name(out)} {d.label.toLowerCase()}
      </button>
    </Sheet>
  );
}

/**
 * Change what happened on a ball already bowled. The batters and bowler
 * stay those of that ball (not whoever is on now), so an old ball keeps
 * its place in the innings.
 */
export function EditDeliverySheet({ entry, ctx, onSave, onClose }: {
  entry: TimelineEntry; ctx: MatchContext;
  onSave: (payload: Record<string, unknown>, reason: string) => void; onClose: () => void;
}) {
  const p = entry.payload as DeliveryPayload;
  const striker = p.striker ?? "", nonStriker = p.nonStriker ?? "", bowler = p.bowler ?? "";
  const fieldingSide: Side = ctx.sides?.a.players.some((x) => x.id === bowler) ? "a" : "b";
  const fielders = ctx.sides?.[fieldingSide].players ?? [];
  const [extra, setExtra] = useState<Extra | "none">(p.extra ?? "none");
  const [runs, setRuns] = useState<number>(p.extra === "wide" || p.extra === "bye" || p.extra === "leg_bye" ? p.extraRuns ?? 0 : p.runsBat ?? 0);
  const [wkt, setWkt] = useState<string>(p.wicket?.type ?? "none");
  const [out, setOut] = useState<string>(p.wicket?.player ?? striker);
  const [fielder, setFielder] = useState<string>(p.wicket?.fielder ?? "");
  const [reason, setReason] = useState("");
  // the runs were put against the wrong batter: the other one at the crease faced it
  const [faced, setFaced] = useState<string>(striker);
  const other = faced === striker ? nonStriker : striker;
  const nm = (id: string) => participant(ctx, id)?.name ?? "";
  const d = DISMISSALS.find((x) => x.key === wkt);
  const ex = extra === "none" ? null : extra;
  const payload = deliveryPayload({ striker: faced, nonStriker: other, bowler }, runs, ex,
    d ? { type: d.key, player: d.anyBatter ? out : faced, fielder: d.fielder ? fielder : "" } : null, p.commentary);
  const preview = describeDelivery(payload as DeliveryPayload, ctx);
  // a wicket taken away, or put on the other batter, changes who batted after this ball
  const wasOut = p.wicket ? (p.wicket.player ?? striker) : null;
  const nowOut = d ? (d.anyBatter ? out : faced) : null;
  const knockOn = wasOut && wasOut !== nowOut
    ? nowOut
      ? `${nm(wasOut)} and ${nm(nowOut)} swap for the rest of the innings.`
      : `${nm(wasOut)} stays in: the batter who came in for this wicket is taken out, and ${nm(wasOut)} gets their later balls.`
    : null;
  return (
    <Sheet title={`Edit ${parseBallLabel(entry.label)?.superOver ? "super over " : ""}ball ${parseBallLabel(entry.label)?.ball ?? ""}`} onClose={onClose}>
      <div className="ck-muted" style={{ fontSize: 13 }}>{nm(bowler)} to {nm(faced)}</div>
      {nonStriker ? (
        <Field label="Faced by">
          <Choice value={faced} onChange={setFaced} options={[{ key: striker, label: nm(striker) }, { key: nonStriker, label: nm(nonStriker) }]} />
        </Field>
      ) : null}
      <Field label="Extra">
        <Choice value={extra} onChange={(v) => { setExtra(v); if ((v === "bye" || v === "leg_bye") && runs === 0) setRuns(1); }}
          options={[{ key: "none" as const, label: "None" }, ...(Object.keys(EXTRA_LABEL) as Extra[]).map((k) => ({ key: k, label: EXTRA_LABEL[k] }))]} />
      </Field>
      <Field label={ex === "wide" ? "Runs run on the wide" : ex === "bye" || ex === "leg_bye" ? "Runs run" : "Runs off the bat"}>
        <Choice value={runs} onChange={setRuns}
          options={[0, 1, 2, 3, 4, 5, 6].map((r) => ({ key: r, label: String(r), disabled: (ex === "bye" || ex === "leg_bye") && r === 0 }))} />
      </Field>
      <Field label="Wicket">
        <Choice value={wkt} onChange={(v) => { setWkt(v); setFielder(""); }}
          options={[{ key: "none", label: "No wicket" }, ...DISMISSALS.map((x) => ({ key: x.key, label: x.label }))]} />
      </Field>
      {d?.anyBatter ? (
        <Field label="Who is out?">
          <Choice value={out} onChange={setOut} options={[{ key: striker, label: nm(striker) }, { key: nonStriker, label: nm(nonStriker) }]} />
        </Field>
      ) : null}
      {d?.fielder ? (
        <Field label={`${d.fielder} (optional)`}>
          <JerseyPick players={fielders} side={fieldingSide} value={fielder} onPick={setFielder} />
        </Field>
      ) : null}
      {knockOn ? <div className="ck-muted" style={{ fontSize: 13 }}>{knockOn}</div> : null}
      <label className="ck-field">
        <span className="ck-label">Reason (kept in the record)</span>
        <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong runs entered" />
      </label>
      <div className="ck-preview"><span className={`ck-ball ${preview.tone}`}>{preview.badge}</span> {preview.text}</div>
      <button type="button" className="ck-cta" onClick={() => onSave(payload, reason.trim() || "Edited by the scorer")}>Save this ball</button>
    </Sheet>
  );
}

/**
 * Fixes across many balls: the wrong player picked (their batting, bowling
 * or fielding moves to the right player, or the two swap if both played)
 * and the wrong bowler for a whole over. Kept in the record like any edit.
 */
export function BulkFixSheet({ ctx, state, overs, onSave, onClose }: {
  ctx: MatchContext; state: CricketState; overs: OverRef[] | null;
  onSave: (edit: CricketBulkEdit, reason: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"player" | "over">("player");
  const [side, setSide] = useState<Side>("a");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [role, setRole] = useState<PlayerRole>("batting");
  const [over, setOver] = useState("");
  const [bowler, setBowler] = useState("");
  const [reason, setReason] = useState("");
  const sides = ctx.sides;
  if (!sides) return null;
  const nm = (id: string) => participant(ctx, id)?.name ?? "";

  // who did what in this match, per player
  const did = new Map<string, Set<PlayerRole>>();
  const mark = (id: string | null | undefined, r: PlayerRole) => { if (id) (did.get(id) ?? did.set(id, new Set()).get(id)!).add(r); };
  for (const inn of state.innings ?? []) {
    Object.keys(inn.batters ?? {}).forEach((id) => mark(id, "batting"));
    Object.keys(inn.bowlers ?? {}).forEach((id) => mark(id, "bowling"));
    Object.keys(inn.fielding ?? {}).forEach((id) => mark(id, "fielding"));
  }
  const roster = sides[side].players;
  const appeared = roster.filter((p) => did.has(p.id));
  const pickFrom = (id: string) => {
    setFrom(id); setTo("");
    const r = did.get(id);
    if (r) setRole(r.has("batting") ? "batting" : r.has("bowling") ? "bowling" : "fielding");
  };
  const roleText = role === "all" ? "records" : role;
  const has = (id: string) => (role === "all" ? (did.get(id)?.size ?? 0) > 0 : !!did.get(id)?.has(role));
  const fromHas = !!from && has(from), toHas = !!to && has(to);

  const o = overs?.find((x) => x.key === over);
  const fieldingSide: Side | null = o ? (sides.a.players.some((p) => p.id === o.bowler) ? "a" : "b") : null;

  const ready = reason.trim().length > 0 && (tab === "player" ? !!from && !!to && (fromHas || toHas) : !!o && !!bowler && bowler !== o.bowler);
  const save = () => {
    if (!ready) return;
    onSave(tab === "player" ? { kind: "player", from, to, role } : { kind: "overBowler", over, bowler }, reason.trim());
  };

  return (
    <Sheet title="Fix a player or bowler" onClose={onClose}>
      <Choice value={tab} onChange={setTab} options={[{ key: "player" as const, label: "Wrong player" }, { key: "over" as const, label: "Wrong bowler for an over" }]} />
      {tab === "player" ? (
        <>
          <Field label="Team">
            <Choice value={side} onChange={(v) => { setSide(v); setFrom(""); setTo(""); }} options={(["a", "b"] as const).map((s) => ({ key: s, label: sides[s].name }))} />
          </Field>
          <Field label="Recorded as (the wrong name)">
            {appeared.length ? <JerseyPick players={appeared} side={side} value={from} onPick={pickFrom} /> : <div className="ck-muted">No one from this team has played yet.</div>}
          </Field>
          {from ? (
            <>
              <Field label="Should be">
                <JerseyPick players={roster.filter((p) => p.id !== from)} side={side} value={to} onPick={setTo} />
              </Field>
              <Field label="Move their">
                <Choice value={role} onChange={setRole} options={[
                  { key: "batting" as const, label: "Batting", disabled: !did.get(from)?.has("batting") && !did.get(to)?.has("batting") },
                  { key: "bowling" as const, label: "Bowling", disabled: !did.get(from)?.has("bowling") && !did.get(to)?.has("bowling") },
                  { key: "fielding" as const, label: "Catches, run outs", disabled: !did.get(from)?.has("fielding") && !did.get(to)?.has("fielding") },
                  { key: "all" as const, label: "Everything" },
                ]} />
              </Field>
              {to ? (
                <div className="ck-muted" style={{ fontSize: 13 }}>
                  {fromHas && toHas ? <>Both have {roleText}: {nm(from)} and {nm(to)} swap theirs.</>
                    : fromHas ? <>{nm(from)}&apos;s {roleText} moves to {nm(to)}.</>
                    : toHas ? <>{nm(to)}&apos;s {roleText} moves to {nm(from)}.</>
                    : <>Neither has any {roleText} in this match.</>}
                  {(fromHas || toHas) && role !== "all" ? " Nothing else changes." : ""}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Field label="Over">
            {overs === null ? <div className="ck-muted">Loading the overs…</div> : overs.length ? (
              <select className="si-input" value={over} onChange={(e) => { setOver(e.target.value); setBowler(""); }}>
                <option value="">Choose the over</option>
                {overs.map((x) => <option key={x.key} value={x.key}>{x.label}: {nm(x.bowler)}</option>)}
              </select>
            ) : <div className="ck-muted">No overs bowled yet.</div>}
          </Field>
          {o && fieldingSide ? (
            <Field label={`Bowled by (now ${nm(o.bowler)})`}>
              <JerseyPick players={sides[fieldingSide].players.filter((p) => p.id !== o.bowler)} side={fieldingSide} value={bowler} onPick={setBowler} />
            </Field>
          ) : null}
        </>
      )}
      <label className="ck-field">
        <span className="ck-label">Reason (kept in the record)</span>
        <input className="si-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tab === "player" ? "Wrong player picked" : "Wrong bowler entered"} />
      </label>
      <button type="button" className="ck-cta" disabled={!ready} onClick={save}>Save the fix</button>
    </Sheet>
  );
}
