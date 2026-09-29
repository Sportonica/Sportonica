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
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
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
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
