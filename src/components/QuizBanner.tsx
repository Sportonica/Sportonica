import Link from "next/link";
import "./quiz-banner.css";

// The sports quiz on the home page, for the event. To take it down,
// remove <QuizBanner /> from src/app/HomeClient.tsx, this file and quiz-banner.css.

/** Four flat jigsaw pieces locked together: each knob is its piece's colour reaching into the next. */
function Pieces() {
  return (
    <svg className="qb-pieces" viewBox="0 0 120 120" aria-hidden="true">
      <rect x="2" y="2" width="56" height="56" rx="8" fill="#14b8a6" />
      <rect x="62" y="2" width="56" height="56" rx="8" fill="#ff6f61" />
      <rect x="2" y="62" width="56" height="56" rx="8" fill="#ffd23f" />
      <rect x="62" y="62" width="56" height="56" rx="8" fill="#ffffff" />
      <circle cx="60" cy="30" r="10" fill="#14b8a6" />
      <circle cx="90" cy="60" r="10" fill="#ff6f61" />
      <circle cx="60" cy="90" r="10" fill="#ffffff" />
      <circle cx="30" cy="60" r="10" fill="#ffd23f" />
      {/* a trophy cup on the white piece */}
      <path d="M78 76h24v6a12 12 0 0 1-24 0zM86 94h8v6h5v4H81v-4h5z" fill="#3730a3" />
      <path d="M78 79h-5a5 5 0 0 0 6 7M102 79h5a5 5 0 0 1-6 7" fill="none" stroke="#3730a3" strokeWidth="2.5" />
    </svg>
  );
}

export default function QuizBanner() {
  return (
    <div className="qb-wrap">
      <div className="qb">
        <Pieces />
        <div className="qb-text">
          <span className="qb-tag">Sports quiz</span>
          <span className="qb-title">Sportonica Sports Quiz</span>
          <span className="qb-sub">4 questions. Get all 4 right to pick a lucky draw prize.</span>
        </div>
        <div className="qb-actions">
          <Link href="/quiz" className="qb-play">Play</Link>
          <Link href="/quiz/leaderboard" className="qb-board">Leaderboard</Link>
        </div>
      </div>
    </div>
  );
}
