// Server-only. Translates organizer-submitted free text (tournament
// descriptions/rules, which come in a mix of English and Nepali) between
// English and Nepali via MyMemory's free translation API — no API key
// needed, and passing MAIL_FROM as the `de` param raises the anonymous
// daily quota from 5k to 50k words. Not an LLM: it's a phrase-lookup/MT
// service, so output grammar won't be perfect — this is scoped to getting
// paragraph structure and punctuation spacing right, not full editing.
//
// Every translation is cached (keyed by exact text + target language) for
// 60 days via Next's data cache — organizer text essentially never changes
// after publish, and without this, every visitor who clicks Translate on
// the same tournament re-spends the same free-tier quota on an identical
// result. This is what actually exhausted MyMemory's daily allowance
// during manual testing of a single tournament.

import { unstable_cache } from "next/cache";
import { createHash } from "crypto";

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_CHUNK_LEN = 450; // MyMemory caps requests around 500 bytes
const CONCURRENCY = 5;

function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function translateChunk(chunk: string, langpair: string): Promise<string> {
  if (!chunk.trim()) return chunk;
  const url = new URL(MYMEMORY_ENDPOINT);
  url.searchParams.set("q", chunk);
  url.searchParams.set("langpair", langpair);
  if (process.env.MAIL_FROM) url.searchParams.set("de", process.env.MAIL_FROM);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`MyMemory request failed: ${res.status}`);
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (typeof translated !== "string") throw new Error("MyMemory: unexpected response shape");
  return translated;
}

// Splits a paragraph into sentence-ish chunks under MAX_CHUNK_LEN — most
// paragraphs in this app's tournament text are already short enough to skip
// this entirely; it only kicks in for unusually long single paragraphs.
function chunkParagraph(paragraph: string): string[] {
  if (paragraph.length <= MAX_CHUNK_LEN) return [paragraph];
  const sentences = paragraph.split(/(?<=[।.!?])\s+/);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const candidate = buf ? `${buf} ${s}` : s;
    if (candidate.length > MAX_CHUNK_LEN && buf) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = candidate;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function cleanup(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([,.!?;:])(?=[^\s)\]"'])/g, "$1 ")
        .trim()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function translateUncached(trimmed: string, target: "en" | "ne"): Promise<string> {
  const langpair = target === "en" ? "ne|en" : "en|ne";
  const paragraphs = trimmed.split(/\n{2,}/);

  const translatedParagraphs = await mapLimit(paragraphs, CONCURRENCY, async (para) => {
    if (!para.trim()) return "";
    const chunks = chunkParagraph(para);
    const translatedChunks: string[] = [];
    for (const chunk of chunks) translatedChunks.push(await translateChunk(chunk, langpair));
    return translatedChunks.join(" ");
  });

  return cleanup(translatedParagraphs.join("\n\n"));
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days

export async function translateText(text: string, target: "en" | "ne"): Promise<string> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return text ?? "";

  const sourceIsDevanagari = isDevanagari(trimmed);
  // Already in the requested language/script — nothing to do.
  if ((target === "en" && !sourceIsDevanagari) || (target === "ne" && sourceIsDevanagari)) {
    return trimmed;
  }

  const key = createHash("sha256").update(`${target}:${trimmed}`).digest("hex");
  const cached = unstable_cache(
    () => translateUncached(trimmed, target),
    ["tournament-text-translation", key],
    { revalidate: CACHE_TTL_SECONDS }
  );
  return cached();
}
