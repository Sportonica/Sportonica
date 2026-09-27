import { getMyStatementRows } from "@/lib/payments/statement";

export const dynamic = "force-dynamic";

const KTM = "Asia/Kathmandu";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KTM });

// Quote a cell and escape any embedded quote, since a venue or game label
// (both venue-owner-set, not something Sportonica controls) can contain a
// comma. Also guard against CSV/formula injection: Excel, Sheets and
// LibreOffice all treat a cell starting with =, +, - or @ as a formula to
// evaluate on open — a venue or Play Together host naming their venue
// something like `=HYPERLINK(...)` would otherwise run for every player
// who downloads a statement mentioning it. A leading apostrophe forces
// spreadsheet apps to treat the cell as plain text instead.
function cell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// getMyStatementRows() returns [] for a signed-out visitor rather than
// throwing (same "getMy*" convention as the rest of src/lib/play/) — a
// direct hit on this URL without a session just downloads an empty
// statement, no data to leak either way.
export async function GET() {
  const rows = await getMyStatementRows();

  const lines = [
    ["Date", "Description", "Amount (Rs)", "Status"],
    ...rows.map((r) => [when(r.when), r.label, r.amount, r.status]),
  ]
    .map((cols) => cols.map(cell).join(","))
    .join("\r\n");

  // Excel mangles non-ASCII characters (an accented venue name, say)
  // without a UTF-8 byte-order mark at the start of the file.
  const csv = "﻿" + lines;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sportonica-statement-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
