import Link from "next/link";
import { listStallScores } from "@/lib/games/actions";
import { STALL_GAMES, stallGame } from "@/lib/games/games";
import GameScores from "./GameScores";

export const dynamic = "force-dynamic";

export default async function PlatformGamesPage({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const { game: key } = await searchParams;
  const game = stallGame(key) ?? STALL_GAMES[0];
  const scores = await listStallScores(game.key);
  return (
    <>
      <h1 className="plt-h1">Stall games</h1>
      <p className="plt-sub2">Type in a player&apos;s result. Each player&apos;s best try goes on the public leaderboard.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 18px" }}>
        {STALL_GAMES.map((g) => (
          <Link key={g.key} href={`/platform/games?game=${g.key}`}
            style={{ padding: "8px 16px", borderRadius: 999, fontWeight: 700, fontSize: 14, textDecoration: "none", color: g.key === game.key ? "#fff" : "inherit", background: g.key === game.key ? "#3730a3" : "transparent", border: "1px solid rgba(127,127,127,.35)" }}>
            {g.title}
          </Link>
        ))}
        <Link href={`/quiz/leaderboard?board=${game.key}`} style={{ padding: "8px 4px", fontWeight: 700, fontSize: 14, color: "inherit" }}>Public leaderboard →</Link>
      </div>
      {"message" in scores
        ? <p style={{ color: "#ef4444", fontSize: 14 }}>{scores.message}</p>
        : <GameScores key={game.key} game={game} initial={scores} />}
    </>
  );
}
