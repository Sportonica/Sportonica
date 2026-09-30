# CSRF Security Report

## Status: PASS (after fix) — was LOW

Cross-site request forgery is blocked by design; one cookie-flag gap (no `Secure`) fixed.

## Findings

### State-changing entry points
| Entry point | CSRF protection |
|---|---|
| **Server actions** (208) | Next.js compares `Origin` with `Host`/`X-Forwarded-Host` and aborts mismatches. **Tested:** POST to a real action with `Origin: http://evil.example` → "Invalid Server Actions request … Aborting the action"; same-origin → runs. |
| **Supabase REST / RPC from the browser** | Authenticated with an `Authorization: Bearer` header set by JavaScript, not by ambient cookies — a cross-site form can't attach it. |
| `POST /api/push` | Shared secret in a header (constant-time compare), not cookies. |
| `GET /auth/callback` | OAuth/PKCE: the code only exchanges with the verifier cookie set by our own sign-in start. |
| Other GET routes (OG/story/team sheet/fixtures card) | Read-only. The only GET-time write is the game page's `expire_stale_play_together_requests()` sweep, which only expires what's already overdue. |

### Session cookies — was LOW (fixed)
`@supabase/ssr` defaults: `SameSite=Lax`, `HttpOnly=false`, **no `Secure`**. Without `Secure`, a first visit to `http://…` (before the 308 redirect / HSTS) could carry the session cookie in clear text. Now set `Secure` (production) on all three Supabase clients.

`HttpOnly` cannot be enabled with this architecture: the browser Supabase client reads the session cookie itself. The Content-Security-Policy (SEC-06) is the mitigation against script access.

## What's at risk

Before the fix: session exposure on a first plain-HTTP request by a network attacker. No CSRF path was found.

## What's already secure

SameSite=Lax on the session; Next's origin check on server actions; header-based auth for the API; HSTS (2 years) and HTTP→HTTPS 308 on production.

## Recommendations

1. `Secure` + `SameSite=Lax` on every Supabase client. **Done** (`src/lib/supabase/cookieOptions.ts`).
2. Optional: raise HSTS to `includeSubDomains` once every subdomain is confirmed HTTPS-only (see SECURITY_HEADERS).

## Verification (2026-09-29)

| Check | Result |
|---|---|
| Cross-origin POST to a server action | aborted ("Invalid Server Actions request") |
| Same-origin POST | runs |
| Session cookie set by the browser at login (production build) | `Secure: true`, `SameSite: Lax`, `HttpOnly: false` (required) |
| Session cookie set by the server on proxy refresh | `Path=/; Secure; SameSite=lax` |
| Sign-in still works | yes |
