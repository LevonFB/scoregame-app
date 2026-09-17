// Stage 11 E2E — callsite gating + invocation memo for computeLeagueLeaderboard,
// via the internal/admin gate endpoint. Local miniflare D1 only.
//
// Run: node --test e2e/leagueCallsite.e2e.test.mjs (package.json test:e2e:leaguecallsite)

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

function weekKey(day) {
  const d = new Date(day); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const ys = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wn = Math.ceil((((d.getTime() - ys.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`;
}
const DAY = "2026-01-05";
const WK = weekKey(DAY);

function freshEnv(name) {
  const p = `.wrangler-e2e-leaguecs-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1(p, `INSERT OR REPLACE INTO league_day_stats (league_id,user_id,day,points,exact_count,joker_points,earliest_pick_time) VALUES
    ('L1',1,'${DAY}',12,1,1,200),('L1',2,'${DAY}',12,1,1,300),('L1',3,'${DAY}',5,0,0,0),
    ('L2',9,'${DAY}',7,0,0,0);`);
  return p;
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: "123456:E2E", ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const gate = (w, league, period, callsite, viewer = 1) =>
  w.fetch(`/internal/admin/league-leaderboard/${league}/gate?period=${encodeURIComponent(period)}&callsite=${callsite}&viewer=${viewer}`, { headers: internal });
const V2ON = { LEAGUE_LEADERBOARD_SQL_V2_ENABLED: "true", LEAGUE_LEADERBOARD_SQL_V2_CALLSITES: "achievement" };

// (1) Default: real call sites use legacy.
test("default (V2 off, empty callsites): mode legacy", async () => {
  const p = freshEnv("default");
  const w = await boot(p);
  try {
    const b = await (await gate(w, "L1", `week:${WK}`, "achievement")).json();
    assert.equal(b.mode, "legacy");
    assert.equal(b.equals_legacy, true);
  } finally { await w.stop(); }
});

// (2)+(7) Achievement V2: new SQL path; result identical to legacy.
test("achievement callsite enabled + week → v2_apply, parity with legacy", async () => {
  const p = freshEnv("apply");
  const w = await boot(p, V2ON);
  try {
    for (const period of [`week:${WK}`, "month:2026-01", "all"]) {
      const b = await (await gate(w, "L1", period, "achievement")).json();
      assert.equal(b.mode, "v2_apply", `period ${period}`);
      assert.equal(b.equals_legacy, true, `parity ${period}`);
      // tie-break order preserved: user1 (early 200) before user2 (early 300), then user3
      assert.deepEqual(b.results.map((x) => x.user_id), [1, 2, 3]);
    }
  } finally { await w.stop(); }
});

// (3) Achievement shadow: returns legacy; mode shadow.
test("shadow mode → returns legacy, mode shadow", async () => {
  const p = freshEnv("shadow");
  const w = await boot(p, { ...V2ON, LEAGUE_LEADERBOARD_SQL_SHADOW_ENABLED: "true" });
  try {
    const b = await (await gate(w, "L1", `week:${WK}`, "achievement")).json();
    assert.equal(b.mode, "shadow");
    assert.equal(b.equals_legacy, true);
  } finally { await w.stop(); }
});

// (8) day/season never switch to V2.
test("day:/season: stay legacy even with achievement enabled", async () => {
  const p = freshEnv("dayseason");
  const w = await boot(p, V2ON);
  try {
    assert.equal((await (await gate(w, "L1", `day:${DAY}`, "achievement")).json()).mode, "legacy");
    assert.equal((await (await gate(w, "L1", "season:1", "achievement")).json()).mode, "legacy");
  } finally { await w.stop(); }
});

// unknown / disabled callsite → legacy.
test("unknown callsite and disabled callsite → legacy", async () => {
  const p = freshEnv("callsite");
  const w = await boot(p, V2ON); // only 'achievement' enabled
  try {
    assert.equal((await (await gate(w, "L1", `week:${WK}`, "quest")).json()).mode, "legacy");
    assert.equal((await (await gate(w, "L1", `week:${WK}`, "bogus")).json()).mode, "legacy");
  } finally { await w.stop(); }
});

// (5) Memo: two identical calls in one workflow → memo collapses to one entry.
test("invocation memo collapses identical calls (memo_size 1)", async () => {
  const p = freshEnv("memo");
  const w = await boot(p, V2ON);
  try {
    const b = await (await gate(w, "L1", `week:${WK}`, "achievement")).json();
    assert.equal(b.memo_size, 1, "two identical calls share one memo entry");
  } finally { await w.stop(); }
});

// (6)+(9) Different leagues isolated; parallel gate requests have independent memos.
test("parallel workflows do not share memo; leagues isolated", async () => {
  const p = freshEnv("parallel");
  const w = await boot(p, V2ON);
  try {
    const [a, c] = await Promise.all([gate(w, "L1", `week:${WK}`, "achievement"), gate(w, "L2", `week:${WK}`, "achievement")]);
    const ba = await a.json(); const bc = await c.json();
    assert.equal(ba.memo_size, 1); assert.equal(bc.memo_size, 1); // each request own memo
    assert.deepEqual(bc.results.map((x) => x.user_id), [9]);
    assert.equal(ba.results.some((x) => x.user_id === 9), false, "L1 not mixed with L2");
  } finally { await w.stop(); }
});

// auth: gate endpoint requires trusted internal auth.
test("gate endpoint requires trusted internal auth", async () => {
  const p = freshEnv("auth");
  const w = await boot(p, V2ON);
  try {
    assert.notEqual((await w.fetch(`/internal/admin/league-leaderboard/L1/gate?period=all&callsite=achievement`)).status, 200);
    assert.equal((await gate(w, "L1", "all", "achievement")).status, 200);
  } finally { await w.stop(); }
});
