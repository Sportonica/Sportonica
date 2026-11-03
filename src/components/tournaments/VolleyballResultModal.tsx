"use client";

// Enter a volleyball match's final set scores after it was played.
// Quick result is the set scores and nothing else; the detailed result
// adds what the score sheet recorded. Player figures are only ever what
// is typed here: nothing is worked out from the score.

import { useEffect, useMemo, useState, useTransition } from "react";
import "@/components/intelligence/volleyball/volleyball.css";
import { getVolleyballResult, saveVolleyballResult, type VolleyballResultView } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import type { Side } from "@/lib/intelligence/core/types";
import { MAX_ENTERED_SETS, VOLLEYBALL_LINE_KEYS, checkSetScores, type VolleyballLineKey } from "@/lib/intelligence/sports/volleyballRules";
import type { TournamentMatch } from "@/lib/tournaments/types";

const LINE_LABEL: Record<VolleyballLineKey, string> = {
  manualPoints: "Points", attacks: "Attacks", kills: "Kills", attackErrors: "Attack errors", serves: "Serves", aces: "Aces", serviceErrors: "Service errors",
  blocks: "Block points", blockErrors: "Block errors", digs: "Digs", receptions: "Receptions", receptionPositive: "Good receptions", receptionErrors: "Reception errors",
  assists: "Assists", settingErrors: "Setting errors", substitutions: "Substitutions", yellowCards: "Yellow cards", redCards: "Red cards",
};

type Row = { a: string; b: string };
const score: React.CSSProperties = { font: "inherit", fontSize: 24, fontWeight: 800, textAlign: "center", width: "100%", minHeight: 52, borderRadius: 10, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", padding: "6px 4px" };
const field: React.CSSProperties = { font: "inherit", fontSize: 15, width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit" };

export default function VolleyballResultModal({ match, onClose, onSaved }: {
  match: TournamentMatch;
  onClose: () => void;
  onSaved: (warning: string | null) => void;
}) {
  const [view, setView] = useState<VolleyballResultView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [detailed, setDetailed] = useState(false);
  // how the scorer records players: one number each, or kills, aces and the rest
  const [entryMode, setEntryMode] = useState<"points" | "full">("points");
  const [side, setSide] = useState<Side>("a");
  // phones: one player's figures open at a time, in place of the wide table
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Partial<Record<VolleyballLineKey, string>>>>({});
  const [mvp, setMvp] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [confirmLive, setConfirmLive] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // one id per entry: a second tap or a retry is stored once
  const [clientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    getVolleyballResult(match.id).then((v) => {
      if (cancelled) return;
      if (isActionError(v)) { setLoadErr(v.message); return; }
      setView(v);
      const known = v.entry?.sets ?? [];
      setRows(Array.from({ length: Math.max(v.rules.bestOf, known.length) }, (_, i) => ({ a: known[i] ? String(known[i].a) : "", b: known[i] ? String(known[i].b) : "" })));
      setMvp(v.entry?.mvp ?? "");
      setNotes(v.entry?.notes ?? "");
      const saved = v.entry?.lines ?? [];
      if (saved.length) {
        setDetailed(true);
        if (saved.some((l) => Object.keys(l).some((k) => k !== "player" && k !== "manualPoints"))) setEntryMode("full");
        setLines(Object.fromEntries(saved.map((l) => [String(l.player), Object.fromEntries(Object.entries(l).filter(([k]) => k !== "player").map(([k, x]) => [k, String(x)]))])));
      }
    }).catch(() => setLoadErr("No connection. Close this and try again."));
    return () => { cancelled = true; };
  }, [match.id]);

  // the rows filled in so far; a row half filled still counts, so it is reported
  const lastFilled = rows.reduce((last, r, i) => (r.a !== "" || r.b !== "" ? i : last), -1);
  const sets = useMemo(() => rows.slice(0, lastFilled + 1).map((r) => ({ a: r.a === "" ? NaN : Number(r.a), b: r.b === "" ? NaN : Number(r.b) })), [rows, lastFilled]);
  const check = view ? checkSetScores(sets) : null;

  if (loadErr || !view || !check) {
    return (
      <div className="tc-scrim" onClick={onClose}>
        <div className="tc-modal vb-form" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
          <div className="tc-empty">{loadErr ?? "Loading…"}</div>
          {loadErr ? <div style={{ textAlign: "right" }}><button className="tc-btn" onClick={onClose}>Close</button></div> : null}
        </div>
      </div>
    );
  }

  const nameA = view.sides.a.name, nameB = view.sides.b.name;
  const editing = !!view.entry || view.status === "completed";
  const live = view.livePoints > 0 && !view.entry;
  const typed = lastFilled >= 0;
  // only changed set scores need a reason: player figures can just be updated
  const known = view.entry?.sets ?? null;
  const setsChanged = !known || known.length !== sets.length || known.some((g, i) => g.a !== sets[i].a || g.b !== sets[i].b);
  const askReason = editing && setsChanged;
  const needLive = live && !confirmLive;

  const shownKeys = VOLLEYBALL_LINE_KEYS.filter((k) => (entryMode === "points") === (k === "manualPoints"));
  const otherModeCount = Object.values(lines).filter((l) => VOLLEYBALL_LINE_KEYS.some((k) => !shownKeys.includes(k) && Number(l[k]) > 0)).length;

  const toLines = () => Object.entries(lines).flatMap(([player, l]) => {
    const out: Record<string, unknown> = { player };
    for (const k of VOLLEYBALL_LINE_KEYS) { const v = Number(l[k]); if (l[k] && Number.isFinite(v) && v > 0) out[k] = Math.floor(v); }
    return Object.keys(out).length > 1 ? [out] : [];
  });

  function save() {
    setErr(null);
    startTransition(async () => {
      try {
        const res = await saveVolleyballResult(match.id, {
          // whether or not the section is open: hiding it must not wipe what is in it
          sets, lines: toLines(), mvp: mvp || null, notes,
        }, { clientId, ...(reason.trim() ? { reason } : {}), confirmLive });
        if (isActionError(res)) { setErr(res.message); setConfirming(false); return; }
        onSaved(res.warning);
      } catch { setErr("No connection. Nothing was saved. Try again."); setConfirming(false); }
    });
  }

  if (confirming && check.winner) {
    const w = check.winner, l = w === "a" ? "b" : "a";
    return (
      <div className="tc-scrim">
        <div className="tc-modal vb-form" style={{ maxWidth: 480, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.6 }}>Check the result</div>
          <div style={{ fontSize: 21, fontWeight: 800, margin: "12px 0" }}>{view.sides[w].name} defeated {view.sides[l].name}</div>
          <div style={{ fontSize: 15 }}>Final score: <b>{check.setsWon[w]}–{check.setsWon[l]}</b></div>
          <div style={{ fontSize: 15, margin: "8px 0 16px", fontVariantNumeric: "tabular-nums" }}>{sets.map((g) => `${g.a}–${g.b}`).join(" | ")}</div>
          {reason.trim() ? <div className="tc-dim" style={{ fontSize: 12.5, marginBottom: 12 }}>Reason on the record: {reason}</div> : null}
          <div className="tc-dim" style={{ fontSize: 12.5, marginBottom: 16 }}>Saving marks the match completed and updates the table and bracket.</div>
          <div style={{ display: "grid", gap: 8 }}>
            <button className="tc-btn primary" style={{ padding: 14, fontSize: 15 }} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save result"}</button>
            <button className="tc-btn" style={{ padding: 12 }} disabled={pending} onClick={() => setConfirming(false)}>Edit scores</button>
            <button className="tc-btn" style={{ padding: 12 }} disabled={pending} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tc-scrim" onClick={onClose}>
      <div className="tc-modal vb-form" style={{ maxWidth: detailed ? 720 : 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Enter match result</h3>
          <button aria-label="Close" onClick={onClose} style={{ background: "none", border: "none", color: "inherit", opacity: 0.6, cursor: "pointer", width: 36, height: 36, fontSize: 18 }}>×</button>
        </div>
        <div className="tc-dim" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Usual format: best of {view.rules.bestOf}, sets to {view.rules.setPoints}. Enter the scores as played: any number of sets, any points. The team with more points takes a set, and the team with more sets wins.
        </div>

        {live ? (
          <label style={{ display: "flex", gap: 10, padding: 12, borderRadius: 10, border: "1px solid #d97706", marginBottom: 12, fontSize: 13, lineHeight: 1.45 }}>
            <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} style={{ width: 18, height: 18, flex: "none", marginTop: 2 }} />
            <span>This match was being scored live ({view.liveSets.map((g) => `${g.a}–${g.b}`).join(", ") || "0–0"}, {view.livePoints} points). The result you enter replaces that score. The live history stays on the record.</span>
          </label>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "58px 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div />
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13.5, overflowWrap: "anywhere" }}>{nameA}</div>
          <div style={{ textAlign: "center", fontWeight: 800, fontSize: 13.5, overflowWrap: "anywhere" }}>{nameB}</div>
          {rows.map((r, i) => {
            return (
              <div key={i} style={{ display: "contents" }}>
                <div className="tc-dim" style={{ fontSize: 13, fontWeight: 700 }}>Set {i + 1}</div>
                {(["a", "b"] as Side[]).map((s) => (
                  <input key={s} style={{ ...score, borderColor: check.winners[i] === s ? "#00a86b" : undefined }} inputMode="numeric" pattern="[0-9]*" value={r[s]}
                    aria-label={`Set ${i + 1} ${s === "a" ? nameA : nameB}`}
                    onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); setRows((all) => all.map((x, k) => (k === i ? { ...x, [s]: v } : x))); }} />
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className="tc-btn" style={{ flex: 1, justifyContent: "center", minHeight: 40 }} disabled={rows.length >= MAX_ENTERED_SETS}
            onClick={() => setRows((all) => [...all, { a: "", b: "" }])}>+ Add set</button>
          <button type="button" className="tc-btn" style={{ flex: 1, justifyContent: "center", minHeight: 40 }} disabled={rows.length <= 1}
            onClick={() => setRows((all) => all.slice(0, -1))}>Remove last set</button>
        </div>

        <div style={{ marginTop: 14, minHeight: 44 }}>
          {!typed ? null : check.winner ? (
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(0,168,107,.12)", textAlign: "center" }}>
              <div style={{ fontSize: 13.5 }}>{nameA} {check.setsWon.a} {check.setsWon.a === 1 ? "set" : "sets"} · {nameB} {check.setsWon.b} {check.setsWon.b === 1 ? "set" : "sets"}</div>
              <div style={{ fontWeight: 800, marginTop: 2 }}>Winner: {view.sides[check.winner].name}</div>
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, color: "#d97706", fontSize: 13, lineHeight: 1.5 }}>
              {check.errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>

        <button className="tc-btn" style={{ marginTop: 12, padding: "8px 12px", fontSize: 12.5 }} aria-expanded={detailed} onClick={() => setDetailed(!detailed)}>
          {detailed ? "Hide player points and statistics" : "Add player points, statistics, MVP and notes (optional)"}
        </button>

        {detailed ? (
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <div role="group" aria-label="How to record players" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" className={`tc-btn ${entryMode === "points" ? "primary" : ""}`} aria-pressed={entryMode === "points"} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setEntryMode("points")}>Direct points</button>
              <button type="button" className={`tc-btn ${entryMode === "full" ? "primary" : ""}`} aria-pressed={entryMode === "full"} style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => setEntryMode("full")}>Kills and full stats</button>
            </div>
            <div className="tc-dim" style={{ fontSize: 12.5 }}>
              {entryMode === "points" ? "Type each player's points. Nothing else is needed." : "Only what you type is recorded. Leave anything you don't have empty."} These never change the set scores.
            </div>
            {otherModeCount ? (
              <div style={{ fontSize: 12.5, color: "#d97706" }}>
                {otherModeCount} player{otherModeCount === 1 ? " has" : "s have"} {entryMode === "points" ? "kills or other stats" : "direct points"} entered too. Both count towards their points, so clear one if they are the same points.
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 6 }}>
              {(["a", "b"] as Side[]).map((s) => <button key={s} className={`tc-btn ${side === s ? "primary" : ""}`} style={{ padding: "7px 12px", fontSize: 12.5 }} onClick={() => setSide(s)}>{view.sides[s].name}</button>)}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className={`tc-table vb-lines${entryMode === "points" ? " points-only" : ""}`} style={entryMode === "points" ? undefined : { minWidth: 1180 }}>
                <thead><tr><th>Player</th>{shownKeys.map((k) => <th key={k} style={{ fontSize: 10.5 }}>{LINE_LABEL[k]}</th>)}</tr></thead>
                <tbody>
                  {view.sides[side].players.map((p) => (
                    <tr key={p.id} className={openPlayer === p.id ? "open" : ""}>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        <button type="button" className="vb-line-name" aria-expanded={openPlayer === p.id} onClick={() => setOpenPlayer(openPlayer === p.id ? null : p.id)}>
                          <span>{p.number != null ? `#${p.number} ` : ""}{p.name}</span>
                          {view.addedPoints[p.id] ? <small style={{ display: "block", fontWeight: 500, opacity: 0.7 }}>+{view.addedPoints[p.id]} added from Player points</small> : null}
                          {lines[p.id] && Object.values(lines[p.id]).some(Boolean) ? <small>{Object.values(lines[p.id]).filter(Boolean).length} entered</small> : null}
                        </button>
                      </td>
                      {shownKeys.map((k) => (
                        <td key={k} data-label={LINE_LABEL[k]}><input inputMode="numeric" aria-label={`${p.name} ${LINE_LABEL[k]}`} value={lines[p.id]?.[k] ?? ""} style={{ font: "inherit", width: 44, padding: "6px 3px", textAlign: "center", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit" }}
                          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); setLines((all) => ({ ...all, [p.id]: { ...all[p.id], [k]: v } })); }} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Match MVP
              <select style={field} value={mvp} onChange={(e) => setMvp(e.target.value)}>
                <option value="">None</option>
                {(["a", "b"] as Side[]).map((s) => <optgroup key={s} label={view.sides[s].name}>{view.sides[s].players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>Match notes
              <textarea style={{ ...field, minHeight: 70 }} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        ) : null}

        {askReason ? (
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700, marginTop: 12 }}>Why are the set scores changing? (optional, kept on the record)
            <input style={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </label>
        ) : null}

        {view.revisions.length ? (
          <details style={{ marginTop: 12, fontSize: 13 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Earlier changes ({view.revisions.length})</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
              {view.revisions.map((r, i) => (
                <li key={i}>
                  {r.from.map((g) => `${g.a}–${g.b}`).join(", ") === r.to.map((g) => `${g.a}–${g.b}`).join(", ") ? "Set scores unchanged" : <>{r.from.map((g) => `${g.a}–${g.b}`).join(", ")} changed to {r.to.map((g) => `${g.a}–${g.b}`).join(", ")}</>}. &ldquo;{r.reason}&rdquo;
                  <span className="tc-dim"> {r.by ?? "An organiser"}, {new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kathmandu" })}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {err ? <div role="alert" style={{ color: "#ef4444", fontSize: 13, marginTop: 10 }}>{err}</div> : null}
        {check.winner && needLive ? <div className="tc-dim" style={{ fontSize: 12.5, marginTop: 10 }}>Tick the box at the top to replace the live score.</div> : null}
        <button className="tc-btn primary" style={{ width: "100%", padding: 14, fontSize: 15, marginTop: 14, justifyContent: "center", textAlign: "center" }} disabled={!check.winner || needLive} onClick={() => { setErr(null); setConfirming(true); }}>
          Review result
        </button>
      </div>
    </div>
  );
}
