// Pictures for the generated share images (link previews, stories).
//
// Satori, the renderer behind next/og, only decodes PNG, JPEG and GIF.
// Given anything else, such as a WebP banner or avatar, it cannot work
// out the image's size and the whole route fails with a 500. So the
// picture is fetched here first, its real format is read from its first
// bytes (not trusted from the file name), and it is handed over as a
// data URL only when Satori can draw it. Otherwise, or if the picture is
// missing, too big or too slow, the caller draws its no-picture design.

const SIGNATURES: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
];

const MAX_BYTES = 5 * 1024 * 1024;

/** A data URL Satori can draw, or null. The caller vets the URL's host first. */
export async function drawableImage(url: string | null | undefined, timeoutMs = 4000): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    const type = SIGNATURES.find(([, sig]) => sig.every((b, i) => buf[i] === b))?.[0];
    return type ? `data:${type};base64,${buf.toString("base64")}` : null;
  } catch {
    return null;
  }
}
