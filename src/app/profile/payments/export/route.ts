import { getMyStatementRows } from "@/lib/payments/statement";

export const dynamic = "force-dynamic";

const KTM = "Asia/Kathmandu";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: KTM });

// Quote a cell and escape any embedded quote — the one thing a raw CSV
// writer needs, since a venue or game label can contain a comma.
function cell(v: string | number): string {
  const s = String(v);
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
