import { extractPrices } from "@/lib/text/prices";

function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

// Renders organizer-submitted free text (tournament descriptions/rules) as
// real spaced paragraph blocks instead of one pre-wrap blob, and pulls any
// fee/prize amounts mentioned in it into a table above the prose.
export default function FormattedText({
  text,
  style,
}: {
  text: string;
  style?: React.CSSProperties;
}) {
  const lang: "en" | "ne" = isDevanagari(text) ? "ne" : "en";
  const prices = extractPrices(text, lang);
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <div>
      {prices.length > 0 && (
        <table className="tr-price-table">
          <thead>
            <tr>
              <th>{lang === "ne" ? "विवरण" : "Item"}</th>
              <th style={{ textAlign: "right" }}>{lang === "ne" ? "रकम" : "Amount"}</th>
            </tr>
          </thead>
          <tbody>
            {prices.map((p, i) => (
              <tr key={i}>
                <td>{p.label}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{p.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {paragraphs.map((p, i) => (
        <p key={i} className="tr-para" style={style}>
          {p.trim()}
        </p>
      ))}
    </div>
  );
}
