"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { editBookingAsPlatform } from "@/lib/platform/actions";
import { isActionError } from "@/lib/actionError";
import { BOOKING_STATE_LABELS, CLOSED_STATES, nepalParts } from "@/lib/platform/bookingEdit";

export interface EditableBooking {
  id: string;
  venue: string;
  court_id: string;
  venue_courts: { id: string; name: string }[];
  customer_name: string | null;
  customer: string;
  phone: string | null;
  starts_at: string;
  ends_at: string;
  price: number | null;
  amount_paid: number;
  state: string | null;
  payment_status: string | null;
  hosted_event_id: string | null;
  updated_at: string;
}

const money = (n: number) => `Rs ${n.toLocaleString("en-IN")}`;
const field: React.CSSProperties = { font: "inherit", fontSize: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", width: "100%", minWidth: 0 };
const label: React.CSSProperties = { display: "grid", gap: 6, fontSize: 13, fontWeight: 700, minWidth: 0 };
const pair: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const hint: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.45, opacity: 0.75 };

export default function EditBookingModal({ booking, onClose }: { booking: EditableBooking; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const start = nepalParts(booking.starts_at);
  const [name, setName] = useState(booking.customer_name ?? "");
  const [phone, setPhone] = useState(booking.phone ?? "");
  const [courtId, setCourtId] = useState(booking.court_id);
  const [date, setDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(nepalParts(booking.ends_at).time);
  const [price, setPrice] = useState(String(Number(booking.price) || 0));
  const [paid, setPaid] = useState(String(booking.amount_paid));
  const [state, setState] = useState(booking.state ?? "reserved");

  const refunded = state === "refunded";
  const paidNow = refunded ? 0 : Number(paid) || 0;
  const left = (Number(price) || 0) - paidNow;
  // review_payment() writes these columns when the review finishes
  const moneyLocked = booking.payment_status === "pending_verification";
  const placeLocked = booking.hosted_event_id !== null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      try {
        const res = await editBookingAsPlatform({
          id: booking.id,
          loaded_updated_at: booking.updated_at,
          customer_name: name,
          phone,
          court_id: courtId,
          date,
          start_time: startTime,
          end_time: endTime,
          // a cleared box is a mistake, not Rs 0: the action refuses NaN
          price: price === "" ? NaN : Number(price),
          amount_paid: refunded ? 0 : paid === "" ? NaN : Number(paid),
          state,
        });
        if (isActionError(res)) { setErr(res.message); return; }
        router.refresh();
        onClose();
      } catch { setErr("No connection. Try again."); }
    });
  }

  return (
    <div className="ebm-scrim" onClick={onClose}>
      <form className="ebm-card" onSubmit={save} noValidate onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>Edit booking</h3>
          <button type="button" aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, color: "inherit", opacity: 0.6, cursor: "pointer" }}><X size={18} /></button>
        </div>
        <div style={{ ...hint, marginTop: -6 }}>{booking.customer} at {booking.venue}</div>

        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>Money</div>
        <div style={pair}>
          <label style={label}>Booking price (Rs)
            <input style={field} inputMode="decimal" value={price} disabled={moneyLocked} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
          <label style={label}>Amount paid (Rs)
            <input style={field} inputMode="decimal" value={refunded ? "0" : paid} disabled={moneyLocked || refunded} onChange={(e) => setPaid(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
        </div>
        {moneyLocked ? <div style={hint}>A payment is waiting for review. Approve or reject it on the Payments page to change these.</div>
          : refunded ? <div style={hint}>Marked as refunded, so nothing counts as paid.</div>
          : left < 0 ? <div style={{ ...hint, color: "#ef4444", opacity: 1 }}>Amount paid is more than the price.</div>
          : <div style={{ fontWeight: 700, fontSize: 14 }}>{left === 0 ? "Fully paid" : `Still to pay: ${money(left)}`}</div>}

        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>What happened</div>
        <label style={label}>Did they play?
          <select style={field} value={state} onChange={(e) => setState(e.target.value)}>
            {Object.entries(BOOKING_STATE_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        {CLOSED_STATES.has(state) && paidNow > 0 ? (
          <div style={{ ...hint, color: "#d97706", opacity: 1 }}>This slot stays blocked while money is recorded on it. To free it, choose Refunded or set the amount paid to 0.</div>
        ) : null}

        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>Court and time (Nepal time)</div>
        <label style={label}>Court
          <select style={field} value={courtId} disabled={placeLocked} onChange={(e) => setCourtId(e.target.value)}>
            {booking.venue_courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label style={label}>Date
          <input style={field} type="date" value={date} disabled={placeLocked} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div style={pair}>
          <label style={label}>Starts
            <input style={field} type="time" value={startTime} disabled={placeLocked} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label style={label}>Ends
            <input style={field} type="time" value={endTime} disabled={placeLocked} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        {placeLocked ? <div style={hint}>This slot belongs to a hosted Play Together game, so its court and time can&apos;t be changed here.</div> : null}

        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 4 }}>Customer</div>
        <label style={label}>Name
          <input style={field} value={name} maxLength={80} placeholder={booking.customer} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label style={label}>Phone
          <input style={field} type="tel" inputMode="numeric" value={phone} placeholder="98XXXXXXXX" onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} autoComplete="off" />
        </label>

        {err ? <div role="alert" style={{ color: "#ef4444", fontSize: 14, fontWeight: 600 }}>{err}</div> : null}
        <button type="submit" disabled={pending} style={{ font: "inherit", fontSize: 16, fontWeight: 800, padding: 14, borderRadius: 12, border: 0, background: "#ffd23f", color: "#1e1b4b", cursor: "pointer", opacity: pending ? 0.6 : 1 }}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <style>{`
        .ebm-scrim { position: fixed; inset: 0; background: rgba(0,0,0,.65); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .ebm-card { display: grid; gap: 12px; width: 100%; max-width: 460px; max-height: 90vh; overflow-y: auto; background: #14171e; border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 22px; }
        [data-theme="paper"] .ebm-card { background: #fff; border-color: rgba(20,23,30,.1); }
        .ebm-card option { color: #14171e; background: #fff; }
        .ebm-card input:disabled, .ebm-card select:disabled { opacity: .5; }
      `}</style>
    </div>
  );
}
