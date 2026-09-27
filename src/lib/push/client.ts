"use client";

import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

// The device's current FCM token, remembered so sign-out can drop it.
// Tokens only change on reinstall or when FCM rotates them, and a fresh
// one arrives through PushBridge's "registration" listener on every launch.
const TOKEN_KEY = "sportonica:push-token";

export function rememberPushToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* private mode */ }
}

// Call BEFORE auth.signOut(): once signed out, RLS no longer lets this
// device delete the row, and the old account would keep getting pushes
// on a phone it no longer uses. Never throws — sign-out must still work.
export async function forgetPushToken() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    await createClient().from("push_tokens").delete().eq("token", token);
  } catch { /* best effort */ }
}
