import type { Metadata } from "next";
import { QUIZ } from "@/lib/quiz/quiz";
import QuizClient from "./QuizClient";
import "./quiz.css";

export const metadata: Metadata = {
  title: `${QUIZ.title} · Sportonica`,
  description: "Four sports questions. Get all four right and pick a prize from the lucky draw.",
};

// Static: no questions here. Each player's four come from the server when they start.
export default function QuizPage() {
  return (
    <main className="qz">
      <QuizClient />
    </main>
  );
}
