import type { NextConfig } from "next";
import { buildCsp } from "./src/lib/security/csp";

// Security headers (SEC-06). Pages get their Content-Security-Policy from
// src/proxy.ts, which adds a per-request nonce and overrides the one
// below; this nonce-less copy covers what the proxy skips (static files).

// Vercel adds `Access-Control-Allow-Origin: *` to pages it serves from its
// cache (e.g. prerendered /tournaments). Nothing reads our pages
// cross-origin (the mobile apps load the site itself), so name our own
// origin instead of a wildcard (security audit, CORS). No credentials.
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.sportonica.com").replace(/\/+$/, "");

const securityHeaders = [
  { key: "Access-Control-Allow-Origin", value: SITE_ORIGIN },
  { key: "Content-Security-Policy", value: buildCsp() },
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
  // Don't advertise the framework (X-Powered-By: Next.js).
  poweredByHeader: false,
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
  // sportonica.com -> www, except /.well-known/: Android App Links (and
  // Apple's association file) must be fetched from the exact host with
  // no redirect, or verification fails, and on Android 11 and older one
  // failing host means the app never opens sportonica.com links at all.
  // Needs the apex domain in Vercel set to serve this deployment, not to
  // redirect at the domain level (that redirect runs before this does).
  // The Android early-access invite (a static page in /public) at a clean URL.
  async rewrites() {
    return [{ source: "/early-access", destination: "/early-access.html" }];
  },
  async redirects() {
    return [
      // Its first address — already shared on WhatsApp.
      { source: "/testers", destination: "/early-access", permanent: true },
      {
        source: "/:path((?!\\.well-known/).*)",
        has: [{ type: "host", value: "sportonica.com" }],
        destination: "https://www.sportonica.com/:path",
        permanent: true,
      },
    ];
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
