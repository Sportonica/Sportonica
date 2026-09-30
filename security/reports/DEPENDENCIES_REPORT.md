# DEPENDENCIES Security Report

## Status: PASS (after fixes) — was CRITICAL

## Findings

### Known vulnerabilities (`npm audit`) — was CRITICAL (fixed)
Production dependencies before: **1 critical, 3 high, 1 moderate**.
- **`next@16.2.9`** — 11 advisories, including two **critical unauthenticated RCEs** (Windows-hosted servers; Image Optimization API with AVIF files — fixed in 16.3.3), a **Middleware/Proxy bypass** in App Router with Turbopack (relevant to `src/proxy.ts` gates; production builds use webpack, but dev uses Turbopack), server-action DoS and SSRF on custom servers, cache confusion, and disclosure of internal Server Function endpoints (fixed in 16.2.11).
- **`postcss`** (bundled with next) — XSS and arbitrary `.map` file read (high).
- **`sharp`** (bundled with next) — libvips / libheif CVEs (high).
- **`nanoid`** — infinite-loop DoS (high); **`baseline-browser-mapping`** — DoS (moderate).

After upgrading to **`next@16.3.7`** / `eslint-config-next@16.3.7` and `npm audit fix`: **production dependencies: 0 vulnerabilities.** Remaining: 3 moderate in `@capacitor/cli` → `xcode` → `uuid` (a local mobile build tool, never deployed; npm's only "fix" is a downgrade) — accepted.

### Package legitimacy — PASS
All 18 runtime and 11 dev dependencies are established packages from their official publishers (Capacitor, Supabase, Next.js/React, Leaflet, Lucide, framer-motion, qrcode, server-only (React team), Tailwind, ESLint, TypeScript). No typo-squats or unknown names.

### Pinning / lock file — was LOW (fixed)
`package-lock.json` is committed. `next`, `react`, `react-dom` were exact; 27 others used `^` ranges. All now pinned to the exact installed versions (no version actually changed).

### Tools
`npm audit` run; `gitleaks`, `semgrep`, `pip-audit` not installed / not applicable.

## What's at risk

Before: known critical/high framework CVEs on the production server and a proxy-bypass class bug affecting auth gates.

## Recommendations

1. Upgrade Next.js and fix transitive advisories. **Done.**
2. Pin exact versions. **Done.**
3. Run `npm audit --omit=dev` before each release (or enable Dependabot security updates on the repo).

## Verification (2026-09-30) — regression after the Next.js upgrade

- Typecheck ok; lint 0 errors, 55 warnings (same as before the upgrade); production build ok; `/tournaments` still static (ISR).
- Proxy gates, signed out: `/profile`, `/admin`, `/platform`, `/organize`, `/my-games` → 307 to login. Plain player → `/admin` redirected to `/`.
- Server actions: same-origin POST runs; cross-origin POST aborted ("Invalid Server Actions request").
- Headless sweep: `/`, `/discover`, `/tournaments`, a tournament, `/play-together` + a game, `/login`, `/signup`, `/contact`; signed in: `/profile`, `/profile/edit`, `/profile/security`, `/messages`, `/my-games` — all 200, no JS errors, no CSP violations. Sign-in works.
