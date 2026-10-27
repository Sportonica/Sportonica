// Signed-out checks for the public tournament pages — the project has no
// test runner, so this runs standalone against a running server:
//   node scripts/check-tournament-pages.mjs [baseUrl] [--save file | --compare file]
// baseUrl defaults to http://localhost:3000. Only reads: it lists public
// tournaments with the anon key and opens their pages like a visitor.
//
// --save writes each page's visible text to a file; --compare checks the
// pages still show exactly that text (run --save before a change and
// --compare after it).

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i !== -1) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3000").replace(/\/+$/, "");
const saveTo = flag("--save");
const compareTo = flag("--compare");

const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/tournaments?select=id,slug,name,status&order=created_at`,
  { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY } },
);
const tournaments = await res.json();
assert.ok(Array.isArray(tournaments) && tournaments.length > 0, "no public tournaments to check");

// What a visitor reads: the HTML minus scripts, styles and tags.
const visibleText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ")
  .trim();

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message.split("\n")[0]}`); }
};

const texts = {};
const timings = [];
for (const t of tournaments) {
  const path = `/tournaments/${t.slug ?? t.id}`;
  // first open warms the server; the timed one is what a returning visitor gets
  await fetch(base + path);
  const started = performance.now();
  const page = await fetch(base + path);
  const ms = Math.round(performance.now() - started);
  const html = await page.text();
  timings.push({ path, ms });
  texts[path] = visibleText(html);

  console.log(`${t.name} (${t.status})`);
  check(`${path} opens (200)`, () => assert.equal(page.status, 200));
  check("shows the tournament's name", () => assert.ok(texts[path].includes(t.name.replace(/\s+/g, " ").trim())));
  if (t.slug) {
    const old = await fetch(`${base}/tournaments/${t.id}`, { redirect: "manual" });
    check("old id link redirects to the name link", () => {
      assert.ok([307, 308].includes(old.status), `status ${old.status}`);
      assert.equal(new URL(old.headers.get("location"), base).pathname, path);
    });
  }
}

console.log("Unknown tournament");
const missing = await fetch(`${base}/tournaments/no-such-tournament-${Date.now()}`);
check("unknown name shows not found (404)", () => assert.equal(missing.status, 404));

if (saveTo) {
  writeFileSync(saveTo, JSON.stringify(texts, null, 1));
  console.log(`\nsaved page text to ${saveTo}`);
}
if (compareTo) {
  console.log("Same content as before");
  const before = JSON.parse(readFileSync(compareTo, "utf8"));
  for (const [path, text] of Object.entries(before)) {
    check(`${path} shows the same text`, () => {
      if (text === texts[path]) return;
      const a = text.split(" "), b = (texts[path] ?? "").split(" ");
      let i = 0;
      while (a[i] === b[i]) i++;
      assert.fail(`differs at: "…${a.slice(i, i + 12).join(" ")}" vs "…${b.slice(i, i + 12).join(" ")}"`);
    });
  }
}

console.log("\nresponse times (warm):");
for (const { path, ms } of timings) console.log(`  ${String(ms).padStart(5)} ms  ${path}`);
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
