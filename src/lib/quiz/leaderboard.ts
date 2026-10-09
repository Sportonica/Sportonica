import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/admin";
import { QUIZ } from "./quiz";

// The quiz leaderboard: highest score first, then the fastest. Names are
// cut to first name and last initial here, so a full name or a phone
// number never leaves the server.

export interface BoardRow { rank: number; name: string; score: number; seconds: number }

/** Midnight in Nepal (UTC+5:45), as an instant: where "today" starts. */
export function todayStartsAt(now = Date.now()): string {
  const npt = new Date(now + 345 * 60_000);
  return new Date(Date.UTC(npt.getUTCFullYear(), npt.getUTCMonth(), npt.getUTCDate()) - 345 * 60_000).toISOString();
}

/** "Sita Kumari Rai" -> "Sita R."; "ram" -> "Ram". */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

async function top(since: string | null, limit: number): Promise<BoardRow[]> {
  let q = createServiceClient().from("quiz_entries").select("full_name, score, duration_ms")
    .eq("quiz_id", QUIZ.id).not("finished_at", "is", null);
  if (since) q = q.gte("finished_at", since);
  const { data, error } = await q.order("score", { ascending: false }).order("duration_ms", { ascending: true }).order("finished_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r, i) => ({ rank: i + 1, name: shortName(r.full_name), score: r.score ?? 0, seconds: (r.duration_ms ?? 0) / 1000 }));
}

// One read every 15 seconds at most, however many screens show the board.
export const getLeaderboard = unstable_cache(
  async (since: string) => ({ today: await top(since, 10), allTime: await top(null, 10) }),
  ["quiz-leaderboard", QUIZ.id],
  { revalidate: 15 },
);

// ── stall games (src/lib/games): each phone's best attempt ───────

export interface GameRow { rank: number; name: string; score: number }

async function gameTop(game: string, since: string | null, limit: number): Promise<GameRow[]> {
  const { data, error } = await createServiceClient().rpc("stall_game_board", { p_game: game, p_since: since, p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { full_name: string; score: number }[]).map((r, i) => ({ rank: i + 1, name: shortName(r.full_name), score: r.score }));
}

export const getGameBoard = unstable_cache(
  async (game: string, since: string) => ({ today: await gameTop(game, since, 10), allTime: await gameTop(game, null, 10) }),
  ["stall-game-board"],
  { revalidate: 15 },
);
