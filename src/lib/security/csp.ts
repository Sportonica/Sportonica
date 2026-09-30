// Content-Security-Policy (SEC-06). Built in one place and used twice:
// src/proxy.ts sends it on every page with a fresh nonce, and
// next.config.ts sends the nonce-less version on everything the proxy
// skips (static files, images).
//
// Inline scripts only run if they carry the request's nonce — Next adds
// it to its own scripts during rendering, which is why every page is
// rendered per request (see `dynamic` in src/app/layout.tsx and
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
//
// Adding a third-party script, API, font, image host or iframe? Add its
// origin here or the browser will block it.
const TURNSTILE = "https://challenges.cloudflare.com";

export function buildCsp(nonce?: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.supabase.co");

  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""} ${TURNSTILE}${isDev ? " 'unsafe-eval'" : ""}`,
    // Leaflet's CSS comes from unpkg (SportonicaMap.tsx), Inter from Google Fonts.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Uploads (Supabase Storage), Google sign-in avatars, map tiles
    // (Carto's a–d subdomains) and Leaflet's marker icons.
    [
      "img-src 'self' data: blob:",
      supabase.origin,
      "https://lh3.googleusercontent.com",
      ...["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com`),
      "https://unpkg.com",
    ].join(" "),
    `connect-src 'self' ${supabase.origin} wss://${supabase.host} ${TURNSTILE}${isDev ? " ws:" : ""}`,
    `frame-src ${TURNSTILE}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
