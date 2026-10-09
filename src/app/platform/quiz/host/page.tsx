import Link from "next/link";
import HostConsole from "./HostConsole";
import "../../../quiz/quiz.css";

export const dynamic = "force-dynamic";

// Host mode: the host reads each question out and taps what the player says.
// Platform admins only (the /platform layout and proxy check the role; so does hostStartQuiz).
export default function QuizHostPage() {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 className="plt-h1">Host the quiz</h1>
        <Link href="/platform/quiz" style={{ fontSize: 14, fontWeight: 700, color: "inherit" }}>Entries and prizes →</Link>
      </div>
      <div className="qz qz-host">
        <HostConsole />
      </div>
    </>
  );
}
