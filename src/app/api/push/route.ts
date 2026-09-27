import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/admin";
import { sendPush, type PushResult } from "@/lib/push/fcm";
import { notificationHref } from "@/lib/notifications/routing";
import type { Notification } from "@/lib/hooks/useNotifications";

// Called by the Supabase Database Webhook on every INSERT into
// public.notifications (setup: RUN_ME_push_notifications.sql). Pushes
// that notification to each of the recipient's registered devices, so
// every existing in-app notification kind becomes a push with no
// per-feature code.

function authorized(req: Request): boolean {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type WebhookPayload = { type: string; table: string; record: (Notification & { user_id: string }) | null };

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const payload = (await req.json().catch(() => null)) as WebhookPayload | null;
  const n = payload?.record;
  if (payload?.type !== "INSERT" || payload.table !== "notifications" || !n?.user_id) {
    return Response.json({ skipped: true });
  }

  const sb = createServiceClient();
  const { data: tokens } = await sb.from("push_tokens").select("token").eq("user_id", n.user_id);
  if (!tokens?.length) return Response.json({ sent: 0 });

  const msg = { title: n.title, body: n.body, url: notificationHref(n) };
  const results = await Promise.all(tokens.map(({ token }) =>
    sendPush(token, msg).catch((): PushResult => "failed").then((r) => ({ token, r }))));

  const dead = results.filter((x) => x.r === "dead").map((x) => x.token);
  if (dead.length) await sb.from("push_tokens").delete().in("token", dead);

  return Response.json({
    sent: results.filter((x) => x.r === "sent").length,
    removed: dead.length,
    failed: results.filter((x) => x.r === "failed").length,
  });
}
