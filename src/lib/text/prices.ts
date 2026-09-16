// Pulls fee/prize amounts out of freeform organizer-submitted text (tournament
// descriptions, rules) so they can be shown as a table instead of buried in
// prose. Regex-based, not a language model — works on the common "रु./Rs.
// <amount>" patterns these documents actually use, in both Devanagari and
// Latin numerals. Imperfect on unusual phrasing; that's an accepted tradeoff
// for something that runs on every page view with no external calls.

export interface PriceItem {
  label: string;
  amount: string;
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

function normalizeDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
}

// Machine-translated output sometimes inserts a space after the thousands
// comma ("Rs 15, 000" instead of "Rs 15,000") — the [,\s]? tolerates that
// without letting the match run on into unrelated numbers later in the line.
const AMOUNT_RE = /(?:रु\.?|रू\.?|Rs\.?|NPR|INR)\s?([०-९0-9]+(?:,\s?[०-९0-9]{2,3})*)\s*\/?-?/;
const LIST_MARKER_RE = /^(?:[०-९0-9]+[.)]|[क-ह][.)])\s*/;

export function extractPrices(text: string | null | undefined): PriceItem[] {
  if (!text) return [];
  const lines = text.split("\n");
  const items: PriceItem[] = [];
  let pendingLabel = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const match = AMOUNT_RE.exec(line);
    if (match) {
      const amountDigits = normalizeDigits(match[1]).replace(/[,\s]/g, "");
      const amount = Number(amountDigits);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const before = line
        .slice(0, match.index)
        .replace(LIST_MARKER_RE, "")
        .replace(/[:\-–—]\s*$/, "")
        .trim();

      // A short prefix ("Yellow Card जरिवाना :") or a preceding list-item
      // heading ("१. प्रथम पुरस्कार") makes a clean label. A long prefix
      // means the amount is just mentioned mid-sentence in flowing prose —
      // not a table row, so skip it rather than dump the whole sentence
      // into the label column.
      const label = (before && before.length <= 50) ? before : pendingLabel;
      if (!label) continue;

      items.push({ label, amount: `Rs ${amount.toLocaleString("en-IN")}` });
    } else if (line.length < 60) {
      // Short standalone line — likely a heading/list item the next
      // amount-bearing line refers to (e.g. "१. प्रथम पुरस्कार" followed
      // by "रु. ३,००,०००/-" on its own line).
      pendingLabel = line.replace(LIST_MARKER_RE, "").trim();
    }
  }

  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.label}|${it.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
