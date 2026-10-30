// The one notification everyone gets each day. To run an offer or announce
// a new feature on a given day, add it to DATED under that Kathmandu date;
// it replaces the rotation for that day only.

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

export function dailyMessage(now = new Date()): DailyMessage {
  const ktm = now.getTime() + KTM_OFFSET_MS;
  const date = new Date(ktm).toISOString().slice(0, 10);
  return DATED[date] ?? ROTATION[Math.floor(ktm / 86_400_000) % ROTATION.length];
}
