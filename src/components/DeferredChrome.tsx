"use client";

// The parts of the app shell that show nothing on first paint: the
// first-visit onboarding (and its animation library), the install prompt,
// and the native app bridges. Loaded as separate files once the page is
// interactive, so they stay out of the JavaScript every page downloads
// and runs before it can respond.

import dynamic from "next/dynamic";

const Onboarding = dynamic(() => import("./onboarding/Onboarding"), { ssr: false });
const PWARegister = dynamic(() => import("./PWARegister"), { ssr: false });
const CapacitorBridge = dynamic(() => import("./CapacitorBridge"), { ssr: false });
const PushBridge = dynamic(() => import("./PushBridge"), { ssr: false });

export default function DeferredChrome() {
  return (
    <>
      <PWARegister />
      <CapacitorBridge />
      <PushBridge />
      <Onboarding />
    </>
  );
}
