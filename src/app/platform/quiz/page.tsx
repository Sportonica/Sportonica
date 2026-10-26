import Link from "next/link";
import { listQuizEntries } from "@/lib/quiz/actions";
import { PAST_QUIZZES, QUIZ, isQuizRound } from "@/lib/quiz/quiz";
import QuizEntries from "./QuizEntries";

export const dynamic = "force-dynamic";

const tab = (on: boolean) => ({
  padding: "7px 14px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, textDecoration: "none",
  border: "1px solid rgba(127,127,127,.35)", background: on ? "#006241" : "transparent", color: on ? "#fff" : "inherit",
});

// ?round=<quiz id> opens a past round (admins only; the public pages show the current one).
export default async function PlatformQuizPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  const { round } = await searchParams;
  const quizId = round && isQuizRound(round) ? round : QUIZ.id;
  const past = PAST_QUIZZES.find((q) => q.id === quizId);
  const entries = await listQuizEntries(quizId);
  return (
    <>
      <h1 className="plt-h1">Quiz</h1>
      <p className="plt-sub2">{QUIZ.title} at /quiz. Check a winner code at the stall and record the prize they picked.</p>
      {PAST_QUIZZES.length > 0 && (
        <nav aria-label="Quiz rounds" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "4px 0 14px" }}>
          <Link href="/platform/quiz" style={tab(!past)} aria-current={!past ? "page" : undefined}>Current round</Link>
          {PAST_QUIZZES.map((q) => (
            <Link key={q.id} href={`/platform/quiz?round=${q.id}`} style={tab(past?.id === q.id)} aria-current={past?.id === q.id ? "page" : undefined}>{q.title}</Link>
          ))}
        </nav>
      )}
      {past && <p className="plt-sub2" style={{ marginTop: 0 }}>Past round: only admins can see these entries. Players and the public leaderboard see the current round.</p>}
      <Link href="/platform/quiz/host" style={{ display: "inline-block", margin: "6px 0 18px", padding: "10px 18px", borderRadius: 999, background: "#ffd23f", color: "#1e1b4b", fontWeight: 800, textDecoration: "none" }}>Host the quiz →</Link>
      {"message" in entries
        ? <p style={{ color: "#ef4444", fontSize: 14, marginTop: 16 }}>{entries.message}</p>
        : <QuizEntries entries={entries} />}
    </>
  );
}
