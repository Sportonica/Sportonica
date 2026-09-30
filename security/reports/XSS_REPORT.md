# XSS Security Report

## Status: PASS

## Findings

- **React output** is escaped by default (React 19.2.4). User content (names, bios, team/club names, tournament descriptions and rules, chat messages) is rendered as text.
- **`dangerouslySetInnerHTML`** — 2 uses, both JSON-LD structured data built from constants (`src/app/page.tsx` `JSON_LD`, `src/app/HomeClient.tsx` `FAQS`). No user data.
- **No** `innerHTML =`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` anywhere in `src`.
- **User-set links** (`own_venue_map_url`, `maps_url`, WhatsApp links, etc.): React 19 blocks `javascript:` URLs in `href`; browsers block top-level `data:` navigation.
- **Hand-built HTML** — the organizer team sheet (`/organize/tournaments/[id]/teams/sheet`) builds an HTML string; every user value goes through `esc()` (escapes `& < > " '`), including `src="${esc(logo_url)}"`; labels are constants.
- **Emails** are sent as plain text (`textContent` in `src/lib/mail/mailer.ts`), so names/titles can't inject markup.
- **CSP** (SEC-06) adds defence in depth (no third-party scripts, no framing, `object-src 'none'`), though `script-src` keeps `'unsafe-inline'` (see SECURITY_HEADERS).

## What's at risk

Nothing identified.

## What's already secure

All of the above.

## Recommendations

- Keep `dangerouslySetInnerHTML` limited to constant JSON-LD; if rich text is ever needed, sanitize with DOMPurify.
- Minor, cosmetic: in the team sheet, the "Contact" row escapes its value twice (an `&` would show as `&amp;`).

## Verification (2026-09-29)

Stored-XSS test on a production build: payloads `<img src=x onerror=…>` and `<script>…</script>` in a profile's name/bio/city, a tournament's name/description/rules/venue, a team's name/club/manager, a guest player's name, and a `javascript:` team logo URL.

| Page | Script ran | Injected handlers / `<img>` | Payload shown as text |
|---|---|---|---|
| `/p/<user>` | 0 | 0 / 0 | yes |
| `/tournaments/<id>` | 0 | 0 / 0 | yes |
| Teams tab | 0 | 0 / 0 | yes |
| Organizer team sheet | 0 | 0 / 0 | yes |
| Organizer Control Center | 0 | 0 / 0 | yes |

No dialogs fired. Temporary data deleted.
