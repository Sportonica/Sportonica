// Stall games scored by hand: a host counts, a platform admin types the
// result in at /platform/games, and each game has its own leaderboard
// (each player's best attempt). To add a game, add a line here.

export interface StallGame {
  /** stored with every score: never change it once scores exist */
  key: string;
  title: string;
  rule: string;
  /** what the number counts, e.g. "juggles" */
  unit: string;
  max: number;
}

export const STALL_GAMES: StallGame[] = [
  { key: "juggling", title: "Football juggling", rule: "Most juggles in 1 minute", unit: "juggles", max: 1000 },
];

export const stallGame = (key: string | null | undefined): StallGame | null => STALL_GAMES.find((g) => g.key === key) ?? null;
