import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { sendPush, type PushResult } from "@/lib/push/fcm";
import { dailyMessage } from "@/lib/push/dailyMessages";

// Vercel Cron (vercel.json), once a day: sends today's message to every
// registered device, on the "updates" channel so people can mute these in
// Android settings and keep friend requests and payment alerts.
// Vercel sends CRON_SECRET as a bearer token. ?dry=1 reports what would go
// out without sending anything.

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

  const message = dailyMessage();
  if (new URL(req.url).searchParams.has("dry")) return Response.json({ dry: true, message, devices: tokens.length });

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
