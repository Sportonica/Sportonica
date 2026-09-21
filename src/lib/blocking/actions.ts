"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { actionError, type ActionError } from "@/lib/actionError";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return { sb, user };
}

/** Block a user — ends the friendship and cancels any pending request
 *  between the two of you (either direction), via block_user() in
 *  RUN_ME_user_blocking.sql. Existing DM history stays visible; new
 *  sends in either direction are rejected at the RLS layer. */
export async function blockUser(userId: string): Promise<void | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const { error } = await sb.rpc("block_user", { p_user_id: userId });
  if (error) return actionError(error.message);
  revalidatePath("/friends");
  revalidatePath("/messages");
  revalidatePath("/profile/privacy");
}

export async function unblockUser(userId: string): Promise<void | ActionError> {
  const { sb, user } = await requireUser();
  if (!user) return actionError("UNAUTHORIZED");
  const { error } = await sb.rpc("unblock_user", { p_user_id: userId });
  if (error) return actionError(error.message);
  revalidatePath("/profile/privacy");
}
