// Player ids inside event payloads, for fixes that move one player's
// records to another: which payload keys hold a player is up to each sport.

/** The ids under those keys swapped, a for b and b for a (a player who never appeared there is simply replaced). */
export function swapIds(value: unknown, a: string, b: string, keys: Set<string>, key = ""): unknown {
  if (typeof value === "string") return keys.has(key) ? (value === a ? b : value === b ? a : value) : value;
  if (Array.isArray(value)) return value.map((v) => swapIds(v, a, b, keys, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => k !== "audit").map(([k, v]) => [k, swapIds(v, a, b, keys, k)]));
  }
  return value;
}

/** Whether any of these ids sits under one of those keys. */
export function mentions(value: unknown, ids: string[], keys: Set<string>, key = ""): boolean {
  if (typeof value === "string") return keys.has(key) && ids.includes(value);
  if (Array.isArray(value)) return value.some((v) => mentions(v, ids, keys, key));
  return !!value && typeof value === "object" && Object.entries(value).some(([k, v]) => k !== "audit" && mentions(v, ids, keys, k));
}
