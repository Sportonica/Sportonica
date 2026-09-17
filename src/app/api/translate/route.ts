import { NextResponse } from "next/server";
import { translateText } from "@/lib/text/translate";

export async function POST(req: Request) {
  let body: { text?: unknown; target?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { text, target } = body;
  if (typeof text !== "string" || (target !== "en" && target !== "ne")) {
    return NextResponse.json({ error: "text (string) and target ('en' | 'ne') are required" }, { status: 400 });
  }
  if (text.length > 20000) {
    return NextResponse.json({ error: "text too long" }, { status: 413 });
  }

  try {
    const translated = await translateText(text, target);
    return NextResponse.json({ translated });
  } catch (err) {
    console.error("POST /api/translate failed:", err);
    return NextResponse.json({ error: "translation unavailable" }, { status: 502 });
  }
}
