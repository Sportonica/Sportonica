import { createClient } from "@/lib/supabase/server";
import { bookingLabel } from "@/lib/payments/types";
import { STATUS_LABEL } from "@/lib/payments/statement";

export const dynamic = "force-dynamic";

// A printable court-booking receipt — same "raw HTML, browser print-to-PDF"
// technique as the tournament team sheet (see
// src/app/organize/tournaments/[id]/teams/sheet/route.tsx), rather than a
// PDF-generation library: no new dependency, and "Save as PDF" from the
// print dialog is the download.

const KTM = "Asia/Kathmandu";
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: KTM });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: KTM });
const dateTimeLabel = (iso: string) => `${dateLabel(iso)}, ${timeLabel(iso)}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  esewa: "eSewa", khalti: "Khalti", fonepay: "FonePay", bank_transfer: "Bank transfer",
};

type BookingRow = {
  id: string; user_id: string | null; starts_at: string; ends_at: string; price: number;
  payment_status: string; advance_amount: number | null; created_at: string;
  courts: { name: string; sport: string } | null; venues: { name: string; address: string | null } | null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new Response("Sign in to view this receipt.", { status: 401 });

  const { data: booking } = await sb
    .from("court_bookings")
    .select("id, user_id, starts_at, ends_at, price, payment_status, advance_amount, created_at, courts(name, sport), venues(name, address)")
    .eq("id", id)
    .maybeSingle();
  const b = booking as unknown as BookingRow | null;
  if (!b || b.user_id !== user.id) return new Response("Receipt not found.", { status: 404 });

  const [{ data: payment }, { data: profile }] = await Promise.all([
    sb.from("payments")
      .select("payment_method, transaction_id")
      .eq("court_booking_id", id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("profiles").select("full_name, name").eq("id", user.id).maybeSingle(),
  ]);

  const playerName = profile?.full_name ?? profile?.name ?? "Player";
  const ref = bookingLabel("court_booking", b.id);
  const generated = dateTimeLabel(new Date().toISOString());
  const statusClass = b.payment_status === "paid" ? "" : b.payment_status === "rejected" ? "bad" : "warn";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${esc(ref)} — Sportonica</title>
<style>
  :root { --accent: #006241; --ink: #14171E; --dim: #5b6572; --line: #e4e0d8; --bg: #ffffff; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f4f1ea; color: var(--ink); }
  body { font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 13px; line-height: 1.55; }

  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; gap: 12px; align-items: center; padding: 12px 20px; background: #14171E; color: #f4f1ea; }
  .toolbar button { font: inherit; font-weight: 700; cursor: pointer; border: 0; border-radius: 8px; padding: 8px 16px; background: var(--accent); color: #fff; }
  .toolbar .hint { font-size: 11px; opacity: .7; }

  .wrap { max-width: 210mm; margin: 0 auto; padding: 28px 20px; }
  .doc { background: var(--bg); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }

  .head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 26px 28px;
    border-bottom: 3px solid var(--accent);
    background: radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 62%), linear-gradient(180deg, #fbfaf7, #fff);
  }
  .brand { font-size: 19px; font-weight: 800; letter-spacing: -.3px; }
  .brand small { display: block; font-size: 10.5px; font-weight: 600; color: var(--dim); letter-spacing: .04em; text-transform: uppercase; margin-top: 3px; }
  .ref { text-align: right; }
  .ref .k { font-size: 9.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); }
  .ref .v { font-size: 17px; font-weight: 800; margin-top: 2px; }

  .body { padding: 26px 28px; }
  .section-h { font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); margin: 22px 0 10px; }
  .section-h:first-child { margin-top: 0; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
  .row:last-child { border-bottom: 0; }
  .row .k { color: var(--dim); }
  .row .v { font-weight: 700; text-align: right; }

  .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 18px; padding-top: 16px; border-top: 2px solid var(--ink); }
  .total .k { font-size: 13px; font-weight: 700; }
  .total .v { font-size: 24px; font-weight: 800; }

  .status { display: inline-flex; align-items: center; gap: 6px; margin-top: 18px; padding: 7px 13px; border-radius: 999px; font-size: 12px; font-weight: 800; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
  .status.warn { background: rgba(230,160,20,.15); color: #a86a00; }
  .status.bad { background: rgba(220,50,50,.12); color: #b32424; }

  .foot { padding: 18px 28px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--dim); display: flex; justify-content: space-between; gap: 12px; }

  @page { size: A4; margin: 14mm; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .wrap { max-width: none; margin: 0; padding: 0; }
    .doc { border: 0; border-radius: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Print / Save as PDF</button>
    <span class="hint">Use your browser's "Save as PDF" for a file. Generated ${esc(generated)} (NPT).</span>
  </div>
  <div class="wrap">
    <div class="doc">
      <div class="head">
        <div class="brand">Sportonica<small>Court booking receipt</small></div>
        <div class="ref"><div class="k">Receipt</div><div class="v">${esc(ref)}</div></div>
      </div>
      <div class="body">
        <div class="section-h">Billed to</div>
        <div class="row"><span class="k">Player</span><span class="v">${esc(playerName)}</span></div>

        <div class="section-h">Booking</div>
        <div class="row"><span class="k">Venue</span><span class="v">${esc(b.venues?.name ?? "Venue")}</span></div>
        ${b.venues?.address ? `<div class="row"><span class="k">Address</span><span class="v">${esc(b.venues.address)}</span></div>` : ""}
        <div class="row"><span class="k">Court</span><span class="v">${esc(b.courts?.name ?? "Court")}${b.courts?.sport ? ` (${esc(b.courts.sport)})` : ""}</span></div>
        <div class="row"><span class="k">Date</span><span class="v">${esc(dateLabel(b.starts_at))}</span></div>
        <div class="row"><span class="k">Time</span><span class="v">${esc(timeLabel(b.starts_at))} – ${esc(timeLabel(b.ends_at))}</span></div>
        <div class="row"><span class="k">Booked on</span><span class="v">${esc(dateTimeLabel(b.created_at))}</span></div>

        <div class="section-h">Payment</div>
        ${payment
          ? `<div class="row"><span class="k">Method</span><span class="v">${esc(PAYMENT_METHOD_LABEL[payment.payment_method] ?? payment.payment_method)}</span></div>
             <div class="row"><span class="k">Transaction ID</span><span class="v">${esc(payment.transaction_id)}</span></div>`
          : `<div class="row"><span class="k">Method</span><span class="v">—</span></div>`}
        ${b.advance_amount != null ? `<div class="row"><span class="k">Advance paid</span><span class="v">${esc(rs(b.advance_amount))}</span></div>` : ""}

        <div class="total"><span class="k">Total</span><span class="v">${esc(rs(b.price))}</span></div>
        <div class="status ${statusClass}">${esc(STATUS_LABEL[b.payment_status] ?? b.payment_status)}</div>
      </div>
      <div class="foot">
        <span>sportonica.com</span>
        <span>Generated ${esc(generated)} NPT</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
