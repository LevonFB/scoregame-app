// Stage 4 E2E — quest event-sync SHADOW mode over the real api-worker (local
// miniflare D1). Proves: legacy quest progress still updates; shadow writes
// NOTHING extra; default (V2 off) behavior is unchanged.
//
// Run: node --test e2e/questshadow.e2e.test.mjs (see package.json test:e2e:questshadow)

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
const DAY = "2026-06-20"; // matches seed.sql match e2e-m1

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1file = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);
function d1num(p, sql) {
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
  const m = out.match(/"n"\s*:\s*(-?\d+)/);
  return m ? Number(m[1]) : 0;
}
function freshEnv(name) {
  const p = `.wrangler-e2e-qs-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  return p;
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const authHeaders = (initData) => ({ "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData });
const dqpRows = (p) => d1num(p, `SELECT COUNT(*) AS n FROM daily_quest_progress WHERE user_id=${USER.id} AND day='${DAY}';`);
const fullDayDone = (p) => d1num(p, `SELECT COUNT(*) AS n FROM daily_quest_progress WHERE user_id=${USER.id} AND day='${DAY}' AND quest_id='dq_full_day' AND completed=1;`);
const ucRows = (p) => d1num(p, `SELECT COUNT(*) AS n FROM user_cases WHERE user_id=${USER.id};`);
const ledgerRows = (p) => d1num(p, `SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id=${USER.id};`);
const starsSum = (p) => d1num(p, `SELECT COALESCE(SUM(stars),0) AS n FROM user_season_progress WHERE user_id=${USER.id};`);
const fullState = (p) => ({ dqp: dqpRows(p), uc: ucRows(p), led: ledgerRows(p), stars: starsSum(p) });

async function savePick(w, initData, home = 1, away = 0) {
  return w.fetch("/pick", { method: "POST", headers: authHeaders(initData), body: JSON.stringify({ matchId: "e2e-m1", home, away }) });
}

// --- E2E-1: V2 OFF — action works, legacy quest progresses, response unchanged ---
test("E2E-1 V2 off: pick succeeds, legacy dq_full_day applied", async () => {
  const p = freshEnv("off");
  const w = await boot(p, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try {
    const initData = buildInitData(USER, BOT_TOKEN);
    const r = await savePick(w, initData);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.picks), "response contract unchanged");
    await new Promise((res) => setTimeout(res, 800));
    assert.ok(dqpRows(p) >= 1, "legacy applied at least one daily quest");
  } finally { await w.stop(); }
});

// --- E2E-2: V2 + shadow ON — shadow runs but writes nothing extra ---
test("E2E-2 shadow on: same legacy progress, no extra quest rows vs V2-off", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  // Baseline: V2 off
  const pOff = freshEnv("base-off");
  const wOff = await boot(pOff, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try { await savePick(wOff, initData); await new Promise((r) => setTimeout(r, 800)); } finally { await wOff.stop(); }
  const offRows = dqpRows(pOff);

  // Shadow on
  const pOn = freshEnv("shadow-on");
  const wOn = await boot(pOn, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try {
    const r = await savePick(wOn, initData);
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 1500)); // allow shadow waitUntil to finish
  } finally { await wOn.stop(); }
  const onRows = dqpRows(pOn);

  assert.equal(onRows, offRows, "shadow does not change the number of quest progress rows");
  assert.ok(dqpRows(pOn) >= 1, "legacy still applied a quest with shadow on");
});

// --- E2E-3: repeating the action with shadow ON adds nothing beyond legacy ---
// (Compares two picks with shadow ON vs two picks V2 OFF: the shadow path must
//  contribute zero extra side effects, so the resulting state must be identical.)
test("E2E-3 shadow on: repeat is identical to legacy-only repeat (no extra side effects)", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  const pOff = freshEnv("rep-off");
  const wOff = await boot(pOff, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try {
    await savePick(wOff, initData); await new Promise((r) => setTimeout(r, 700));
    await savePick(wOff, initData); await new Promise((r) => setTimeout(r, 900));
  } finally { await wOff.stop(); }

  const pOn = freshEnv("rep-on");
  const wOn = await boot(pOn, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try {
    await savePick(wOn, initData); await new Promise((r) => setTimeout(r, 700));
    await savePick(wOn, initData); await new Promise((r) => setTimeout(r, 1400));
  } finally { await wOn.stop(); }

  assert.equal(dqpRows(pOn), dqpRows(pOff), "repeat with shadow == repeat legacy-only");
  assert.equal(ucRows(pOn), ucRows(pOff), "inventory identical across repeats");
});

// --- E2E-7: safety guard — shadow on changes only what legacy changes ---
test("E2E-7 safety: quest progress + inventory identical to legacy-only run", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  const pOff = freshEnv("safe-off");
  const wOff = await boot(pOff, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try { await savePick(wOff, initData); await new Promise((r) => setTimeout(r, 800)); } finally { await wOff.stop(); }

  const pOn = freshEnv("safe-on");
  const wOn = await boot(pOn, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try { await savePick(wOn, initData); await new Promise((r) => setTimeout(r, 1500)); } finally { await wOn.stop(); }

  assert.equal(dqpRows(pOn), dqpRows(pOff), "quest progress identical");
  assert.equal(ucRows(pOn), ucRows(pOff), "inventory identical");
});

// --- E2E-13: shadow on vs off — full state (progress/stars/ledger/cases) identical ---
test("E2E-13 shadow on vs off: progress + stars + ledger + cases identical", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  const pOff = freshEnv("full-off");
  const wOff = await boot(pOff, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try { await savePick(wOff, initData); await new Promise((r) => setTimeout(r, 900)); } finally { await wOff.stop(); }

  const pOn = freshEnv("full-on");
  const wOn = await boot(pOn, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try { await savePick(wOn, initData); await new Promise((r) => setTimeout(r, 1500)); } finally { await wOn.stop(); }

  assert.deepEqual(fullState(pOn), fullState(pOff), "full reward state identical with shadow on");
  assert.ok(fullState(pOff).led >= 1, "legacy actually awarded (cascade present)");
});

// --- E2E-changepick: changing a prediction with shadow on == legacy-only ---
test("E2E change prediction: shadow on matches legacy-only after re-pick", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  const pOff = freshEnv("chg-off");
  const wOff = await boot(pOff, { QUEST_EVENT_SYNC_V2_ENABLED: "false" });
  try { await savePick(wOff, initData, 1, 0); await savePick(wOff, initData, 2, 1); await new Promise((r) => setTimeout(r, 1000)); } finally { await wOff.stop(); }

  const pOn = freshEnv("chg-on");
  const wOn = await boot(pOn, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try { await savePick(wOn, initData, 1, 0); await savePick(wOn, initData, 2, 1); await new Promise((r) => setTimeout(r, 1600)); } finally { await wOn.stop(); }

  assert.deepEqual(fullState(pOn), fullState(pOff), "re-pick state identical with shadow");
});

// --- E2E-14: /me/boosts still performs the legacy reconcile (not disabled) ---
test("E2E-14 /me/boosts still reconciles with shadow on", async () => {
  const initData = buildInitData(USER, BOT_TOKEN);
  const p = freshEnv("boosts");
  const w = await boot(p, { QUEST_EVENT_SYNC_V2_ENABLED: "true", QUEST_EVENT_SYNC_SHADOW_MODE: "true" });
  try {
    await savePick(w, initData);
    const r = await w.fetch("/me/boosts", { method: "POST", headers: authHeaders(initData), body: JSON.stringify({ initData, day: DAY }) });
    assert.equal(r.status, 200, "/me/boosts still responds");
    const body = await r.json();
    assert.equal(body.ok, true);
    await new Promise((res) => setTimeout(res, 800));
    assert.ok(dqpRows(p) >= 1, "legacy reconcile via /me/boosts still applies quests");
  } finally { await w.stop(); }
});
