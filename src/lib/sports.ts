// ================================================================
// The one place sports are defined. Every form, filter, and card
// imports from here — so adding or renaming a sport is one edit.
//
// Note: Football was merged into Futsal. In Kathmandu the two are used
// interchangeably and nearly all bookable grounds are futsal courts,
// so keeping both created duplicate, confusing options.
// ================================================================

export interface Sport {
  name: string;
  color: string;
  /** typical squad size per side, used for cost-split defaults */
  squad: number;
  /** short line used on cards and empty states */
  tagline: string;
  /** a tournament team's default size: players on court plus bench substitutes */
  team?: { onCourt: number; substitutes: number };
  /** roster positions offered as suggestions (free text is still accepted) */
  positions?: { code: string; name: string }[];
}

export const SPORTS: Sport[] = [
  { name: "Futsal",     color: "#2E7D5B", squad: 5,  tagline: "Floodlit nights, fast feet" },
  { name: "Cricket",    color: "#f97316", squad: 8,  tagline: "Box cages after dark",
    positions: [
      { code: "Batter", name: "Batter" }, { code: "Bowler", name: "Bowler" }, { code: "All-rounder", name: "All-rounder" },
      { code: "Wicket-keeper", name: "Wicket-keeper" },
    ] },
  // a game roster is 12: five on court, seven substitutes on the bench
  { name: "Basketball", color: "#A78BFA", squad: 5,  tagline: "Five a side, full court, all week", team: { onCourt: 5, substitutes: 7 },
    positions: [
      { code: "PG", name: "Point Guard" }, { code: "SG", name: "Shooting Guard" }, { code: "SF", name: "Small Forward" },
      { code: "PF", name: "Power Forward" }, { code: "C", name: "Center" },
    ] },
  { name: "Volleyball", color: "#3b82f6", squad: 6,  tagline: "Sand, net, sunset" },
  { name: "Badminton",  color: "#a855f7", squad: 2,  tagline: "Dawn doubles, indoor courts" },
  { name: "Tennis",     color: "#ec4899", squad: 2,  tagline: "Baseline rallies" },
  { name: "Pickleball", color: "#84cc16", squad: 2,  tagline: "The fastest-growing game in town" },
  { name: "Swimming",   color: "#06b6d4", squad: 1,  tagline: "Lanes, laps, early mornings" },
  { name: "Running",    color: "#60a5fa", squad: 1,  tagline: "Ring road crews, every morning" },
];

/** Just the names — for <select> options and chip rows. */
export const SPORT_NAMES = SPORTS.map((s) => s.name);

/** name → colour, for cards, bars and badges. */
export const SPORT_COLORS: Record<string, string> = Object.fromEntries(
  SPORTS.map((s) => [s.name, s.color])
);

export function sportColor(name: string | null | undefined): string {
  return (name && SPORT_COLORS[name]) || "#006241";
}

/** Default tournament team size for a sport, or null to keep the form's generic defaults. */
export function sportTeamSize(name: string | null | undefined): { onCourt: number; substitutes: number } | null {
  return SPORTS.find((s) => s.name === name)?.team ?? null;
}

/** Roster position suggestions for a sport, or an empty list. */
export function sportPositions(name: string | null | undefined): { code: string; name: string }[] {
  return SPORTS.find((s) => s.name === name)?.positions ?? [];
}

export function sportSquad(name: string | null | undefined): number {
  return SPORTS.find((s) => s.name === name)?.squad ?? 5;
}

/**
 * Old data may still say "Football". Treat it as Futsal everywhere
 * so existing venues and games keep working after the merge.
 */
export function normalizeSport(name: string | null | undefined): string {
  if (!name) return "Futsal";
  return name.trim().toLowerCase() === "football" ? "Futsal" : name;
}

/**
 * Resolve a raw `?sport=` query value (any case, e.g. from a "Pick your
 * game" link) to one of the canonical SPORT_NAMES. Returns null if it
 * doesn't match a known sport, so callers can fall back to "any sport".
 */
export function resolveSportParam(param: string | null | undefined): string | null {
  if (!param) return null;
  const normalized = normalizeSport(param).trim().toLowerCase();
  return SPORT_NAMES.find((s) => s.toLowerCase() === normalized) ?? null;
}

/**
 * Tournaments branch on scoring shape, not on the sport name itself —
 * this is the one place that mapping happens. "team_ball" covers every
 * sport whose matches are still two-team goals/points-style (the
 * original, still-default behavior); "cricket" and "individual_race"
 * get their own scoring/registration/results UI.
 */
export type SportKind = "team_ball" | "cricket" | "individual_race";

export function getSportKind(sport: string | null | undefined): SportKind {
  const normalized = normalizeSport(sport);
  if (normalized === "Cricket") return "cricket";
  if (normalized === "Running") return "individual_race";
  return "team_ball";
}
