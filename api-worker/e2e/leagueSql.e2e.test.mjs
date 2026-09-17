// Stage 10 E2E — league leaderboard SQL V2 legacy/V2 parity + EXPLAIN + auth, via
// the internal/admin endpoint. Local miniflare D1 only.
//
// Run: node --test e2e/leagueSql.e2e.test.mjs (package.json test:e2e:leaguesql)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");
const INTERNAL_SECRET = "e2e-internal-secret";

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1 = (p, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql]);
const d1file = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);

// Mirror api-worker getWeekKey exactly.
function weekKey(day) {
  const d = new Date(day);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
const DAY = "2026-01-05";
const DAY2 = "2026-01-14";
const WK = weekKey(DAY);

function freshEnv(name) {
  const p = `.wrangler-e2e-leaguesql-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  // Seed a couple leagues with multi-day, multi-user rows incl. a tie.
  d1(p, `INSERT OR REPLACE INTO league_day_stats (league_id,user_id,day,points,exact_count,joker_points,earliest_pick_time) VALUES
    ('L1',1,'${DAY}',10,2,1,500),('L1',1,'${DAY2}',5,0,0,0),
    ('L1',2,'${DAY}',12,1,1,300),('L1',3,'${DAY}',12,1,1,200),
    ('L2',7,'${DAY}',99,0,0,0);`);
  return p;
}
async function boot(p) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: "123456:E2E", ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false" },
  });
}
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const cmp = (w, league, period) => w.fetch(`/internal/admin/league-leaderboard/${league}/compare?period=${encodeURIComponent(period)}`, { headers: internal });

// (1)+(6)+(7) compare all → match, not truncated, tie-break/order identical.
test("compare all-time: legacy == V2 (order, tie-break, rows)", async () => {
  const p = freshEnv("all");
  const w = await boot(p);
  try {
    const r = await cmp(w, "L1", "all");
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.match, true, `reason=${b.reason}`);
    assert.equal(b.legacy_rows, 3);
    assert.equal(b.v2_rows, 3);
    // user1=15, then tie 12: user3 (early 200) before user2 (early 300)
    assert.deepEqual(b.v2.map((x) => x.user_id), [1, 3, 2]);
    assert.deepEqual(b.legacy.map((x) => x.user_id), b.v2.map((x) => x.user_id));
  } finally { await w.stop(); }
});

// (3) compare week → match (only that week's rows).
test("compare week: legacy == V2", async () => {
  const p = freshEnv("week");
  const w = await boot(p);
  try {
    const b = await (await cmp(w, "L1", `week:${WK}`)).json();
    assert.equal(b.match, true, `reason=${b.reason}`);
    // DAY2 (different week) excluded → user1 has only DAY's 10 pts
    const u1 = b.v2.find((x) => x.user_id === 1);
    assert.equal(u1.points, 10);
  } finally { await w.stop(); }
});

// (4)+(5) compare month → match.
test("compare month: legacy == V2", async () => {
  const p = freshEnv("month");
  const w = await boot(p);
  try {
    const b = await (await cmp(w, "L1", "month:2026-01")).json();
    assert.equal(b.match, true, `reason=${b.reason}`);
    assert.equal(b.v2_rows, 3);
  } finally { await w.stop(); }
});

// (9)+(13) EXPLAIN QUERY PLAN confirms index/period filtering.
test("explain: V2 query uses idx_lds_league_day", async () => {
  const p = freshEnv("explain");
  const w = await boot(p);
  try {
    const b = await (await w.fetch(`/internal/admin/league-leaderboard/L1/explain?period=${encodeURIComponent("month:2026-01")}`, { headers: internal })).json();
    assert.equal(b.uses_index, true, b.plan);
  } finally { await w.stop(); }
});

// (10) different leagues are not mixed (parallel compares).
test("parallel compares: leagues isolated", async () => {
  const p = freshEnv("isolation");
  const w = await boot(p);
  try {
    const [a, c] = await Promise.all([cmp(w, "L1", "all"), cmp(w, "L2", "all")]);
    const ba = await a.json(); const bc = await c.json();
    assert.equal(ba.match, true); assert.equal(bc.match, true);
    assert.deepEqual(bc.v2.map((x) => x.user_id), [7]);
    assert.equal(ba.v2.some((x) => x.user_id === 7), false, "L1 must not contain L2 users");
  } finally { await w.stop(); }
});

// (2) V2 intentionally scoped to non-day periods → day/season rejected (legacy authoritative).
test("V2 endpoint rejects day:/season: (legacy path stays authoritative)", async () => {
  const p = freshEnv("reject");
  const w = await boot(p);
  try {
    assert.equal((await cmp(w, "L1", `day:${DAY}`)).status, 400);
    assert.equal((await cmp(w, "L1", "season:1")).status, 400);
  } finally { await w.stop(); }
});

// (12) auth: internal endpoints reject untrusted callers.
test("internal league-leaderboard endpoints require trusted internal auth", async () => {
  const p = freshEnv("auth");
  const w = await boot(p);
  try {
    assert.notEqual((await w.fetch(`/internal/admin/league-leaderboard/L1/compare?period=all`)).status, 200, "unauth rejected");
    assert.equal((await cmp(w, "L1", "all")).status, 200, "authed ok");
  } finally { await w.stop(); }
});
