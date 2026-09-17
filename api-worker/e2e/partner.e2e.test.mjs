// Stage 8 E2E — partner claims V2: targeted processing, hourly sweep, legacy
// fallback, internal repair, idempotency/atomicity. Local miniflare D1 only.
//
// Run: node --test e2e/partner.e2e.test.mjs (package.json test:e2e:partner)

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
const BOT_TOKEN = "123456:E2E-TEST-TOKEN";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Date.now();
const PAST = NOW - 60_000;

function freshEnv(name) {
  const p = `.wrangler-e2e-partner-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  return p;
}
// Seed a due, verified-ready pending_hold balls claim (telegram_bot_start verifies by
// the presence of a 'partner_task_verified' event). Returns claim id.
function seedDueClaim(p, { user, amount = 10, holdUntil = PAST, maxTotal = "NULL" } = {}) {
  d1(p, `INSERT OR IGNORE INTO users (id, balls) VALUES (${user}, 0);`);
  d1(p, `INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, max_total_claims, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',${amount},0,${maxTotal},'active',${NOW},${NOW});`);
  const cid = d1num(p, `SELECT id AS n FROM partner_campaigns ORDER BY id DESC LIMIT 1;`);
  d1(p, `INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (${cid}, ${user}, 'tok-${cid}-${user}', 'pending_hold', ${holdUntil}, ${PAST}, ${NOW}, ${NOW});`);
  const clid = d1num(p, `SELECT id AS n FROM partner_claims ORDER BY id DESC LIMIT 1;`);
  d1(p, `INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (${cid}, ${user}, ${clid}, 'partner_task_verified', ${PAST});`);
  return clid;
}
const balls = (p, uid) => d1num(p, `SELECT balls AS n FROM users WHERE id=${uid};`);
const claimStatus = (p, id) => {
  const out = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", `SELECT status FROM partner_claims WHERE id=${id};`, "--json"]);
  const m = out.match(/"status"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
};
const ledgerCount = (p, id) => d1num(p, `SELECT COUNT(*) AS n FROM partner_reward_logs WHERE claim_id=${id};`);
const completedLedgers = (p) => d1num(p, `SELECT COUNT(*) AS n FROM partner_reward_logs WHERE status='completed';`);

async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", ...vars },
  });
}
const internal = { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "admin" };
const triggerCron = (w, cron) => w.fetch(`/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}`, { method: "POST" });
const FREQ = "*/10 * * * *";
// Stage 16: partner sweep now runs via the shared V2 dispatcher (was the dedicated "7 * * * *").
const SWEEP = "5 * * * *";
async function waitBalls(p, uid, want, timeoutMs = 10000) {
  const s = Date.now();
  while (balls(p, uid) < want && Date.now() - s < timeoutMs) await sleep(400);
  return balls(p, uid);
}

// (1) Default: V2 off → frequent cron runs legacy sweep and processes the due claim.
test("default (V2 off): frequent cron legacy sweep processes due claim", async () => {
  const p = freshEnv("default");
  const clid = seedDueClaim(p, { user: 800 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "false" });
  try {
    await triggerCron(w, FREQ);
    assert.equal(await waitBalls(p, 800, 10), 10, "legacy sweep granted reward");
    assert.equal(claimStatus(p, clid), "completed");
  } finally { await w.stop(); }
});

// (2)+(3) Targeted internal run processes one claim; repeat does not double-grant.
test("targeted internal run grants once; repeat no duplicate", async () => {
  const p = freshEnv("targeted");
  const clid = seedDueClaim(p, { user: 801 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    const r1 = await w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal });
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).processed, true);
    assert.equal(balls(p, 801), 10);
    const r2 = await w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal });
    assert.equal(r2.status, 200);
    assert.equal(balls(p, 801), 10, "no double grant");
    assert.equal(ledgerCount(p, clid), 1);
  } finally { await w.stop(); }
});

// (4) Two concurrent runs → exactly one reward.
test("two concurrent targeted runs → one reward", async () => {
  const p = freshEnv("concurrent");
  const clid = seedDueClaim(p, { user: 802 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    await Promise.all([
      w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal }),
      w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal }),
    ]);
    await sleep(300);
    assert.equal(balls(p, 802), 10, "exactly one reward");
    assert.equal(ledgerCount(p, clid), 1);
  } finally { await w.stop(); }
});

// (5)+(6) Hourly sweep processes pending claim; repeat sweep no duplicate.
test("hourly sweep processes due claim; repeat adds no duplicate", async () => {
  const p = freshEnv("sweep");
  seedDueClaim(p, { user: 803, amount: 15 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    await triggerCron(w, SWEEP);
    assert.equal(await waitBalls(p, 803, 15), 15, "sweep granted");
    await triggerCron(w, SWEEP);
    await sleep(600);
    assert.equal(balls(p, 803), 15, "repeat sweep no duplicate");
    assert.equal(completedLedgers(p), 1);
  } finally { await w.stop(); }
});

// (7) Batch limit respected: small batch still drains all due via keyset pages.
test("batch limit respected (keyset drains all due)", async () => {
  const p = freshEnv("batch");
  for (let i = 0; i < 5; i++) seedDueClaim(p, { user: 810 + i, amount: 5 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true", PARTNER_CLAIMS_BATCH_SIZE: "2" });
  try {
    await triggerCron(w, SWEEP);
    await sleep(800);
    assert.equal(completedLedgers(p), 5, "all 5 drained across keyset pages of 2");
  } finally { await w.stop(); }
});

// (8) One invalid claim does not block the rest of the batch.
test("one invalid claim does not block the batch", async () => {
  const p = freshEnv("invalid");
  const good1 = seedDueClaim(p, { user: 820, amount: 7 });
  // Bad claim: due pending_hold but NO verified event AND campaign points to missing
  // case type via a broken reward → verification fails → marked failed, others proceed.
  d1(p, `INSERT OR IGNORE INTO users (id, balls) VALUES (821, 0);`);
  d1(p, `INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',7,0,'active',${NOW},${NOW});`);
  const badCid = d1num(p, `SELECT id AS n FROM partner_campaigns ORDER BY id DESC LIMIT 1;`);
  d1(p, `INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (${badCid}, 821, 'tok-bad', 'pending_hold', ${PAST}, ${PAST}, ${NOW}, ${NOW});`);
  // no partner_task_verified event → verification not verified → claim revoked, no reward
  const good2 = seedDueClaim(p, { user: 822, amount: 9 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    await triggerCron(w, SWEEP);
    await sleep(800);
    assert.equal(balls(p, 820), 7, "good claim 1 processed");
    assert.equal(balls(p, 822), 9, "good claim 2 processed");
    assert.equal(balls(p, 821), 0, "bad claim granted nothing");
  } finally { await w.stop(); }
});

// (9) Partial failure (ledger pending, claim verified) + retry resumes exactly once.
test("partial failure + retry resumes once", async () => {
  const p = freshEnv("partial");
  const clid = seedDueClaim(p, { user: 830, amount: 12 });
  // Simulate a crash mid-grant: claim verified, ledger pending, balls not applied.
  const cid = d1num(p, `SELECT campaign_id AS n FROM partner_claims WHERE id=${clid};`);
  d1(p, `UPDATE partner_claims SET status='verified' WHERE id=${clid};`);
  d1(p, `INSERT INTO partner_reward_logs (claim_id, campaign_id, user_id, reward_type, reward_amount, status, created_at) VALUES (${clid}, ${cid}, 830, 'balls', 12, 'pending', ${NOW});`);
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    const r = await w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal });
    assert.equal((await r.json()).processed, true);
    assert.equal(balls(p, 830), 12, "resumed exactly once");
    // retry again → no further grant
    await w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST", headers: internal });
    assert.equal(balls(p, 830), 12);
  } finally { await w.stop(); }
});

// (10) V2 failure / lag + legacy fallback: overdue due claim → frequent cron fallback.
test("V2 on + overdue claim → frequent cron legacy fallback processes it", async () => {
  const p = freshEnv("fallback");
  // hold elapsed far in the past (overdue beyond default 120 min) → fallback trigger.
  const clid = seedDueClaim(p, { user: 840, amount: 8, holdUntil: NOW - 5 * 60 * 60 * 1000 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true", PARTNER_CLAIMS_LEGACY_CRON_FALLBACK_ENABLED: "true" });
  try {
    await triggerCron(w, FREQ); // frequent cron: V2 skips heavy sweep, but overdue → legacy fallback
    assert.equal(await waitBalls(p, 840, 8), 8, "legacy fallback processed overdue claim");
    assert.equal(claimStatus(p, clid), "completed");
  } finally { await w.stop(); }
});

// (10b) V2 on, no overdue, fallback path NOT triggered on frequent cron (claim stays pending).
test("V2 on + not overdue → frequent cron does NOT run heavy legacy sweep", async () => {
  const p = freshEnv("nofallback");
  // hold elapsed recently (due) but NOT overdue beyond 120 min → frequent cron skips.
  seedDueClaim(p, { user: 841, amount: 8, holdUntil: NOW - 10_000 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    await triggerCron(w, FREQ);
    await sleep(800);
    assert.equal(balls(p, 841), 0, "frequent cron did not process (waits for hourly sweep)");
    // the hourly sweep DOES process it
    await triggerCron(w, SWEEP);
    assert.equal(await waitBalls(p, 841, 8), 8, "hourly sweep processed it");
  } finally { await w.stop(); }
});

// (11) Dry-run changes nothing.
test("internal dry-run makes no writes", async () => {
  const p = freshEnv("dryrun");
  const clid = seedDueClaim(p, { user: 850, amount: 11 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    const r = await w.fetch(`/internal/admin/partner-claim/${clid}/dry-run`, { method: "POST", headers: internal });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.would_process, true);
    assert.equal(body.due, "due");
    assert.equal(balls(p, 850), 0, "dry-run wrote nothing");
    assert.equal(ledgerCount(p, clid), 0);
  } finally { await w.stop(); }
});

// (12) Internal endpoints are auth-protected.
test("internal partner-claim endpoints require trusted internal auth", async () => {
  const p = freshEnv("auth");
  const clid = seedDueClaim(p, { user: 860 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    assert.notEqual((await w.fetch(`/internal/admin/partner-claim/${clid}/status`, { method: "GET" })).status, 200, "unauth rejected");
    assert.notEqual((await w.fetch(`/internal/admin/partner-claim/${clid}/run`, { method: "POST" })).status, 200, "unauth run rejected");
    const ok = await w.fetch(`/internal/admin/partner-claim/${clid}/status`, { method: "GET", headers: internal });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).due, "due");
    assert.equal(balls(p, 860), 0, "status is read-only");
  } finally { await w.stop(); }
});

// (13) Internal status contract stable (keys present).
test("internal status response shape stable", async () => {
  const p = freshEnv("contract");
  const clid = seedDueClaim(p, { user: 870 });
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    const r = await w.fetch(`/internal/admin/partner-claim/${clid}/status`, { method: "GET", headers: internal });
    const body = await r.json();
    assert.deepEqual(Object.keys(body).sort(), ["claim_id", "claim_status", "due", "found", "ok", "reward_log"].sort());
  } finally { await w.stop(); }
});
