"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps a server-rendered page's match scores current without a reload:
// re-fetches the route's server data every 15s while a match on it is
// live, every 60s otherwise (so a kick-off shows up too), and right away
// when the tab comes back into view. Paused while the tab is hidden.
// router.refresh() keeps client state (open tab, scroll, city) intact.
export function useLiveRefresh(hasLive: boolean) {
  const router = useRouter();
  useEffect(() => {
    const every = hasLive ? 15_000 : 60_000;
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, every);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [hasLive, router]);
}
