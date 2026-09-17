// Stage 5 E2E — event-driven apply rollout + read-reconcile skip for allowlisted
// users. Local miniflare D1 only. Proves: default unchanged; allowlisted users
// skip /me/boosts + /me/cases reconcile (no quest writes); others reconcile;
// internal repair is auth-gated; removing a user from the skip-list restores it.
//
// Run: node --test e2e/questapply.e2e.test.mjs (package.json test:e2e:questapply)

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
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
  const m = out.match(/"n"\s*:\s*(-?\d+)/);
  return m ? Number(m[1]) : 0;
}
function freshEnv(name) {
  const p = `.wrangler-e2e-qa-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  // Pre-seed a pick directly (bypassing /pick apply) so that ONLY the read
  // reconcile would complete dq_full_day. updated_at < lock_time (far future).
  d1(p, `INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES ('${DAY}', 'e2e-m1', ${USER.id}, 1, 0, 0, 1);`);
  return p;
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const auth = (initData) => ({ "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData });
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const dqp = (p) => d1num(p, `SELECT COUNT(*) AS n FROM daily_quest_progress WHERE user_id=${USER.id} AND day='${DAY}';`);
const ALLOW = { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: String(USER.id), QUEST_READ_RECONCILE_SKIP_USER_IDS: String(USER.id) };

async function callBoosts(w, initData) {
  return w.fetch("/me/boosts", { method: "POST", headers: auth(initData), body: JSON.stringify({ initData, day: DAY }) });
}
async function callCases(w, initData) {
  return w.fetch("/me/cases", { method: "POST", headers: auth(initData), body: JSON.stringify({ initData }) });
}

// --- E2E-1: defaults (apply off) — /me/boosts reconcile applies dq_full_day ---
test("default (apply off): /me/boosts reconcile still applies quests", async () => {
  const p = freshEnv("default");
  const w = await boot(p, {});
  try {
    assert.equal(dqp(p), 0);
    const r = await callBoosts(w, buildInitData(USER, BOT_TOKEN));
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 900));
    assert.ok(dqp(p) >= 1, "legacy reconcile applied a quest (default behavior)");
  } finally { await w.stop(); }
});

// --- E2E-7: allowlisted /me/boosts — reconcile skipped, quest writes = 0, response ok ---
test("allowlisted /me/boosts: reconcile skipped (0 quest writes), response unchanged", async () => {
  const p = freshEnv("skip-boosts");
  const w = await boot(p, ALLOW);
  try {
    const r = await callBoosts(w, buildInitData(USER, BOT_TOKEN));
    assert.equal(r.status, 200, "response status unchanged");
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.available), "response shape unchanged");
    await new Promise((res) => setTimeout(res, 900));
    assert.equal(dqp(p), 0, "no quest writes for allowlisted user (reconcile skipped)");
  } finally { await w.stop(); }
});

// --- E2E-8: allowlisted /me/cases — reconcile skipped, quest writes = 0 ---
test("allowlisted /me/cases: reconcile skipped (0 quest writes)", async () => {
  const p = freshEnv("skip-cases");
  const w = await boot(p, ALLOW);
  try {
    const r = await callCases(w, buildInitData(USER, BOT_TOKEN));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    await new Promise((res) => setTimeout(res, 900));
    assert.equal(dqp(p), 0, "no quest writes for allowlisted user");
  } finally { await w.stop(); }
});

// --- E2E-9: user not in allowlist — old reconcile still works ---
test("non-allowlisted user: /me/boosts reconcile still applies", async () => {
  const p = freshEnv("noallow");
  // apply on, but user NOT in the allowlists → must NOT skip
  const w = await boot(p, { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: "999", QUEST_READ_RECONCILE_SKIP_USER_IDS: "999" });
  try {
    await callBoosts(w, buildInitData(USER, BOT_TOKEN));
    await new Promise((res) => setTimeout(res, 900));
    assert.ok(dqp(p) >= 1, "reconcile runs for non-allowlisted user");
  } finally { await w.stop(); }
});

// --- E2E-10/fail-safe: removing user from skip-list restores reconcile ---
test("fail-safe: removing user from skip-list restores read reconcile", async () => {
  const p = freshEnv("restore");
  // First: allowlisted → skipped → no writes
  const w1 = await boot(p, ALLOW);
  try { await callBoosts(w1, buildInitData(USER, BOT_TOKEN)); await new Promise((r) => setTimeout(r, 700)); } finally { await w1.stop(); }
  assert.equal(dqp(p), 0, "skipped while allowlisted");
  // Then: removed from skip-list → reconcile restored
  const w2 = await boot(p, { QUEST_EVENT_APPLY_V2_ENABLED: "true", QUEST_EVENT_APPLY_USER_IDS: String(USER.id), QUEST_READ_RECONCILE_SKIP_USER_IDS: "" });
  try { await callBoosts(w2, buildInitData(USER, BOT_TOKEN)); await new Promise((r) => setTimeout(r, 900)); } finally { await w2.stop(); }
  assert.ok(dqp(p) >= 1, "reconcile restored after removal from skip-list");
});

// --- E2E-11: internal repair auth + dry-run + apply (idempotent) ---
test("internal quest-apply repair: auth-gated, dry-run no-writes, apply idempotent", async () => {
  const p = freshEnv("repair");
  const w = await boot(p, ALLOW);
  try {
    const base = `/internal/admin/quest-apply/${DAY}/${USER.id}`;
    // unauthenticated rejected
    assert.notEqual((await w.fetch(`${base}/status`, { method: "GET" })).status, 200);
    // dry-run: detects the pending dq_full_day, writes nothing
    const dr = await w.fetch(`${base}/dry-run`, { method: "POST", headers: internal });
    assert.equal(dr.status, 200);
    assert.ok((await dr.json()).diff_count >= 1, "dry-run detects pending quest");
    assert.equal(dqp(p), 0, "dry-run wrote nothing");
    // apply: completes it
    const ap = await w.fetch(`${base}/apply`, { method: "POST", headers: internal });
    assert.equal(ap.status, 200);
    await new Promise((r) => setTimeout(r, 300));
    const afterApply = dqp(p);
    assert.ok(afterApply >= 1, "apply completed the quest");
    // apply again → idempotent (no extra rows)
    await w.fetch(`${base}/apply`, { method: "POST", headers: internal });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(dqp(p), afterApply, "apply is idempotent");
  } finally { await w.stop(); }
});
