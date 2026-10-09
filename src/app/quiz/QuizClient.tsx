"use client";

// Register, then this player's four questions (2 easy, 1 medium, 1 hard,
// picked on the server) one at a time, then the result. Nothing is
// kept on the device: "Next participant" (or a reload) starts a blank
// quiz, so one phone at a stall can serve everyone.

import { useState } from "react";
import Link from "next/link";
import Confetti from "@/components/Confetti";
import { startQuiz, submitQuiz, type QuizResult } from "@/lib/quiz/actions";
import { MAX_SCORE, QUESTIONS_PER_PLAYER, QUIZ, type PlayerQuestion } from "@/lib/quiz/quiz";

export default function QuizClient() {
  // a new key remounts everything: a blank form for the next person
  const [round, setRound] = useState(0);
  return <Round key={round} onNext={() => setRound((r) => r + 1)} />;
}

function Round({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [questions, setQuestions] = useState<PlayerQuestion[]>([]);
  const [step, setStep] = useState(-1); // -1: register; 0..n-1: questions
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<QuizResult, { ok: true }> | null>(null);
  const total = QUESTIONS_PER_PLAYER;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!/^\d{10}$/.test(phone.trim())) return setError("Phone number must contain exactly 10 digits.");
    if (!consent) return setError("Tick the box to agree before you start.");
    setBusy(true);
    try {
      const res = await startQuiz({ name, phone: phone.trim(), consent });
      if ("message" in res) setError(res.message);
      else { setQuestions(res.questions); setStep(0); }
    } catch { setError("No connection. Try again."); }
    setBusy(false);
  };

  const pick = async (qid: string, option: string) => {
    const next = { ...answers, [qid]: option };
    setAnswers(next);
    if (step < total - 1) { setStep(step + 1); return; }
    setBusy(true); setError(null);
    try {
      const res = await submitQuiz({ phone: phone.trim(), answers: next });
      if (res.ok) setResult(res); else setError(res.message);
    } catch { setError("No connection. Your answers were not sent. Tap your last answer again."); }
    setBusy(false);
  };

  if (result) {
    const perfect = result.score === result.max;
    return (
      <div className="qz-card">
        {perfect ? <Confetti /> : null}
        <p className="qz-kicker">{perfect ? "Perfect score!" : "Quiz complete"}</p>
        <h1 className="qz-title">Thank you, {result.name}!</h1>
        <div className="qz-score"><b>{result.score}</b><span>/ {result.max} points in {result.seconds.toFixed(1)} s</span></div>
        <p className="qz-rank-line">You&apos;re <b>#{result.rankToday}</b> on today&apos;s leaderboard.</p>
        {perfect && result.winnerCode ? (
          <div className="qz-win">
            <span className="qz-win-label">Your winner code</span>
            <span className="qz-win-code">{result.winnerCode}</span>
            <span className="qz-win-help">Show this at the Sportonica stall and pick your prize from the lucky draw bowl.</span>
          </div>
        ) : (
          <p className="qz-muted">Get all {total} right ({MAX_SCORE} points) to win a lucky draw prize. Thanks for playing!</p>
        )}
        <button type="button" className="qz-btn" onClick={onNext}>Next participant</button>
        <Link href="/quiz/leaderboard" className="qz-link">See the leaderboard</Link>
      </div>
    );
  }

  if (step >= 0) {
    const q = questions[step];
    return (
      <div className="qz-card">
        <div className="qz-progress" aria-label={`Question ${step + 1} of ${total}`}>
          {questions.map((x, i) => <span key={x.id} className={i <= step ? "on" : ""} />)}
        </div>
        <p className="qz-kicker">Question {step + 1} of {total}</p>
        <h2 className="qz-q">{q.text}</h2>
        <div className="qz-options">
          {q.options.map((o) => (
            <button type="button" key={o.id} disabled={busy} className={`qz-option${answers[q.id] === o.id ? " on" : ""}`} onClick={() => void pick(q.id, o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        {busy ? <p className="qz-muted">Checking your answers…</p> : null}
        {error ? <p className="qz-error" role="alert">{error}</p> : null}
        {step > 0 && !busy ? <button type="button" className="qz-link" onClick={() => setStep(step - 1)}>Back</button> : null}
      </div>
    );
  }

  return (
    <form className="qz-card" onSubmit={start} noValidate>
      <p className="qz-kicker">{QUIZ.title}</p>
      <h1 className="qz-title">{total} questions. Get all {total} right to win.</h1>
      <p className="qz-muted">A perfect score lets you pick a prize from the lucky draw bowl.</p>
      <label className="qz-field">Full name
        <input className="qz-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} required />
      </label>
      <label className="qz-field">Phone number
        <input className="qz-input" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
          inputMode="numeric" type="tel" autoComplete="off" placeholder="98XXXXXXXX" required />
      </label>
      <label className="qz-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Sportonica may use my name and number to run this quiz and contact me about my prize. One entry per phone number.</span>
      </label>
      {error ? <p className="qz-error" role="alert">{error}</p> : null}
      <button type="submit" className="qz-btn" disabled={busy}>{busy ? "Checking…" : "Start quiz"}</button>
      <p className="qz-muted" style={{ fontSize: 13 }}>The clock starts when you tap Start. Same score? The faster player ranks higher on the <Link href="/quiz/leaderboard" className="qz-link">leaderboard</Link>.</p>
    </form>
  );
}
