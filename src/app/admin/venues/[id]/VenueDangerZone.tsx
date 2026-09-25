"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, DoorClosed, DoorOpen } from "lucide-react";
import { deleteVenue, setVenueOpen } from "@/lib/admin/actions";
import { isActionError } from "@/lib/actionError";
import { VENUE_HAS_HISTORY, type VenueStatus } from "@/lib/admin/types";

export default function VenueDangerZone({
  venueId, venueName, status,
}: { venueId: string; venueName: string; status: VenueStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closed = status === "closed";

  function toggleOpen() {
    if (!closed && !window.confirm(`Close ${venueName}? Players won't see it or be able to book it until you reopen it. Existing bookings stay as they are.`)) return;
    setErr(null);
    startTransition(async () => {
      const res = await setVenueOpen(venueId, closed);
      if (isActionError(res)) { setErr(res.message); return; }
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete ${venueName} and all its courts? This can't be undone.`)) return;
    setErr(null);
    startTransition(async () => {
      const res = await deleteVenue(venueId);
      if (isActionError(res)) { setErr(res.message); return; }
      router.push("/admin/venues");
      router.refresh();
    });
  }

  return (
    <div className="adm-card" style={{ marginTop: 20, borderColor: "rgba(239,68,68,0.25)" }}>
      <div className="adm-card-t">Close or delete venue</div>
      <div className="adm-card-sub">
        Closing hides the venue from players and keeps all your bookings and payouts. Delete is only for a venue that has never taken a booking, like a duplicate or a test.
      </div>
      {err && (
        <div className="adm-badge danger" style={{ marginBottom: 12, whiteSpace: "normal", lineHeight: 1.45 }}>{err}</div>
      )}
      <div className="adm-flex" style={{ gap: 10, flexWrap: "wrap" }}>
        <button className={`adm-btn sm${err === VENUE_HAS_HISTORY && !closed ? " primary" : ""}`} onClick={toggleOpen} disabled={pending}>
          {closed ? <><DoorOpen size={14} /> Reopen venue</> : <><DoorClosed size={14} /> Close venue</>}
        </button>
        <button className="adm-btn sm danger" onClick={remove} disabled={pending}>
          <Trash2 size={14} /> Delete venue
        </button>
      </div>
    </div>
  );
}
