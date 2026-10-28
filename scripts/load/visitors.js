// k6 load test: a crowd of signed-out visitors arriving from a shared
// link. Run against a LOCAL build, never the live site:
//   npm run build && npx next start -p 3100
//   k6 run -e BASE_URL=http://localhost:3100 scripts/load/visitors.js
// Stress (no pauses, find the breaking point):
//   k6 run -e BASE_URL=http://localhost:3100 -e PAUSE=0 --vus 200 --duration 30s scripts/load/visitors.js
//
// Read-only on purpose. Nothing here signs in, registers, pays or saves —
// there is no staging database, so a local server still reads the live
// Supabase project. These pages come from Next's data cache, so the
// database sees about one read per page every 15 s–2 min whatever the
// crowd size. Pages that query on every request (e.g. /quiz/leaderboard)
// are left out so this can't load the live database.

import http from "k6/http";
import { check, sleep, group } from "k6";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
if (/sportonica\.com/i.test(BASE_URL)) throw new Error("Refusing to load-test the live site; point BASE_URL at a local build.");
const TOURNAMENT = __ENV.TOURNAMENT || "ronb-corporate-championship-2083-indoor-cricket";
// a real visitor reads for a few seconds between pages; PAUSE=0 doesn't
const think = () => { if (__ENV.PAUSE !== "0") sleep(2 + Math.random() * 3); };

export const options = {
  stages: [
    { duration: "20s", target: 20 },
    { duration: "40s", target: 20 },
    { duration: "20s", target: 50 },
    { duration: "40s", target: 50 },
    { duration: "20s", target: 100 },
    { duration: "40s", target: 100 },
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const ok = (res) => check(res, { "status 200": (r) => r.status === 200 });

export default function () {
  group("open the shared tournament link", () => {
    ok(http.get(`${BASE_URL}/tournaments/${TOURNAMENT}`, { tags: { name: "tournament" } }));
  });
  think();
  group("browse all tournaments", () => {
    ok(http.get(`${BASE_URL}/tournaments`, { tags: { name: "tournaments" } }));
  });
  think();
  group("home page", () => {
    ok(http.get(`${BASE_URL}/`, { tags: { name: "home" } }));
  });
  think();
}
