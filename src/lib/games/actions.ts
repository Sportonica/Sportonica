"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isValidLocalPhone, normalizePhone, PHONE_ERROR } from "@/lib/validation/identity";
import { stallGame } from "./games";

// Scores for the stall games (./games.ts), typed in by a platform admin.
// public.stall_scores has RLS on and no policies: only these actions
// (service role, after the role check) read or write it.

export interface StallScore { id: string; game: string; full_name: string; phone: string; score: number; note: string | null; created_at: string }

async function adminId(): Promise<string | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.rpc("is_super_admin");
  return data === true ? user.id : null;
}

const TABLE_MISSING = "The stall games table is not set up yet (run the stall scores SQL in Supabase).";

export async function addStallScore(input: { game: string; name: string; phone: string; score: number; note?: string; consent: boolean }): Promise<{ score: StallScore } | { message: string }> {
  const by = await adminId();
  if (!by) return { message: "Only platform admins can add scores. Sign in again." };
  const game = stallGame(input.game);
  if (!game) return { message: "Pick a game." };
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) return { message: "Enter the player's full name." };
  if (!isValidLocalPhone(input.phone)) return { message: PHONE_ERROR };
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > game.max) return { message: `Enter a whole number of ${game.unit} from 0 to ${game.max}.` };
  if (input.consent !== true) return { message: "Read the consent line to the player and tick that they agreed." };
  const note = input.note?.trim().slice(0, 120) || null;
  const { data, error } = await createServiceClient().from("stall_scores")
    .insert({ game: game.key, full_name: name, phone: normalizePhone(input.phone), score: input.score, note, added_by: by })
    .select("id, game, full_name, phone, score, note, created_at").single();
  if (error) return { message: error.message.includes("stall_scores") ? TABLE_MISSING : "Could not save the score. Try again." };
  return { score: data as StallScore };
}

/** A score typed in by mistake: taken off the leaderboard. */
export async function removeStallScore(id: string): Promise<{ ok: true } | { message: string }> {
  if (!(await adminId())) return { message: "Only platform admins can remove scores." };
  const { error } = await createServiceClient().from("stall_scores").delete().eq("id", id);
  return error ? { message: "Could not remove it. Try again." } : { ok: true };
}

export async function listStallScores(game: string): Promise<StallScore[] | { message: string }> {
  if (!(await adminId())) return { message: "Only platform admins can see scores." };
  if (!stallGame(game)) return { message: "Unknown game." };
  const { data, error } = await createServiceClient().from("stall_scores")
    .select("id, game, full_name, phone, score, note, created_at").eq("game", game).order("created_at", { ascending: false }).limit(500);
  if (error) return { message: error.message.includes("stall_scores") ? TABLE_MISSING : "Could not load scores." };
  return (data ?? []) as StallScore[];
}
