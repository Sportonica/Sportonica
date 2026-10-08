"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import MagnetDock from "./layout/MagnetDock";
import AppHeader from "./AppHeader";

// Drawn or shown only after the page is up (a canvas, a popup, a key
// check): loaded once it is interactive, not with every page's first load.
const NearbyPopup = dynamic(() => import("./NearbyPopup"), { ssr: false });
const AnimatedBackground = dynamic(() => import("./AnimatedBackground"), { ssr: false });
const EnsureE2EKey = dynamic(() => import("./EnsureE2EKey"), { ssr: false });
import { isBareChromeRoute } from "@/lib/nav/authRoutes";

// Global chrome: the animated backdrop, the magnet dock, the top-right
// actions, and the "Near me" popup.
export default function NavWrapper() {
  const pathname = usePathname();
  // The consoles and auth pages have their own chrome — same set AppHeader
  // and MagnetDock already hide themselves on.
  const hideChrome =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/platform") ||
    isBareChromeRoute(pathname);

  return (
    <>
      {!hideChrome && (
        <AnimatedBackground accent1="#006241" accent2="#1e3932" accent3="#5f756d" opacity={0.4} />
      )}
      <AppHeader />
      <MagnetDock />
      <EnsureE2EKey />
      {!hideChrome && <NearbyPopup />}
    </>
  );
}
