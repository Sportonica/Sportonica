// The evening news push, built from our own tournaments. Pure: the cron
// route fetches the rows and passes them in, so this can be checked
// without a database (npm run test:daily-news).
//
// One message a day, picked in this order:
//   1. a final finished today          -> "Champions: <team>"
//   2. today's results and/or tomorrow's fixtures, for the busiest tournament
//   3. a tournament whose registration closes within three days
// Nothing to say -> null, and the route falls back to the app rotation.

import type { DailyMessage } from "./dailyMessages";

export interface NewsTournament {
  id: string;
  slug: string | null;
  name: string;
  status: string;
  organizer_name: string | null;
  starts_at: string | null;
  registration_closes_at: string | null;
}

export interface NewsMatch {
  tournament_id: string;
  stage: string;
  round_label: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  next_match_id: string | null;
  starts_at: string | null;
  updated_at: string;
  status: string;
  score_a: number | null;
  score_b: number | null;
  wickets_a: number | null;
  wickets_b: number | null;
  score_a_pens: number | null;
  score_b_pens: number | null;
  winner_team_id: string | null;
}

export interface NewsInput {
  tournaments: NewsTournament[];
  matches: NewsMatch[];
  teamNames: Map<string, string>;
}

const KTM_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;
const DAY_MS = 86_400_000;
const DONE = new Set(["completed", "walkover"]);
const MAX_RESULTS_SHOWN = 2;

/** Kathmandu calendar date (YYYY-MM-DD) of an instant. */
export const ktmDate = (t: Date | string | number): string =>
  new Date(new Date(t).getTime() + KTM_OFFSET_MS).toISOString().slice(0, 10);

/** The UTC instant Kathmandu's day `offsetDays` from `now` begins. */
export const ktmDayStart = (now: Date, offsetDays = 0): Date =>
  new Date(Date.parse(`${ktmDate(now.getTime() + offsetDays * DAY_MS)}T00:00:00Z`) - KTM_OFFSET_MS);

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kathmandu", hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kathmandu", weekday: "long" });
const ktmTime = (iso: string) => timeFmt.format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm");

const pathOf = (t: NewsTournament) => `/tournaments/${t.slug ?? t.id}`;

/** Test and sample tournaments are public for checking, never news. */
export const isNewsworthy = (t: NewsTournament) =>
  !/^test\b/i.test(t.name.trim()) && t.organizer_name !== "Sportonica (sample)";

const side = (m: NewsMatch, s: "a" | "b"): string | null => {
  const runs = s === "a" ? m.score_a : m.score_b;
  const wkts = s === "a" ? m.wickets_a : m.wickets_b;
  if (runs === null) return null;
  return wkts !== null ? `${runs}/${wkts}` : String(runs);
};

const isFinal = (m: NewsMatch) =>
  m.stage === "knockout" && !m.next_match_id && /final/i.test(m.round_label ?? "") &&
  !/semi|quarter|third|3rd|bronze|eliminator|qualifier/i.test(m.round_label ?? "");

/** "Team A beat Team B 3–1", or null when a side is still TBD. */
export function resultLine(m: NewsMatch, names: Map<string, string>): string | null {
  const a = m.team_a_id ? names.get(m.team_a_id) : undefined;
  const b = m.team_b_id ? names.get(m.team_b_id) : undefined;
  if (!a || !b) return null;
  const sa = side(m, "a");
  const sb = side(m, "b");

  if (!m.winner_team_id) {
    if (m.status === "walkover") return null;
    return sa && sb ? `${a} ${sa}–${sb} ${b}` : `${a} drew with ${b}`;
  }
  const aWon = m.winner_team_id === m.team_a_id;
  const [w, l] = aWon ? [a, b] : [b, a];
  if (m.status === "walkover") return `${w} got a walkover against ${l}`;

  let line = `${w} beat ${l}`;
  const [ws, ls] = aWon ? [sa, sb] : [sb, sa];
  if (ws && ls) line += ` ${ws}–${ls}`;
  if (m.score_a_pens !== null && m.score_b_pens !== null) {
    const [wp, lp] = aWon ? [m.score_a_pens, m.score_b_pens] : [m.score_b_pens, m.score_a_pens];
    line += ` (${wp}–${lp} on penalties)`;
  }
  return line;
}

const fixtureLine = (m: NewsMatch, names: Map<string, string>) => {
  const a = m.team_a_id ? names.get(m.team_a_id) : undefined;
  const b = m.team_b_id ? names.get(m.team_b_id) : undefined;
  return a && b ? `${a} vs ${b}` : null;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "es"}`;

export function composeDailyNews({ tournaments, matches, teamNames }: NewsInput, now = new Date()): DailyMessage | null {
  const today = ktmDate(now);
  const tomorrow = ktmDate(now.getTime() + DAY_MS);
  const byId = new Map(tournaments.filter(isNewsworthy).map((t) => [t.id, t]));

  const finishedToday = matches
    .filter((m) => byId.has(m.tournament_id) && DONE.has(m.status) && m.team_b_id && ktmDate(m.starts_at ?? m.updated_at) === today)
    .sort((x, y) => (x.starts_at ?? x.updated_at).localeCompare(y.starts_at ?? y.updated_at));
  const tomorrowFixtures = matches
    .filter((m) => byId.has(m.tournament_id) && m.status === "scheduled" && m.starts_at && ktmDate(m.starts_at) === tomorrow)
    .sort((x, y) => x.starts_at!.localeCompare(y.starts_at!));

  // 1. A final finished today.
  for (const m of finishedToday) {
    if (!isFinal(m) || !m.winner_team_id) continue;
    const t = byId.get(m.tournament_id)!;
    const winner = teamNames.get(m.winner_team_id);
    const line = resultLine(m, teamNames);
    if (!winner || !line) continue;
    return { title: `Champions: ${winner}`, body: `${winner} won the ${t.name}. Final: ${line}.`, url: pathOf(t) };
  }

  // 2. The busiest tournament's day: results count double, fixtures once.
  const weight = new Map<string, number>();
  for (const m of finishedToday) if (resultLine(m, teamNames)) weight.set(m.tournament_id, (weight.get(m.tournament_id) ?? 0) + 2);
  for (const m of tomorrowFixtures) weight.set(m.tournament_id, (weight.get(m.tournament_id) ?? 0) + 1);
  const busiest = [...weight.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];

  if (busiest) {
    const t = byId.get(busiest)!;
    const results = finishedToday.filter((m) => m.tournament_id === busiest).map((m) => resultLine(m, teamNames)).filter((s): s is string => !!s);
    const next = tomorrowFixtures.filter((m) => m.tournament_id === busiest);
    const startsTomorrow = !results.length && !!t.starts_at && ktmDate(t.starts_at) === tomorrow;

    const nextLine = next.length
      ? `${results.length ? "Tomorrow: " : ""}${plural(next.length, "match")} from ${ktmTime(next[0].starts_at!)}.`
      : "";

    if (results.length) {
      const shown = results.slice(0, MAX_RESULTS_SHOWN).join(" · ");
      const more = results.length > MAX_RESULTS_SHOWN ? ` · +${results.length - MAX_RESULTS_SHOWN} more` : "";
      return { title: `Today's results: ${t.name}`, body: [`${shown}${more}.`, nextLine].filter(Boolean).join(" "), url: pathOf(t) };
    }
    const first = fixtureLine(next[0], teamNames);
    return {
      title: `${startsTomorrow ? "Starts tomorrow" : "Tomorrow"}: ${t.name}`,
      body: [nextLine, first ? `First up: ${first}.` : ""].filter(Boolean).join(" "),
      url: pathOf(t),
    };
  }

  // 3. Registration closing soon.
  const closing = [...byId.values()]
    .filter((t) => t.status === "registration_open" && t.registration_closes_at &&
      Date.parse(t.registration_closes_at) > now.getTime() && Date.parse(t.registration_closes_at) - now.getTime() <= 3 * DAY_MS)
    .sort((x, y) => x.registration_closes_at!.localeCompare(y.registration_closes_at!))[0];
  if (closing) {
    const closes = closing.registration_closes_at!;
    const when = ktmDate(closes) === today ? "tonight" : ktmDate(closes) === tomorrow ? "tomorrow" : `on ${weekdayFmt.format(new Date(closes))}`;
    return { title: `Last call: ${closing.name}`, body: `Registration closes ${when}. Get your team in.`, url: pathOf(closing) };
  }

  return null;
}
