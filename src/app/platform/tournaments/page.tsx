import { listAllTournaments, getDisplayVenueName } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";
import { STATUS_LABELS } from "@/lib/tournaments/types";
import PlatformTournamentsTable from "@/components/tournaments/PlatformTournamentsTable";
import "@/components/tournaments/tournament-console.css";

export const dynamic = "force-dynamic";

export default async function PlatformTournamentsPage() {
  const tournaments = await listAllTournaments();
  const rows = isActionError(tournaments) ? [] : tournaments;
  const venueNames = await Promise.all(rows.map((t) => getDisplayVenueName(t)));

  const pendingCount = rows.filter((t) => t.status === "pending_approval").length;

  return (
    <>
      <h1 className="plt-h1">Tournaments</h1>
      <p className="plt-sub2">
        Every tournament across all venues, plus any Sportonica runs itself. Approve a vendor&apos;s
        draft to publish it, or cancel one outright. Payment verification for tournament
        registrations happens in Payments, exactly like every other booking.
      </p>

      {pendingCount > 0 && (
        <div className="tc-card" style={{ borderColor: "rgba(217,119,6,0.4)" }}>
          <div className="tc-card-t">{pendingCount} awaiting review</div>
          <div className="tc-card-sub">Vendors have submitted tournaments for approval.</div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="tc-empty">No tournaments yet.</div>
      ) : (
        <PlatformTournamentsTable
          rows={rows.map((t, i) => ({
            id: t.id, name: t.name, venue: venueNames[i], sport: t.sport,
            starts: t.starts_at ? new Date(t.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "TBD",
            teams: String(t.max_teams ?? "∞"), status: t.status, statusLabel: STATUS_LABELS[t.status],
            badge: t.status === "pending_approval" ? "warn" : t.status === "cancelled" ? "danger" : t.status === "draft" ? "neutral" : "ok",
          }))}
        />
      )}
    </>
  );
}
