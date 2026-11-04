import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { sendPush, type PushResult } from "@/lib/push/fcm";
import { datedMessage, rotationMessage, type DailyMessage } from "@/lib/push/dailyMessages";
import { composeDailyNews, ktmDayStart, type NewsMatch, type NewsTournament } from "@/lib/push/dailyNews";

// Vercel Cron (vercel.json), once a day: sends today's message to every
// registered device, on the "updates" channel so people can mute these in
// Android settings and keep friend requests and payment alerts.
// Today's message: a DATED one if set, else tournament news, else the
// app rotation. Vercel sends CRON_SECRET as a bearer token. ?dry=1 reports
// what would go out without sending anything; with ?dry=1, &at=<ISO time>
// previews another day.

const PAGE = 1000;
const BATCH = 100;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const sb = createServiceClient();
  const tokens: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("push_tokens").select("token").order("token").range(from, from + PAGE - 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    tokens.push(...data.map((t) => t.token));
    if (data.length < PAGE) break;
  }

  const params = new URL(req.url).searchParams;
  const dry = params.has("dry");
  const at = dry && params.get("at") ? new Date(params.get("at")!) : new Date();
  if (Number.isNaN(at.getTime())) return Response.json({ error: "bad at" }, { status: 400 });

  let message: DailyMessage;
  let source: "dated" | "news" | "rotation";
  const dated = datedMessage(at);
  if (dated) {
    message = dated;
    source = "dated";
  } else {
    // A failed news lookup must not cost the day's push.
    const news = await tournamentNews(sb, at).catch((e: unknown) => {
      console.error("daily-push news", e);
      return null;
    });
    message = news ?? rotationMessage(at);
    source = news ? "news" : "rotation";
  }
  if (dry) return Response.json({ dry: true, source, message, devices: tokens.length });

  const results: { token: string; r: PushResult }[] = [];
  for (let i = 0; i < tokens.length; i += BATCH) {
    results.push(...await Promise.all(tokens.slice(i, i + BATCH).map((token) =>
      sendPush(token, { ...message, channel: "updates" }).catch((): PushResult => "failed").then((r) => ({ token, r })))));
  }

  const dead = results.filter((x) => x.r === "dead").map((x) => x.token);
  if (dead.length) await sb.from("push_tokens").delete().in("token", dead);

  return Response.json({
    sent: results.filter((x) => x.r === "sent").length,
    removed: dead.length,
    failed: results.filter((x) => x.r === "failed").length,
  });
}

const NEWS_TOURNAMENT_COLUMNS = "id, slug, name, status, organizer_name, starts_at, registration_closes_at";
const NEWS_MATCH_COLUMNS = "tournament_id, stage, round_label, team_a_id, team_b_id, next_match_id, starts_at, updated_at, status, score_a, score_b, wickets_a, wickets_b, score_a_pens, score_b_pens, winner_team_id";

async function tournamentNews(sb: ReturnType<typeof createServiceClient>, now: Date): Promise<DailyMessage | null> {
  const todayStart = ktmDayStart(now).toISOString();
  const dayAfterStart = ktmDayStart(now, 2).toISOString();

  // Public tournaments, plus ones marked completed since today began (a
  // final played today may already have closed its tournament).
  const { data: tournaments, error } = await sb.from("tournaments").select(NEWS_TOURNAMENT_COLUMNS)
    .or(`status.in.(published,registration_open,registration_closed,live),and(status.eq.completed,updated_at.gte.${todayStart})`)
    .limit(500);
  if (error) throw new Error(error.message);
  const ids = (tournaments ?? []).map((t) => t.id);
  if (!ids.length) return null;

  // Matches that kicked off (or were last touched) from today through tomorrow.
  const { data: matches, error: mErr } = await sb.from("tournament_matches").select(NEWS_MATCH_COLUMNS).in("tournament_id", ids)
    .or(`and(starts_at.gte.${todayStart},starts_at.lt.${dayAfterStart}),and(starts_at.is.null,updated_at.gte.${todayStart})`)
    .limit(2000);
  if (mErr) throw new Error(mErr.message);

  const teamIds = [...new Set((matches ?? []).flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x))];
  const teamNames = new Map<string, string>();
  for (let i = 0; i < teamIds.length; i += 200) {
    const { data: teams, error: tErr } = await sb.from("tournament_teams").select("id, name").in("id", teamIds.slice(i, i + 200));
    if (tErr) throw new Error(tErr.message);
    for (const t of teams ?? []) teamNames.set(t.id, t.name);
  }

  return composeDailyNews({
    tournaments: (tournaments ?? []) as NewsTournament[],
    matches: (matches ?? []) as NewsMatch[],
    teamNames,
  }, now);
}
