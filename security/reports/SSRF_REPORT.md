# SSRF Security Report

## Status: PASS (after fixes) — was MEDIUM

Two places where the server fetched a URL a user controls. Both fixed; one proven exploitable locally and verified fixed.

## Findings

Inventory of every server-side `fetch()` with a non-literal URL and every server-rendered `<img>` (Satori downloads image `src` on the server): push (`fcm.googleapis.com`, fixed host), mailer (`api.brevo.com`, fixed), Supabase REST helper (fixed host), Turnstile siteverify (fixed), `parseMapsUrl` (user URL), and five image routes. Browser-side `fetch` calls (share/download buttons, map geojson) hit our own origin and aren't SSRF.

### 1. Share-image routes fetched any user-set image URL — MEDIUM (fixed)
`/p/[username]/opengraph-image` and `/p/[username]/story` rendered `profile.avatar_url` if it merely ended in `.png/.jpg/…`; `/tournaments/[id]/opengraph-image` did the same with `banner_url` (any `http(s)://…`). `avatar_url` is directly editable by the user (profiles self-update policy), `banner_url` by the organizer. Setting either to an internal address makes **our server** request it when the share image is generated — e.g. the AWS Lambda runtime API on `127.0.0.1:9001` behind Vercel functions, or any host/port for probing.

**Proven locally:** a test profile with `avatar_url = http://127.0.0.1:4555/probe.png`; requesting its two share images from a production build of `main` made the server send **2 requests** to the local listener. (`/tournaments/[id]/story` already restricted banners to our storage — the pattern the fix reuses.)

### 2. Maps short-link expansion followed redirects blind — LOW/MEDIUM (fixed)
`parseMapsUrl` (`src/lib/admin/location.ts`) allowlists https + Google hosts, but expanded short links with `fetch(url, { redirect: "follow" })` and only checked the **final** URL. Every intermediate hop was fetched unchecked, and `*.google.com` includes open redirectors (`google.com/url?q=…`). It was also a server action with no caller check.

## What's at risk

Blind SSRF from Vercel's servers: probing internal addresses/ports, hitting the function runtime API, or using our servers to hit third parties. No response content is returned to the attacker (only whether an image rendered), so data exfiltration is limited — but it's reachable by any signed-in user (avatar) with no special role.

## What's already secure

All other server-side outbound calls use fixed, hard-coded hosts. `parseMapsUrl` already had an https + Google-host allowlist and a 5 s timeout. `/tournaments/[id]/story` already limited banners to our storage.

## Recommendations

1. Server-rendered images: only our own public storage buckets, decodable formats. **Done** (`src/lib/security/storageImage.ts`, used by all four routes).
2. Redirect following: `redirect: "manual"`, allowlist each hop **before** requesting it, max 5 hops; require a signed-in caller. **Done.**
3. If a future feature must fetch arbitrary user URLs (link previews, imports), resolve DNS and reject private/loopback/link-local ranges before connecting.

## Verification (2026-09-29)

| Check | Before | After |
|---|---|---|
| Share images for a profile whose avatar points at `127.0.0.1:4555` | server made **2** internal requests | **0** requests; routes still 200 (initial fallback) |
| Existing real avatars / banners accepted by the new rule | — | 2/2 renderable avatars, 8/8 banners (1 AVIF avatar skipped, as before) |
| `parseMapsUrl` without a signed-in user | ran | "Sign in to add a map location." |
| Redirect hops | fetched blind | each hop checked against the Google allowlist before fetching (code review; no Google-controlled redirect to test against) |
