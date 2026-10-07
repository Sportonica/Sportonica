"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { SplashScreen } from "@capacitor/splash-screen";
import { consumeHardwareBack } from "@/lib/capacitor/hardwareBack";
import { recordAppOpen } from "@/lib/capacitor/appOpenActions";
import { createClient } from "@/lib/supabase/client";

// The app is cream/"paper" only (see src/lib/hooks/useTheme.ts), so the
// system bars always want dark icons. Uses Capacitor's built-in
// SystemBars rather than @capacitor/status-bar: the app is edge-to-edge
// (Android 15+ forces it), so there's no bar color to set — the paper
// window background (android styles.xml) shows through behind the bars —
// and the old plugin's setStatusBarColor calls are deprecated on
// Android 15, which Play Console flags.
function syncStatusBar() {
  // SystemBarsStyle.Light = dark icons for a light background — named
  // for the BACKGROUND, the opposite of @capacitor/status-bar's Style.
  SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => {});
}

// Native-only wiring, mounted once in the root layout. No-ops entirely
// on the web (Capacitor.isNativePlatform() is false there) so this is
// safe to render on every page regardless of platform.
export default function CapacitorBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Scopes the "kill every webpage tell" rules in globals.css (tap
    // highlight, long-press callout, overscroll bounce) to the native
    // app only — the website keeps normal browser behavior.
    document.documentElement.classList.add("capacitor-native");

    // Same reasoning, same native-only scope: a real app's layout doesn't
    // pinch-zoom or pan like a webpage. layout.tsx's viewport export sets
    // initialScale for everyone (web needs pinch-zoom for accessibility —
    // WCAG 1.4.4 — so it can't be disabled there); overwrite the rendered
    // <meta name="viewport"> tag's content here, native-only, once mounted.
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      viewportMeta.setAttribute(
        "content",
        "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
      );
    }

    // launchAutoHide is off (capacitor.config.ts) specifically so this
    // fires once this component — meaning the remote page — has actually
    // mounted, rather than a fixed timer that risks a blank-white gap on
    // a slow connection or hanging around too long on a fast one.
    SplashScreen.hide().catch(() => {});

    syncStatusBar();

    // Tag the signed-in account as a native-app user (appOpenActions.ts)
    // on launch, on every return to the foreground, and right after a
    // sign-in — testers usually sign in on their very first launch.
    const platform = Capacitor.getPlatform();
    const tagAppOpen = () => { recordAppOpen(platform).catch(() => {}); };
    tagAppOpen();
    const resumeSub = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) tagAppOpen();
    });
    const { data: authSub } = createClient().auth.onAuthStateChange((event) => {
      // Deferred like PushBridge's: let the session cookie land first.
      if (event === "SIGNED_IN") setTimeout(tagAppOpen, 0);
    });

    // Universal Link (iOS) / App Link (Android) reopening the app —
    // this is how a Google or Apple sign-in started via Browser.open()
    // (see GoogleButton.tsx / AppleButton.tsx) hands control back once
    // it lands on /auth/callback and finishes. Also covers any other
    // sportonica.com link opened from outside the app (a shared game
    // link, etc).
    const urlSub = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      Browser.close().catch(() => {});
      try {
        const url = new URL(event.url);
        router.push(`${url.pathname}${url.search}${url.hash}`);
      } catch {
        // Not a URL we can parse into an in-app route — ignore rather
        // than crash the listener.
      }
    });

    // Hardware back: a wizard/modal on screen gets first refusal (see
    // hardwareBack.ts) so it can step back through its own state
    // instead of the press falling through to page navigation. If
    // nothing claims it, behave like a normal back button — go back in
    // the WebView's history, or exit at the root.
    const backSub = App.addListener("backButton", ({ canGoBack }) => {
      if (consumeHardwareBack()) return;
      if (canGoBack) window.history.back();
      else App.exitApp();
    });

    return () => {
      urlSub.then((s) => s.remove());
      backSub.then((s) => s.remove());
      resumeSub.then((s) => s.remove());
      authSub.subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
