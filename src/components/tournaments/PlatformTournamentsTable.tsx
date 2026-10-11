"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteTournament } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";

export type PlatformTournamentRow = {
  id: string; name: string; venue: string; sport: string; starts: string;
  teams: string; status: string; statusLabel: string; badge: string;
};

const deletable = (r: PlatformTournamentRow) => r.status === "cancelled" || r.status === "draft";

export default function PlatformTournamentsTable({ rows }: { rows: PlatformTournamentRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const ids = rows.filter(deletable).map((r) => r.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedRows = rows.filter((r) => selected.has(r.id));

  function removeSelected() {
    if (!selectedRows.length) return;
    const list = selectedRows.map((r) => `• ${r.name} (${r.venue}, ${r.statusLabel})`).join("\n");
    if (!window.confirm(`Permanently delete ${selectedRows.length} tournament${selectedRows.length > 1 ? "s" : ""}?\n\n${list}\n\nThis also deletes their teams, matches, scores and payment records, and cannot be undone.`)) return;
    start(async () => {
      const failed: string[] = [];
      for (const r of selectedRows) {
        const res = await deleteTournament(r.id);
        if (isActionError(res)) failed.push(`${r.name}: ${res.message}`);
      }
      setSelected(new Set());
      setErr(failed.length ? failed.join("\n") : null);
      router.refresh();
    });
  }

  return (
    <>
      {ids.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 12px" }}>
          <button type="button" className="tc-btn" disabled={pending} onClick={() => setSelected(allOn ? new Set() : new Set(ids))}>
            {allOn ? "Clear selection" : `Select all cancelled and draft (${ids.length})`}
          </button>
          <button
            type="button" className="tc-btn" disabled={pending || selectedRows.length === 0} onClick={removeSelected}
            style={{ color: selectedRows.length ? "#ef4444" : undefined, borderColor: selectedRows.length ? "#ef4444" : undefined }}
          >
            {pending ? "Deleting…" : `Delete selected (${selectedRows.length})`}
          </button>
        </div>
      )}
      {err && <div className="ev-err" style={{ whiteSpace: "pre-line" }}>{err}</div>}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table className="tc-table stk">
          <thead><tr><th style={{ width: 32 }} /><th>Name</th><th>Venue</th><th>Sport</th><th>Starts</th><th>Teams</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {deletable(r) && (
                    <input type="checkbox" checked={selected.has(r.id)} disabled={pending} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
                  )}
                </td>
                <td data-label="Name"><Link href={`/platform/tournaments/${r.id}`} style={{ fontWeight: 700, color: "inherit" }}>{r.name}</Link></td>
                <td className="tc-dim" data-label="Venue">{r.venue}</td>
                <td className="tc-dim" data-label="Sport">{r.sport}</td>
                <td className="tc-num tc-dim" style={{ fontSize: 12 }} data-label="Starts">{r.starts}</td>
                <td className="tc-num" data-label="Teams">{r.teams}</td>
                <td data-label="Status"><span className={`tc-badge ${r.badge}`}>{r.statusLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
