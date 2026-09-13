"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { addStaff, findUserForStaffInvite } from "@/lib/admin/actions";
import { isActionError } from "@/lib/actionError";

type StaffRow = { id: string; user_id: string; role: string; created_at: string };

const ROLE_DESC: Record<string, string> = {
  owner: "Full control — pricing, payouts, staff, everything.",
  manager: "Manages courts, pricing and bookings. No payout access.",
  staff: "Checks players in and blocks slots. Can't touch pricing or money.",
};

const ERROR_TEXT: Record<string, string> = {
  USER_NOT_FOUND: "No Sportonica account found for that email — ask them to sign up first, then try again.",
  FORBIDDEN: "You don't have permission to add staff to this venue.",
};

export default function StaffTeamCard({ venueId, staff }: { venueId: string; staff: StaffRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [err, setErr] = useState<string | null>(null);

  function invite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setErr(null);
    startTransition(async () => {
      const found = await findUserForStaffInvite(trimmed);
      if (isActionError(found)) { setErr(ERROR_TEXT[found.message] ?? found.message); return; }
      const res = await addStaff({ venue_id: venueId, user_id: found.id, role });
      if (isActionError(res)) { setErr(ERROR_TEXT[res.message] ?? res.message); return; }
      setAdding(false); setEmail(""); setRole("staff");
      router.refresh();
    });
  }

  return (
    <div className="adm-card">
      <div className="adm-between" style={{ marginBottom: 16 }}>
        <div>
          <div className="adm-card-t">Team</div>
          <div className="adm-card-sub" style={{ marginBottom: 0 }}>Who can access this venue&apos;s console</div>
        </div>
        {!adding && (
          <button className="adm-btn sm primary" onClick={() => setAdding(true)}><Plus size={14} /> Invite staff</button>
        )}
      </div>

      {adding && (
        <div style={{ background: "var(--a-bg)", border: "1px solid var(--a-line-2)", borderRadius: 11, padding: 16, marginBottom: 16 }}>
          <div className="adm-row">
            <div className="adm-field">
              <label className="adm-label">Their email</label>
              <input
                className="adm-input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
              <div className="adm-dim" style={{ fontSize: 11.5, marginTop: 4 }}>
                They need an existing Sportonica account — sharing/signup isn&apos;t handled here yet.
              </div>
            </div>
            <div className="adm-field">
              <label className="adm-label">Role</label>
              <select className="adm-select" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          </div>
          {err && <div className="adm-badge danger" style={{ marginBottom: 10 }}>{err}</div>}
          <div className="adm-flex">
            <button className="adm-btn primary sm" onClick={invite} disabled={pending || !email.trim()}>
              {pending ? "Adding…" : "Add to team"}
            </button>
            <button className="adm-btn ghost sm" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {err && !adding && <div className="adm-badge danger" style={{ marginBottom: 12 }}>{err}</div>}

      <table className="adm-table">
        <thead><tr><th>Member</th><th>Role</th><th>Can do</th></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id}>
              <td className="adm-mono" style={{ fontSize: 12 }}>{s.user_id.slice(0, 8)}…</td>
              <td><span className={`adm-badge ${s.role === "owner" ? "warn" : "neutral"}`}>{s.role}</span></td>
              <td className="adm-dim" style={{ fontSize: 12 }}>{ROLE_DESC[s.role]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
