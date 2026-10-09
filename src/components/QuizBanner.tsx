import Link from "next/link";
import { Trophy } from "lucide-react";

// The sports quiz on the home page, for the event. To take it down,
// remove <QuizBanner /> from src/app/HomeClient.tsx and this file.
export default function QuizBanner() {
  return (
    <div style={{ padding: "18px 16px 0", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 16px", padding: "14px 16px", borderRadius: 16,
        background: "linear-gradient(90deg, rgba(0,98,65,.35), rgba(0,98,65,.12))", border: "1px solid var(--border-line)",
      }}>
        <Trophy size={22} aria-hidden="true" style={{ color: "#f5b301", flex: "none" }} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Sportonica Sports Quiz</div>
          <div style={{ fontSize: 13.5, color: "var(--muted)" }}>4 questions. Get all 4 right to pick a lucky draw prize.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/quiz" style={{ padding: "9px 16px", borderRadius: 999, background: "var(--color-primary)", color: "#fff", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Play</Link>
          <Link href="/quiz/leaderboard" style={{ padding: "9px 16px", borderRadius: 999, border: "1px solid var(--border-line)", color: "inherit", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>Leaderboard</Link>
        </div>
      </div>
    </div>
  );
}
