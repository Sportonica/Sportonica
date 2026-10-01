// npm run test:intelligence
// Plain assertion scripts, like the other checks in scripts/: no test runner.
const files = ["core", "basketball", "standings", "pickleball", "cricket", "volleyball", "badminton", "swimming"];
const only = process.argv[2];
const { count } = await import("./harness.mjs");
for (const f of files) {
  if (only && only !== f) continue;
  console.log(`\n${f}`);
  await import(`./${f}.test.mjs`);
}
console.log(`\n${count()} checks passed`);
