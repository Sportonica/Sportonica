// Turns a user-typed search box value into something safe to embed in a
// PostgREST filter string like `.or(\`name.ilike.%${term}%\`)`.
//
// Those filter strings are parsed by PostgREST: a comma starts a new
// condition, parentheses group, a dot separates column/operator/value.
// Unfiltered, a search for `x%,role.eq.super_admin,username.eq.y` rewrote
// the query (security audit, SQL_INJECTION). RLS still applied, but the
// search logic was the user's to choose. This strips PostgREST's
// reserved characters, escapes LIKE wildcards, and caps the length.
export function filterSafeSearchTerm(raw: string | null | undefined, maxLength = 60): string {
  return (raw ?? "")
    .replace(/[,()"'\\:*.]/g, " ")
    .replace(/[%_]/g, (c) => `\\${c}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
