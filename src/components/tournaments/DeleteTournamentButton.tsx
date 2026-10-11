"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTournament } from "@/lib/tournaments/actions";
import { isActionError } from "@/lib/actionError";

export default function DeleteTournamentButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function remove() {
    if (!window.confirm(`Permanently delete "${name}"? This also deletes its teams, matches and scores, and can't be undone.`)) return;
    start(async () => {
      const res = await deleteTournament(id);
      if (isActionError(res)) setErr(res.message);
      else router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="tc-btn" disabled={pending} onClick={remove} style={{ padding: "5px 9px", fontSize: 12, color: "#ef4444" }}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {err && <div className="ev-err" style={{ marginTop: 6, marginBottom: 0 }}>{err}</div>}
    </>
  );
}
