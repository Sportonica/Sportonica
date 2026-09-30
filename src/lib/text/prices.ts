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
const LATIN_TO_DEVANAGARI: Record<string, string> = Object.fromEntries(
  Object.entries(DEVANAGARI_DIGITS).map(([dev, lat]) => [lat, dev])
);

function normalizeDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
}

function toDevanagariDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => LATIN_TO_DEVANAGARI[d] ?? d);
}

function formatAmount(amount: number, lang: "en" | "ne"): string {
  const grouped = amount.toLocaleString("en-IN"); // lakh/crore grouping either way
  return lang === "ne" ? `रू ${toDevanagariDigits(grouped)}` : `Rs ${grouped}`;
}

// Machine-translated output sometimes inserts a space after the thousands
// comma ("Rs 15, 000" instead of "Rs 15,000") — the [,\s]? tolerates that
// without letting the match run on into unrelated numbers later in the line.
const AMOUNT_RE = /(?:रु\.?|रू\.?|Rs\.?|NPR|INR)\s?([०-९0-9]+(?:,\s?[०-९0-9]{2,3})*)\s*\/?-?/;
// "1." / "१)" / "क." numbering, or a bullet ("•", "●", "▪", "◦", "*", "-").
const LIST_MARKER_RE = /^(?:[०-९0-9]+[.)]|[क-ह][.)]|[•●▪◦*\-–])\s*/;

// The opening phrase of a long sentence, up to its first ":", "=", ",",
// "(" or " - " — "Protest: submit in writing … with a" → "Protest",
// "Misconduct or violence against referee, organizer …" → "Misconduct or
// violence against referee". Empty if that phrase is still too long.
function leadingPhrase(before: string): string {
  const head = before.split(/\s*(?:[:=,(]|\s-\s|\s–\s|\s—\s)\s*/)[0]?.trim() ?? "";
  return head.length >= 2 && head.length <= 50 ? head : "";
}

export function extractPrices(text: string | null | undefined, lang: "en" | "ne" = "en"): PriceItem[] {
  if (!text) return [];
  const lines = text.split("\n");
  const items: PriceItem[] = [];
  // A heading the NEXT amount line may belong to. Only ever the line
  // directly above: it used to linger, so an unrelated short sentence
  // ("Card fines must be paid before the next match starts.") ended up
  // labelling every later amount that sat in a long sentence.
  let headingAbove = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const match = AMOUNT_RE.exec(line);
    if (!match) {
      // Short standalone line — likely a heading/list item the next
      // amount-bearing line refers to (e.g. "१. प्रथम पुरस्कार" followed
      // by "रु. ३,००,०००/-" on its own line).
      headingAbove = line.length < 60 ? line.replace(LIST_MARKER_RE, "").trim() : "";
      continue;
    }

    const heading = headingAbove;
    headingAbove = "";

    const amountDigits = normalizeDigits(match[1]).replace(/[,\s]/g, "");
    const amount = Number(amountDigits);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const before = line
      .slice(0, match.index)
      .replace(LIST_MARKER_RE, "")
      .replace(/[:\-–—]\s*$/, "")
      .trim();

    // Label, in order of preference:
    //  - a short prefix on the same line ("Yellow Card जरिवाना :")
    //  - the amount on its own line under a heading ("१. प्रथम पुरस्कार")
    //  - the opening phrase of a longer sentence ("Protest: …")
    const label =
      (before && before.length <= 50) ? before :
      !before ? heading :
      leadingPhrase(before);
    if (!label) continue;

    items.push({ label, amount: formatAmount(amount, lang) });
  }

  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.label}|${it.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
