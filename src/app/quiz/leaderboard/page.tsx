import type { Metadata } from "next";
import Link from "next/link";
import { getGameBoard, getLeaderboard, todayStartsAt, type BoardRow, type GameRow } from "@/lib/quiz/leaderboard";
import { MAX_SCORE, QUIZ } from "@/lib/quiz/quiz";
import { STALL_GAMES, stallGame, type StallGame } from "@/lib/games/games";
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

function GameBoard({ title, rows, game }: { title: string; rows: GameRow[]; game: StallGame }) {
  return (
    <section className="qz-card qz-board">
      <h2 className="qz-q">{title}</h2>
      {rows.length ? (
        <ol className="qz-rows qz-rows-game">
          {rows.map((r) => (
            <li key={r.rank} className={r.rank <= 3 ? `top top${r.rank}` : ""}>
              <span className="qz-rank">{r.rank}</span>
              <span className="qz-name">{r.name}</span>
              <span className="qz-pts">{r.score}<small> {game.unit}</small></span>
            </li>
          ))}
        </ol>
      ) : <p className="qz-muted">No one yet. Be the first!</p>}
    </section>
  );
}

// ?board=juggling shows a stall game; no board, the quiz. Each tab is its own URL, for a stall screen.
export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const { board: key } = await searchParams;
  const game = stallGame(key);
  const since = todayStartsAt();
  let quiz: Awaited<ReturnType<typeof getLeaderboard>> | null = null;
  let games: Awaited<ReturnType<typeof getGameBoard>> | null = null;
  try {
    if (game) games = await getGameBoard(game.key, since);
    else quiz = await getLeaderboard(since);
  } catch { /* shown below */ }

  return (
    <main className="qz qz-lb">
      <AutoRefresh seconds={30} />
      <nav className="qz-tabs" aria-label="Leaderboards">
        <Link href="/quiz/leaderboard" className={!game ? "on" : ""} aria-current={!game ? "page" : undefined}>Sports quiz</Link>
        {STALL_GAMES.map((g) => (
          <Link key={g.key} href={`/quiz/leaderboard?board=${g.key}`} className={game?.key === g.key ? "on" : ""} aria-current={game?.key === g.key ? "page" : undefined}>{g.title}</Link>
        ))}
      </nav>
      <div className="qz-lb-head">
        <p className="qz-kicker">{game ? game.rule : QUIZ.title}</p>
        <h1 className="qz-title">{game ? game.title : "Leaderboard"}</h1>
        <p className="qz-muted">{game ? "Each player's best try counts. Same score? Whoever got there first." : "Highest score first. Same score? The faster player ranks higher."}</p>
      </div>
      {game && games ? (
        <div className="qz-lb-grid">
          <GameBoard title="Today" rows={games.today} game={game} />
          <GameBoard title="All time" rows={games.allTime} game={game} />
        </div>
      ) : !game && quiz ? (
        <div className="qz-lb-grid">
          <Board title="Today" rows={quiz.today} />
          <Board title="All time" rows={quiz.allTime} />
        </div>
      ) : <p className="qz-error">The leaderboard could not load. It will try again shortly.</p>}
      {game ? <p className="qz-muted">Ask at the Sportonica stall to have a go.</p> : <Link href="/quiz" className="qz-btn qz-lb-play">Play the quiz</Link>}
    </main>
  );
}
