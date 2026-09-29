// Image URLs that server-side renderers (the OG / story image routes, via
// Satori) are allowed to fetch. Those routes download the image on OUR
// server, and avatar_url / banner_url are user-editable, so anything
// outside our own public storage would let a user point the server at an
// internal address (SSRF) — e.g. the Lambda runtime API on 127.0.0.1.
// Also restricted to formats Satori can decode.
const DECODABLE = /\.(jpe?g|png|gif|webp)(\?.*)?$/i;

export function storageImageUrl(
  url: string | null | undefined,
  bucket: "avatars" | "tournament-banners" | "team-logos" | "venue-photos",
): string | null {
  if (!url) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const prefix = `${base.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
  return url.startsWith(prefix) && DECODABLE.test(url) && !url.includes("..") ? url : null;
}
