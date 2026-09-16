/**
 * Delete leftover anonymous auth users (and their blank profiles rows)
 * left behind by visiting a tournament's Register tab while logged out
 * — see db/skip_profile_for_anonymous_signin.sql for the trigger fix
 * that stops new ones from being created.
 *
 * Only targets auth.users where is_anonymous = true, excluding anyone
 * who shows up as a tournament_teams.captain_id (anonymous sessions are
 * also how "register a team without an account" works — some anonymous
 * users are real captains, not drive-by ghosts; Supabase's deleteUser()
 * returns an opaque 500 rather than a clean FK message when this blocks
 * a delete, so it's checked up front instead of parsed from the error).
 * For anything else, this uses the same auth.admin.deleteUser() call
 * src/lib/auth/deleteAccount.ts already uses for real account deletion,
 * so Postgres's own foreign-key constraints still protect against
 * deleting anyone with other real data attached — that delete fails
 * loudly for them instead of silently dropping their data, and this
 * script reports it as skipped rather than treating it as an error.
 *
 * No scheduled DB backups on the free Supabase plan, so before each
 * delete this snapshots that user's full auth.users + profiles row to
 * a local JSON file (backups/anonymous-ghosts-<timestamp>.json) —
 * enough to manually recreate one if a deletion turns out to be wrong,
 * without needing a whole-project pg_dump for what are blank rows.
 *
 * Dry run (default):  node scripts/cleanup-anonymous-ghosts.mjs
 * Actually delete:     node scripts/cleanup-anonymous-ghosts.mjs --yes
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
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

const apply = process.argv.includes("--yes");
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const ghosts = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.log("listUsers error:", error.message); process.exit(1); }
  for (const u of data.users) if (u.is_anonymous) ghosts.push(u);
  if (data.users.length < 1000) break;
}

console.log(`Found ${ghosts.length} anonymous auth user(s).`);
if (ghosts.length === 0) process.exit(0);

// Anonymous sessions are also how "register a team without an account"
// works (TournamentRegisterTab.tsx) — some anonymous users are real team
// captains, not drive-by ghosts. Supabase's admin deleteUser() returns an
// opaque 500 (not a clean foreign-key message) when this blocks a delete,
// so check up front instead of relying on parsing that error.
const allIds = ghosts.map((u) => u.id);
const { data: captains } = await admin.from("tournament_teams").select("captain_id").in("captain_id", allIds);
const captainIds = new Set((captains ?? []).map((c) => c.captain_id));
const realCaptains = ghosts.filter((u) => captainIds.has(u.id));
const candidates = ghosts.filter((u) => !captainIds.has(u.id));

if (realCaptains.length) {
  console.log(`\n${realCaptains.length} of these are anonymous team captains with a real registered team — never deleted:`);
  for (const u of realCaptains) console.log(`  ${u.id}  created ${u.created_at}`);
}
console.log(`\n${candidates.length} candidate ghost(s) with no registered team:`);
for (const u of candidates) console.log(`  ${u.id}  created ${u.created_at}`);

if (!apply) {
  console.log("\nDry run — no deletes performed. Re-run with --yes to actually delete the candidates above.\n");
  process.exit(0);
}

mkdirSync("backups", { recursive: true });
const snapshotPath = `backups/anonymous-ghosts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const snapshot = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let deleted = 0, blocked = 0, failed = 0;
for (const u of candidates) {
  const { data: profile } = await admin.from("profiles").select("*").eq("id", u.id).maybeSingle();
  snapshot.push({ auth_user: u, profile: profile ?? null });
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  let error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    ({ error } = await admin.auth.admin.deleteUser(u.id));
    if (!error) break;
    const msg = `${error.message} ${error.code ?? ""}`.toLowerCase();
    if (msg.includes("23503") || msg.includes("foreign key") || msg.includes("still referenced") || msg.includes("violates")) break;
    await sleep(1000 * attempt); // transient (e.g. rate limit) — back off and retry
  }

  if (!error) { deleted++; await sleep(150); continue; }
  const msg = `${error.message} ${error.code ?? ""}`.toLowerCase();
  if (msg.includes("23503") || msg.includes("foreign key") || msg.includes("still referenced") || msg.includes("violates")) {
    blocked++;
    console.log(`  skipped ${u.id} — referenced elsewhere (has real data, not a ghost): ${error.message}`);
  } else {
    failed++;
    console.log(`  FAILED ${u.id} — status:${error.status ?? "?"} name:${error.name ?? "?"} message:${JSON.stringify(error.message)}`);
  }
  await sleep(150);
}
console.log(`\nDeleted ${deleted}, skipped ${blocked} (real data attached), failed ${failed}.`);
console.log(`Snapshot of every deleted/attempted row saved to ${snapshotPath}`);
