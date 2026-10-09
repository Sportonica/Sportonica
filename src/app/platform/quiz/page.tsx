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
      {"message" in entries
        ? <p style={{ color: "#ef4444", fontSize: 14, marginTop: 16 }}>{entries.message}</p>
        : <QuizEntries entries={entries} />}
    </>
  );
}
