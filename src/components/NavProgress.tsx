"use client";

// A thin bar at the top that starts the moment a link is tapped and
// finishes when the new page arrives. Pages are rendered on the server
// for every visit, so without it a tap looked like nothing happened for
// half a second or more. (Not a loading.tsx: that would commit a 200
// before a page's notFound()/redirect(), see RouteLoadingSpinner.)
// Arrival is the URL changing, which Next does once the new page is in:
// no useSearchParams, which would need a Suspense boundary in the root
// layout.

import { useEffect, useState } from "react";

export default function NavProgress() {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  useEffect(() => {
    let tick: ReturnType<typeof setInterval> | undefined, giveUp: ReturnType<typeof setTimeout> | undefined, fade: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearInterval(tick); clearTimeout(giveUp); clearTimeout(fade); };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page, or a #hash
      stop();
      const from = location.pathname + location.search;
      setState("busy");
      // a light check every 80ms while a page is on its way (not animation
      // frames: those pause in a tab that isn't in front)
      tick = setInterval(() => {
        if (location.pathname + location.search === from) return;
        stop();
        setState("done");
        fade = setTimeout(() => setState("idle"), 300);
      }, 80);
      // never left showing if the navigation goes nowhere
      giveUp = setTimeout(() => { clearInterval(tick); setState("idle"); }, 12_000);
    };
    // capture: Next's <Link> cancels the browser's own navigation (to do its
    // own) before a bubbling listener would see the click
    document.addEventListener("click", onClick, true);
    return () => { stop(); document.removeEventListener("click", onClick, true); };
  }, []);

  return (
    <div aria-hidden="true" className={`navp navp-${state}`}>
      <style>{`
        .navp { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 2147483000; pointer-events: none; padding-top: env(safe-area-inset-top); }
        .navp::before { content: ""; display: block; height: 3px; width: 0; background: #006241; box-shadow: 0 0 6px rgba(0,98,65,.5); opacity: 0; }
        .navp-busy::before { opacity: 1; width: 85%; transition: width 6s cubic-bezier(.1,.7,.2,1), opacity .1s; }
        .navp-done::before { opacity: 0; width: 100%; transition: width .2s ease-out, opacity .3s ease .15s; }
        @media (prefers-reduced-motion: reduce) { .navp-busy::before { transition: opacity .1s; } }
      `}</style>
    </div>
  );
}
