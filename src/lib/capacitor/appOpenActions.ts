"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";

// "This account uses the native app" — the only way to see which testers
// actually installed it, since Play Console only ever reports counts.
// Lives in auth app_metadata (service-role only, like the consent record)
// so it needs no table; scripts/app-users.mjs lists it.
export type NativeAppRecord = {
  platform: "android" | "ios";
  first_seen_at: string;
  last_seen_at: string;
};

// Opens closer together than this don't rewrite the record — keeps a
// flurry of resumes from turning into a flurry of admin API calls.
const REFRESH_MS = 60 * 60 * 1000;

export async function recordAppOpen(platform: string): Promise<void> {
  if (platform !== "android" && platform !== "ios") return;

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return;

  const prev = (user.app_metadata as { native_app?: Partial<NativeAppRecord> } | undefined)?.native_app;
  const now = new Date();
  if (prev?.last_seen_at && prev.platform === platform
      && now.getTime() - Date.parse(prev.last_seen_at) < REFRESH_MS) return;

  const native_app: NativeAppRecord = {
    platform,
    first_seen_at: prev?.first_seen_at ?? now.toISOString(),
    last_seen_at: now.toISOString(),
  };

  try {
    // GoTrue merges app_metadata keys, so consent/provider data stay put.
    await createServiceClient().auth.admin.updateUserById(user.id, { app_metadata: { native_app } });
  } catch {
    // Best-effort bookkeeping — never worth surfacing to the user.
  }
}
