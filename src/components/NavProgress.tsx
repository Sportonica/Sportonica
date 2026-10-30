"use client";

// A small spinning circle near the top that appears the moment a link
// is tapped and goes away when the new page arrives. Pages are rendered on the server
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
      <span />
      <style>{`
        .navp { position: fixed; left: 0; right: 0; top: calc(env(safe-area-inset-top) + 72px); z-index: 2147483000; pointer-events: none;
          width: 40px; height: 40px; margin: 0 auto; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.18);
          display: grid; place-items: center; opacity: 0; transform: scale(.6); transition: opacity .15s, transform .15s; }
        .navp > span { width: 22px; height: 22px; border-radius: 50%; border: 3px solid rgba(0,98,65,.18); border-top-color: #006241; animation: navp-spin .7s linear infinite; }
        .navp-busy { opacity: 1; transform: scale(1); }
        .navp-idle > span { animation: none; }
        @keyframes navp-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .navp { transition: opacity .15s; transform: none; } .navp > span { animation-duration: 1.4s; } }
      `}</style>
    </div>
  );
}
