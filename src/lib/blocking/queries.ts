import { createClient, getUser } from "@/lib/supabase/server";

/** Have I (the viewer) blocked this person? Never exposes the reverse —
 *  whether they've blocked me stays private, same as every social app. */
export async function haveIBlocked(otherUserId: string): Promise<boolean> {
  const sb = await createClient();
  const user = await getUser();
  if (!user || user.id === otherUserId) return false;
  const { data } = await sb
    .from("blocked_users")
    .select("blocker_id")
    .eq("blocker_id", user.id)
    .eq("blocked_id", otherUserId)
    .maybeSingle();
  return !!data;
}

export type BlockedProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  blocked_at: string;
};

/** Everyone the current user has blocked. */
export async function listBlockedUsers(): Promise<BlockedProfile[]> {
  const sb = await createClient();
  const user = await getUser();
  if (!user) return [];

  const { data } = await sb
    .from("blocked_users")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });
  if (!data || data.length === 0) return [];

  const { data: profiles } = await sb
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .in("id", data.map((r) => r.blocked_id));

  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return data
    .map((r) => {
      const p = byId.get(r.blocked_id);
      if (!p) return null;
      return { ...p, blocked_at: r.created_at };
    })
    .filter((p): p is BlockedProfile => p !== null);
}
