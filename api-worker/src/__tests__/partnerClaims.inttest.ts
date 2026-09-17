import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { runPartnerSweepCore, type PartnerSweepClaim } from "../partnerClaimsCore";
import { processSinglePartnerClaim, runPartnerClaimsSweepV2 } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-partner");
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;

const NOW = Date.now();
const PAST = NOW - 60_000; // hold elapsed

async function schema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 't', task_type TEXT NOT NULL, reward_type TEXT NOT NULL, reward_amount INTEGER NOT NULL DEFAULT 0, reward_payload_json TEXT, hold_hours INTEGER NOT NULL DEFAULT 0, max_total_claims INTEGER, max_claims_per_user INTEGER NOT NULL DEFAULT 1, completed_claims_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, user_id INTEGER NOT NULL, verify_token TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'started', started_at INTEGER, verified_at INTEGER, hold_until INTEGER, completed_at INTEGER, reward_granted_at INTEGER, failed_reason TEXT, verification_payload_json TEXT, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, UNIQUE(campaign_id, user_id), UNIQUE(verify_token))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_events (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, user_id INTEGER NOT NULL, claim_id INTEGER, event_type TEXT NOT NULL, payload_json TEXT, created_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS partner_reward_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id INTEGER NOT NULL, campaign_id INTEGER NOT NULL, user_id INTEGER NOT NULL, reward_type TEXT NOT NULL, reward_amount INTEGER NOT NULL DEFAULT 0, reward_payload_json TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL DEFAULT 0, UNIQUE(claim_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, payload_json TEXT, admin_id INTEGER, created_at INTEGER)`),
    // Case-reward inventory tables — real grantCaseToInventory() writes here (no user_partner_rewards).
    db.prepare(`CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER NOT NULL, case_type TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, case_type))`),
    // case_transactions incl. the additive idempotency_key (migration 0101) + its partial unique index.
    db.prepare(`CREATE TABLE IF NOT EXISTS case_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, case_type TEXT NOT NULL, amount INTEGER NOT NULL, quantity_before INTEGER NOT NULL, quantity_after INTEGER NOT NULL, operation_type TEXT NOT NULL, comment TEXT, admin_user_id INTEGER, created_at INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_case_transactions_idempotency_key ON case_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL`),
  ]);
}

// Seed a verified-ready, due pending_hold balls claim. telegram_bot_start verifies
// by the presence of a 'partner_task_verified' event.
async function seedDueClaim(userId: number, amount = 10, opts: { maxTotal?: number } = {}) {
  await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(userId).run();
  const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, max_total_claims, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',?,0,?,'active',?,?)`).bind(amount, opts.maxTotal ?? null, NOW, NOW).run();
  const campaignId = Number(c.meta.last_row_id);
  const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'pending_hold', ?, ?, ?, ?)`).bind(campaignId, userId, `tok-${campaignId}-${userId}`, PAST, PAST, NOW, NOW).run();
  const claimId = Number(cl.meta.last_row_id);
  await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, userId, claimId, PAST).run();
  return { campaignId, claimId };
}

const balls = async (uid: number) => Number((await db.prepare(`SELECT balls FROM users WHERE id=?`).bind(uid).first() as any)?.balls ?? 0);
const claimStatus = async (id: number) => String(((await db.prepare(`SELECT status FROM partner_claims WHERE id=?`).bind(id).first()) as any)?.status ?? "");
const logStatus = async (id: number) => String(((await db.prepare(`SELECT status FROM partner_reward_logs WHERE claim_id=?`).bind(id).first()) as any)?.status ?? "none");
const ledgerCount = async (id: number) => Number(((await db.prepare(`SELECT COUNT(*) AS n FROM partner_reward_logs WHERE claim_id=?`).bind(id).first()) as any)?.n ?? 0);
const caseQty = async (uid: number, ct = "premium") => Number(((await db.prepare(`SELECT quantity FROM user_cases WHERE user_id=? AND case_type=?`).bind(uid, ct).first()) as any)?.quantity ?? 0);
const caseTxnCount = async (uid: number) => Number(((await db.prepare(`SELECT COUNT(*) AS n FROM case_transactions WHERE user_id=?`).bind(uid).first()) as any)?.n ?? 0);
const userPartnerRewardsTableExists = async () => Number(((await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='user_partner_rewards'`).first()) as any)?.n ?? 0);
const campaignCounter = async (cid: number) => Number(((await db.prepare(`SELECT completed_claims_count FROM partner_campaigns WHERE id=?`).bind(cid).first()) as any)?.completed_claims_count ?? 0);

// Seed a verified-ready, due pending_hold CASE claim (reward_type='case' + caseType in payload).
async function seedDueCaseClaim(userId: number, caseType = "premium", amount = 1, opts: { maxTotal?: number | null } = {}) {
  await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(userId).run();
  const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, reward_payload_json, hold_hours, max_total_claims, status, created_at, updated_at) VALUES ('telegram_bot_start','case',?,?,0,?,'active',?,?)`).bind(amount, JSON.stringify({ caseType }), opts.maxTotal ?? null, NOW, NOW).run();
  const campaignId = Number(c.meta.last_row_id);
  const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'pending_hold', ?, ?, ?, ?)`).bind(campaignId, userId, `tok-case-${campaignId}-${userId}`, PAST, PAST, NOW, NOW).run();
  const claimId = Number(cl.meta.last_row_id);
  await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, userId, claimId, PAST).run();
  return { campaignId, claimId };
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db, TELEGRAM_BOT_TOKEN: "x", PARTNER_CLAIMS_V2_ENABLED: "true" };
  await schema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(async () => {
  await db.batch([
    db.prepare(`DELETE FROM partner_reward_logs`),
    db.prepare(`DELETE FROM partner_events`),
    db.prepare(`DELETE FROM partner_claims`),
    db.prepare(`DELETE FROM partner_campaigns`),
    db.prepare(`DELETE FROM user_cases`),
    db.prepare(`DELETE FROM case_transactions`),
    db.prepare(`DELETE FROM users`),
  ]);
});

// ── Sweep core (DB-agnostic): keyset, batch limit, isolation ──
describe("partner sweep core (keyset/batch/isolation)", () => {
  const params = { batchSize: 3, maxPages: 20, overdueMs: 0 };
  const makeClaims = (n: number): PartnerSweepClaim[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, campaign_id: 1, user_id: 100 + i, status: "pending_hold", hold_until: PAST }));

  it("keyset paginates and drains all via cursor", async () => {
    const all = makeClaims(7);
    const seen: number[] = [];
    const r = await runPartnerSweepCore(params, {
      trigger: "t",
      listDuePage: async (cursor, limit) => all.filter((c) => c.id > cursor).slice(0, limit),
      processOne: async (c) => { seen.push(c.id); return { ok: true }; },
    });
    expect(r.processed).toBe(7);
    expect(r.granted).toBe(7);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("batch size bounds a single page; maxPages caps total work", async () => {
    const all = makeClaims(100);
    const r = await runPartnerSweepCore({ batchSize: 3, maxPages: 2, overdueMs: 0 }, {
      trigger: "t",
      listDuePage: async (cursor, limit) => all.filter((c) => c.id > cursor).slice(0, limit),
      processOne: async () => ({ ok: true }),
    });
    expect(r.processed).toBe(6); // 2 pages * batch 3
    expect(r.has_more).toBe(true);
  });

  it("one invalid claim does not block the batch", async () => {
    const all = makeClaims(4);
    const r = await runPartnerSweepCore(params, {
      trigger: "t",
      listDuePage: async (cursor, limit) => all.filter((c) => c.id > cursor).slice(0, limit),
      processOne: async (c) => { if (c.id === 2) throw new Error("bad"); return { ok: true }; },
    });
    expect(r.granted).toBe(3);
    expect(r.failed).toBe(1);
  });
});

// ── Real D1: idempotency / atomicity of balls grant ──
describe("partner targeted grant (real D1, balls atomic+idempotent)", () => {
  it("first apply grants once; claim+ledger completed", async () => {
    const { claimId } = await seedDueClaim(500, 10);
    const r = await processSinglePartnerClaim(env, claimId, { trigger: "t" });
    expect(r.ok).toBe(true);
    expect(await balls(500)).toBe(10);
    expect(await claimStatus(claimId)).toBe("completed");
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("repeat does not double-grant", async () => {
    const { claimId } = await seedDueClaim(501, 10);
    await processSinglePartnerClaim(env, claimId, { trigger: "t" });
    const second = await processSinglePartnerClaim(env, claimId, { trigger: "t" });
    expect(second.ok).toBe(false); // already completed → not_pending
    expect(await balls(501)).toBe(10);
    expect(await ledgerCount(claimId)).toBe(1);
  });

  it("two concurrent applies grant exactly once", async () => {
    const { claimId } = await seedDueClaim(502, 10);
    await Promise.all([
      processSinglePartnerClaim(env, claimId, { trigger: "a" }),
      processSinglePartnerClaim(env, claimId, { trigger: "b" }),
    ]);
    expect(await balls(502)).toBe(10);
    expect(await ledgerCount(claimId)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("partial failure (ledger pending, claim verified) → retry resumes once", async () => {
    const { campaignId, claimId } = await seedDueClaim(503, 10);
    // Simulate a crash mid-grant: claim verified, ledger pending, balls NOT applied.
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();
    await db.prepare(`INSERT INTO partner_reward_logs (claim_id, campaign_id, user_id, reward_type, reward_amount, status, created_at) VALUES (?, ?, 503, 'balls', 10, 'pending', ?)`).bind(claimId, campaignId, NOW).run();
    const r = await processSinglePartnerClaim(env, claimId, { trigger: "retry" });
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("resumed_verified");
    expect(await balls(503)).toBe(10); // exactly once
    expect(await logStatus(claimId)).toBe("completed");
    // retry again → no further grant
    await processSinglePartnerClaim(env, claimId, { trigger: "retry2" });
    expect(await balls(503)).toBe(10);
  });

  it("not-yet-due hold is skipped (no work)", async () => {
    const { claimId } = await seedDueClaim(504, 10);
    await db.prepare(`UPDATE partner_claims SET hold_until=? WHERE id=?`).bind(NOW + 3_600_000, claimId).run();
    const r = await processSinglePartnerClaim(env, claimId, { trigger: "t" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_due");
    expect(await balls(504)).toBe(0);
  });

  it("removed reward_type (custom/cosmetic) → controlled failure, no payout", async () => {
    // Only 'balls' and 'case' are supported partner reward types. A campaign carrying a
    // no-longer-supported reward_type (e.g. a legacy 'custom' row) must never pay out:
    // grantPartnerCampaignReward throws PARTNER_REWARD_TYPE_NOT_ALLOWED → the reward log is
    // marked 'failed', the claim is NOT completed and no balance/inventory changes.
    const userId = 505;
    await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(userId).run();
    const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, status, created_at, updated_at) VALUES ('telegram_bot_start','custom',10,0,'active',?,?)`).bind(NOW, NOW).run();
    const campaignId = Number(c.meta.last_row_id);
    const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'pending_hold', ?, ?, ?, ?)`).bind(campaignId, userId, `tok-c-${userId}`, PAST, PAST, NOW, NOW).run();
    const claimId = Number(cl.meta.last_row_id);
    await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, userId, claimId, PAST).run();

    // Either a controlled {ok:false} or a thrown error — in both cases NO payout.
    try { await processSinglePartnerClaim(env, claimId, { trigger: "t" }); } catch { /* controlled failure */ }
    expect(await balls(userId)).toBe(0);
    expect(await claimStatus(claimId)).not.toBe("completed");
    expect(await logStatus(claimId)).toBe("failed");
  });
});

// ── Real D1: CASE reward delivery via the REAL grant function (grantCaseToInventory) ──
describe("partner targeted grant (real D1, case happy-path + idempotency)", () => {
  it("case reward: happy path → 1 case + 1 receipt, claim/log completed, no user_partner_rewards", async () => {
    const { claimId } = await seedDueCaseClaim(900, "premium");
    // inventory before
    expect(await caseQty(900, "premium")).toBe(0);
    expect(await caseTxnCount(900)).toBe(0);

    const r = await processSinglePartnerClaim(env, claimId, { trigger: "t" });

    expect(r.ok).toBe(true);
    expect(await claimStatus(claimId)).toBe("completed");
    expect(await logStatus(claimId)).toBe("completed");
    expect(await ledgerCount(claimId)).toBe(1);          // exactly one reward log
    expect(await caseQty(900, "premium")).toBe(1);        // inventory +1
    expect(await caseTxnCount(900)).toBe(1);              // one earn receipt in case_transactions
    // The receipt carries the stable claim-derived idempotency key.
    const key = String(((await db.prepare(`SELECT idempotency_key FROM case_transactions WHERE user_id=?`).bind(900).first()) as any)?.idempotency_key ?? "");
    expect(key).toBe(`partner_claim:${claimId}:case_reward`);
    // The case path must NOT touch user_partner_rewards — the table is not even present here,
    // so any access would throw "no such table". A green test proves zero access.
    expect(await userPartnerRewardsTableExists()).toBe(0);
  });

  it("case reward: repeat after completed → no double case (top-guard via reward log)", async () => {
    const { claimId } = await seedDueCaseClaim(901, "premium");
    await processSinglePartnerClaim(env, claimId, { trigger: "1" });
    const second = await processSinglePartnerClaim(env, claimId, { trigger: "2" });
    expect(second.ok).toBe(false);                       // already completed → not re-granted
    expect(await caseQty(901, "premium")).toBe(1);
    expect(await caseTxnCount(901)).toBe(1);
    expect(await ledgerCount(claimId)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
    expect(await claimStatus(claimId)).toBe("completed");
  });

  it("case reward: two concurrent runs grant exactly one case", async () => {
    const { claimId } = await seedDueCaseClaim(902, "premium");
    await Promise.all([
      processSinglePartnerClaim(env, claimId, { trigger: "a" }),
      processSinglePartnerClaim(env, claimId, { trigger: "b" }),
    ]);
    expect(await caseQty(902, "premium")).toBe(1);        // exactly one case, no duplicate
    expect(await caseTxnCount(902)).toBe(1);
    expect(await ledgerCount(claimId)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("case reward: missing caseType → controlled failure, inventory unchanged", async () => {
    const userId = 903;
    await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(userId).run();
    const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, reward_payload_json, hold_hours, status, created_at, updated_at) VALUES ('telegram_bot_start','case',1,'{}',0,'active',?,?)`).bind(NOW, NOW).run();
    const campaignId = Number(c.meta.last_row_id);
    const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'pending_hold', ?, ?, ?, ?)`).bind(campaignId, userId, `tok-nocase-${userId}`, PAST, PAST, NOW, NOW).run();
    const claimId = Number(cl.meta.last_row_id);
    await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, userId, claimId, PAST).run();

    // grantPartnerCampaignReward throws PARTNER_CASE_TYPE_REQUIRED → controlled failure.
    try { await processSinglePartnerClaim(env, claimId, { trigger: "t" }); } catch { /* controlled failure */ }
    expect(await caseTxnCount(userId)).toBe(0);          // no case granted
    expect(await claimStatus(claimId)).not.toBe("completed");
    expect(await logStatus(claimId)).toBe("failed");
  });
});

// ── Real D1: CASE reward CRASH-SAFETY via the idempotency key (migration 0101) ──
describe("partner case reward crash-safety (idempotency key)", () => {
  it("10.4 crash recovery: receipt exists + reward log pending → retry completes, NO double case", async () => {
    const { claimId } = await seedDueCaseClaim(910, "premium");
    // Real first grant: case + receipt(key) + log/claim completed (consistent committed state).
    await processSinglePartnerClaim(env, claimId, { trigger: "first" });
    expect(await caseQty(910, "premium")).toBe(1);
    expect(await caseTxnCount(910)).toBe(1);
    // Simulate a crash AFTER the inventory grant committed but BEFORE the reward log/claim were
    // completed: roll the log back to pending and the claim back to verified. Inventory + receipt
    // (with the stable key) stay exactly as the completed inventory operation left them.
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(claimId).run();
    await db.prepare(`UPDATE partner_claims SET status='verified', completed_at=NULL, reward_granted_at=NULL WHERE id=?`).bind(claimId).run();

    // Normal production retry.
    const r = await processSinglePartnerClaim(env, claimId, { trigger: "recover" });

    expect(r.ok).toBe(true);                              // recovery is a SUCCESS, not a failure
    expect(await caseQty(910, "premium")).toBe(1);        // NOT 2 — idempotent grant
    expect(await caseTxnCount(910)).toBe(1);              // receipt NOT duplicated
    expect(await logStatus(claimId)).toBe("completed");   // log recovered to completed
    expect(await claimStatus(claimId)).toBe("completed"); // claim recovered to completed
  });

  it("10.7 different claims → different keys → two cases, two receipts", async () => {
    const a = await seedDueCaseClaim(911, "premium");
    const b = await seedDueCaseClaim(911, "premium"); // same user, second campaign/claim
    await processSinglePartnerClaim(env, a.claimId, { trigger: "a" });
    await processSinglePartnerClaim(env, b.claimId, { trigger: "b" });
    expect(await caseQty(911, "premium")).toBe(2);        // two independent grants
    expect(await caseTxnCount(911)).toBe(2);
    const keys = (await db.prepare(`SELECT idempotency_key FROM case_transactions WHERE user_id=911 ORDER BY id`).all()).results.map((r: any) => r.idempotency_key);
    expect(keys).toEqual([`partner_claim:${a.claimId}:case_reward`, `partner_claim:${b.claimId}:case_reward`]);
  });

  it("10.8 same claim, payload changed after first grant → NO second case (receipt authoritative)", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(912, "premium");
    await processSinglePartnerClaim(env, claimId, { trigger: "1" });
    expect(await caseQty(912, "premium")).toBe(1);
    // Admin mistakenly changes the case type AND reopen the claim for reprocessing.
    await db.prepare(`UPDATE partner_campaigns SET reward_payload_json=? WHERE id=?`).bind(JSON.stringify({ caseType: "daily_free" }), campaignId).run();
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(claimId).run();
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();

    await processSinglePartnerClaim(env, claimId, { trigger: "2" });
    // The key is bound to the CLAIM, not the case type → the existing receipt is authoritative.
    expect(await caseQty(912, "premium")).toBe(1);        // no second premium
    expect(await caseQty(912, "daily_free")).toBe(0);     // and NO new daily_free case
    expect(await caseTxnCount(912)).toBe(1);              // still one receipt
  });

  it("10.6 atomic rollback: a failing inventory batch commits nothing; later retry grants once", async () => {
    const { claimId } = await seedDueCaseClaim(913, "premium");
    // Force the atomic batch to fail: drop the inventory table so stmt 1 errors → whole batch rolls
    // back → neither user_cases nor case_transactions is partially written.
    await db.prepare(`DROP TABLE user_cases`).run();
    let threw = false;
    try { await processSinglePartnerClaim(env, claimId, { trigger: "boom" }); } catch { threw = true; }
    // recover schema
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER NOT NULL, case_type TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, case_type))`).run();
    expect(await caseTxnCount(913)).toBe(0);              // nothing partially committed
    // A correct retry now grants exactly one case + one receipt.
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(claimId).run();
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();
    await processSinglePartnerClaim(env, claimId, { trigger: "retry" });
    expect(await caseQty(913, "premium")).toBe(1);
    expect(await caseTxnCount(913)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("integrity: an existing receipt key resolving to a DIFFERENT user is a controlled error, not a silent no-op", async () => {
    const { claimId } = await seedDueCaseClaim(914, "premium");
    // Seed a poisoned receipt: same key this claim will build, but for a different user (corruption).
    const key = `partner_claim:${claimId}:case_reward`;
    await db.prepare(`INSERT INTO case_transactions (user_id, case_type, amount, quantity_before, quantity_after, operation_type, comment, created_at, idempotency_key) VALUES (?, 'premium', 1, 0, 1, 'earn', 'poison', ?, ?)`).bind(999999, NOW, key).run();
    // Retry: grantCaseToInventory finds the key but for user 999999 ≠ claim user → integrity error.
    try { await processSinglePartnerClaim(env, claimId, { trigger: "t" }); } catch { /* integrity error surfaced */ }
    expect(await caseQty(914, "premium")).toBe(0);        // claim user got NO case
    expect(await caseTxnCount(914)).toBe(0);              // no receipt for the claim user
    expect(await logStatus(claimId)).toBe("failed");      // controlled failure, not silent success
  });

  // Helper: poison the receipt for a claim (same key) with a mismatched field, then retry.
  const poisonAndRetry = async (uid: number, receiptCols: string) => {
    const { claimId } = await seedDueCaseClaim(uid, "premium");
    const key = `partner_claim:${claimId}:case_reward`;
    await db.prepare(`INSERT INTO case_transactions (user_id, case_type, amount, quantity_before, quantity_after, operation_type, comment, created_at, idempotency_key) VALUES (${receiptCols}, ?, ?)`).bind(NOW, key).run();
    try { await processSinglePartnerClaim(env, claimId, { trigger: "t" }); } catch { /* controlled integrity error */ }
    return claimId;
  };

  it("7.3 receipt with different case_type → integrity error, no second case", async () => {
    const claimId = await poisonAndRetry(915, `915, 'basic', 1, 0, 1, 'earn', 'poison'`);
    expect(await caseQty(915, "premium")).toBe(0);
    expect(await logStatus(claimId)).toBe("failed");      // mismatch not silently accepted
  });

  it("7.4 receipt with different amount → integrity error, inventory unchanged", async () => {
    const claimId = await poisonAndRetry(916, `916, 'premium', 5, 0, 5, 'earn', 'poison'`);
    expect(await caseQty(916, "premium")).toBe(0);
    expect(await logStatus(claimId)).toBe("failed");
  });

  it("7.5 receipt with non-earn operation_type → integrity error, no silent recovery", async () => {
    const claimId = await poisonAndRetry(917, `917, 'premium', 1, 0, 1, 'spend', 'poison'`);
    expect(await caseQty(917, "premium")).toBe(0);
    expect(await logStatus(claimId)).toBe("failed");
  });

  it("7.6 campaign payload changed after first grant → immutable snapshot; recovery succeeds, no 2nd case", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(918, "premium");
    await processSinglePartnerClaim(env, claimId, { trigger: "1" });
    expect(await caseQty(918, "premium")).toBe(1);
    // Mutate the live campaign payload AND simulate a crash (log pending, claim verified).
    await db.prepare(`UPDATE partner_campaigns SET reward_payload_json=? WHERE id=?`).bind(JSON.stringify({ caseType: "daily_free" }), campaignId).run();
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(claimId).run();
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();

    const r = await processSinglePartnerClaim(env, claimId, { trigger: "recover" });
    expect(r.ok).toBe(true);                              // recovery via immutable snapshot SUCCEEDS
    expect(await caseQty(918, "premium")).toBe(1);        // original premium, not doubled
    expect(await caseQty(918, "daily_free")).toBe(0);     // mutated type NOT granted
    expect(await caseTxnCount(918)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
    expect(await claimStatus(claimId)).toBe("completed");
  });
});

// ── Real D1: campaign quota counter — idempotent reservation per claim (no drift) ──
describe("partner campaign completed_claims_count reservation", () => {
  // build extra claims on an EXISTING campaign (for limit / multi-claim tests)
  const mkClaim = async (campaignId: number, uid: number) => {
    await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(uid).run();
    const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'pending_hold', ?, ?, ?, ?)`).bind(campaignId, uid, `tok-${campaignId}-${uid}`, PAST, PAST, NOW, NOW).run();
    const claimId = Number(cl.meta.last_row_id);
    await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, uid, claimId, PAST).run();
    return claimId;
  };

  it("8.1 happy path: counter N → N+1", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(920, "premium", 1, { maxTotal: 5 });
    expect(await campaignCounter(campaignId)).toBe(0);
    await processSinglePartnerClaim(env, claimId, { trigger: "t" });
    expect(await campaignCounter(campaignId)).toBe(1);
  });

  it("8.2 sequential retry of completed claim: counter stays N+1", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(921, "premium", 1, { maxTotal: 5 });
    await processSinglePartnerClaim(env, claimId, { trigger: "1" });
    await processSinglePartnerClaim(env, claimId, { trigger: "2" });
    expect(await campaignCounter(campaignId)).toBe(1);
  });

  it("8.3 concurrent processing: counter increments exactly +1", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(922, "premium", 1, { maxTotal: 5 });
    await Promise.all([
      processSinglePartnerClaim(env, claimId, { trigger: "a" }),
      processSinglePartnerClaim(env, claimId, { trigger: "b" }),
    ]);
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await caseQty(922, "premium")).toBe(1);
  });

  it("8.4 crash recovery: counter NOT double-incremented (drift fix)", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(923, "premium", 1, { maxTotal: 5 });
    await processSinglePartnerClaim(env, claimId, { trigger: "first" });
    expect(await campaignCounter(campaignId)).toBe(1);
    // Crash AFTER reservation+grant but before completion: log pending, claim verified.
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(claimId).run();
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();
    await processSinglePartnerClaim(env, claimId, { trigger: "recover" });
    expect(await campaignCounter(campaignId)).toBe(1);   // STILL 1 — no drift
    expect(await caseQty(923, "premium")).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("8.5 transient failure after reservation: rollback once; retry re-reserves & grants once", async () => {
    const { campaignId, claimId } = await seedDueCaseClaim(924, "premium", 1, { maxTotal: 5 });
    // Force a TRANSIENT failure inside the inventory batch (drop the table) AFTER reservation.
    await db.prepare(`DROP TABLE user_cases`).run();
    try { await processSinglePartnerClaim(env, claimId, { trigger: "1" }); } catch { /* transient batch failure */ }
    await db.prepare(`CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER NOT NULL, case_type TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, case_type))`).run();
    expect(await campaignCounter(campaignId)).toBe(0);   // reserved(0→1) then rolled back(1→0): exactly once
    expect(await logStatus(claimId)).toBe("failed");
    expect(await caseTxnCount(924)).toBe(0);             // nothing partially committed
    // Retry: failed→pending winner re-reserves once; the IMMUTABLE premium snapshot grants once.
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(claimId).run();
    await processSinglePartnerClaim(env, claimId, { trigger: "2" });
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await caseQty(924, "premium")).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("8.7 two different claims on one campaign: counter N → N+2", async () => {
    const { campaignId, claimId: a } = await seedDueCaseClaim(925, "premium", 1, { maxTotal: 5 });
    const b = await mkClaim(campaignId, 926);
    await processSinglePartnerClaim(env, a, { trigger: "a" });
    await processSinglePartnerClaim(env, b, { trigger: "b" });
    expect(await campaignCounter(campaignId)).toBe(2);
    expect(await caseQty(925, "premium")).toBe(1);
    expect(await caseQty(926, "premium")).toBe(1);
  });

  it("8.8 campaign limit=1: first reserves, its retry takes no 2nd slot, 2nd claim rejected", async () => {
    const { campaignId, claimId: a } = await seedDueCaseClaim(927, "premium", 1, { maxTotal: 1 });
    const b = await mkClaim(campaignId, 928);
    await processSinglePartnerClaim(env, a, { trigger: "A" });
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await caseQty(927, "premium")).toBe(1);
    // A crash-recovery retry must NOT consume the second slot.
    await db.prepare(`UPDATE partner_reward_logs SET status='pending' WHERE claim_id=?`).bind(a).run();
    await db.prepare(`UPDATE partner_claims SET status='verified' WHERE id=?`).bind(a).run();
    await processSinglePartnerClaim(env, a, { trigger: "A2" });
    expect(await campaignCounter(campaignId)).toBe(1);   // still 1
    // B is rejected by the limit; counter never exceeds the cap.
    try { await processSinglePartnerClaim(env, b, { trigger: "B" }); } catch { /* PARTNER_CAMPAIGN_LIMIT_REACHED */ }
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await caseQty(928, "premium")).toBe(0);
    expect(await logStatus(b)).toBe("failed");
  });
});

// ── Real D1: failed-retry IMMUTABLE snapshot + concurrent failed→pending reactivation ──
describe("partner failed-retry immutable snapshot + concurrent reactivation", () => {
  const mkVerifiedClaim = async (campaignId: number, uid: number) => {
    await db.prepare(`INSERT OR IGNORE INTO users (id, balls) VALUES (?, 0)`).bind(uid).run();
    const cl = await db.prepare(`INSERT INTO partner_claims (campaign_id, user_id, verify_token, status, hold_until, verified_at, created_at, updated_at) VALUES (?, ?, ?, 'verified', ?, ?, ?, ?)`).bind(campaignId, uid, `tok-fr-${campaignId}-${uid}`, PAST, PAST, NOW, NOW).run();
    const claimId = Number(cl.meta.last_row_id);
    await db.prepare(`INSERT INTO partner_events (campaign_id, user_id, claim_id, event_type, created_at) VALUES (?, ?, ?, 'partner_task_verified', ?)`).bind(campaignId, uid, claimId, PAST).run();
    return claimId;
  };
  // Seed a campaign + verified claim + a partner_reward_log in a crash-state (failed or pending) with
  // an explicit reward snapshot. Direct log seeding is a legitimate crash-state preparation; the
  // retry always runs the REAL processSinglePartnerClaim.
  const seedCaseCrash = async (uid: number, o: { campaignCaseType: string; snapshotCaseType: string; logStatus: "failed" | "pending"; counter?: number; maxTotal?: number | null }) => {
    const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, reward_payload_json, hold_hours, max_total_claims, completed_claims_count, status, created_at, updated_at) VALUES ('telegram_bot_start','case',1,?,0,?,?,'active',?,?)`)
      .bind(JSON.stringify({ caseType: o.campaignCaseType }), o.maxTotal ?? null, o.counter ?? 0, NOW, NOW).run();
    const campaignId = Number(c.meta.last_row_id);
    const claimId = await mkVerifiedClaim(campaignId, uid);
    await db.prepare(`INSERT INTO partner_reward_logs (claim_id, campaign_id, user_id, reward_type, reward_amount, reward_payload_json, status, created_at) VALUES (?, ?, ?, 'case', 1, ?, ?, ?)`)
      .bind(claimId, campaignId, uid, JSON.stringify({ caseType: o.snapshotCaseType }), o.logStatus, NOW).run();
    return { campaignId, claimId };
  };
  const snapCaseType = async (claimId: number) => {
    const r = await db.prepare(`SELECT reward_payload_json FROM partner_reward_logs WHERE claim_id=?`).bind(claimId).first() as any;
    return JSON.parse(r.reward_payload_json).caseType as string;
  };

  it("6.1 failed→retry keeps the ORIGINAL case snapshot (campaign edit ignored)", async () => {
    const { claimId } = await seedCaseCrash(940, { campaignCaseType: "daily_free", snapshotCaseType: "premium", logStatus: "failed" });
    await processSinglePartnerClaim(env, claimId, { trigger: "retry" });
    expect(await caseQty(940, "premium")).toBe(1);       // ORIGINAL premium granted
    expect(await caseQty(940, "daily_free")).toBe(0);    // mutated campaign type NOT granted
    expect(await caseTxnCount(940)).toBe(1);
    expect(await snapCaseType(claimId)).toBe("premium"); // snapshot unchanged by retry
    expect(await logStatus(claimId)).toBe("completed");
    expect(await claimStatus(claimId)).toBe("completed");
  });

  it("6.2 failed→retry keeps the ORIGINAL balls amount (campaign edit ignored)", async () => {
    const uid = 941;
    const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',1000,0,'active',?,?)`).bind(NOW, NOW).run();
    const campaignId = Number(c.meta.last_row_id);
    const claimId = await mkVerifiedClaim(campaignId, uid);
    await db.prepare(`INSERT INTO partner_reward_logs (claim_id, campaign_id, user_id, reward_type, reward_amount, status, created_at) VALUES (?, ?, ?, 'balls', 10, 'failed', ?)`).bind(claimId, campaignId, uid, NOW).run();
    await processSinglePartnerClaim(env, claimId, { trigger: "retry" });
    expect(await balls(uid)).toBe(10);                   // ORIGINAL 10 (NOT the mutated 1000)
    expect(await logStatus(claimId)).toBe("completed");
    await processSinglePartnerClaim(env, claimId, { trigger: "retry2" });
    expect(await balls(uid)).toBe(10);                   // repeat → no double
  });

  it("6.3 a NEW claim uses the NEW campaign config (immutability is per-claim)", async () => {
    const { campaignId, claimId: oldClaim } = await seedCaseCrash(942, { campaignCaseType: "daily_free", snapshotCaseType: "premium", logStatus: "failed" });
    await processSinglePartnerClaim(env, oldClaim, { trigger: "old" });
    const newClaim = await mkVerifiedClaim(campaignId, 943);
    await processSinglePartnerClaim(env, newClaim, { trigger: "new" });
    expect(await caseQty(942, "premium")).toBe(1);       // old claim → old (premium) snapshot
    expect(await caseQty(943, "daily_free")).toBe(1);    // new claim → new (daily_free) config
    expect(await snapCaseType(oldClaim)).toBe("premium");
    expect(await snapCaseType(newClaim)).toBe("daily_free");
  });

  it("7.1 two workers reactivate one failed CASE claim → one grant, counter +1, loser no reserve", async () => {
    const { campaignId, claimId } = await seedCaseCrash(944, { campaignCaseType: "premium", snapshotCaseType: "premium", logStatus: "failed", maxTotal: 5, counter: 0 });
    await Promise.all([
      processSinglePartnerClaim(env, claimId, { trigger: "a" }),
      processSinglePartnerClaim(env, claimId, { trigger: "b" }),
    ]);
    expect(await campaignCounter(campaignId)).toBe(1);   // exactly one reservation (single winner)
    expect(await caseQty(944, "premium")).toBe(1);
    expect(await caseTxnCount(944)).toBe(1);
    expect(await ledgerCount(claimId)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
    expect(await claimStatus(claimId)).toBe("completed");
  });

  it("7.2 two workers reactivate one failed BALLS claim → balls once, counter +1", async () => {
    const uid = 945;
    const c = await db.prepare(`INSERT INTO partner_campaigns (task_type, reward_type, reward_amount, hold_hours, max_total_claims, completed_claims_count, status, created_at, updated_at) VALUES ('telegram_bot_start','balls',10,0,5,0,'active',?,?)`).bind(NOW, NOW).run();
    const campaignId = Number(c.meta.last_row_id);
    const claimId = await mkVerifiedClaim(campaignId, uid);
    await db.prepare(`INSERT INTO partner_reward_logs (claim_id, campaign_id, user_id, reward_type, reward_amount, status, created_at) VALUES (?, ?, ?, 'balls', 10, 'failed', ?)`).bind(claimId, campaignId, uid, NOW).run();
    await Promise.all([
      processSinglePartnerClaim(env, claimId, { trigger: "a" }),
      processSinglePartnerClaim(env, claimId, { trigger: "b" }),
    ]);
    expect(await balls(uid)).toBe(10);                   // exactly once
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await ledgerCount(claimId)).toBe(1);
    expect(await claimStatus(claimId)).toBe("completed");
  });

  it("7.3 winner reactivated+reserved then crashed (log pending, counter 1, no case) → recovery delivers once", async () => {
    // Crash-state left by a winner: log pending, slot already reserved (counter 1), nothing delivered.
    const { campaignId, claimId } = await seedCaseCrash(948, { campaignCaseType: "premium", snapshotCaseType: "premium", logStatus: "pending", maxTotal: 5, counter: 1 });
    await processSinglePartnerClaim(env, claimId, { trigger: "recover" });
    expect(await campaignCounter(campaignId)).toBe(1);   // recovery does NOT re-reserve
    expect(await caseQty(948, "premium")).toBe(1);
    expect(await caseTxnCount(948)).toBe(1);
    expect(await logStatus(claimId)).toBe("completed");
  });

  it("7.4 concurrent retry of a failed claim under limit=1 → counter ≤ 1; independent claim rejected", async () => {
    const { campaignId, claimId: a } = await seedCaseCrash(946, { campaignCaseType: "premium", snapshotCaseType: "premium", logStatus: "failed", maxTotal: 1, counter: 0 });
    const b = await mkVerifiedClaim(campaignId, 947);
    await Promise.all([
      processSinglePartnerClaim(env, a, { trigger: "a1" }),
      processSinglePartnerClaim(env, a, { trigger: "a2" }),
    ]);
    expect(await campaignCounter(campaignId)).toBe(1);   // A reactivated → exactly 1 slot, not 2
    expect(await caseQty(946, "premium")).toBe(1);
    // independent B rejected by the now-full limit
    try { await processSinglePartnerClaim(env, b, { trigger: "b" }); } catch { /* PARTNER_CAMPAIGN_LIMIT_REACHED */ }
    expect(await campaignCounter(campaignId)).toBe(1);
    expect(await caseQty(947, "premium")).toBe(0);
    expect(await logStatus(b)).toBe("failed");
  });
});

// ── Real D1: hourly sweep V2 drains due claims ──
describe("partner sweep V2 (real D1)", () => {
  it("processes due pending_hold claims; repeat adds no duplicates", async () => {
    const a = await seedDueClaim(600, 10);
    const b = await seedDueClaim(601, 20);
    const r = await runPartnerClaimsSweepV2(env, { trigger: "t" });
    expect(r.processed).toBe(2);
    expect(await balls(600)).toBe(10);
    expect(await balls(601)).toBe(20);
    const r2 = await runPartnerClaimsSweepV2(env, { trigger: "t" });
    expect(r2.processed).toBe(0); // nothing due anymore
    expect(await balls(600)).toBe(10);
    expect(await ledgerCount(a.claimId)).toBe(1);
    expect(await ledgerCount(b.claimId)).toBe(1);
  });

  it("batch limit respected within one sweep page", async () => {
    for (let i = 0; i < 5; i++) await seedDueClaim(700 + i, 5);
    const smallEnv = { ...env, PARTNER_CLAIMS_BATCH_SIZE: "2" };
    // With batchSize 2 and 5 claims, the sweep drains via keyset pages (2+2+1).
    const r = await runPartnerClaimsSweepV2(smallEnv, { trigger: "t" });
    expect(r.processed).toBe(5);
    expect(r.pages).toBe(3);
  });
});
