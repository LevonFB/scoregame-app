// Stage 3 E2E — Daily Case Backfill V2 against a LOCAL miniflare D1.
// No production D1, no real Telegram/providers. Each scenario uses its own
// persist dir (isolated D1) so job/lock state cannot leak between tests.
//
// Run: node --test e2e/backfill.e2e.test.mjs  (see package.json "test:e2e:backfill")

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
const MATCHDAY = "2026-06-10";
const JOB_KEY = `daily-case-backfill:${MATCHDAY}`;
const NON_LEAGUE_QUESTS = ["dq_full_day", "dq_early_start", "dq_captain", "dq_read_game", "dq_feel_score", "dq_exact_score", "dq_joker_played"];

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
function d1(persist, sql) {
  return wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persist, "--command", sql]);
}
function d1file(persist, file) {
  return wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persist, "--file", file]);
}
function d1num(persist, sql) {
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persist, "--command", sql, "--json"]);
  const m = out.match(/"n"\s*:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

function freshEnv(name) {
  const persist = `.wrangler-e2e-bf-${name}`;
  rmSync(path.join(apiRoot, persist), { recursive: true, force: true });
  d1file(persist, "e2e/fixtures/schema.sql");
  return persist;
}
function seedEligible(persist, userId, questCount = 4, matchday = MATCHDAY) {
  for (let i = 0; i < questCount; i++) {
    d1(persist, `INSERT OR REPLACE INTO daily_quest_progress (day,user_id,quest_id,completed) VALUES ('${matchday}',${userId},'${NON_LEAGUE_QUESTS[i]}',1);`);
  }
}
const caseQty = (p, uid) => d1num(p, `SELECT COALESCE(quantity,0) AS n FROM user_cases WHERE user_id=${uid} AND case_type='daily_free';`);
const txCount = (p, uid) => d1num(p, `SELECT COUNT(*) AS n FROM case_transactions WHERE user_id=${uid};`);
const earned = (p, uid, md = MATCHDAY) => d1num(p, `SELECT COALESCE(earned,-1) AS n FROM daily_cases WHERE user_id=${uid} AND day='${md}';`);
const jobStatusCount = (p, status) => d1num(p, `SELECT COUNT(*) AS n FROM daily_case_backfill_jobs WHERE job_key='${JOB_KEY}' AND status='${status}';`);

async function boot(persist, extraVars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: persist, experimental: { disableExperimentalWarning: true },
    vars: {
      INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: "123:test", ANTI_ABUSE_DISABLE: "true",
      ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_BACKFILL_V2_ENABLED: "true",
      // Isolate the V2 mechanism from the background legacy lazy-insurance sweep
      // (which would otherwise grant cases for any day in its 7-day window).
      // The lazy-fallback behavior itself is covered by the dedicated lazy tests.
      DAILY_CASE_LAZY_FALLBACK_ENABLED: "false",
      ...extraVars,
    },
  });
}
const internalHeaders = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const repair = (md, action) => `/internal/admin/daily-case-backfill/${md}/${action}`;

// --- E2E-3: first successful apply grants exactly one case + one ledger row ---
test("E2E-3 first apply restores one case, one ledger, job completed", async () => {
  const p = freshEnv("apply");
  seedEligible(p, 1001);
  const w = await boot(p);
  try {
    const res = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.restored_cases, 1);
    assert.equal(caseQty(p, 1001), 1);
    assert.equal(txCount(p, 1001), 1);
    assert.equal(earned(p, 1001), 2);
    assert.equal(jobStatusCount(p, "completed"), 1);
  } finally { await w.stop(); }
});

// --- E2E-4: repeating a completed job grants nothing extra ---
test("E2E-4 repeat completed job is a no-op (already_completed)", async () => {
  const p = freshEnv("repeat");
  seedEligible(p, 1001);
  const w = await boot(p);
  try {
    await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const res2 = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const body2 = await res2.json();
    assert.equal(body2.claimed, false);
    assert.equal(body2.decision, "already_completed");
    assert.equal(caseQty(p, 1001), 1);
    assert.equal(txCount(p, 1001), 1);
  } finally { await w.stop(); }
});

// --- E2E-2: dry-run computes eligibility but changes nothing; apply still works ---
test("E2E-2 dry-run is read-only and does not block a later apply", async () => {
  const p = freshEnv("dryrun");
  seedEligible(p, 1001);
  const w = await boot(p);
  try {
    const dr = await w.fetch(repair(MATCHDAY, "dry-run"), { method: "POST", headers: internalHeaders });
    const drBody = await dr.json();
    assert.equal(drBody.would_restore, 1);
    assert.equal(caseQty(p, 1001), 0, "inventory unchanged by dry-run");
    assert.equal(txCount(p, 1001), 0, "no ledger from dry-run");
    const dcRows = d1num(p, `SELECT COUNT(*) AS n FROM daily_cases WHERE user_id=1001 AND day='${MATCHDAY}';`);
    assert.equal(dcRows, 0, "no daily_cases row from dry-run");
    assert.equal(d1num(p, `SELECT COUNT(*) AS n FROM daily_case_backfill_jobs WHERE job_key='${JOB_KEY}';`), 0, "dry-run creates no job row");

    const ap = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const apBody = await ap.json();
    assert.equal(apBody.restored_cases, 1, "apply after dry-run works");
    assert.equal(caseQty(p, 1001), 1);
  } finally { await w.stop(); }
});

// --- E2E-5: two concurrent apply requests grant exactly one case ---
test("E2E-5 concurrent apply grants exactly one case / one ledger", async () => {
  const p = freshEnv("concurrent");
  seedEligible(p, 1001);
  const w = await boot(p);
  try {
    const [r1, r2] = await Promise.all([
      w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders }),
      w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders }),
    ]);
    const [b1, b2] = [await r1.json(), await r2.json()];
    const claimed = [b1, b2].filter((b) => b.claimed !== false);
    assert.ok(claimed.length >= 1, "at least one run claims");
    // The decisive invariant: exactly one case + one ledger regardless of races.
    assert.equal(caseQty(p, 1001), 1);
    assert.equal(txCount(p, 1001), 1);
  } finally { await w.stop(); }
});

// --- E2E-6: retry of a FAILED job restores the rest without duplicates ---
// (HTTP path; deterministic intra-transfer failure is covered in-process by
//  backfillCore.int.test.mjs, since runtime no longer has an env failure hook.)
test("E2E-6 retry of failed job completes remaining without duplicates", async () => {
  const p = freshEnv("retry");
  seedEligible(p, 1001);
  seedEligible(p, 1002);
  seedEligible(p, 1003);
  // Simulate a prior partial run: user 1001 already granted, job left 'failed'.
  d1(p, `INSERT INTO daily_cases (user_id, day, earned, earned_at) VALUES (1001,'${MATCHDAY}',2,1);`);
  d1(p, `INSERT INTO user_cases (user_id, case_type, quantity) VALUES (1001,'daily_free',1);`);
  d1(p, `INSERT INTO case_transactions (user_id, case_type, amount, operation_type, comment, created_at) VALUES (1001,'daily_free',1,'earn','daily_case_backfill_v2',1);`);
  d1(p, `INSERT INTO daily_case_backfill_jobs (job_key, matchday_key, status, run_id, restored_cases, created_at, updated_at) VALUES ('${JOB_KEY}','${MATCHDAY}','failed','R0',1,1,1);`);

  const w = await boot(p);
  try {
    const r = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const b = await r.json();
    assert.equal(b.status, "completed", "failed job is retried to completion");
    // Every eligible user has exactly one case and one ledger row (no duplicate for 1001).
    for (const uid of [1001, 1002, 1003]) {
      assert.equal(caseQty(p, uid), 1, `user ${uid} qty`);
      assert.equal(txCount(p, uid), 1, `user ${uid} ledger`);
    }
  } finally { await w.stop(); }
});

// --- E2E-7: stale running job is safely taken over; case granted once ---
test("E2E-7 stale running job is recovered with a new run_id", async () => {
  const p = freshEnv("stale");
  seedEligible(p, 1001);
  // Inject a stale running job (heartbeat far in the past, old run_id).
  d1(p, `INSERT INTO daily_case_backfill_jobs (job_key, matchday_key, status, run_id, attempts, heartbeat_at, created_at, updated_at) VALUES ('${JOB_KEY}','${MATCHDAY}','running','OLD-RUN-ID',1,1,1,1);`);
  const w = await boot(p, { DAILY_CASE_BACKFILL_STALE_LOCK_MINUTES: "1" });
  try {
    const r = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.restored_cases, 1);
    assert.equal(caseQty(p, 1001), 1);
    const newRunId = d1num(p, `SELECT COUNT(*) AS n FROM daily_case_backfill_jobs WHERE job_key='${JOB_KEY}' AND run_id != 'OLD-RUN-ID';`);
    assert.equal(newRunId, 1, "job now owned by a new run_id");
  } finally { await w.stop(); }
});

// --- E2E-8: already-rewarded user is skipped, no duplicate ---
test("E2E-8 already-rewarded user is skipped_existing", async () => {
  const p = freshEnv("already");
  seedEligible(p, 1001);
  // Pre-mark as already transferred (earned=2) with one existing inventory case.
  d1(p, `INSERT INTO daily_cases (user_id, day, earned, earned_at) VALUES (1001,'${MATCHDAY}',2,1);`);
  d1(p, `INSERT INTO user_cases (user_id, case_type, quantity) VALUES (1001,'daily_free',1);`);
  const w = await boot(p);
  try {
    const r = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const b = await r.json();
    assert.equal(b.restored_cases, 0);
    assert.equal(b.skipped_existing_cases, 1);
    assert.equal(caseQty(p, 1001), 1, "inventory not increased");
  } finally { await w.stop(); }
});

// --- E2E-9: non-eligible user gets nothing; job completes cleanly ---
test("E2E-9 non-eligible user receives no case", async () => {
  const p = freshEnv("noteligible");
  seedEligible(p, 1001, 3); // only 3 quests => not eligible (needs >=4)
  const w = await boot(p);
  try {
    const r = await w.fetch(repair(MATCHDAY, "run"), { method: "POST", headers: internalHeaders });
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.restored_cases, 0);
    assert.equal(caseQty(p, 1001), 0);
    assert.equal(txCount(p, 1001), 0);
  } finally { await w.stop(); }
});

// --- E2E-13: admin/internal auth — unauthenticated rejected, authorized allowed ---
test("E2E-13 internal repair requires trusted internal auth", async () => {
  const p = freshEnv("auth");
  seedEligible(p, 1001);
  const w = await boot(p);
  try {
    for (const action of ["status", "dry-run", "run"]) {
      const method = action === "status" ? "GET" : "POST";
      const unauth = await w.fetch(repair(MATCHDAY, action), { method });
      assert.notEqual(unauth.status, 200, `${action} must reject unauthenticated`);
    }
    const ok = await w.fetch(repair(MATCHDAY, "status"), { method: "GET", headers: internalHeaders });
    assert.equal(ok.status, 200, "authorized internal status allowed");
  } finally { await w.stop(); }
});

// Mirror of computeMatchdayKey/previousMatchdayKey (07:00 MSK = -4h boundary).
function prevMatchday() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  d.setUTCHours(d.getUTCHours() - 4);
  return d.toISOString().slice(0, 10);
}
async function pollCaseQty(p, uid, want, timeoutMs = 8000) {
  const start = Date.now();
  let q = caseQty(p, uid);
  while (q !== want && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    q = caseQty(p, uid);
  }
  return q;
}

// --- E2E-10: lazy fallback after a COMPLETED V2 job does NOT re-scan ---
test("E2E-10 lazy fallback skips legacy scan when V2 job is completed", async () => {
  const md = prevMatchday();
  const p = freshEnv("lazy-completed");
  seedEligible(p, 2001, 4, md);
  // V2 job already completed for the football day the lazy gate targets.
  d1(p, `INSERT INTO daily_case_backfill_jobs (job_key, matchday_key, status, run_id, heartbeat_at, created_at, updated_at, completed_at) VALUES ('daily-case-backfill:${md}','${md}','completed','R1',${Date.now()},1,1,${Date.now()});`);
  const w = await boot(p, { DAILY_CASE_LAZY_FALLBACK_ENABLED: "true" });
  try {
    await w.fetch("/health"); // triggers the lazy gate (waitUntil)
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(caseQty(p, 2001), 0, "completed V2 job => legacy scan skipped, no grant");
  } finally { await w.stop(); }
});

// --- E2E-11b: lazy fallback after a FAILED V2 job runs the legacy backfill ---
test("E2E-11 lazy fallback runs legacy backfill when V2 job failed", async () => {
  const md = prevMatchday();
  const p = freshEnv("lazy-failed");
  seedEligible(p, 2002, 4, md);
  d1(p, `INSERT INTO daily_case_backfill_jobs (job_key, matchday_key, status, run_id, failed_at, created_at, updated_at) VALUES ('daily-case-backfill:${md}','${md}','failed','R1',${Date.now()},1,1);`);
  const w = await boot(p, { DAILY_CASE_LAZY_FALLBACK_ENABLED: "true" });
  try {
    await w.fetch("/health");
    const q = await pollCaseQty(p, 2002, 1);
    assert.equal(q, 1, "failed V2 job + lazy fallback => legacy grants the case");
  } finally { await w.stop(); }
});

// --- E2E-11: invalid matchday is rejected ---
test("E2E-11 invalid matchday is rejected", async () => {
  const p = freshEnv("invalid");
  const w = await boot(p);
  try {
    const r = await w.fetch(repair("2026-13-40", "run"), { method: "POST", headers: internalHeaders });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.error, "INVALID_MATCHDAY");
  } finally { await w.stop(); }
});
