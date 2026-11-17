"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveSportParam } from "@/lib/sports";

/** Only show what's within this distance of the user. */
const RADIUS_KM = 5;
/** Safety cap per list; 5 km rarely holds this many. */
const MAX_ROWS = 50;

export interface NearbyVenue {
  id: string; name: string; venue_type: string;
  sports: string[] | null; km: number;
}
export interface NearbyGame {
  id: string; title: string; sport: string; venue: string;
  event_date: string; slots_remaining: number; km: number;
}
export interface NearbyResult { venues: NearbyVenue[]; games: NearbyGame[] }

const R = 6371;
const toRad = (v: number) => (v * Math.PI) / 180;
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Approved venues + upcoming games within RADIUS_KM of a point, closest
// first. A lat/lng bounding box narrows the query in the database; the
// exact distance check happens here. Venue sports are normalised to the
// canonical names so the popup's sport chips match them.
//
// Closest approved venues + closest upcoming games to a point. The two
// queries are independent on purpose (Promise.allSettled, not
// Promise.all) — a transient failure on one (a slow/overloaded
// database, a dropped connection) shouldn't wipe out the other's
// perfectly good result along with it.
export async function nearbyVenuesAndGames(lat: number, lng: number): Promise<NearbyResult> {
  const sb = await createClient();
  const dLat = RADIUS_KM / 111.32;
  const dLng = RADIUS_KM / (111.32 * Math.max(Math.cos(toRad(lat)), 0.01));

  const [venuesRes, gamesRes] = await Promise.allSettled([
    sb.from("venues")
      .select("id, name, venue_type, sports, lat, lng")
      .eq("verification_status", "verified")
      .eq("status", "open")
      .gte("lat", lat - dLat).lte("lat", lat + dLat)
      .gte("lng", lng - dLng).lte("lng", lng + dLng)
      .limit(200),
    sb.from("events_with_counts")
      .select("id, title, sport, venue, event_date, slots_remaining, venue_lat, venue_lng")
      .gte("event_date", new Date().toISOString())
      .gte("venue_lat", lat - dLat).lte("venue_lat", lat + dLat)
      .gte("venue_lng", lng - dLng).lte("venue_lng", lng + dLng)
      .order("event_date", { ascending: true })
      .limit(200),
  ]);

  const venues = venuesRes.status === "fulfilled" ? venuesRes.value.data : null;
  const games = gamesRes.status === "fulfilled" ? gamesRes.value.data : null;

  return {
    venues: (venues ?? [])
      .map((v) => ({
        id: v.id, name: v.name, venue_type: v.venue_type,
        sports: v.sports
          ? [...new Set<string>((v.sports as string[]).map((s) => resolveSportParam(s) ?? s))]
          : null,
        km: km(lat, lng, v.lat as number, v.lng as number),
      }))
      .filter((x) => x.km <= RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_ROWS),
    games: (games ?? [])
      .map((g) => ({
        id: g.id, title: g.title, sport: resolveSportParam(g.sport) ?? g.sport, venue: g.venue,
        event_date: g.event_date,
        slots_remaining: Number(g.slots_remaining) || 0,
        km: km(lat, lng, g.venue_lat as number, g.venue_lng as number),
      }))
      .filter((x) => x.km <= RADIUS_KM)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_ROWS),
  };
}
