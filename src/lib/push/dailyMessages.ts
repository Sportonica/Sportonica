// The one notification everyone gets each day. To run an offer or announce
// a new feature on a given day, add it to DATED under that Kathmandu date;
// it wins over everything that day. Otherwise the cron sends tournament
// news (dailyNews.ts), and on a day with no news, the rotation below.

export type DailyMessage = { title: string; body: string; url: string };

const DATED: Record<string, DailyMessage> = {
  // "2026-11-05": { title: "...", body: "...", url: "/tournaments" },
};

const ROTATION: DailyMessage[] = [
  { title: "Tournaments near you", body: "See who's playing and follow the fixtures.", url: "/tournaments" },
  { title: "Need a game today?", body: "Join a Play Together game and meet new players.", url: "/play-together" },
  { title: "Book your court", body: "Check live availability and book in a few taps.", url: "/create" },
  { title: "Fancy a quick quiz?", body: "Try the Sportonica Quiz and climb the leaderboard.", url: "/quiz" },
  { title: "Bring your friends along", body: "Find players and send them a friend request.", url: "/players" },
  { title: "Got a regular team?", body: "Set up your squad on Sportonica.", url: "/league" },
  { title: "Follow the match live", body: "Open a live tournament for scores and standings.", url: "/tournaments" },
];

const KTM_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/** A message pinned to today's Kathmandu date, if any. */
export function datedMessage(now = new Date()): DailyMessage | null {
  return DATED[new Date(now.getTime() + KTM_OFFSET_MS).toISOString().slice(0, 10)] ?? null;
}

/** The app tip for a day with nothing else to say. */
export function rotationMessage(now = new Date()): DailyMessage {
  return ROTATION[Math.floor((now.getTime() + KTM_OFFSET_MS) / 86_400_000) % ROTATION.length];
}
