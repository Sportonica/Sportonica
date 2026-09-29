"use client";

// Shrinks a picked photo in the browser before it's uploaded. Phone
// cameras produce 3–5 MB, 4000px images that then get downloaded in full
// wherever they're shown (a 40px avatar, a venue card), which is most of
// why images were slow on mobile data. Re-encoded as WebP at a sensible
// maximum size, a photo is usually 100–300 KB.
//
// Only for images that are displayed. Payment QR codes and payment-proof
// screenshots are uploaded untouched so they stay scannable and legible.
//
// Never makes things worse: anything it can't handle (GIFs, which may be
// animated; a browser that can't encode WebP; a decode failure) or a
// result that isn't smaller goes up as the original file.

const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

export async function shrinkImage(
  file: File,
  { maxSize, quality = 0.82 }: { maxSize: number; quality?: number },
): Promise<File> {
  if (!RESIZABLE.includes(file.type)) return file;
  try {
    // Honours the camera's EXIF rotation, so portrait photos stay upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    // Browsers that can't encode WebP silently hand back a PNG instead.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([blob], name, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}

// Longest side, in pixels, for each kind of upload.
export const IMAGE_MAX = {
  avatar: 512,       // shown at up to ~80px, so 512 covers 3x screens with room
  logo: 512,
  venuePhoto: 1600,  // full-width on the venue page
  banner: 1600,
} as const;
