// Stage 13 E2E — seasonal quest/level shadow (compute+compare only, NO writes).
// Proves: default /me/level & /quests/seasonal unchanged; shadow runs & writes 0 rows
// (production guard); repeat no side effects; mismatch detected (not corrected);
// shadow off/on give identical reads; internal runner is auth-gated.
//
// Run: node --test e2e/seasonalshadow.e2e.test.mjs (package.json test:e2e:seasonalshadow)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";
import { buildInitData } from "./helpers/initData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");
const INTERNAL_SECRET = "e2e-internal-secret";
const BOT_TOKEN = "123456:E2E-TEST-TOKEN";
const USER = { id: 777777, first_name: "E2E" };

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1 = (p, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql]);
const d1file = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);
function d1num(p, sql) {
  const m = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]).match(/"n"\s*:\s*(-?\d+)/);
  return m ? Number(m[1]) : 0;
}
// Combined signature of all writable seasonal tables in ONE query (one wrangler
// subprocess — many sequential spawns would starve the dev worker connection).
function writeSignature(p) {
  const sql = `SELECT (
    (SELECT COUNT(*) FROM user_task_progress) || '|' ||
    (SELECT COUNT(*) FROM user_achievements) || '|' ||
    (SELECT COUNT(*) FROM stars_ledger) || '|' ||
    (SELECT COUNT(*) FROM balls_ledger) || '|' ||
    (SELECT COUNT(*) FROM daily_quest_progress) || '|' ||
    (SELECT COUNT(*) FROM user_cases) || '|' ||
    (SELECT COUNT(*) FROM daily_cases) || '|' ||
    (SELECT COUNT(*) FROM case_opens) || '|' ||
    (SELECT COALESCE(SUM(balls),0) FROM users) || '|' ||
    (SELECT COALESCE(SUM(stars),0) FROM user_season_progress)
  ) AS sig;`;
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
  const m = out.match(/"sig"\s*:\s*"([^"]+)"/);
  return m ? m[1] : out;
}

function seedAch(p) {
  // revokeDisabledSeasonalTasksForUser queries tasks_catalog.period_type; add it here
  // (isolated to this env — the weekly suite adds it via its own ALTER).
  d1(p, `ALTER TABLE tasks_catalog ADD COLUMN period_type TEXT;`);
  // One global seasonal achievement (picks_total, threshold 2) with a 10-star reward.
  d1(p, `INSERT OR REPLACE INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold, version) VALUES ('season_picks_test','global','common','*','Picks','','picks_total',2,1);`);
  d1(p, `INSERT OR REPLACE INTO tasks_catalog (task_key, task_type, period_type, is_enabled, reward_stars, reward_balls) VALUES ('season_picks_test','seasonal','seasonal',1,10,0);`);
  // 2 in-season picks → expected progress = 2 = threshold (completed).
  d1(p, `INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('2026-06-15','m1',${USER.id},1,0,0,1),('2026-06-16','m2',${USER.id},2,1,0,1);`);
  d1(p, `INSERT OR REPLACE INTO user_season_progress (user_id, season_number, stars, level) VALUES (${USER.id}, 1, 0, 1);`);
}
function freshEnv(name, { match = false } = {}) {
  const p = `.wrangler-e2e-ss-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  seedAch(p);
  if (match) {
    // Stored state already reflects a completed+rewarded quest and matching stars.
    d1(p, `INSERT OR REPLACE INTO user_task_progress (user_id, season_id, task_key, instance_key, progress, completed_at, reward_granted) VALUES (${USER.id}, 1, 'season_picks_test', 'season', 2, ${Date.now()}, 1);`);
    d1(p, `UPDATE user_season_progress SET stars = 10 WHERE user_id = ${USER.id} AND season_number = 1;`);
  }
  return p;
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const auth = (initData) => ({ "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData });
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const runShadow = (w) => w.fetch(`/internal/admin/seasonal-shadow/${USER.id}`, { method: "GET", headers: internal });
const SHADOW_ON = { SEASONAL_EVENT_SYNC_V2_ENABLED: "true", SEASONAL_EVENT_SYNC_SHADOW_MODE: "true" };

// (1) Default /me/season-progress — works & contract intact (no level field).
test("default GET /me/season-progress works (contract)", async () => {
  const p = freshEnv("level"); const w = await boot(p, {});
  try {
    const r = await w.fetch("/me/season-progress", { headers: auth(buildInitData(USER, BOT_TOKEN)) });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(typeof b.stars, "number");
    assert.equal(b.level, undefined);
    assert.equal(typeof b.balls, "number");
  } finally { await w.stop(); }
});

// (2) Default /quests/seasonal — works & contract intact.
test("default GET /quests/seasonal works (contract)", async () => {
  const p = freshEnv("seasonal"); const w = await boot(p, {});
  try {
    const r = await w.fetch("/quests/seasonal", { headers: auth(buildInitData(USER, BOT_TOKEN)) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  } finally { await w.stop(); }
});

// (3)+(4) Shadow runs after a real event path (internal runner) → 0 writes; repeat 0.
test("shadow runs & writes nothing (production guard); repeat no side effects", async () => {
  const p = freshEnv("guard"); const w = await boot(p, SHADOW_ON);
  try {
    const before = writeSignature(p);
    const r = await runShadow(w);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.ok(b.mismatched >= 1, "pending seasonal quest detected as mismatch");
    assert.equal(writeSignature(p), before, "shadow wrote nothing");
    await runShadow(w); // repeat
    assert.equal(writeSignature(p), before, "repeat shadow: still no writes");
  } finally { await w.stop(); }
});

// (5) Mismatch detected and NOT corrected.
test("mismatch detected, not silently corrected", async () => {
  const p = freshEnv("mismatch"); const w = await boot(p, SHADOW_ON);
  try {
    const dqpBefore = d1num(p, `SELECT COUNT(*) AS n FROM user_task_progress WHERE user_id=${USER.id};`);
    assert.equal(dqpBefore, 0, "no stored seasonal progress yet");
    const b = await (await runShadow(w)).json();
    assert.ok(b.mismatched >= 1, "missing/level mismatch reported");
    assert.equal(d1num(p, `SELECT COUNT(*) AS n FROM user_task_progress WHERE user_id=${USER.id};`), 0, "shadow did not create progress");
    assert.equal(d1num(p, `SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id=${USER.id};`), 0, "shadow granted no stars");
  } finally { await w.stop(); }
});

// (6) Match scenario → matched, 0 mismatches, 0 writes.
test("already-applied state → match with no writes", async () => {
  const p = freshEnv("match", { match: true }); const w = await boot(p, SHADOW_ON);
  try {
    const before = writeSignature(p);
    const b = await (await runShadow(w)).json();
    assert.ok(b.matched >= 1, "seasonal quest matches stored state");
    assert.equal(b.mismatched, 0, "no mismatches when stored state is correct");
    assert.equal(writeSignature(p), before, "no writes");
  } finally { await w.stop(); }
});

// (7) Shadow off vs on → identical /me/season-progress read (shadow does not affect the read path).
test("shadow off/on give identical /me/season-progress read", async () => {
  const pa = freshEnv("off-a", { match: true }); const wa = await boot(pa, {});
  let off;
  try { off = await (await wa.fetch("/me/season-progress", { headers: auth(buildInitData(USER, BOT_TOKEN)) })).json(); } finally { await wa.stop(); }
  const pb = freshEnv("on-b", { match: true }); const wb = await boot(pb, SHADOW_ON);
  try {
    const on = await (await wb.fetch("/me/season-progress", { headers: auth(buildInitData(USER, BOT_TOKEN)) })).json();
    assert.equal(on.stars ?? null, off.stars ?? null);
    assert.deepEqual(Object.keys(on).sort(), Object.keys(off).sort());
  } finally { await wb.stop(); }
});

// (8) Internal seasonal-shadow runner requires trusted internal auth.
test("internal seasonal-shadow runner is auth-gated", async () => {
  const p = freshEnv("auth"); const w = await boot(p, SHADOW_ON);
  try {
    assert.notEqual((await w.fetch(`/internal/admin/seasonal-shadow/${USER.id}`, { method: "GET" })).status, 200);
    assert.equal((await runShadow(w)).status, 200);
  } finally { await w.stop(); }
});
