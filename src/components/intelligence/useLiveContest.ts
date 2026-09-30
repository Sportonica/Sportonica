"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { toView, type ContestRow } from "@/lib/intelligence/view";
import type { ContestView } from "@/lib/intelligence/types";

// Keeps one contest current. Supabase Realtime pushes the row the
// moment an event is stored; a slow poll covers a dropped socket or a
// database where the table is not in the realtime publication.
export function useLiveContest(initial: ContestView): [ContestView, (c: ContestView) => void] {
  const [contest, setContest] = useState(initial);
  const id = initial.id;

  useEffect(() => {
    const newer = (c: ContestView) => setContest((cur) => (c.lastSeq > cur.lastSeq || (c.lastSeq === cur.lastSeq && c.updatedAt > cur.updatedAt) ? c : cur));
    const sb = createClient();
    const channel = sb
      .channel(`si-contest-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "si_contests", filter: `id=eq.${id}` },
        (payload) => newer(toView(payload.new as ContestRow)))
      .subscribe();

    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      const fresh = await getContest(id);
      if (!isActionError(fresh)) newer(fresh);
    };
    const timer = setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => { sb.removeChannel(channel); clearInterval(timer); document.removeEventListener("visibilitychange", poll); };
  }, [id]);

  return [contest, setContest];
}
