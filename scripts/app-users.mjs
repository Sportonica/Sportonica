/**
 * List the accounts that have opened the native Android/iOS app — Play
 * Console only reports install counts, never who. Reads the
 * app_metadata.native_app tag written by src/lib/capacitor/appOpenActions.ts
 * (set on launch/resume/sign-in once that code is live; signed-in only).
 *
 * Read-only:  node scripts/app-users.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const rows = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.log("listUsers error:", error.message); process.exit(1); }
  for (const u of data.users) {
    const n = u.app_metadata?.native_app;
    if (n) rows.push({ name: u.user_metadata?.full_name ?? u.user_metadata?.name ?? "", email: u.email ?? "", ...n });
  }
  if (data.users.length < 1000) break;
}

rows.sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at));
console.log(`${rows.length} account(s) have opened the app.\n`);
for (const r of rows) {
  console.log(`${r.platform.padEnd(8)} last ${r.last_seen_at.slice(0, 16)}  first ${r.first_seen_at.slice(0, 10)}  ${r.name || "(no name)"}  ${r.email}`);
}
