import type { NextConfig } from "next";

// Security headers (SEC-06). The CSP is an allowlist rather than
// nonce-based: nonces force every page to render dynamically (see
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md),
// which would cost the home page and /tournaments their ISR cache. So
// Next's inline scripts are allowed via 'unsafe-inline'; what the policy
// buys is: no framing (clickjacking), no plugins, no <base> or form
// hijacking, scripts only from us and Turnstile, and data only sent to
// us, Supabase and Turnstile.
//
// Adding a third-party script, API, font or iframe? Add its origin here
// or the browser will block it.
const isDev = process.env.NODE_ENV === "development";
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.supabase.co");
const TURNSTILE = "https://challenges.cloudflare.com";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}${isDev ? " 'unsafe-eval'" : ""}`,
  // Leaflet's CSS comes from unpkg (SportonicaMap.tsx), Inter from Google Fonts.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Avatars (Google, Supabase Storage), map tiles and markers, payment QRs.
  "img-src 'self' data: blob: https:",
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

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Older browsers that don't know frame-ancestors.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Discover asks for location; nothing uses the camera, mic or payments API.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  // includeSubDomains: every *.sportonica.com is served over HTTPS by
  // Vercel (wildcard DNS; checked 2026-09-29). Don't point a subdomain at
  // anything HTTP-only. No `preload` (hard to undo).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  experimental: {
    // Payment-proof screenshots (src/components/payments/PaymentStep.tsx)
    // are validated client-side up to 5MB, a real size for an unedited
    // phone camera screenshot — but Server Actions default to a 1MB body
    // limit, so anything over 1MB was silently failing production requests
    // with a generic "Error occurred in the Server Components render"
    // (actual cause only visible in server logs: "Body exceeded 1 MB
    // limit"). Raised to match the client-side check, plus headroom for
    // multipart/base64 encoding overhead on top of the raw file bytes.
    serverActions: { bodySizeLimit: "6mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "unpkg.com" },
      { protocol: "https", hostname: "tile.openstreetmap.org" },
      { protocol: "https", hostname: "*.basemaps.cartocdn.com" },
    ],
  },
  // apple-app-site-association has no file extension, so Next's static
  // file serving guesses application/octet-stream — iOS is lenient about
  // this over HTTPS, but serving the right content type removes any doubt
  // during Universal Links verification.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Bundled images were served with max-age=0, so every page view
      // re-asked the server about every photo — slow on mobile data. Their
      // names aren't content-hashed, so keep it to a week, then serve the
      // cached copy while quietly re-checking. Replacing one of these files?
      // Give it a new name so phones pick it up straight away.
      ...["/sports/:path*", "/icons/:path*", "/awards/:path*", "/nepal-provinces.geojson"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=2592000" }],
      })),
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
