"use client";

import { useMemo, useState } from "react";
import { setPrizeGiven, type QuizEntry } from "@/lib/quiz/actions";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function downloadCsv(rows: QuizEntry[]) {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Started", "Name", "Phone", "Score", "Out of", "Seconds", "Winner code", "Prize given", "Prize"].map(cell).join(",")];
  for (const r of rows) lines.push([r.created_at, r.full_name, r.phone, r.score, r.max_score, r.duration_ms === null ? null : (r.duration_ms / 1000).toFixed(1), r.winner_code, r.prize_given_at, r.prize_note].map(cell).join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = `quiz-entries-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export default function QuizEntries({ entries: initial }: { entries: QuizEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [q, setQ] = useState("");
  const [winnersOnly, setWinnersOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toUpperCase().replace(/^W-?/, "");
    return entries.filter((e) => (!winnersOnly || e.winner_code)
      && (!s || e.full_name.toUpperCase().includes(s) || e.phone.includes(s) || (e.winner_code ?? "").replace("W-", "").includes(s)));
  }, [entries, q, winnersOnly]);

  const winners = entries.filter((e) => e.winner_code);
  const give = async (e: QuizEntry, undo = false) => {
    const note = undo ? null : window.prompt(`Prize ${e.full_name} picked from the bowl (optional)`, "");
    if (!undo && note === null) return;
    const res = await setPrizeGiven(e.id, note);
    if ("message" in res) { setError(res.message); return; }
    setError(null);
    setEntries((all) => all.map((x) => (x.id === e.id ? { ...x, prize_given_at: undo ? null : new Date().toISOString(), prize_note: undo ? null : note?.trim() || null } : x)));
  };

  return (
    <>
      <div className="plt-stats">
        <div className="plt-stat"><div className="plt-stat-v">{entries.length}</div><div className="plt-stat-l">Entries</div></div>
        <div className="plt-stat"><div className="plt-stat-v">{entries.filter((e) => sameDay(e.created_at)).length}</div><div className="plt-stat-l">Today</div></div>
        <div className="plt-stat"><div className="plt-stat-v">{winners.length}</div><div className="plt-stat-l">Perfect scores</div></div>
        <div className="plt-stat"><div className="plt-stat-v">{winners.filter((e) => e.prize_given_at).length}</div><div className="plt-stat-l">Prizes given</div></div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Winner code, name or phone"
          style={{ flex: "1 1 240px", font: "inherit", fontSize: 15, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit" }} />
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={winnersOnly} onChange={(e) => setWinnersOnly(e.target.checked)} /> Winners only
        </label>
        <button type="button" onClick={() => downloadCsv(shown)}
          style={{ font: "inherit", fontSize: 13.5, fontWeight: 700, padding: "9px 14px", borderRadius: 10, border: 0, background: "#006241", color: "#fff", cursor: "pointer" }}>
          Download CSV ({shown.length})
        </button>
      </div>
      {error ? <p style={{ color: "#ef4444", fontSize: 14 }}>{error}</p> : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.6, fontSize: 12 }}>
              <th style={{ padding: 8 }}>Time</th><th style={{ padding: 8 }}>Name</th><th style={{ padding: 8 }}>Phone</th>
              <th style={{ padding: 8 }}>Score</th><th style={{ padding: 8 }}>Time</th><th style={{ padding: 8 }}>Winner code</th><th style={{ padding: 8 }}>Prize</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid rgba(127,127,127,.2)" }}>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>{when(e.created_at)}</td>
                <td style={{ padding: 8 }}>{e.full_name}</td>
                <td style={{ padding: 8 }}>{e.phone}</td>
                <td style={{ padding: 8, fontWeight: 700 }}>{e.score === null ? <span style={{ opacity: 0.6, fontWeight: 400 }}>not finished</span> : `${e.score}/${e.max_score}`}</td>
                <td style={{ padding: 8 }}>{e.duration_ms === null ? "" : `${(e.duration_ms / 1000).toFixed(1)} s`}</td>
                <td style={{ padding: 8, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{e.winner_code ?? ""}</td>
                <td style={{ padding: 8 }}>
                  {!e.winner_code ? null : e.prize_given_at ? (
                    <span>Given{e.prize_note ? `: ${e.prize_note}` : ""} <button type="button" onClick={() => void give(e, true)} style={{ font: "inherit", fontSize: 12, background: "none", border: 0, color: "#3d8a68", cursor: "pointer" }}>undo</button></span>
                  ) : (
                    <button type="button" onClick={() => void give(e)} style={{ font: "inherit", fontSize: 13, fontWeight: 700, padding: "6px 10px", borderRadius: 8, border: "1px solid #3d8a68", background: "transparent", color: "inherit", cursor: "pointer" }}>Mark prize given</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length ? <p style={{ opacity: 0.6, fontSize: 14, padding: 8 }}>{entries.length ? "No entries match." : "No entries yet."}</p> : null}
      </div>
    </>
  );
}
