"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getContest } from "@/lib/intelligence/actions";
import { isActionError } from "@/lib/actionError";
import { toView, type ContestRow } from "@/lib/intelligence/view";
import type { ContestView } from "@/lib/intelligence/types";

// Keeps one contest current. Supabase Realtime pushes the row the
// moment an event is stored; a poll covers a dropped socket, a database
// where the table is not in the realtime publication, or a viewer over
// the plan's connection limit. While the socket is up the poll is only a
// slow safety net, so a crowd of viewers does not hammer the server.
//
// `hold`: the scorer's own taps are on their way and already shown
// (ScorerConsole applies them on the device). A pushed row would count
// one of them twice next to the queue, so pushes wait until it drains.
export function useLiveContest(initial: ContestView, hold = false): [ContestView, (c: ContestView) => void] {
  const [contest, setContest] = useState(initial);
  const id = initial.id;
  const holding = useRef(hold);
  const held = useRef<ContestView | null>(null);

  const newer = (c: ContestView) => setContest((cur) => (c.lastSeq > cur.lastSeq || (c.lastSeq === cur.lastSeq && c.updatedAt > cur.updatedAt) ? c : cur));

  useEffect(() => {
    holding.current = hold;
    if (!hold && held.current) { const c = held.current; held.current = null; newer(c); }
  }, [hold]);

  useEffect(() => {
    const offer = (c: ContestView) => {
      if (holding.current) { if (!held.current || c.lastSeq >= held.current.lastSeq) held.current = c; return; }
      newer(c);
    };
    const sb = createClient();
    let live = false;
    const channel = sb
      .channel(`si-contest-${id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "si_contests", filter: `id=eq.${id}` },
        (payload) => offer(toView(payload.new as ContestRow)))
      .subscribe((status) => { live = status === "SUBSCRIBED"; });

    // every 15s without a socket; every 90s with one (a missed push is rare)
    let last = Date.now();
    const poll = async (force = false) => {
      if (document.visibilityState !== "visible") return;
      if (!force && live && Date.now() - last < 90_000) return;
      last = Date.now();
      const fresh = await getContest(id);
      if (!isActionError(fresh)) offer(fresh);
    };
    const timer = setInterval(() => void poll(), 15_000);
    const onVisible = () => void poll(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => { sb.removeChannel(channel); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [id]);

  return [contest, setContest];
}
