// Recorded proof that an account confirmed "I'm 18 or older and I agree to
// the Terms and Privacy policy". It lives in auth app_metadata, which only
// the service role can write (unlike user_metadata, which the browser can
// set via auth.updateUser()), and it rides along in the access token, so
// src/proxy.ts can check it without a database round-trip.
//
// Bump CONSENT_VERSION when the Terms or Privacy policy change enough to
// need fresh agreement; hasConsent() then asks everyone again.

export const CONSENT_VERSION = "2026-10-02";

// Set by the signup page just before a Google/Apple sign-up, read once by
// /consent. Like user_metadata.signup_consent, it only records that this
// browser ticked the box; the saved record itself gets a server timestamp.
export const SIGNUP_CONSENT_COOKIE = "sportonica_signup_consent";

export type ConsentRecord = {
  version: string;
  accepted_at: string;
  age_confirmed: true;
  source: "signup" | "prompt";
};

export function hasConsent(appMetadata: unknown): boolean {
  const c = (appMetadata as { consent?: Partial<ConsentRecord> } | null | undefined)?.consent;
  return c?.version === CONSENT_VERSION && c.age_confirmed === true;
}

// Pages a signed-in user without a consent record can still open: the
// consent screen itself, everything needed to sign in or out, and the
// documents they're being asked to agree to.
const OPEN_PREFIXES = [
  "/consent", "/login", "/signup", "/forgot-password", "/reset-password", "/auth/",
  "/api/", "/terms", "/privacy", "/account-deletion", "/contact", "/offline",
];

export function consentExempt(path: string): boolean {
  return OPEN_PREFIXES.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"))
    || path === "/robots.txt" || path === "/sitemap.xml";
}
