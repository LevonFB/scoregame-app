// Stage 12 E2E — GET /quests/daily becomes a PURE READ for allowlisted users
// (apply V2 + apply allowlist + reconcile-skip allowlist). Proves: default unchanged;
// allowlisted GET writes 0 quest rows; repeated GET 0 writes; non-allowlisted reconcile
// still runs; removing the ID restores reconcile; read reflects event-applied progress;
// missing progress is NOT hidden-fixed, internal repair still works; response shape same.
//
// Run: node --test e2e/dailyread.e2e.test.mjs (package.json test:e2e:dailyread)

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
const DAY = "2026-06-20";

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
function freshEnv(name) {
  const p = `.wrangler-e2e-dr-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  // Pre-seed a pick directly so ONLY the read reconcile would complete dq_full_day.
  d1(p, `INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('${DAY}', 'e2e-m1', ${USER.id}, 1, 0, 0, 1);`);
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
const dqp = (p) => d1num(p, `SELECT COUNT(*) AS n FROM daily_quest_progress WHERE user_id=${USER.id} AND day='${DAY}';`);
const ALLOW = { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: String(USER.id), QUEST_READ_RECONCILE_SKIP_USER_IDS: String(USER.id) };
const getDaily = (w, initData) => w.fetch(`/quests/daily?day=${DAY}`, { headers: auth(initData) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (1) Default: GET /quests/daily reconcile applies quests (legacy behavior).
test("default (apply off): GET /quests/daily reconcile still applies quests", async () => {
  const p = freshEnv("default");
  const w = await boot(p, {});
  try {
    assert.equal(dqp(p), 0);
    const r = await getDaily(w, buildInitData(USER, BOT_TOKEN));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    await sleep(900);
    assert.ok(dqp(p) >= 1, "legacy reconcile applied a quest");
  } finally { await w.stop(); }
});

// (2)+(3) Allowlist GET: read-only, 0 quest writes; repeated GET still 0.
test("allowlist GET: read-only (0 writes), response unchanged, repeat 0 writes", async () => {
  const p = freshEnv("allow");
  const w = await boot(p, ALLOW);
  try {
    const r = await getDaily(w, buildInitData(USER, BOT_TOKEN));
    assert.equal(r.status, 200, "status unchanged");
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.quests) && body.quests.length > 0, "all daily quests read");
    assert.equal(typeof body.totalCompleted, "number");
    await sleep(700);
    assert.equal(dqp(p), 0, "allowlist GET wrote no quest rows");
    // repeated GETs → still 0
    await getDaily(w, buildInitData(USER, BOT_TOKEN));
    await getDaily(w, buildInitData(USER, BOT_TOKEN));
    await sleep(700);
    assert.equal(dqp(p), 0, "repeated allowlist GETs add no writes");
  } finally { await w.stop(); }
});

// (4) Non-allowlisted user → reconcile still runs.
test("non-allowlisted user: GET reconcile still applies", async () => {
  const p = freshEnv("noallow");
  const w = await boot(p, { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: "999", QUEST_READ_RECONCILE_SKIP_USER_IDS: "999" });
  try {
    await getDaily(w, buildInitData(USER, BOT_TOKEN));
    await sleep(900);
    assert.ok(dqp(p) >= 1, "reconcile runs for non-allowlisted user");
  } finally { await w.stop(); }
});

// (5) Removing the ID restores reconcile.
test("removing user from skip-list restores reconcile", async () => {
  const p = freshEnv("restore");
  const w1 = await boot(p, ALLOW);
  try { await getDaily(w1, buildInitData(USER, BOT_TOKEN)); await sleep(700); } finally { await w1.stop(); }
  assert.equal(dqp(p), 0, "skipped while allowlisted");
  const w2 = await boot(p, { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: String(USER.id), QUEST_READ_RECONCILE_SKIP_USER_IDS: "" });
  try { await getDaily(w2, buildInitData(USER, BOT_TOKEN)); await sleep(900); } finally { await w2.stop(); }
  assert.ok(dqp(p) >= 1, "reconcile restored after removal from skip-list");
});

// (6) Event apply → read-only GET shows the up-to-date progress.
test("event-applied progress is reflected by read-only allowlist GET", async () => {
  const p = freshEnv("reflect");
  // Simulate event-driven apply having completed dq_full_day already.
  d1(p, `INSERT OR REPLACE INTO daily_quest_progress (day, user_id, quest_id, completed, stars_awarded, completed_at) VALUES ('${DAY}', ${USER.id}, 'dq_full_day', 1, 5, ${Date.now()});`);
  const w = await boot(p, ALLOW);
  try {
    const before = dqp(p);
    const body = await (await getDaily(w, buildInitData(USER, BOT_TOKEN))).json();
    const q = body.quests.find((x) => x.id === "dq_full_day");
    assert.ok(q && q.completed === true, "read reflects event-applied completion");
    await sleep(600);
    assert.equal(dqp(p), before, "read-only: no extra writes");
  } finally { await w.stop(); }
});

// (7) Missing progress NOT hidden-fixed by GET; internal repair still works.
test("missing progress is not auto-fixed by GET; internal repair applies it", async () => {
  const p = freshEnv("repair");
  const w = await boot(p, ALLOW);
  try {
    // allowlist GET does NOT complete the pending quest
    await getDaily(w, buildInitData(USER, BOT_TOKEN));
    await sleep(700);
    assert.equal(dqp(p), 0, "GET did not silently apply missing progress");
    // internal repair (Stage 5) still works
    const base = `/internal/admin/quest-apply/${DAY}/${USER.id}`;
    assert.notEqual((await w.fetch(`${base}/status`, { method: "GET" })).status, 200, "repair auth-gated");
    const ap = await w.fetch(`${base}/apply`, { method: "POST", headers: internal });
    assert.equal(ap.status, 200);
    await sleep(400);
    assert.ok(dqp(p) >= 1, "internal repair applied the quest");
  } finally { await w.stop(); }
});

// (8) Response shape identical: default vs allowlist.
test("response shape identical (default vs allowlist)", async () => {
  const pa = freshEnv("shape-a"); const wa = await boot(pa, {});
  let keysDefault;
  try { keysDefault = Object.keys(await (await getDaily(wa, buildInitData(USER, BOT_TOKEN))).json()).sort(); } finally { await wa.stop(); }
  const pb = freshEnv("shape-b"); const wb = await boot(pb, ALLOW);
  try {
    const body = await (await getDaily(wb, buildInitData(USER, BOT_TOKEN))).json();
    assert.deepEqual(Object.keys(body).sort(), keysDefault, "top-level response shape unchanged");
  } finally { await wb.stop(); }
});
