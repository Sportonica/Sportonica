import "server-only";
import sharp from "sharp";
import { storageImageUrl } from "@/lib/security/storageImage";

const MAX_BYTES = 8 * 1024 * 1024;

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

// An <img src> Satori (next/og ImageResponse) can actually render, or null.
// Satori only decodes PNG/JPEG reliably — a .webp banner/avatar 500s the
// whole OG/story route ("Image size cannot be determined") — so anything
// else is converted to PNG here. Same own-storage allowlist as before
// (SSRF), redirects refused, size and time capped. Any failure → null, so
// the card falls back to its no-image design instead of erroring.
export async function satoriImageSrc(
  url: string | null | undefined,
  bucket: Parameters<typeof storageImageUrl>[1],
): Promise<string | null> {
  const safe = storageImageUrl(url, bucket);
  if (!safe) return null;
  try {
    const res = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;

    if (isPng(bytes)) return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    if (isJpeg(bytes)) return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

    const png = await sharp(bytes)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
