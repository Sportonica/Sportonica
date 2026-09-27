"use server";

import { createClient } from "@/lib/supabase/server";

export interface VenueSearchHit {
  id: string;
  name: string;
  address: string | null;
}

/**
 * Verified, open venues whose name or address matches the query, for the
 * homepage search bar (src/components/home/HomeSearch.tsx). Two plain
 * ilike queries merged client-side rather than one `.or()` filter —
 * PostgREST's `.or()` string syntax treats commas and parens as its own
 * grammar, so a venue name or a typed query containing either would
 * silently break the filter. Empty/short queries return nothing; the
 * caller decides when it's worth asking.
 */
export async function searchVenues(query: string): Promise<VenueSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const sb = await createClient();
  const pattern = `%${q}%`;
  const cols = "id, name, address";

  const [byName, byAddress] = await Promise.all([
    sb.from("venues").select(cols)
      .eq("verification_status", "verified").eq("status", "open")
      .ilike("name", pattern).limit(5),
    sb.from("venues").select(cols)
      .eq("verification_status", "verified").eq("status", "open")
      .ilike("address", pattern).limit(5),
  ]);

  const seen = new Map<string, VenueSearchHit>();
  for (const row of [...(byName.data ?? []), ...(byAddress.data ?? [])]) {
    if (!seen.has(row.id)) seen.set(row.id, row as VenueSearchHit);
  }
  return [...seen.values()].slice(0, 5);
}
