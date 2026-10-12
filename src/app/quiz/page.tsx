import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { QUIZ } from "@/lib/quiz/quiz";
import QuizClient from "./QuizClient";
import "./quiz.css";

export const metadata: Metadata = {
  title: `${QUIZ.title} · Sportonica`,
  description: "Four sports questions. Get all four right and pick a prize from the lucky draw.",
};

// No questions here. Each player's four come from the server when they start.
// Playing on your own phone needs an account; at the stall, a platform admin
// can still play anyone through host mode (/platform/quiz/host).
export default async function QuizPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  const signedIn = !!user && !user.is_anonymous;
  return (
    <main className="qz">
      {signedIn ? <QuizClient /> : (
        <div className="qz-card">
          <p className="qz-kicker">{QUIZ.title}</p>
          <h1 className="qz-title">Sign in to play</h1>
          <p className="qz-muted">Four sports questions. Get all four right to pick a prize from the lucky draw. Sign in or create a free account to start.</p>
          <Link href="/login?redirect=/quiz" className="qz-btn">Sign in</Link>
          <Link href="/signup?redirect=/quiz" className="qz-link">Create an account</Link>
          <p className="qz-muted" style={{ fontSize: 13 }}>No account? Play at the Sportonica stall and we will run it for you. See the <Link href="/quiz/leaderboard" className="qz-link">leaderboard</Link>.</p>
        </div>
      )}
    </main>
  );
}
