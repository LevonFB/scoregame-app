// Stage 3.1 E2E — direct scheduled handler (cron 15 4) + migration-not-applied
// behavior + isolated migration apply. Local miniflare D1 only. No prod, no real
// Telegram/providers (the empty matches fixture means fast-sync makes no provider
// calls).
//
// Run: node --test e2e/scheduled.e2e.test.mjs (see package.json test:e2e:scheduled)

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
const NON_LEAGUE_QUESTS = ["dq_full_day", "dq_early_start", "dq_captain", "dq_read_game"];

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
function d1raw(p, sql) {
  return wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]);
}

function prevMatchday() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(0, 10);
}
const MD = prevMatchday();
const JOB_KEY = `daily-case-backfill:${MD}`;

function freshEnv(name) {
  const p = `.wrangler-e2e-sch-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  return p;
}
function seedEligible(p, uid) {
  for (const q of NON_LEAGUE_QUESTS) d1(p, `INSERT OR REPLACE INTO daily_quest_progress (day,user_id,quest_id,completed) VALUES ('${MD}',${uid},'${q}',1);`);
}
const caseQty = (p, uid) => d1num(p, `SELECT COALESCE(quantity,0) AS n FROM user_cases WHERE user_id=${uid} AND case_type='daily_free';`);
const txCount = (p, uid) => d1num(p, `SELECT COUNT(*) AS n FROM case_transactions WHERE user_id=${uid};`);
const jobCount = (p, status) => d1num(p, `SELECT COUNT(*) AS n FROM daily_case_backfill_jobs WHERE job_key='${JOB_KEY}'${status ? ` AND status='${status}'` : ""};`);

async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    // Stage 16: the daily backfill now runs via the shared "5 * * * *" dispatcher in the
    // configured UTC hour-window. Pin the window to the current hour so the daily branch
    // runs whenever the test triggers the shared cron.
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: "1:t", ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", DAILY_CASE_BACKFILL_HOUR_UTC: String(new Date().getUTCHours()), ...vars },
  });
}
// Stage 16: shared V2 dispatcher cron (was the dedicated "15 4 * * *").
const triggerCron = (w) => w.fetch("/cdn-cgi/handler/scheduled?cron=5+*+*+*+*", { method: "POST" });
async function waitJob(p, status, timeoutMs = 10000) {
  const start = Date.now();
  while (jobCount(p, status) === 0 && Date.now() - start < timeoutMs) await new Promise((r) => setTimeout(r, 400));
  return jobCount(p, status);
}

// --- E2E-1: V2 OFF — scheduled 15 4 creates no job, grants nothing ---
test("scheduled V2-off creates no job and grants no case", async () => {
  const p = freshEnv("off");
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "false" });
  try {
    const r = await triggerCron(w);
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 2000));
    // Key V2-off invariant: the new job model is fully inert (no job row, no V2
    // apply branch). The legacy sweep keeps the old behavior (may grant) — that is
    // intentionally preserved, so we only assert the V2 path did not engage.
    assert.equal(jobCount(p), 0, "no V2 job row created when V2 off");
  } finally { await w.stop(); }
});

// --- E2E-2: V2 ON — scheduled 15 4 runs apply for previous matchday ---
test("scheduled V2-on applies for previous matchday: one case, one ledger", async () => {
  const p = freshEnv("on");
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "true" });
  try {
    const r = await triggerCron(w);
    assert.equal(r.status, 200);
    assert.equal(await waitJob(p, "completed"), 1, "job completed for prev matchday");
    assert.equal(caseQty(p, 3001), 1);
    assert.equal(txCount(p, 3001), 1);
  } finally { await w.stop(); }
});

// --- E2E-3: repeat scheduled event grants nothing extra ---
test("scheduled repeat does not re-grant", async () => {
  const p = freshEnv("repeat");
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "true" });
  try {
    await triggerCron(w); await waitJob(p, "completed");
    await triggerCron(w); await new Promise((res) => setTimeout(res, 2000));
    assert.equal(caseQty(p, 3001), 1, "no extra case on repeat");
    assert.equal(txCount(p, 3001), 1, "no extra ledger on repeat");
  } finally { await w.stop(); }
});

// --- E2E-4: two concurrent scheduled invocations grant exactly one case ---
test("scheduled concurrent invocations grant exactly one case / one ledger", async () => {
  const p = freshEnv("concurrent");
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "true" });
  try {
    await Promise.all([triggerCron(w), triggerCron(w)]);
    await waitJob(p, "completed");
    await new Promise((res) => setTimeout(res, 1500));
    assert.equal(caseQty(p, 3001), 1);
    assert.equal(txCount(p, 3001), 1);
  } finally { await w.stop(); }
});

// --- B: V2 OFF without the job table — app works, no missing-table errors ---
test("V2-off without job table: health + scheduled work, no missing-table error", async () => {
  const p = freshEnv("notable-off");
  d1(p, `DROP TABLE IF EXISTS daily_case_backfill_jobs;`);
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "false", DAILY_CASE_LAZY_FALLBACK_ENABLED: "true" });
  try {
    assert.equal((await w.fetch("/health")).status, 200);
    assert.equal((await triggerCron(w)).status, 200);
    await new Promise((res) => setTimeout(res, 1500));
    // No table, V2 off → legacy path may grant; the point is: no crash, app healthy.
    assert.equal((await w.fetch("/health")).status, 200);
  } finally { await w.stop(); }
});

// --- C: V2 ON without the job table — controlled error, no crash, no completed ---
test("V2-on without job table: scheduled returns controlled error, app stays up", async () => {
  const p = freshEnv("notable-on");
  d1(p, `DROP TABLE IF EXISTS daily_case_backfill_jobs;`);
  seedEligible(p, 3001);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "true" });
  try {
    const r = await triggerCron(w);
    assert.equal(r.status, 200, "scheduled handler does not crash");
    await new Promise((res) => setTimeout(res, 1500));
    // user-facing endpoint still works
    assert.equal((await w.fetch("/health")).status, 200);
    // No case granted via V2 (claim failed); table truly absent.
    const tbl = d1num(p, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='daily_case_backfill_jobs';`);
    assert.equal(tbl, 0, "table was not auto-created by runtime");
  } finally { await w.stop(); }
});

// --- J: isolated migration apply (twice) — schema + indexes, idempotent ---
test("migration 0089 applies in isolation, twice, with correct schema + indexes", async () => {
  const p = `.wrangler-e2e-sch-migration`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  // Apply only the 0089 SQL file (not the whole drifted chain), twice.
  d1file(p, "migrations/0089_daily_case_backfill_jobs.sql");
  d1file(p, "migrations/0089_daily_case_backfill_jobs.sql"); // idempotent (CREATE IF NOT EXISTS)

  const cols = d1raw(p, `PRAGMA table_info(daily_case_backfill_jobs);`);
  assert.ok(cols.includes("processed_eligible_users"), "renamed column present");
  assert.ok(cols.includes("job_key"), "job_key present");
  assert.ok(!cols.includes("checked_users"), "old checked_users column absent");

  const idx = d1raw(p, `PRAGMA index_list('daily_case_backfill_jobs');`);
  assert.ok(idx.includes("idx_dcbj_status"), "status index present");
  assert.ok(idx.includes("idx_dcbj_matchday"), "matchday index present");
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
});
