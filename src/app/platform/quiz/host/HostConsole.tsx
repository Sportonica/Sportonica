"use client";

// The host's side of the quiz: player details, then each question read
// out loud with the player's spoken answer tapped in, the right answer
// shown at once, then the result. Same entry, clock, rules and
// leaderboard as /quiz. "Next player" starts blank.

import { useState } from "react";
import Confetti from "@/components/Confetti";
import { hostStartQuiz, submitQuiz, type QuizResult } from "@/lib/quiz/actions";
import { NO_ANSWER, type HostQuestion } from "@/lib/quiz/quiz";

const LETTERS = ["A", "B", "C", "D"];
const LEVEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

export default function HostConsole() {
  const [round, setRound] = useState(0);
  return <Player key={round} onNext={() => setRound((r) => r + 1)} />;
}

function Player({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [questions, setQuestions] = useState<HostQuestion[]>([]);
  const [step, setStep] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<QuizResult, { ok: true }> | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const res = await hostStartQuiz({ name, phone: phone.trim(), consent: agreed });
      if ("message" in res) setError(res.message); else { setQuestions(res.questions); setStep(0); }
    } catch { setError("No connection. Try again."); }
    setBusy(false);
  };

  const finish = async () => {
    setError(null); setBusy(true);
    try {
      const res = await submitQuiz({ phone: phone.trim(), answers });
      if (res.ok) setResult(res); else setError(res.message);
    } catch { setError("No connection. Tap Finish again."); }
    setBusy(false);
  };

  if (result) {
    const perfect = result.score === result.max;
    return (
      <div className="qz-card qz-host-card">
        {perfect ? <Confetti /> : null}
        <p className="qz-kicker">{perfect ? "Perfect score!" : "Quiz complete"}</p>
        <h2 className="qz-title">Well played, {result.name}!</h2>
        <div className="qz-score"><b>{result.score}</b><span>/ {result.max} points in {result.seconds.toFixed(1)} s</span></div>
        <p className="qz-rank-line">#{result.rankToday} on today&apos;s leaderboard.</p>
        {perfect && result.winnerCode ? (
          <div className="qz-win">
            <span className="qz-win-label">Winner code</span>
            <span className="qz-win-code">{result.winnerCode}</span>
            <span className="qz-win-help">They pick a prize from the lucky draw bowl. Record it under Entries and prizes.</span>
          </div>
        ) : null}
        <button type="button" className="qz-btn" onClick={onNext}>Next player</button>
      </div>
    );
  }

  if (step >= 0) {
    const q = questions[step];
    const picked = answers[q.id];
    const last = step === questions.length - 1;
    const tap = (option: string) => setAnswers((a) => ({ ...a, [q.id]: option }));
    return (
      <div className="qz-card qz-host-card">
        <div className="qz-progress" aria-label={`Question ${step + 1} of ${questions.length}`}>
          {questions.map((x, i) => <span key={x.id} className={i <= step ? "on" : ""} />)}
        </div>
        <p className="qz-kicker">Question {step + 1} of {questions.length} · {LEVEL[q.level]} · {name.trim().split(/\s+/)[0]}</p>
        <h2 className="qz-q qz-host-q">{q.text}</h2>
        <p className="qz-muted">Read the question and the four options. Tap the one the player says.</p>
        <div className="qz-options">
          {q.options.map((o, i) => {
            const state = !picked ? "" : o.id === q.answer ? " right" : o.id === picked ? " wrong" : " dim";
            return (
              <button type="button" key={o.id} disabled={!!picked} className={`qz-option${state}`} onClick={() => tap(o.id)}>
                <span className="qz-letter">{LETTERS[i]}</span>{o.label}
              </button>
            );
          })}
        </div>
        {!picked ? (
          <button type="button" className="qz-link" onClick={() => tap(NO_ANSWER)}>Didn&apos;t know / gave another answer</button>
        ) : (
          <>
            <p className={`qz-verdict ${picked === q.answer ? "right" : "wrong"}`}>
              {picked === q.answer ? "✓ Correct!" : `✗ Wrong. The answer is ${q.options.find((o) => o.id === q.answer)?.label}.`}
            </p>
            <div className="qz-host-row">
              <button type="button" className="qz-btn" disabled={busy} onClick={() => (last ? void finish() : setStep(step + 1))}>
                {last ? (busy ? "Saving…" : "Finish and show score") : "Next question"}
              </button>
              <button type="button" className="qz-link" disabled={busy} onClick={() => setAnswers((a) => { const n = { ...a }; delete n[q.id]; return n; })}>Tapped the wrong one? Change</button>
            </div>
          </>
        )}
        {error ? <p className="qz-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <form className="qz-card qz-host-card" onSubmit={start} noValidate>
      <p className="qz-kicker">New player</p>
      <h2 className="qz-title">Who&apos;s playing?</h2>
      <label className="qz-field">Player&apos;s full name
        <input className="qz-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} />
      </label>
      <label className="qz-field">Player&apos;s phone number
        <input className="qz-input" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
          inputMode="numeric" type="tel" autoComplete="off" placeholder="98XXXXXXXX" />
      </label>
      <label className="qz-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>I read this to the player and they agreed: &quot;Sportonica may use your name and number to run this quiz and contact you about your prize. One entry per phone number.&quot;</span>
      </label>
      {error ? <p className="qz-error" role="alert">{error}</p> : null}
      <button type="submit" className="qz-btn" disabled={busy}>{busy ? "Checking…" : "Start the clock and show question 1"}</button>
      <p className="qz-muted" style={{ fontSize: 13 }}>The clock starts now and stops at the last answer, the same as on /quiz.</p>
    </form>
  );
}
