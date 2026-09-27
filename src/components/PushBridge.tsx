"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";
import { rememberPushToken } from "@/lib/push/client";

// Native push wiring, mounted once in the root layout next to
// CapacitorBridge. No-op on the web. The server side lives in
// src/app/api/push/route.ts: every notifications row that gets inserted
// is also pushed to that user's devices, so there's nothing per-feature
// to hook up here.
export default function PushBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sb = createClient();
    const platform = Capacitor.getPlatform() as "android" | "ios";

    // Only real (non-anonymous) accounts get pushes — a guest session
    // has no notifications of its own. The OS permission prompt is
    // therefore first shown right after sign-in, not on a cold launch.
    async function registerIfSignedIn() {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || user.is_anonymous) return;
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== "granted") return;
      await PushNotifications.register();
    }

    const regSub = PushNotifications.addListener("registration", async ({ value }) => {
      rememberPushToken(value);
      await sb.rpc("register_push_token", { p_token: value, p_platform: platform });
    });

    // Tapping a push opens the same page the in-app bell would
    // (the server puts notificationHref() into data.url).
    const tapSub = PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = notification.data?.url;
      if (typeof url === "string" && url.startsWith("/")) router.push(url);
    });

    // Android 8+ shows nothing without a channel; creating it again is a no-op.
    if (platform === "android") {
      PushNotifications.createChannel({
        id: "default", name: "Sportonica", description: "Games, bookings, payments and tournaments",
        importance: 4, visibility: 1,
      }).catch(() => {});
    }

    registerIfSignedIn().catch(() => {});
    const { data: authSub } = sb.auth.onAuthStateChange((event) => {
      // Deferred for the same reason as authCache.ts: calling back into
      // auth from inside this callback would deadlock Supabase's auth lock.
      if (event === "SIGNED_IN") setTimeout(() => { registerIfSignedIn().catch(() => {}); }, 0);
    });

    return () => {
      regSub.then((s) => s.remove());
      tapSub.then((s) => s.remove());
      authSub.subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
