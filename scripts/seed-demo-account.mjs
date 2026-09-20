/**
 * Seed (or re-fetch) a standing demo/reviewer account for App Store
 * Connect's "App Review Information" and Play Console's "App access"
 * fields — both stores require working credentials so a reviewer can
 * get past login into an app that's otherwise entirely behind auth.
 *
 * Idempotent: re-running with the same email just resets its password
 * and prints fresh credentials instead of failing on "already exists".
 *
 * Sets role: "player" directly in user_metadata so handle_new_user()
 * (identity_validation.sql) skips the null-role branch — the account
 * lands straight in the app, not in /welcome onboarding.
 *
 *   node scripts/seed-demo-account.mjs
 */
import { randomBytes } from "node:crypto";
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

const EMAIL = "appreview@sportonica.com";
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function genPassword() {
  // 16 random bytes, base64url — no ambiguous chars, comfortably above
  // PASSWORD_MIN, safe to paste directly into App Store Connect / Play
  // Console's reviewer-credentials fields.
  return randomBytes(16).toString("base64url");
}

const password = genPassword();

// Find an existing account with this email first (listUsers, since the
// admin API has no getUserByEmail) — re-running this script should reset
// the password and hand back fresh credentials, not error out.
let userId = null;
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.log("listUsers error:", error.message); process.exit(1); }
  const match = data.users.find((u) => u.email === EMAIL);
  if (match) { userId = match.id; break; }
  if (data.users.length < 1000) break;
}

if (userId) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) { console.log("updateUserById error:", error.message); process.exit(1); }
  console.log(`Existing demo account found — password reset.`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: "App Review", role: "player" },
  });
  if (error) { console.log("createUser error:", error.message); process.exit(1); }
  userId = data.user.id;
  console.log(`New demo account created.`);
}

// handle_new_user() should already have inserted this via the trigger —
// verify rather than assume, same defensive pattern auth/callback/route.ts
// uses for the same reason (some Supabase setups don't fire the trigger
// for every insert path).
const { data: profile } = await admin.from("profiles").select("id, role, full_name").eq("id", userId).maybeSingle();
if (!profile) {
  const { error } = await admin.from("profiles").insert({
    id: userId, full_name: "App Review", role: "player", trust_score: 50,
  });
  if (error) { console.log("profile insert error:", error.message); process.exit(1); }
  console.log("Profile row was missing — created one.");
} else if (!profile.role) {
  const { error } = await admin.from("profiles").update({ role: "player" }).eq("id", userId);
  if (error) { console.log("profile role update error:", error.message); process.exit(1); }
  console.log("Profile existed with no role — set to player.");
}

console.log(`\nuser_id:  ${userId}`);
console.log(`email:    ${EMAIL}`);
console.log(`password: ${password}`);
console.log(`\nPaste these into App Store Connect → App Review Information and`);
console.log(`Play Console → App content → App access. Store them in a password`);
console.log(`manager too — re-running this script resets the password, so this`);
console.log(`is the only time it's printed.`);
