"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Every venue id the signed-in player has favorited. Empty (never an
 * error) for a signed-out visitor, so callers can treat "no favorites"
 * and "not signed in" the same way.
 *
 * Reads db/venue_favorites.sql's table — see that file for the schema
 * and its RLS. Needs applying in the Supabase SQL editor before this
 * (and toggleFavoriteVenue below) will actually work.
 */
export async function getMyFavoriteVenueIds(): Promise<string[]> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];

  const { data } = await sb.from("venue_favorites").select("venue_id").eq("user_id", user.id);
  return (data ?? []).map((r) => r.venue_id as string);
}

/**
 * Flip one venue on/off the signed-in player's favorites. Returns the
 * new state (true = now favorited) so the caller doesn't have to guess
 * which way the toggle landed.
 */
export async function toggleFavoriteVenue(venueId: string): Promise<boolean> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("Sign in to save favorites.");

  const { data: existing } = await sb
    .from("venue_favorites")
    .select("venue_id")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .maybeSingle();

  if (existing) {
    await sb.from("venue_favorites").delete().eq("user_id", user.id).eq("venue_id", venueId);
    return false;
  }

  await sb.from("venue_favorites").insert({ user_id: user.id, venue_id: venueId });
  return true;
}
