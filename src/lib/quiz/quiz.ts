// What the quiz page needs before anyone starts: no questions, no answers.
// The question bank is in ./bank.ts, on the server only.

export const QUIZ = {
  // one entry per phone is per quiz id: a new quiz gets a new id
  id: "sports-2026-10",
  title: "Sportonica Sports Quiz",
  pointsPerQuestion: 10,
  // every player gets this mix, picked at random within each level
  mix: { easy: 2, medium: 1, hard: 1 },
} as const;

export const QUESTIONS_PER_PLAYER = QUIZ.mix.easy + QUIZ.mix.medium + QUIZ.mix.hard;
export const MAX_SCORE = QUESTIONS_PER_PLAYER * QUIZ.pointsPerQuestion;

/** One question as a player sees it: its options already shuffled, no answer. */
export interface PlayerQuestion {
  id: string;
  text: string;
  options: { id: string; label: string }[];
}

/** Sent for a question the player could not answer (host mode): scored as wrong. */
export const NO_ANSWER = "none";

/** What the host sees: the level, and the right option, to call it out straight away. */
export interface HostQuestion extends PlayerQuestion {
  level: "easy" | "medium" | "hard";
  answer: string;
}
