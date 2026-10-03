import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { CONSENT_VERSION, SIGNUP_CONSENT_COOKIE, hasConsent } from "@/lib/auth/consent";
import { safeRedirect } from "@/lib/validation/redirect";
import ConsentGate from "./ConsentGate";

export const metadata: Metadata = {
  title: "Before you continue — Sportonica",
  description: "Confirm you're 18 or older and agree to the Terms and Privacy policy.",
};

// src/proxy.ts sends signed-in accounts here until they have a consent
// record (src/lib/auth/consent.ts). Three ways in:
//  - already recorded (a stale token from before it was saved): just
//    refresh the session and carry on;
//  - ticked the box at sign-up (signup_consent in user_metadata for email
//    sign-up, or the short-lived cookie for Google/Apple from the signup
//    page): save it without asking twice;
//  - anyone else (Google/Apple from the login page, accounts from before
//    this existed): show the checkbox.
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const user = await getUser();
  if (!user || user.is_anonymous) redirect("/login");

  const target = safeRedirect(next);
  const recorded = hasConsent(user.app_metadata);
  const fromSignup = user.user_metadata?.signup_consent === CONSENT_VERSION
    || (await cookies()).get(SIGNUP_CONSENT_COOKIE)?.value === CONSENT_VERSION;

  return <ConsentGate next={target} mode={recorded ? "recorded" : fromSignup ? "signup" : "ask"} />;
}
