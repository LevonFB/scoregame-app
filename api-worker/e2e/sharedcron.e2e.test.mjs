// Stage 16 E2E — single shared V2 cron dispatcher ("5 * * * *"). Each V2 branch is
// independently feature-flagged; flag off => no D1 work. Weekly + partner run hourly;
// daily backfill runs only in the configured UTC hour-window. Error in one branch must
// not block the others. Local miniflare D1 only.
//
// Run: node --test e2e/sharedcron.e2e.test.mjs (package.json test:e2e:sharedcron)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");
const INTERNAL_SECRET = "e2e-internal-secret";

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1 = (p, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql]);
const d1file = (p, f) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", f]);
const d1num = (p, sql) => { const m = wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--command", sql, "--json"]).match(/"n"\s*:\s*(-?\d+)/); return m ? Number(m[1]) : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NON_LEAGUE_QUESTS = ["dq_full_day", "dq_early_start", "dq_captain", "dq_read_game"];
function prevMatchday() { const d = new Date(); d.setUTCHours(d.getUTCHours() - 4); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
const MD = prevMatchday();
const NOW = Date.now(), PAST = NOW - 60_000;
const past7 = new Date(Date.now() - 7 * 86400000), P7 = past7.toISOString(), P7D = P7.slice(0, 10);

function freshEnv(name) {
  const p = `.wrangler-e2e-shared-${name}`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1file(p, "e2e/fixtures/schema.sql");
  d1file(p, "e2e/fixtures/seed.sql");
  return p;
}
function seedDaily(p, uid) { for (const q of NON_LEAGUE_QUESTS) d1(p, `INSERT OR REPLACE INTO daily_quest_progress (day,user_id,quest_id,completed) VALUES ('${MD}',${uid},'${q}',1);`); }
function seedWeekly(p) { d1(p, `INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('wk7','${P7D}','${P7D}','${P7}','${P7}','FINISHED',1);`); }
function seedPartner(p, uid, amount = 10) {
  d1(p, `INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',${amount},0,'active',${NOW},${NOW});`);
  const cid = d1num(p, `SELECT id AS n FROM partner_campaigns ORDER BY id DESC LIMIT 1;`);
  d1(p, `INSERT OR IGNORE INTO users (id, balls) VALUES (${uid}, 0);`);
  d1(p, `INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (${cid}, ${uid}, 'tok-${cid}-${uid}', 'pending_hold', ${PAST}, ${PAST}, ${NOW}, ${NOW});`);
  const clid = d1num(p, `SELECT id AS n FROM partner_claims ORDER BY id DESC LIMIT 1;`);
  d1(p, `INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (${cid}, ${uid}, ${clid}, 'partner_task_verified', ${PAST});`);
}
const dailyJobs = (p) => d1num(p, `SELECT COUNT(*) AS n FROM daily_case_backfill_jobs;`);
const dailyCase = (p, uid) => d1num(p, `SELECT COALESCE(quantity,0) AS n FROM user_cases WHERE user_id=${uid} AND case_type='daily_free';`);
const weeklyJobs = (p) => d1num(p, `SELECT COUNT(*) AS n FROM weekly_finalizer_jobs WHERE status='completed';`);
const weeklyFinal = (p) => d1num(p, `SELECT COUNT(*) AS n FROM weekly_finalizations;`);
const partnerBalls = (p, uid) => d1num(p, `SELECT COALESCE(balls,0) AS n FROM users WHERE id=${uid};`);

const HOUR = new Date().getUTCHours();
async function boot(p, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: "1:t", ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: "1", ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false", DAILY_CASE_BACKFILL_HOUR_UTC: String(HOUR), ...vars },
  });
}
const trigger = (w) => w.fetch("/cdn-cgi/handler/scheduled?cron=5+*+*+*+*", { method: "POST" });
const ALL_V2 = { DAILY_CASE_BACKFILL_V2_ENABLED: "true", WEEKLY_FINALIZER_V2_ENABLED: "true", PARTNER_CLAIMS_V2_ENABLED: "true" };

// (1) All V2 off → dispatcher completes, NO V2 D1 work (V2 job tables stay empty).
// Note: the always-on LEGACY partner/weekly sweeps run on every tick regardless (that
// is unchanged current behavior); "0 V2 work" is asserted via the V2-specific job tables.
test("all V2 off: shared cron completes, zero V2 job rows", async () => {
  const p = freshEnv("off"); seedDaily(p, 9001); seedWeekly(p);
  const w = await boot(p, {});
  try {
    assert.equal((await trigger(w)).status, 200);
    await sleep(1500);
    assert.equal(dailyJobs(p), 0, "no daily V2 job created");
    assert.equal(weeklyJobs(p), 0, "no weekly V2 job created");
  } finally { await w.stop(); }
});

// (2) Daily only: out-of-window skip; in-window one job; repeat no extra.
test("daily V2 only: out-of-window skip, in-window once, repeat no dup", async () => {
  const pOut = freshEnv("daily-out"); seedDaily(pOut, 9101);
  const wOut = await boot(pOut, { DAILY_CASE_BACKFILL_V2_ENABLED: "true", DAILY_CASE_BACKFILL_HOUR_UTC: String((HOUR + 1) % 24) });
  try { await trigger(wOut); await sleep(1200); assert.equal(dailyJobs(pOut), 0, "out-of-window: daily branch skipped"); } finally { await wOut.stop(); }

  const p = freshEnv("daily-in"); seedDaily(p, 9102);
  const w = await boot(p, { DAILY_CASE_BACKFILL_V2_ENABLED: "true" });
  try {
    await trigger(w); await sleep(1800);
    assert.equal(dailyJobs(p), 1, "in-window: one job");
    assert.equal(dailyCase(p, 9102), 1, "one case granted");
    await trigger(w); await sleep(1500);
    assert.equal(dailyCase(p, 9102), 1, "repeat: no extra case");
  } finally { await w.stop(); }
});

// (3) Weekly only: one completed job; repeat no dup.
test("weekly V2 only: one finalization; repeat no dup", async () => {
  const p = freshEnv("weekly"); seedWeekly(p);
  const w = await boot(p, { WEEKLY_FINALIZER_V2_ENABLED: "true" });
  try {
    await trigger(w);
    const s = Date.now(); while (weeklyFinal(p) < 1 && Date.now() - s < 10000) await sleep(400);
    assert.equal(weeklyFinal(p), 1, "one finalization");
    await trigger(w); await sleep(1500);
    assert.equal(weeklyFinal(p), 1, "repeat: no dup");
  } finally { await w.stop(); }
});

// (4) Partner only: pending claim processed; repeat no dup.
test("partner V2 only: claim processed; repeat no dup", async () => {
  const p = freshEnv("partner"); seedPartner(p, 9201, 15);
  const w = await boot(p, { PARTNER_CLAIMS_V2_ENABLED: "true" });
  try {
    await trigger(w);
    const s = Date.now(); while (partnerBalls(p, 9201) < 15 && Date.now() - s < 10000) await sleep(400);
    assert.equal(partnerBalls(p, 9201), 15, "claim granted");
    await trigger(w); await sleep(1500);
    assert.equal(partnerBalls(p, 9201), 15, "repeat: no dup");
  } finally { await w.stop(); }
});

// (5) All three independently; error in one branch does not block the others.
test("all three V2 run independently; error isolation", async () => {
  const p = freshEnv("all"); seedDaily(p, 9301); seedWeekly(p); seedPartner(p, 9302, 12);
  const w = await boot(p, ALL_V2);
  try {
    await trigger(w);
    const s = Date.now(); while ((weeklyFinal(p) < 1 || partnerBalls(p, 9302) < 12 || dailyCase(p, 9301) < 1) && Date.now() - s < 12000) await sleep(400);
    assert.equal(dailyCase(p, 9301), 1, "daily branch ran");
    assert.equal(weeklyFinal(p), 1, "weekly branch ran");
    assert.equal(partnerBalls(p, 9302), 12, "partner branch ran");
  } finally { await w.stop(); }

  // Error isolation: drop the DAILY job table → daily V2 branch fails (and lazy fallback
  // is off, so NO case is granted) while weekly + partner still complete. dailyCase is a
  // V2-specific signal here (legacy lazy backfill is disabled), unlike weekly_finalizations
  // which the always-on legacy finalize would also write.
  const p2 = freshEnv("iso"); seedDaily(p2, 9311); seedWeekly(p2); seedPartner(p2, 9312, 8);
  d1(p2, `DROP TABLE IF EXISTS daily_case_backfill_jobs;`);
  const w2 = await boot(p2, ALL_V2);
  try {
    await trigger(w2);
    const s = Date.now(); while ((partnerBalls(p2, 9312) < 8 || weeklyJobs(p2) < 1) && Date.now() - s < 12000) await sleep(400);
    assert.equal(weeklyJobs(p2), 1, "weekly V2 ran despite daily error");
    assert.equal(partnerBalls(p2, 9312), 8, "partner V2 ran despite daily error");
    assert.equal(dailyCase(p2, 9311), 0, "daily V2 failed (no job table); no case granted");
  } finally { await w2.stop(); }
});

// (6) Concurrent shared cron: job locks + idempotency hold.
test("concurrent shared cron: locks/idempotency preserved", async () => {
  const p = freshEnv("conc"); seedDaily(p, 9401); seedWeekly(p); seedPartner(p, 9402, 9);
  const w = await boot(p, ALL_V2);
  try {
    await Promise.all([trigger(w), trigger(w)]);
    const s = Date.now(); while ((weeklyFinal(p) < 1 || partnerBalls(p, 9402) < 9 || dailyCase(p, 9401) < 1) && Date.now() - s < 12000) await sleep(400);
    await sleep(1500);
    assert.equal(weeklyFinal(p), 1, "exactly one finalization");
    assert.equal(dailyCase(p, 9401), 1, "exactly one case");
    assert.equal(partnerBalls(p, 9402), 9, "exactly one partner grant");
  } finally { await w.stop(); }
});

// (7) Total cron triggers ≤ 5 (api + bot).
test("total cron triggers across workers ≤ 5", () => {
  const apiToml = readFileSync(path.join(apiRoot, "wrangler.toml"), "utf8");
  const botToml = readFileSync(path.join(repoRoot, "bot-worker", "wrangler.toml"), "utf8");
  const countCrons = (toml) => {
    const m = toml.match(/crons\s*=\s*\[([^\]]*)\]/);
    if (!m) return 0;
    return (m[1].match(/"/g) || []).length / 2;
  };
  const api = countCrons(apiToml), bot = countCrons(botToml);
  assert.ok(api >= 1 && bot >= 1, `api=${api} bot=${bot}`);
  assert.ok(api + bot <= 5, `total crons ${api}+${bot}=${api + bot} must be ≤ 5`);
  assert.equal(api, 3, "api: */10, 1 0, shared 5"); // exact post-Stage-16 set
  assert.equal(bot, 1, "bot: */2");
});
