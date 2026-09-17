"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldOff } from "lucide-react";
import { blockUser, unblockUser } from "@/lib/blocking/actions";
import { getCachedUser } from "@/lib/supabase/authCache";
import { isActionError } from "@/lib/actionError";

export default function BlockButton({
  profileId, initialBlocked, name = "this person", onChange,
}: { profileId: string; initialBlocked: boolean; name?: string; onChange?: (blocked: boolean) => void }) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function requireLoggedIn(): Promise<boolean> {
    const user = await getCachedUser();
    if (!user) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;
      return false;
    }
    return true;
  }

  function toggle() {
    if (!blocked && !window.confirm(
      `Block ${name}? They won't be able to message or add you as a friend, and your existing conversation (if any) will go silent.`
    )) return;
    setError(null);
    startTransition(async () => {
      if (!(await requireLoggedIn())) return;
      const res = blocked ? await unblockUser(profileId) : await blockUser(profileId);
      if (isActionError(res)) { setError(res.message); return; }
      setBlocked(!blocked);
      onChange?.(!blocked);
      router.refresh();
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
      <button
        onClick={toggle} disabled={pending} title={blocked ? "Unblock" : "Block"}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none",
          color: "var(--faint)", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit", padding: 4 }}
      >
        {blocked ? <ShieldOff size={12} /> : <Ban size={12} />} {blocked ? "Unblock" : "Block"}
      </button>
      {error && <span style={{ fontSize: 11.5, color: "#ef4444" }}>{error}</span>}
    </span>
  );
}
