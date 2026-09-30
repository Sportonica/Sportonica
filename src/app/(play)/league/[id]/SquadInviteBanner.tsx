"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { respondToInvite } from "@/lib/squads/actions";
import { isActionError } from "@/lib/actionError";

// Shown to a player the squad's owner has invited. They only become a
// member once they accept here (supabase/squad_invites.sql).
export default function SquadInviteBanner({ inviteId, squadId }: { inviteId: string; squadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function respond(accept: boolean) {
    startTransition(async () => {
      setMsg(null);
      try {
        const res = await respondToInvite(inviteId, squadId, accept);
        if (isActionError(res)) {
          setMsg(res.message === "SQUAD_FULL" ? "This squad is full." : "Couldn't save that. Please try again.");
          return;
        }
        router.refresh();
      } catch {
        setMsg("Couldn't save that. Please try again.");
      }
    });
  }

  return (
    <div style={{ padding: 16, marginBottom: 18, borderRadius: 14, border: "1px solid var(--line, rgba(127,127,127,0.25))" }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 10 }}>You&apos;ve been invited to join this squad.</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="play-btn" onClick={() => respond(true)} disabled={pending}>
          <Check size={15} /> Accept
        </button>
        <button className="play-btn ghost" onClick={() => respond(false)} disabled={pending}>
          <X size={15} /> Decline
        </button>
      </div>
      {msg && <div role="alert" style={{ fontSize: 12.5, color: "#ef4444", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
