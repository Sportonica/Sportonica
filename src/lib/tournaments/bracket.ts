import type { TournamentMatch } from "./types";

// The bracket rule, the same everywhere: in each knockout round,
// matches 1 and 2 feed match 1 of the next round, 3 and 4 feed match 2,
// and so on to the Final. The order comes from the next_match links,
// not from creation time or kickoff: the Final is position 0, its
// slot-a feeder 0 and slot-b feeder 1, and down (parent * 2 + slot).
// Unlinked (hand-built) matches get no position.
export function bracketPositions(matches: TournamentMatch[]): Map<string, number> {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const pos = new Map<string, number>();
  // A root only counts if something feeds it (a Final, not a loose match).
  const roots = matches.filter((x) => !x.next_match_id && matches.some((f) => f.next_match_id === x.id));
  const visit = (m: TournamentMatch, seen: Set<string>): number | null => {
    if (pos.has(m.id)) return pos.get(m.id)!;
    if (seen.has(m.id)) return null;
    seen.add(m.id);
    const next = m.next_match_id ? byId.get(m.next_match_id) : undefined;
    let p: number | null;
    if (next) {
      const parent = visit(next, seen);
      p = parent === null ? null : parent * 2 + (m.next_match_slot === "b" ? 1 : 0);
    } else {
      const i = roots.findIndex((x) => x.id === m.id);
      p = i < 0 ? null : i;
    }
    if (p !== null) pos.set(m.id, p);
    return p;
  };
  for (const m of matches) visit(m, new Set());
  return pos;
}

// One round's matches in bracket order. Unlinked matches keep their
// given order, after the linked ones.
export function sortByBracket(round: TournamentMatch[], positions: Map<string, number>): TournamentMatch[] {
  if (!round.some((m) => positions.has(m.id))) return round;
  return [...round].sort(
    (x, y) => (positions.get(x.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(y.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

// The match whose winner fills `slot` of `match`, if the bracket links one.
export function feederOf(matches: TournamentMatch[], match: TournamentMatch, slot: "a" | "b") {
  return matches.find((f) => f.next_match_id === match.id && f.next_match_slot === slot) ?? null;
}

// 1-based number of a match within its round, in bracket order
// ("Semifinal 2"), or null when the round isn't linked.
export function bracketNumber(matches: TournamentMatch[], positions: Map<string, number>, match: TournamentMatch): number | null {
  if (!positions.has(match.id)) return null;
  const sameRound = sortByBracket(matches.filter((x) => x.stage === match.stage && x.round_label === match.round_label), positions);
  return sameRound.findIndex((x) => x.id === match.id) + 1;
}

// What an empty slot is waiting for: "Winner of India v Australia", or
// "Winner of Semifinal 1" while that match's own teams aren't known.
// null when nothing feeds it (or the feeder was cancelled).
export function slotSource(
  matches: TournamentMatch[], positions: Map<string, number>, match: TournamentMatch, slot: "a" | "b",
  teamName: (id: string) => string,
): string | null {
  const f = feederOf(matches, match, slot);
  if (!f || f.status === "cancelled") return null;
  if (f.team_a_id && f.team_b_id) return `Winner of ${teamName(f.team_a_id)} v ${teamName(f.team_b_id)}`;
  const n = bracketNumber(matches, positions, f);
  return `Winner of ${f.round_label}${n ? ` ${n}` : ""}`;
}
