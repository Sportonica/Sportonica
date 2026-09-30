// Identifies an uploaded image by its first bytes (magic numbers) instead
// of trusting the browser-reported file.type, which the uploader controls
// (security audit, FILE_UPLOADS). Only the formats the app accepts.
export type ImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export const IMAGE_EXT: Record<ImageMime, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

export async function sniffImageType(file: Blob): Promise<ImageMime | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "image/png";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  return null;
}

// True when the bytes are one of `allowed` AND agree with the declared type.
export async function isRealImage(file: File, allowed: readonly string[]): Promise<boolean> {
  const sniffed = await sniffImageType(file);
  return !!sniffed && allowed.includes(sniffed) && sniffed === file.type;
}
