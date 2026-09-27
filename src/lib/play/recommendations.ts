"use server";

import { createClient } from "@/lib/supabase/server";
import { normalizeSport } from "@/lib/sports";
import type { RailVenue } from "./homeRails";

export interface RecommendedVenue extends RailVenue {
  /** Short line the card shows for why it's here, e.g. "Because you play Futsal". */
  reason: string;
}

const POOL_SIZE = 60;
const RAIL_SIZE = 8;

/**
 * "Recommended for you" rail: verified venues ranked against the
 * signed-in player's own sports (player_sports.games — the same table
 * the profile page's sport breakdown reads, see src/lib/profile/queries.ts),
 * heaviest-played sport first. Falls back to the newest verified venues
 * (the same ordering getHomeRails uses for "Venue near me") for a
 * signed-out visitor, or an account that hasn't played a game yet.
 *
 * Deliberately its own query rather than folded into getHomeRails():
 * that one runs through the cookie-free anon client so the rest of the
 * homepage can sit behind the edge cache (see src/app/page.tsx's
 * `revalidate`). This needs the caller's own cookies to know who they
 * are, so HomeClient fetches it client-side after the cached page has
 * already painted, instead of on every visitor's cached render.
 */
export async function getRecommendedVenues(): Promise<RecommendedVenue[]> {
  const sb = await createClient();

  const { data: venueRows } = await sb
    .from("venues")
    .select("id, name, venue_type, address, photos, sports, lat, lng, courts(base_price, status)")
    .eq("verification_status", "verified")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(POOL_SIZE);

  const venues: RailVenue[] = (venueRows ?? []).map((v) => {
    const { courts, ...venue } = v as typeof v & {
      courts: { base_price: number; status: string }[] | null;
    };
    const prices = (courts ?? [])
      .filter((c) => c.status === "active")
      .map((c) => Number(c.base_price) || 0)
      .filter((p) => p > 0);
    return { ...venue, from_price: prices.length ? Math.min(...prices) : null };
  });

  const trending = (): RecommendedVenue[] =>
    venues.slice(0, RAIL_SIZE).map((v) => ({ ...v, reason: "Popular right now" }));

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return trending();

  const { data: sportsRows } = await sb
    .from("player_sports")
    .select("sport, games")
    .eq("user_id", user.id)
    .order("games", { ascending: false });

  if (!sportsRows?.length) return trending();

  const weightBySport = new Map(sportsRows.map((r) => [normalizeSport(r.sport), r.games]));

  const scored = venues
    .map((v) => {
      const played = (v.sports ?? [])
        .map((s) => normalizeSport(s))
        .filter((s) => weightBySport.has(s))
        .sort((a, b) => weightBySport.get(b)! - weightBySport.get(a)!);
      return { venue: v, sport: played[0] ?? null, weight: played[0] ? weightBySport.get(played[0])! : 0 };
    })
    .filter((s): s is { venue: RailVenue; sport: string; weight: number } => s.sport !== null)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, RAIL_SIZE)
    .map((s) => ({ ...s.venue, reason: `Because you play ${s.sport}` }));

  if (scored.length >= RAIL_SIZE) return scored;

  // Not enough sport matches to fill the rail: pad with trending venues,
  // skipping any already picked above.
  const pickedIds = new Set(scored.map((v) => v.id));
  const padding = venues
    .filter((v) => !pickedIds.has(v.id))
    .slice(0, RAIL_SIZE - scored.length)
    .map((v) => ({ ...v, reason: "Popular right now" }));

  return [...scored, ...padding];
}
