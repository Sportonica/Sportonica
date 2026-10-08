"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Keeps a server-rendered page's match scores current without a reload:
// re-fetches the route's server data every ~30s while a match on it is
// live, every ~2 minutes otherwise (so a kick-off shows up too), and right
// away when the tab comes back into view. Paused while the tab is hidden.
// Each wait is jittered so a crowd that opened the page together does not
// refresh in step; every refresh is a full server render. The ball-by-ball
// and play-by-play pages follow the scorer live instead (useLiveContest).
// router.refresh() keeps client state (open tab, scroll, city) intact.
export function useLiveRefresh(hasLive: boolean) {
  const router = useRouter();
  useEffect(() => {
    const every = hasLive ? 30_000 : 120_000;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => { timer = setTimeout(tick, every * (0.8 + Math.random() * 0.4)); };
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); schedule(); };
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [hasLive, router]);
}
