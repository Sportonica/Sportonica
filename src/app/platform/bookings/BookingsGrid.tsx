"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import DataTable, { type Column } from "@/components/DataTable";
import { nepalParts } from "@/lib/platform/bookingEdit";
import EditBookingModal, { type EditableBooking } from "./EditBookingModal";

interface BookingRow extends EditableBooking, Record<string, unknown> {
  court: string;
  source: string | null;
  balance_due: number;
  state_label: string;
  payment_method: string | null;
  transaction_id: string | null;
}

// 5% platform commission, shown per booking.
const COMMISSION = 0.05;

const money = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;
const when = (r: BookingRow) => `${nepalParts(r.starts_at).time} to ${nepalParts(r.ends_at).time}`;

const STATE_COLORS: Record<string, string> = {
  reserved: "#F5A623", paid: "#2E7D5B", confirmed: "#2E7D5B", checked_in: "#2E7D5B",
  played: "#3b82f6", dropped: "#8A95A3", no_show: "#ef4444", refunded: "#8A95A3", cancelled: "#ef4444",
};

const PAYMENT_NOTES: Record<string, string> = {
  pending_verification: "Waiting for review",
  rejected: "Payment rejected",
  refunded: "Refunded",
};

const COLS: Column<BookingRow>[] = [
  {
    key: "venue", label: "Venue", type: "custom",
    render: (r) => (
      <>
        {r.venue}
        <div className="dt-dim" style={{ fontSize: 11 }}>{r.court}</div>
      </>
    ),
  },
  {
    key: "starts_at", label: "When", type: "custom",
    render: (r) => (
      <>
        {new Date(r.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kathmandu" })}
        <div className="dt-dim" style={{ fontSize: 11 }}>{when(r)}</div>
      </>
    ),
  },
  {
    key: "customer", label: "Customer", type: "custom",
    render: (r) => (
      <>
        {r.customer}
        {r.phone && <div className="dt-dim" style={{ fontSize: 11 }}>{r.phone}</div>}
      </>
    ),
  },
  {
    key: "state_label", label: "Played?", type: "custom",
    render: (r) => {
      const color = STATE_COLORS[r.state ?? ""] ?? "#8A95A3";
      return <span className="dt-badge" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>{r.state_label}</span>;
    },
  },
  { key: "price", label: "Price", type: "money" },
  {
    key: "amount_paid", label: "Paid", type: "custom",
    render: (r) => {
      const note = PAYMENT_NOTES[r.payment_status ?? ""];
      return (
        <>
          <span className="dt-mono">{money(r.amount_paid)}</span>
          {note && <div className="dt-dim" style={{ fontSize: 11 }}>{note}</div>}
        </>
      );
    },
  },
  {
    key: "balance_due", label: "Still to pay", type: "custom",
    render: (r) => r.balance_due > 0
      ? <span className="dt-mono" style={{ color: "#d97706", fontWeight: 700 }}>{money(r.balance_due)}</span>
      : <span className="dt-dim">—</span>,
  },
  {
    key: "commission", label: "Our cut", type: "custom",
    render: (r) => <span className="dt-mono" style={{ color: "#006241" }}>{money((Number(r.price) || 0) * COMMISSION)}</span>,
  },
  {
    key: "transaction_id", label: "Approved via", type: "custom",
    render: (r) => r.payment_method && r.transaction_id
      ? <span className="dt-mono" style={{ fontSize: 12 }}>{String(r.payment_method).toUpperCase()} · {r.transaction_id}</span>
      : <span className="dt-dim">—</span>,
  },
  {
    key: "source", label: "Source", type: "badge",
    badgeColors: { platform: "#3b82f6", walk_in: "#8A95A3", phone: "#006241" },
  },
];

export default function BookingsGrid({ bookings }: { bookings: BookingRow[] }) {
  const [editing, setEditing] = useState<BookingRow | null>(null);
  const total = bookings.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const collected = bookings.reduce((s, b) => s + b.amount_paid, 0);
  const owed = bookings.reduce((s, b) => s + b.balance_due, 0);
  const played = bookings.filter((b) => b.state === "played").length;
  const cut = Math.round(total * COMMISSION);

  return (
    <>
      <div className="plt-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div className="plt-stat">
          <div className="plt-stat-v">{bookings.length}</div>
          <div className="plt-stat-l">Bookings shown</div>
        </div>
        <div className="plt-stat">
          <div className="plt-stat-v">{played}</div>
          <div className="plt-stat-l">Played</div>
        </div>
        <div className="plt-stat">
          <div className="plt-stat-v dt-mono">{money(total)}</div>
          <div className="plt-stat-l">Gross value</div>
        </div>
        <div className="plt-stat">
          <div className="plt-stat-v dt-mono">{money(collected)}</div>
          <div className="plt-stat-l">Paid so far</div>
        </div>
        <div className="plt-stat">
          <div className="plt-stat-v warn dt-mono">{money(owed)}</div>
          <div className="plt-stat-l">Still to pay</div>
        </div>
        <div className="plt-stat">
          <div className="plt-stat-v warn dt-mono">{money(cut)}</div>
          <div className="plt-stat-l">Our commission (5%)</div>
        </div>
      </div>

      <DataTable<BookingRow>
        columns={COLS}
        rows={bookings}
        pageSize={15}
        exportName="sportonica-bookings"
        empty="No bookings yet."
        actions={(r) => (
          <button type="button" className="dt-btn" onClick={() => setEditing(r)}><Pencil size={13} /> Edit</button>
        )}
      />

      {editing && <EditBookingModal key={editing.id} booking={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
