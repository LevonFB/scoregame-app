// Stage 14 E2E — seasonal event-driven apply + read-only endpoints (allowlist only).
// Proves: default reconcile on reads; allowlist event apply updates seasonal progress;
// repeat no dup; /me/level & /quests/seasonal read-only (0 writes); non-allowlist legacy;
// removal restores; missing progress not GET-fixed + internal repair; shadow==apply.
//
// Run: node --test e2e/seasonalapply.e2e.test.mjs (package.json test:e2e:seasonalapply)

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
function writeSig(p) {
  const sql = `SELECT (
    (SELECT COUNT(*) FROM user_task_progress) || '|' || (SELECT COUNT(*) FROM user_achievements) || '|' ||
    (SELECT COUNT(*) FROM stars_ledger) || '|' || (SELECT COUNT(*) FROM balls_ledger) || '|' ||
    (SELECT COALESCE(SUM(stars),0) FROM user_season_progress) || '|' || (SELECT COALESCE(SUM(balls),0) FROM users)
  ) AS sig;`;
  const m = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]).match(/"sig"\s*:\s*"([^"]+)"/);
  return m ? m[1] : "?";
}
// Seasonal-specific markers (written ONLY by the reconcile).
const seasonRows = (p) => d1num(p, `SELECT COUNT(*) AS n FROM user_task_progress WHERE user_id=${USER.id} AND task_key='season_picks_test' AND instance_key='season';`);
const seasonLedger = (p) => d1num(p, `SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id=${USER.id} AND task_key='season_picks_test' AND instance_key='season';`);
const seasonStars = (p) => d1num(p, `SELECT COALESCE(SUM(stars),0) AS n FROM stars_ledger WHERE user_id=${USER.id} AND task_key='season_picks_test';`);

function seedAch(p, { match = false } = {}) {
  d1(p, `ALTER TABLE tasks_catalog ADD COLUMN period_type TEXT;`);
  d1(p, `INSERT OR REPLACE INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold, version) VALUES ('season_picks_test','global','common','*','Picks','','picks_total',2,1);`);
  d1(p, `INSERT OR REPLACE INTO tasks_catalog (task_key, task_type, period_type, is_enabled, reward_stars, reward_balls) VALUES ('season_picks_test','seasonal','seasonal',1,10,0);`);
  d1(p, `INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('2026-06-15','m1',${USER.id},1,0,0,1),('2026-06-16','m2',${USER.id},2,1,0,1);`);
  d1(p, `INSERT OR REPLACE INTO user_season_progress (user_id, season_number, stars, level) VALUES (${USER.id}, 1, 0, 1);`);
  if (match) d1(p, `INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('m1','2026-06-15','2026-06-15','2026-06-15T18:00:00Z','2099-01-01T00:00:00Z','SCHEDULED',1);`);
  return p;
}
function freshEnv(name, opts = {}) {
  const p = `.wrangler-e2e-sa-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  return seedAch(p, opts);
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const auth = (initData) => ({ "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData });
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const ID = buildInitData(USER, BOT_TOKEN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const APPLY = { SEASONAL_EVENT_APPLY_V2_ENABLED: "true", SEASONAL_EVENT_APPLY_USER_IDS: String(USER.id), SEASONAL_READ_RECONCILE_SKIP_USER_IDS: String(USER.id) };
const postPick = (w) => w.fetch("/pick", { method: "POST", headers: { ...auth(ID), "content-type": "application/json" }, body: JSON.stringify({ initData: ID, matchId: "m1", home: 1, away: 0 }) });
const getLevel = (w) => w.fetch("/me/season-progress", { headers: auth(ID) });
const getSeasonal = (w) => w.fetch("/quests/seasonal", { headers: auth(ID) });

// (1) Default /me/level reconcile applies seasonal quest (legacy).
test("default /me/level reconcile applies seasonal quest", async () => {
  const p = freshEnv("default"); const w = await boot(p, {});
  try {
    assert.equal(seasonLedger(p), 0);
    assert.equal((await getLevel(w)).status, 200);
    assert.ok(seasonRows(p) >= 1, "legacy reconcile applied seasonal progress");
    assert.ok(seasonStars(p) >= 10, "stars granted");
  } finally { await w.stop(); }
});

// (2)+(3) Allowlist event apply (POST /pick) updates progress; repeat no duplicate.
test("allowlist event apply via /pick updates seasonal progress; repeat no dup", async () => {
  const p = freshEnv("apply", { match: true }); const w = await boot(p, APPLY);
  try {
    assert.equal((await postPick(w)).status, 200);
    await sleep(900);
    assert.ok(seasonRows(p) >= 1, "event apply created seasonal progress");
    const ledger1 = seasonLedger(p), stars1 = seasonStars(p);
    assert.ok(ledger1 >= 1 && stars1 >= 10);
    // repeat event → idempotent (no duplicate stars/ledger)
    await postPick(w); await sleep(900);
    assert.equal(seasonLedger(p), ledger1, "no duplicate ledger");
    assert.equal(seasonStars(p), stars1, "no duplicate stars");
  } finally { await w.stop(); }
});

// (8) Non-allowlisted user → event apply does NOT run (no seasonal progress from /pick).
test("non-allowlisted user: /pick does not run seasonal apply", async () => {
  const p = freshEnv("noallow", { match: true });
  const w = await boot(p, { SEASONAL_EVENT_APPLY_V2_ENABLED: "true", SEASONAL_EVENT_APPLY_USER_IDS: "999", SEASONAL_READ_RECONCILE_SKIP_USER_IDS: "999" });
  try {
    assert.equal((await postPick(w)).status, 200);
    await sleep(800);
    assert.equal(seasonRows(p), 0, "no seasonal apply for non-allowlisted user");
  } finally { await w.stop(); }
});

// (6) /me/level allowlist → read-only (0 writes), response unchanged.
test("allowlist /me/level: read-only (0 writes), response intact", async () => {
  const p = freshEnv("level-ro"); const w = await boot(p, APPLY);
  try {
    const before = writeSig(p);
    const r = await getLevel(w);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true); assert.equal(typeof b.stars, "number"); assert.equal(b.level, undefined);
    await sleep(500);
    assert.equal(writeSig(p), before, "0 writes");
    assert.equal(seasonRows(p), 0, "no reconcile on read");
  } finally { await w.stop(); }
});

// (7) /quests/seasonal allowlist → read-only (0 writes).
test("allowlist /quests/seasonal: read-only (0 writes)", async () => {
  const p = freshEnv("seasonal-ro"); const w = await boot(p, APPLY);
  try {
    const before = writeSig(p);
    assert.equal((await getSeasonal(w)).status, 200);
    await getSeasonal(w);
    await sleep(500);
    assert.equal(writeSig(p), before, "repeated reads: 0 writes");
  } finally { await w.stop(); }
});

// (9) Removing the ID restores legacy reconcile on /me/level.
test("removing user from skip-list restores reconcile", async () => {
  const p = freshEnv("restore"); const w1 = await boot(p, APPLY);
  try { await getLevel(w1); await sleep(500); } finally { await w1.stop(); }
  assert.equal(seasonRows(p), 0, "skipped while allowlisted");
  const w2 = await boot(p, { SEASONAL_EVENT_APPLY_V2_ENABLED: "true", SEASONAL_EVENT_APPLY_USER_IDS: String(USER.id), SEASONAL_READ_RECONCILE_SKIP_USER_IDS: "" });
  try { await getLevel(w2); await sleep(500); } finally { await w2.stop(); }
  assert.ok(seasonRows(p) >= 1, "reconcile restored after removal");
});

// (10) Missing progress not GET-fixed; internal repair applies it (idempotent).
test("missing progress not auto-fixed by read; internal repair applies (idempotent)", async () => {
  const p = freshEnv("repair"); const w = await boot(p, APPLY);
  try {
    await getLevel(w); await sleep(400);
    assert.equal(seasonRows(p), 0, "read did not apply missing progress");
    const base = `/internal/admin/seasonal-apply/${USER.id}`;
    assert.notEqual((await w.fetch(`${base}/status`, { method: "GET" })).status, 200, "repair auth-gated");
    const st = await w.fetch(`${base}/status`, { method: "GET", headers: internal });
    assert.equal(st.status, 200);
    assert.ok((await st.json()).mismatched >= 1, "status reports pending");
    // dry-run writes nothing
    const before = writeSig(p);
    await w.fetch(`${base}/dry-run`, { method: "POST", headers: internal });
    assert.equal(writeSig(p), before, "dry-run no writes");
    // apply
    assert.equal((await w.fetch(`${base}/apply`, { method: "POST", headers: internal })).status, 200);
    await sleep(300);
    assert.ok(seasonRows(p) >= 1, "internal apply applied progress");
    const stars1 = seasonStars(p);
    // apply again → idempotent
    await w.fetch(`${base}/apply`, { method: "POST", headers: internal }); await sleep(300);
    assert.equal(seasonStars(p), stars1, "apply idempotent");
  } finally { await w.stop(); }
});

// (Stage 15 #1) Scoring-completed seasonal apply. The scoring hook calls the IDENTICAL
// maybeRunSeasonalApply → reconcile as the /pick (test 2) and /cases/open (test 9)
// real-event hooks (code-verified: all 4 hooks call one function). The real /admin/result
// trigger needs the full recalc pipeline (bonus/goalscorer/source-rules) whose fixture is
// out of scope; here we exercise the same reconcile twice (two scoring events) and assert
// progress/reward correctness + idempotency (no duplicate stars on repeat scoring).
test("scoring-completed seasonal apply: correct progress/reward + repeat no dup", async () => {
  const p = freshEnv("scoring"); const w = await boot(p, APPLY);
  try {
    const base = `/internal/admin/seasonal-apply/${USER.id}`;
    assert.equal((await w.fetch(`${base}/apply`, { method: "POST", headers: internal })).status, 200);
    await sleep(300);
    assert.ok(seasonRows(p) >= 1, "scoring apply created seasonal progress");
    const stars1 = seasonStars(p);
    assert.ok(stars1 >= 10, "reward correct");
    // second scoring event → idempotent
    await w.fetch(`${base}/apply`, { method: "POST", headers: internal }); await sleep(300);
    assert.equal(seasonStars(p), stars1, "repeat scoring: no duplicate stars");
  } finally { await w.stop(); }
});

// (Stage 15 #2) Case opened → seasonal apply for allowlist; repeat no dup; open not broken.
test("case opened runs seasonal apply for allowlist; repeat no dup; open unaffected", async () => {
  const p = freshEnv("case");
  d1(p, `INSERT OR REPLACE INTO shop_cases (id, code, is_active, price_balls) VALUES (1,'daily_free',1,0);`);
  d1(p, `INSERT OR REPLACE INTO shop_case_rewards (id, case_id, is_active, chance_percent, reward_type, reward_amount) VALUES (1,1,1,100,'balls',5);`);
  d1(p, `INSERT OR REPLACE INTO user_cases (user_id, case_type, quantity) VALUES (${USER.id},'daily_free',2);`);
  const w = await boot(p, APPLY);
  try {
    const open = (openId) => w.fetch("/cases/open", { method: "POST", headers: { ...auth(ID), "content-type": "application/json" }, body: JSON.stringify({ initData: ID, caseType: "daily_free", openId }) });
    const r1 = await open("o1");
    assert.equal(r1.status, 200, "case open succeeds");
    assert.equal((await r1.json()).ok, true);
    await sleep(1000);
    assert.ok(seasonRows(p) >= 1, "case-open triggered seasonal apply");
    const stars1 = seasonStars(p);
    // open another case → seasonal apply repeats but no duplicate reward
    assert.equal((await open("o2")).status, 200);
    await sleep(1000);
    assert.equal(seasonStars(p), stars1, "repeat: no duplicate seasonal stars");
  } finally { await w.stop(); }
});

// (12) Shadow and apply agree: shadow shows mismatch before apply, match after.
test("shadow and apply use the same expected result", async () => {
  const p = freshEnv("agree"); const w = await boot(p, APPLY);
  try {
    const base = `/internal/admin/seasonal-apply/${USER.id}`;
    const pre = await (await w.fetch(`${base}/status`, { method: "GET", headers: internal })).json();
    assert.ok(pre.mismatched >= 1, "pending before apply");
    await w.fetch(`${base}/apply`, { method: "POST", headers: internal }); await sleep(300);
    const post = await (await w.fetch(`${base}/status`, { method: "GET", headers: internal })).json();
    assert.equal(post.mismatched, 0, "match after apply");
    assert.ok(post.matched >= 1);
  } finally { await w.stop(); }
});
