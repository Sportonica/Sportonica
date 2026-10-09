import Link from "next/link";
import { listQuizEntries } from "@/lib/quiz/actions";
import { QUIZ } from "@/lib/quiz/quiz";
import QuizEntries from "./QuizEntries";

export const dynamic = "force-dynamic";

export default async function PlatformQuizPage() {
  const entries = await listQuizEntries();
  return (
    <>
      <h1 className="plt-h1">Quiz</h1>
      <p className="plt-sub2">{QUIZ.title} at /quiz. Check a winner code at the stall and record the prize they picked.</p>
      <Link href="/platform/quiz/host" style={{ display: "inline-block", margin: "6px 0 18px", padding: "10px 18px", borderRadius: 999, background: "#ffd23f", color: "#1e1b4b", fontWeight: 800, textDecoration: "none" }}>Host the quiz →</Link>
      {"message" in entries
        ? <p style={{ color: "#ef4444", fontSize: 14, marginTop: 16 }}>{entries.message}</p>
        : <QuizEntries entries={entries} />}
    </>
  );
}
