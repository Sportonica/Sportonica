"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { actionError, type ActionError } from "@/lib/actionError";
import { CONSENT_VERSION, type ConsentRecord } from "@/lib/auth/consent";

// Saves the signed-in user's "18+ and I agree" with a server timestamp.
// Written through the service role into app_metadata so the browser can't
// forge or backdate it. The caller must refresh its session afterwards:
// the proxy reads the record from the access token, and the current token
// was issued before it existed.
export async function recordConsent(source: ConsentRecord["source"] = "prompt"): Promise<{ ok: true } | ActionError> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.is_anonymous) return actionError("UNAUTHORIZED");

  const consent: ConsentRecord = {
    version: CONSENT_VERSION,
    accepted_at: new Date().toISOString(),
    age_confirmed: true,
    source: source === "signup" ? "signup" : "prompt",
  };

  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return actionError("Couldn't save that right now. Please try again.");
  }
  // GoTrue merges app_metadata keys, so this leaves provider/role data alone.
  const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { consent } });
  if (error) return actionError("Couldn't save that right now. Please try again.");
  return { ok: true };
}
