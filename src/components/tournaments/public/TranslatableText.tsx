"use client";

import { useMemo, useState } from "react";
import { Languages } from "lucide-react";
import { extractPrices } from "@/lib/text/prices";

function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

export default function TranslatableText({
  text,
  style,
}: {
  text: string;
  style?: React.CSSProperties;
}) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const target: "en" | "ne" = isDevanagari(text) ? "en" : "ne";
  const activeText = showTranslated && translated ? translated : text;
  const prices = useMemo(() => extractPrices(activeText), [activeText]);
  const paragraphs = useMemo(() => activeText.split(/\n{2,}/).filter((p) => p.trim()), [activeText]);

  async function handleClick() {
    if (showTranslated) {
      setShowTranslated(false);
      return;
    }
    if (translated) {
      setShowTranslated(true);
      return;
    }
    setLoading(true);
    setErrored(false);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = await res.json();
      if (typeof data.translated !== "string") throw new Error("bad response");
      setTranslated(data.translated);
      setShowTranslated(true);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={handleClick} disabled={loading} className="tr-btn">
        <Languages size={13} />
        {loading
          ? "Translating…"
          : showTranslated
          ? "Show original"
          : target === "en"
          ? "Translate to English"
          : "नेपालीमा अनुवाद गर्नुहोस्"}
      </button>
      {errored && <div className="tr-error">Translation unavailable right now — try again in a moment.</div>}

      {prices.length > 0 && (
        <table className="tr-price-table">
          <thead>
            <tr>
              <th>Item</th>
              <th style={{ textAlign: "right" }}>Amount</th>
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
