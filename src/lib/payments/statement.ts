"use server";

import { createClient } from "@/lib/supabase/server";

export interface StatementRow {
  key: string;
  label: string;
  /** ISO timestamp — callers format it however they need (a page renders it locally, the CSV export writes it plainly). */
  when: string;
  amount: number;
  status: string;
  href: string | null;
  /** Set only for a real court booking — the one kind of row with an actual receipt to print/email. Play Together contributions are paid host-to-player and never touch a payments row. */
  courtBookingId: string | null;
}

export const STATUS_LABEL: Record<string, string> = {
  paid: "Paid", pending_verification: "Awaiting verification", rejected: "Rejected", unpaid: "Unpaid",
  collected: "Paid to host", pending: "Owed to host",
};

type CourtRow = {
  id: string; starts_at: string; price: number; payment_status: string;
  courts: { name: string; sport: string } | null; venues: { name: string } | null;
};
type GameRow = {
  id: string; game_id: string; contribution_amount: number; contribution_status: string;
  status: string; joined_at: string; games: { sport: string; venues: { name: string } | null } | null;
};

/**
 * Every payment row for the signed-in player, most recent first — court
 * bookings paid to Sportonica, and Play Together contributions paid
 * directly to hosts. Shared by /profile/payments and its CSV export
 * (route.ts) so the two can't drift out of sync with each other.
 */
export async function getMyStatementRows(): Promise<StatementRow[]> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];

  const [{ data: courtBookings }, { data: gamePlayers }] = await Promise.all([
    sb.from("court_bookings")
      .select("id, starts_at, price, payment_status, courts(name, sport), venues(name)")
      .eq("user_id", user.id)
      .order("starts_at", { ascending: false })
      .limit(50),
    sb.from("game_players")
      .select("id, game_id, contribution_amount, contribution_status, status, joined_at, games(sport, venues(name))")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false })
      .limit(50),
  ]);

  const rows: StatementRow[] = [
    ...((courtBookings ?? []) as unknown as CourtRow[]).map((b) => ({
      key: `cb-${b.id}`,
      label: `${b.courts?.sport ?? "Court"} · ${b.venues?.name ?? "Venue"}`,
      when: b.starts_at,
      amount: Number(b.price) || 0,
      status: STATUS_LABEL[b.payment_status] ?? b.payment_status,
      href: null,
      courtBookingId: b.id,
    })),
    ...((gamePlayers ?? []) as unknown as GameRow[])
      .filter((g) => g.status === "joined" || g.status === "payment_pending" || g.status === "payment_verification_pending" || g.status === "payment_rejected")
      .map((g) => ({
        key: `gp-${g.id}`,
        label: `${g.games?.sport ?? "Game"} · ${g.games?.venues?.name ?? "Venue"} (Play Together)`,
        when: g.joined_at,
        amount: Number(g.contribution_amount) || 0,
        status: g.status === "joined"
          ? (STATUS_LABEL[g.contribution_status] ?? g.contribution_status)
          : g.status === "payment_pending" ? "Payment required, tap to pay"
          : g.status === "payment_verification_pending" ? "Awaiting host verification"
          : "Payment not verified, tap to resubmit",
        // Sends them straight back to the game page, which auto-opens the
        // pay-the-host / upload-screenshot popup for these two statuses
        // (see the autoOpenedRef effect in PlayTogetherJoinPanel).
        href: `/play-together/${g.game_id}`,
        courtBookingId: null,
      })),
  ];

  // Chronological, most recent first — this is a statement, not a
  // leaderboard (the page this replaced used to sort by amount).
  rows.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  return rows;
}
