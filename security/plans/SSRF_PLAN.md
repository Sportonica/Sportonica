# SSRF Fix Plan

## Changes

- `src/lib/security/storageImage.ts` (new) — `storageImageUrl(url, bucket)`: only `…/storage/v1/object/public/<bucket>/…` with a decodable extension.
- `src/app/p/[username]/opengraph-image.tsx`, `src/app/p/[username]/story/route.tsx` — avatars via `storageImageUrl(…, "avatars")`.
- `src/app/tournaments/[id]/opengraph-image.tsx`, `src/app/tournaments/[id]/story/route.tsx` — banners via `storageImageUrl(…, "tournament-banners")`.
- `src/lib/admin/location.ts` — `expandShortLink` follows redirects manually, allowlisting each hop before fetching, max 5; `parseMapsUrl` requires a signed-in (non-anonymous) user.

## New files

- `src/lib/security/storageImage.ts`

## Verification goals

- [x] All user-supplied URL fetching is validated before the request
- [x] Server-rendered images only come from our own storage (internal URL → 0 outbound requests)
- [x] Only https is allowed for maps links; only http(s) storage URLs for images
- [x] Redirect targets are validated per hop, not only at the end
- [x] Existing real avatars/banners still render
- [ ] (Future) DNS-resolve + private-range blocking if arbitrary URL fetching is ever added

## Manual verification (for the human)

- After deploy: share a tournament and a player card on WhatsApp — banner/avatar still appear in the preview.
- Paste a `maps.app.goo.gl` link in a venue's location field — coordinates still fill in.
