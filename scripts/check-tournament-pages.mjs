// Signed-out checks for the public tournament pages — the project has no
// test runner, so this runs standalone against a running server:
//   node scripts/check-tournament-pages.mjs [baseUrl] [--save file | --compare file]
// baseUrl defaults to http://localhost:3000. Only reads: it lists public
// tournaments with the anon key and opens their pages like a visitor.
//
// Also opens every public match centre and loads its timeline and stats
// the way the browser does (the same server actions, by name from the
// build), so run it against a `next build && next start`.
//
// --save writes each page's visible text (and each load's data) to a
// file; --compare checks they are exactly the same (run --save before a
// change and --compare after it).

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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

// ── match centres: /tournaments/<name>/live/<contest> ──
const contestsRes = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/si_contests?select=id,label,tournament_id,tournaments(slug)&order=created_at`,
  { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY } },
);
const contests = (await contestsRes.json()).filter((c) => c.tournaments?.slug);
const manifestPath = ".next/server/server-reference-manifest.json";
const actionId = (name) => existsSync(manifestPath)
  ? Object.entries(JSON.parse(readFileSync(manifestPath, "utf8")).node)
    .find(([, v]) => v.filename === "lib/intelligence/actions.ts" && v.exportedName === name)?.[0]
  : undefined;
const eventsAction = actionId("getContestEvents");
const statsAction = actionId("getContestIntelligence");
// a server action as the browser calls it; the result is the response's "1:" line
async function callAction(path, id, args) {
  const r = await fetch(base + path, {
    method: "POST", body: JSON.stringify(args),
    headers: { "Next-Action": id, Origin: base, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
  });
  const body = await r.text();
  return { status: r.status, data: body.split("\n").find((l) => l.startsWith("1:"))?.slice(2) ?? "" };
}

console.log(`Match centres (${contests.length})`);
check("timeline and stats actions found in the build", () => assert.ok(eventsAction && statsAction, "run next build first"));
for (const c of contests) {
  const path = `/tournaments/${c.tournaments.slug}/live/${c.id}`;
  await fetch(base + path);
  const started = performance.now();
  const page = await fetch(base + path);
  timings.push({ path, ms: Math.round(performance.now() - started) });
  texts[path] = visibleText(await page.text());
  check(`${path} opens (200)`, () => assert.equal(page.status, 200));
  if (!eventsAction || !statsAction) continue;
  for (const [label, id, args] of [
    ["timeline", eventsAction, [c.id, { limit: 40 }]],
    ["timeline, older page", eventsAction, [c.id, { limit: 150, before: 60 }]],
    ["stats", statsAction, [c.id]],
  ]) {
    await callAction(path, id, args);
    const t0 = performance.now();
    const res = await callAction(path, id, args);
    timings.push({ path: `${path} (${label})`, ms: Math.round(performance.now() - t0) });
    texts[`${path} ${label}`] = res.data;
    check(`  ${label} loads`, () => {
      assert.equal(res.status, 200);
      assert.ok(res.data.startsWith("{") && !res.data.includes("__sportonicaActionError"), res.data.slice(0, 120));
    });
  }
}
console.log("Unknown match");
const noMatch = await fetch(`${base}/tournaments/${contests[0]?.tournaments.slug}/live/00000000-0000-4000-8000-000000000000`);
check("unknown match shows not found (404)", () => assert.equal(noMatch.status, 404));

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
