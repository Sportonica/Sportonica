import type { Metadata } from "next";
import Link from "next/link";
import { getLeaderboard, todayStartsAt, type BoardRow } from "@/lib/quiz/leaderboard";
import { MAX_SCORE, QUIZ } from "@/lib/quiz/quiz";
import AutoRefresh from "./AutoRefresh";
import "../quiz.css";

export const metadata: Metadata = { title: `Leaderboard · ${QUIZ.title} · Sportonica` };
export const dynamic = "force-dynamic";

const time = (s: number) => (s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`);

function Board({ title, rows }: { title: string; rows: BoardRow[] }) {
  return (
    <section className="qz-card qz-board">
      <h2 className="qz-q">{title}</h2>
      {rows.length ? (
        <ol className="qz-rows">
          {rows.map((r) => (
            <li key={r.rank} className={r.rank <= 3 ? `top top${r.rank}` : ""}>
              <span className="qz-rank">{r.rank}</span>
              <span className="qz-name">{r.name}</span>
              <span className="qz-pts">{r.score}<small>/{MAX_SCORE}</small></span>
              <span className="qz-time">{time(r.seconds)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="qz-muted">No one yet. Be the first!</p>}
    </section>
  );
}

export default async function LeaderboardPage() {
  let board: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  try { board = await getLeaderboard(todayStartsAt()); } catch { /* shown below */ }
  return (
    <main className="qz qz-lb">
      <AutoRefresh seconds={30} />
      <div className="qz-lb-head">
        <p className="qz-kicker">{QUIZ.title}</p>
        <h1 className="qz-title">Leaderboard</h1>
        <p className="qz-muted">Highest score first. Same score? The faster player ranks higher.</p>
      </div>
      {board ? (
        <div className="qz-lb-grid">
          <Board title="Today" rows={board.today} />
          <Board title="All time" rows={board.allTime} />
        </div>
      ) : <p className="qz-error">The leaderboard could not load. It will try again shortly.</p>}
      <Link href="/quiz" className="qz-btn qz-lb-play">Play the quiz</Link>
    </main>
  );
}
