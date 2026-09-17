// Stage 6 E2E — weekly finalizer V2 scheduled path + GET contract + internal
// repair. Local miniflare D1 only. A "ready" period = a FINISHED match in a past
// (ended) week. Finalization is idempotent (weekly_finalizations ON CONFLICT).
//
// Run: node --test e2e/weekly.e2e.test.mjs (package.json test:e2e:weekly)

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

const past = new Date(Date.now() - 10 * 86400000);
const PAST_ISO = past.toISOString();
const PAST_DAY = PAST_ISO.slice(0, 10);

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1 = (p, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql]);
const d1file = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);
function d1json(p, sql) {
  return wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
}
function d1num(p, sql) {
  const m = d1json(p, sql).match(/"n"\s*:\s*(-?\d+)/);
  return m ? Number(m[1]) : 0;
}
function freshEnv(name, ready = true) {
  const p = `.wrangler-e2e-wk-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  if (ready) {
    // A FINISHED match in a past (ended) week → that week is ready to finalize.
    d1(p, `INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('wk1', '${PAST_DAY}', '${PAST_DAY}', '${PAST_ISO}', '${PAST_ISO}', 'FINISHED', 1);`);
  }
  return p;
}
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const triggerCron = (w) => w.fetch("/cdn-cgi/handler/scheduled?cron=5+*+*+*+*", { method: "POST" });
const finalizations = (p) => d1num(p, `SELECT COUNT(*) AS n FROM weekly_finalizations;`);
const jobs = (p, status) => d1num(p, `SELECT COUNT(*) AS n FROM weekly_finalizer_jobs${status ? ` WHERE status='${status}'` : ""};`);
// GET /quests/weekly as a given user (front-worker internal headers + valid initData).
const weeklyGet = (w, uid) => w.fetch("/quests/weekly", { headers: { "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": buildInitData({ id: uid, first_name: "E2E" }, BOT_TOKEN) } });
async function waitFinal(p, want, timeoutMs = 10000) {
  const s = Date.now();
  while (finalizations(p) < want && Date.now() - s < timeoutMs) await new Promise((r) => setTimeout(r, 400));
  return finalizations(p);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stage 7: a FINISHED match in the *previous* week (now-7d). The week it belongs to
// is the one previousWeeklyScope() resolves — exactly the period the GET gate checks.
const past7 = new Date(Date.now() - 7 * 86400000);
const P7_ISO = past7.toISOString();
const P7_DAY = P7_ISO.slice(0, 10);
function freshEnv7(name) {
  const p = `.wrangler-e2e-wk-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  // Activate the GET /quests/weekly finalize gate: it only runs when tasks_catalog
  // has a period_type column (getQuestSchemaSupport.taskPeriodType). With these columns
  // present but no 'weekly' rows, listWeeklyQuestDefinitions returns empty (no crash),
  // so finalizeWeeklyPeriod still writes weekly_finalizations. Isolated to the Stage 7
  // weekly env so other suites / Stage 6 freshEnv are untouched.
  for (const col of ["period_type TEXT", "scope TEXT", "title TEXT", "description TEXT", "progress_target INTEGER", "progress_kind TEXT"]) {
    d1(p, `ALTER TABLE tasks_catalog ADD COLUMN ${col};`);
  }
  d1(p, `INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('wk7', '${P7_DAY}', '${P7_DAY}', '${P7_ISO}', '${P7_ISO}', 'FINISHED', 1);`);
  return p;
}
const ALLOW_UID = 777777; // in the Stage 7 allowlist below
const OTHER_UID = 888888; // never allowlisted

// --- GET default: /quests/weekly works (V2 off) ---
test("GET /quests/weekly works at default (V2 off), contract intact", async () => {
  const p = freshEnv("get-default");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "false" });
  try {
    const r = await w.fetch("/quests/weekly", { headers: { "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": buildInitData({ id: 777777, first_name: "E2E" }, BOT_TOKEN) } });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
  } finally { await w.stop(); }
});

// --- Scheduled V2-off: no finalizer job created ---
test("scheduled V2-off: no weekly_finalizer_jobs row", async () => {
  const p = freshEnv("sch-off");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "false" });
  try {
    assert.equal((await triggerCron(w)).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(jobs(p), 0, "no V2 job when off");
  } finally { await w.stop(); }
});

// --- Scheduled V2-on: ready period finalized once (job completed + finalization) ---
test("scheduled V2-on: ready period finalized exactly once", async () => {
  const p = freshEnv("sch-on");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    assert.equal((await triggerCron(w)).status, 200);
    assert.equal(await waitFinal(p, 1), 1, "one weekly_finalizations row");
    assert.equal(jobs(p, "completed"), 1, "one completed finalizer job");
  } finally { await w.stop(); }
});

// --- Scheduled repeat: no extra finalizations ---
test("scheduled repeat: no additional finalizations/rewards", async () => {
  const p = freshEnv("sch-repeat");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    await triggerCron(w); await waitFinal(p, 1);
    await triggerCron(w); await new Promise((r) => setTimeout(r, 1500));
    assert.equal(finalizations(p), 1, "still one finalization after repeat");
  } finally { await w.stop(); }
});

// --- Scheduled concurrent: one finalization ---
test("scheduled concurrent: one finalization / one completed job", async () => {
  const p = freshEnv("sch-conc");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    await Promise.all([triggerCron(w), triggerCron(w)]);
    await waitFinal(p, 1);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(finalizations(p), 1);
    assert.equal(jobs(p, "completed"), 1);
  } finally { await w.stop(); }
});

// --- Internal repair: auth + dry-run (no writes) + run (idempotent) ---
test("internal weekly-finalizer: auth-gated, dry-run no-writes, run idempotent", async () => {
  const p = freshEnv("repair");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    // discover the actual week_key by running the scheduled finalize once
    await triggerCron(w); await waitFinal(p, 1);
    const out = d1json(p, `SELECT season_id, week_key FROM weekly_finalizer_jobs LIMIT 1;`);
    const sid = Number(out.match(/"season_id"\s*:\s*(\d+)/)[1]);
    const wk = out.match(/"week_key"\s*:\s*"([^"]+)"/)[1];
    const base = `/internal/admin/weekly-finalizer/${sid}/${encodeURIComponent(wk)}`;

    assert.notEqual((await w.fetch(`${base}/status`, { method: "GET" })).status, 200, "unauth rejected");
    const st = await w.fetch(`${base}/status`, { method: "GET", headers: internal });
    assert.equal(st.status, 200);
    assert.equal((await st.json()).finalized, true);

    const before = finalizations(p);
    const dr = await w.fetch(`${base}/dry-run`, { method: "POST", headers: internal });
    assert.equal(dr.status, 200);
    assert.equal(finalizations(p), before, "dry-run wrote nothing");

    const run = await w.fetch(`${base}/run`, { method: "POST", headers: internal });
    assert.equal(run.status, 200);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(finalizations(p), before, "run is idempotent (no extra finalization)");
  } finally { await w.stop(); }
});

// ══════════════════════ Stage 7 — GET read-skip for allowlisted users ══════════════════════

// (1) Default: V2 on but NO skip env → Stage 6 behavior (every user → legacy fallback).
test("Stage 7 default (no skip env): missing-job period → legacy fallback finalizes (Stage 6)", async () => {
  const p = freshEnv7("s7-default");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    assert.equal(finalizations(p), 0);
    const r = await weeklyGet(w, ALLOW_UID);
    assert.equal(r.status, 200);
    assert.equal(await waitFinal(p, 1), 1, "no allowlist → legacy fallback finalized");
  } finally { await w.stop(); }
});

// (2) Allowlist + completed job → GET only reads, 0 new finalizations. (9) repeat → still 0.
test("Stage 7 allowlist + completed job → GET reads only, repeated GETs add no writes", async () => {
  const p = freshEnv7("s7-completed");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: String(ALLOW_UID) });
  try {
    await triggerCron(w); await waitFinal(p, 1);          // scheduled completes previous-week job
    const before = finalizations(p);
    for (let i = 0; i < 3; i++) {
      const r = await weeklyGet(w, ALLOW_UID);
      assert.equal(r.status, 200);
      assert.equal((await r.json()).ok, true);
    }
    await sleep(600);
    assert.equal(finalizations(p), before, "allowlist completed → repeated GETs add no finalization");
  } finally { await w.stop(); }
});

// (3) Allowlist + failed job → legacy NOT called (0 writes); non-allowlist + failed → fallback finalizes.
test("Stage 7 allowlist + failed job → no legacy finalize; non-allowlist → fallback finalizes", async () => {
  const p = freshEnv7("s7-failed");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: String(ALLOW_UID) });
  try {
    // Discover the previous-week job, then reset to a clean failed state (0 finalizations).
    await triggerCron(w); await waitFinal(p, 1);
    d1(p, `DELETE FROM weekly_finalizations;`);
    d1(p, `UPDATE weekly_finalizer_jobs SET status='failed', completed_at=NULL, failed_at=1, heartbeat_at=1;`);
    assert.equal(finalizations(p), 0);

    // allowlisted user → pure read, legacy NOT invoked
    assert.equal((await weeklyGet(w, ALLOW_UID)).status, 200);
    await sleep(600);
    assert.equal(finalizations(p), 0, "allowlist failed → legacy not called");

    // non-allowlisted user → legacy fallback runs and finalizes
    assert.equal((await weeklyGet(w, OTHER_UID)).status, 200);
    assert.equal(await waitFinal(p, 1), 1, "non-allowlist failed → fallback finalized");
  } finally { await w.stop(); }
});

// (4)+(5) Allowlist + missing job → 0 writes; non-allowlist + missing → fallback finalizes.
test("Stage 7 allowlist + missing job → 0 writes; non-allowlist → fallback finalizes", async () => {
  const p = freshEnv7("s7-missing");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: String(ALLOW_UID) });
  try {
    assert.equal(finalizations(p), 0);
    assert.equal((await weeklyGet(w, ALLOW_UID)).status, 200);
    await sleep(600);
    assert.equal(finalizations(p), 0, "allowlist missing → no finalize");
    assert.equal(jobs(p), 0, "GET created no job");

    assert.equal((await weeklyGet(w, OTHER_UID)).status, 200);
    assert.equal(await waitFinal(p, 1), 1, "non-allowlist missing → fallback finalized");
  } finally { await w.stop(); }
});

// (6) Removing the ID from the allowlist immediately restores the legacy fallback.
test("Stage 7 removing user from allowlist → legacy fallback restored", async () => {
  const p = freshEnv7("s7-removed");
  // 777777 NOT in the (empty) skip list → behaves as a normal user again
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: "" });
  try {
    assert.equal((await weeklyGet(w, ALLOW_UID)).status, 200);
    assert.equal(await waitFinal(p, 1), 1, "removed from allowlist → fallback finalized");
  } finally { await w.stop(); }
});

// (7) Job-status read failure (jobs table absent) → allowlist fail-safe runs legacy fallback.
test("Stage 7 fail-safe: job-status read error + allowlist → safe legacy fallback", async () => {
  const p = freshEnv7("s7-failsafe");
  d1(p, `DROP TABLE IF EXISTS weekly_finalizer_jobs;`);
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: String(ALLOW_UID) });
  try {
    const r = await weeklyGet(w, ALLOW_UID);
    assert.equal(r.status, 200, "fail-safe keeps response contract");
    assert.equal(await waitFinal(p, 1), 1, "fail-safe ran legacy fallback (no fabricated completed)");
  } finally { await w.stop(); }
});

// (8) Response contract is identical for allowlisted vs non-allowlisted users.
test("Stage 7 response contract identical (allowlist vs non-allowlist)", async () => {
  const p = freshEnv7("s7-contract");
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true", WEEKLY_GET_FALLBACK_SKIP_USER_IDS: String(ALLOW_UID) });
  try {
    const a = await (await weeklyGet(w, ALLOW_UID)).json();
    const b = await (await weeklyGet(w, OTHER_UID)).json();
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), "same top-level response shape");
  } finally { await w.stop(); }
});
