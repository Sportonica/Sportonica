"use client";

import { SPORT_NAMES as SPORTS, SPORT_COLORS as SPORT_COLOR } from "@/lib/sports";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Clock, X, Trash2, Power } from "lucide-react";
import { createCourt, setCourtHours, deleteCourt, setCourtActive } from "@/lib/admin/actions";
import { isActionError } from "@/lib/actionError";
import type { Court, CourtHours } from "@/lib/admin/types";
import { DOW_LABELS, COURT_HAS_HISTORY } from "@/lib/admin/types";



export default function CourtManager({
  venueId, venueSports, courts, hoursByCourt,
}: {
  venueId: string;
  venueSports: string[];
  courts: Court[];
  hoursByCourt: Record<string, CourtHours[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingHours, setEditingHours] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Per-court error (e.g. "has history, deactivate instead"), keyed by court id.
  const [courtErr, setCourtErr] = useState<{ id: string; message: string } | null>(null);

  function removeCourt(c: Court) {
    if (!window.confirm(`Delete ${c.name}? Its hours and pricing rules go with it. This can't be undone.`)) return;
    setCourtErr(null);
    startTransition(async () => {
      const res = await deleteCourt(c.id, venueId);
      if (isActionError(res)) { setCourtErr({ id: c.id, message: res.message }); return; }
      router.refresh();
    });
  }

  function toggleCourt(c: Court) {
    const active = c.status !== "active";
    if (!active && !window.confirm(`Deactivate ${c.name}? Players won't be able to book it until you turn it back on.`)) return;
    setCourtErr(null);
    startTransition(async () => {
      const res = await setCourtActive(c.id, venueId, active);
      if (isActionError(res)) { setCourtErr({ id: c.id, message: res.message }); return; }
      router.refresh();
    });
  }

  const sportOpts = venueSports.length ? venueSports : SPORTS;
  const [name, setName] = useState("Court 1");
  const [sport, setSport] = useState(sportOpts[0]);
  const [price, setPrice] = useState("1500");

  function addCourt() {
    setErr(null);
    startTransition(async () => {
      const res = await createCourt({ venue_id: venueId, name: name.trim(), sport, base_price: Number(price) || 0 });
      if (isActionError(res)) { setErr(res.message); return; }
      setAdding(false);
      setName(`Court ${courts.length + 2}`);
      router.refresh();
    });
  }

  return (
    <div className="adm-card">
      <div className="adm-between" style={{ marginBottom: 16 }}>
        <div>
          <div className="adm-card-t">Courts</div>
          <div className="adm-card-sub" style={{ marginBottom: 0 }}>Each court has its own hours, pricing and calendar.</div>
        </div>
        {!adding && (
          <button className="adm-btn sm primary" onClick={() => setAdding(true)}><Plus size={14} /> Add court</button>
        )}
      </div>

      {adding && (
        <div style={{ background: "var(--a-bg)", border: "1px solid var(--a-line-2)", borderRadius: 11, padding: 16, marginBottom: 16 }}>
          <div className="adm-row">
            <div className="adm-field">
              <label className="adm-label">Court name</label>
              <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="adm-field">
              <label className="adm-label">Sport</label>
              <select className="adm-select" value={sport} onChange={(e) => setSport(e.target.value)}>
                {sportOpts.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="adm-field">
            <label className="adm-label">Base price (Rs / hour)</label>
            <input className="adm-input mono" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} />
          </div>
          {err && <div className="adm-badge danger" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="adm-flex">
            <button className="adm-btn primary sm" onClick={addCourt} disabled={pending}>{pending ? "Saving…" : "Save court"}</button>
            <button className="adm-btn ghost sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {courts.length === 0 && !adding ? (
        <div className="adm-dim" style={{ fontSize: 13, padding: "10px 0" }}>
          No courts yet. Add your first court to set hours and take bookings.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {courts.map((c) => (
            <div key={c.id}>
              <div className="adm-between" style={{ padding: "12px 14px", background: "var(--a-bg)", borderRadius: 10, border: "1px solid var(--a-line)" }}>
                <div style={{ opacity: c.status === "active" ? 1 : 0.6 }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.name} <span className="adm-dim" style={{ fontWeight: 400, fontSize: 12 }}>· {c.sport}</span>
                    {c.status !== "active" && <span className="adm-badge neutral" style={{ marginLeft: 8 }}>{c.status === "maintenance" ? "Maintenance" : "Inactive"}</span>}
                  </div>
                  <div className="adm-num adm-dim" style={{ fontSize: 12, marginTop: 2 }}>
                    Rs {c.base_price}/hr · {(hoursByCourt[c.id]?.length ?? 0)} day{(hoursByCourt[c.id]?.length ?? 0) !== 1 ? "s" : ""} open
                  </div>
                </div>
                <div className="adm-flex" style={{ gap: 6 }}>
                  <button className="adm-btn sm ghost" onClick={() => setEditingHours(editingHours === c.id ? null : c.id)}>
                    <Clock size={13} /> Hours
                  </button>
                  <button
                    className={`adm-btn sm ghost${courtErr?.id === c.id && courtErr.message === COURT_HAS_HISTORY ? " primary" : ""}`}
                    onClick={() => toggleCourt(c)} disabled={pending}
                    title={c.status === "active" ? "Hide from players" : "Take bookings again"}
                  >
                    <Power size={13} /> {c.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                  <button className="adm-btn sm ghost danger" onClick={() => removeCourt(c)} disabled={pending} aria-label={`Delete ${c.name}`} title="Delete court">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {courtErr?.id === c.id && (
                <div className="adm-badge danger" style={{ marginTop: 6, whiteSpace: "normal", lineHeight: 1.45 }}>{courtErr.message}</div>
              )}
              {editingHours === c.id && (
                <HoursEditor
                  courtId={c.id}
                  venueId={venueId}
                  existing={hoursByCourt[c.id] ?? []}
                  onDone={() => { setEditingHours(null); router.refresh(); }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HoursEditor({
  courtId, venueId, existing, onDone,
}: { courtId: string; venueId: string; existing: CourtHours[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // day -> {open, close} | null(closed)
  const init: Record<number, { open: string; close: string } | null> = {};
  for (let d = 0; d < 7; d++) {
    const row = existing.find((h) => h.dow === d);
    init[d] = row ? { open: row.open_time.slice(0, 5), close: row.close_time.slice(0, 5) } : null;
  }
  const [days, setDays] = useState(init);

  const setDay = (d: number, val: { open: string; close: string } | null) =>
    setDays((prev) => ({ ...prev, [d]: val }));

  function save() {
    setErr(null);
    const rows = Object.entries(days)
      .filter(([, v]) => v)
      .map(([d, v]) => ({ dow: Number(d), open_time: v!.open, close_time: v!.close }));
    // The schema has no way to represent hours crossing midnight (a single
    // open/close pair per day) — DayCalendar's hourly rail silently renders
    // zero rows ("Closed on this day") whenever close <= open, so catch it
    // here instead of saving a contradiction nothing else surfaces.
    const invalid = rows.find((r) => r.close_time <= r.open_time);
    if (invalid) {
      setErr(`${DOW_LABELS[invalid.dow]}: close time must be after open time (overnight hours aren't supported yet).`);
      return;
    }
    startTransition(async () => {
      const res = await setCourtHours(courtId, venueId, rows);
      if (isActionError(res)) { setErr(res.message); return; }
      onDone();
    });
  }

  return (
    <div style={{ background: "var(--a-bg)", border: "1px solid var(--a-line-2)", borderRadius: 10, padding: 14, marginTop: 6 }}>
      <div className="adm-dim" style={{ fontSize: 11, marginBottom: 10, fontFamily: "var(--a-mono)", letterSpacing: "0.08em" }}>
        WEEKLY OPENING HOURS
      </div>
      {DOW_LABELS.map((label, d) => {
        const v = days[d];
        return (
          <div key={d} className="adm-flex" style={{ marginBottom: 8, gap: 10 }}>
            <div style={{ width: 42, fontSize: 12, fontWeight: 600 }}>{label}</div>
            {v ? (
              <>
                <input type="time" className="adm-input mono" style={{ width: 120, padding: "6px 8px" }}
                  value={v.open} onChange={(e) => setDay(d, { ...v, open: e.target.value })} />
                <span className="adm-dim">–</span>
                <input type="time" className="adm-input mono" style={{ width: 120, padding: "6px 8px" }}
                  value={v.close} onChange={(e) => setDay(d, { ...v, close: e.target.value })} />
                <button className="adm-btn sm ghost danger" onClick={() => setDay(d, null)}><X size={13} /></button>
              </>
            ) : (
              <button className="adm-btn sm ghost" onClick={() => setDay(d, { open: "06:00", close: "22:00" })}>Closed, set open</button>
            )}
          </div>
        );
      })}
      {err && <div className="adm-badge danger" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="adm-flex" style={{ marginTop: 12 }}>
        <button className="adm-btn primary sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save hours"}</button>
        <button className="adm-btn ghost sm" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}
