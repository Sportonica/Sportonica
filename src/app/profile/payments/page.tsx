import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ChevronRight, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMyStatementRows } from "@/lib/payments/statement";
import ReceiptActions from "./ReceiptActions";
import "../../p/profile.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Payments — Sportonica" };

const KTM = "Asia/Kathmandu";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: KTM });

// Read-only, consolidated view of the same payment data already visible
// piecemeal in /my-games (court bookings) and on individual Play Together
// game pages (game_players contribution) — no new payment logic, just one
// place to see all of it. See supabase/payments.sql and
// supabase/play_together_payments.sql for the underlying state machines.
export default async function PaymentsPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?redirect=/profile/payments");

  const rows = await getMyStatementRows();

  return (
    <div className="pf">
      <div className="pf-wrap" style={{ maxWidth: 720 }}>
        <Link href="/profile" className="pf-back"><ArrowLeft size={15} /> Profile</Link>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
          <div>
            <h1 className="pf-hub-name">Payments</h1>
            <p className="pf-hub-tag">Court bookings paid to Sportonica, and Play Together contributions paid to hosts.</p>
          </div>
          {rows.length > 0 && (
            <a
              href="/profile/payments/export"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#006241", textDecoration: "none", padding: "8px 0", whiteSpace: "nowrap" }}
            >
              <Download size={14} /> Download statement (CSV)
            </a>
          )}
        </div>

        <section className="pf-sec" style={{ marginTop: 40 }}>
          {rows.length === 0 ? (
            <div className="pf-empty">No payments yet.</div>
          ) : (
            <div className="pf-hub-list">
              {rows.map((r) => {
                const body = (
                  <>
                    <div style={{ flex: 1 }}>
                      <div className="pf-hub-row-label">{r.label}</div>
                      <div style={{ fontSize: 12, color: "var(--pf-faint)", marginTop: 2 }}>{when(r.when)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700 }}>Rs {r.amount}</div>
                      <div style={{ fontSize: 12, color: "var(--pf-faint)", marginTop: 2 }}>{r.status}</div>
                    </div>
                    {/* Only a real court booking has a receipt to print/email — a Play
                        Together contribution is paid host-to-player and never touches
                        a payments row (see StatementRow's courtBookingId comment). */}
                    {r.courtBookingId && <ReceiptActions bookingId={r.courtBookingId} />}
                    {r.href && <ChevronRight size={16} className="pf-hub-row-chev" />}
                  </>
                );
                return r.href ? (
                  <Link key={r.key} href={r.href} className="pf-hub-row">{body}</Link>
                ) : (
                  <div key={r.key} className="pf-hub-row" style={{ cursor: "default" }}>{body}</div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
