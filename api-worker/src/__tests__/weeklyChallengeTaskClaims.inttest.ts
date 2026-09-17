import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { buildWeeklyChallengeTasksForUser, type WeeklyTaskReward } from "../seasonPredictionWeeklyTasks";
import { listWeeklyChallengeArchiveCandidates } from "../weeklyChallengeTaskArchive";
import { claimWeeklyChallengeTaskReward, WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS } from "../weeklyChallengeTaskClaims";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-weekly-claims");
const MIGRATION_0090 = path.resolve(process.cwd(), "migrations", "0090_weekly_challenge_task_claims.sql");
const USER_ID = 901;
const SEASON_ID = 1;
// V2 task set (V1 retired): the claimable score task is weekly_challenge_result.
// The A/B test's 4/5 score = 80% = gold tier, whose default reward is exactly
// REWARD below — so the claim flow assertions stay byte-identical.
const TASK_KEY = "weekly_challenge_result";
const BASE_A = `weekly_challenge_task:101:${TASK_KEY}:${USER_ID}`;
const BASE_B = `weekly_challenge_task:102:${TASK_KEY}:${USER_ID}`;
const REWARD: WeeklyTaskReward = { stars: 3, balls: 1, case_type: null, case_count: 0 };

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

async function createPre0090Schema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER NOT NULL, season_number INTEGER NOT NULL, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, PRIMARY KEY(user_id, season_number))`,
    `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, source TEXT, created_at INTEGER, UNIQUE(user_id, season_id, task_key, instance_key))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id, case_type))`,
    `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, boost_type TEXT, status TEXT, purchased_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS reward_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, source_type TEXT, source_id TEXT, unique_key TEXT UNIQUE, reward_type TEXT, amount INTEGER, case_type TEXT, status TEXT, granted_at INTEGER, granted_by INTEGER, metadata_json TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC)`,
    `CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenges (id INTEGER PRIMARY KEY, season_prediction_season_id INTEGER, code TEXT, title TEXT, status TEXT, deadline_at INTEGER, task_schema_version INTEGER NOT NULL DEFAULT 1, bonus_question_key TEXT)`,
    `CREATE TABLE IF NOT EXISTS season_prediction_weekly_challenge_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, weekly_challenge_id INTEGER, user_id INTEGER, status TEXT, answers_json TEXT)`,
  ];
  for (const stmt of stmts) await db.prepare(stmt).run();
}

async function applyMigration0090() {
  const sql = readFileSync(MIGRATION_0090, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const stmt of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

async function resetData() {
  for (const table of [
    "users",
    "user_season_progress",
    "stars_ledger",
    "balls_ledger",
    "user_cases",
    "user_boosts",
    "reward_ledger",
    "weekly_challenge_task_claims",
    "season_prediction_weekly_challenges",
    "season_prediction_weekly_challenge_entries",
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
  await db.prepare(`INSERT INTO users (id, balls) VALUES (?, 0)`).bind(USER_ID).run();
}

async function claim(challengeId = 101, base = BASE_A, token?: string, nowSeconds = 1_800_000_000) {
  return claimWeeklyChallengeTaskReward({
    db,
    userId: USER_ID,
    seasonId: SEASON_ID,
    taskKey: TASK_KEY,
    base,
    reward: REWARD,
    challengeId,
    nowSeconds,
    nowMs: nowSeconds * 1000,
    lockToken: token,
  });
}

async function n(sql: string, ...binds: unknown[]) {
  const row = await db.prepare(sql).bind(...binds).first() as any;
  return Number(row?.n ?? 0);
}

async function balances() {
  return {
    stars: await n(`SELECT COALESCE(SUM(stars), 0) n FROM user_season_progress WHERE user_id = ?`, USER_ID),
    balls: await n(`SELECT COALESCE(balls, 0) n FROM users WHERE id = ?`, USER_ID),
    basicCases: await n(`SELECT COALESCE(SUM(quantity), 0) n FROM user_cases WHERE user_id = ? AND case_type = 'basic'`, USER_ID),
    jokerBoosts: await n(`SELECT COUNT(*) n FROM user_boosts WHERE user_id = ? AND boost_type = 'extra_joker' AND status = 'available'`, USER_ID),
    rewardRows: await n(`SELECT COUNT(*) n FROM reward_ledger WHERE user_id = ?`, USER_ID),
    claimRows: await n(`SELECT COUNT(*) n FROM weekly_challenge_task_claims WHERE user_id = ?`, USER_ID),
  };
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  await createPre0090Schema();
  await applyMigration0090();
});

afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});

beforeEach(resetData);

describe("migration 0090", () => {
  it("creates claim table, unique operation key, and expected indexes; reapply is idempotent", async () => {
    await applyMigration0090();
    const tableCount = await n(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='weekly_challenge_task_claims'`);
    expect(tableCount).toBe(1);
    const indexes = await db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'weekly_challenge_task_claims'
    `).all() as any;
    const names = new Set((indexes.results || []).map((row: any) => String(row.name)));
    expect([...names].some((name) => name.includes("autoindex"))).toBe(true);
    expect(names.has("idx_wctc_user_status")).toBe(true);
    expect(names.has("idx_wctc_challenge_user")).toBe(true);

    await db.prepare(`
      INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json)
      VALUES (1, 2, 'k', 'running', 'a', '{}')
    `).run();
    await db.prepare(`
      INSERT OR IGNORE INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json)
      VALUES (1, 2, 'k', 'running', 'b', '{}')
    `).run();
    expect(await n(`SELECT COUNT(*) n FROM weekly_challenge_task_claims WHERE weekly_challenge_id = 1 AND user_id = 2 AND task_key = 'k'`)).toBe(1);
  });
});

describe("claim recovery and concurrency over local D1", () => {
  it("fresh running lock returns controlled in-progress conflict", async () => {
    await db.prepare(`
      INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json, created_at, updated_at)
      VALUES (101, ?, ?, 'running', 'live-lock', '{}', ?, ?)
    `).bind(USER_ID, TASK_KEY, 1_800_000_000, 1_800_000_000).run();
    await expect(claim(101, BASE_A, "second-token", 1_800_000_010)).rejects.toThrow("WEEKLY_TASK_CLAIM_IN_PROGRESS");
    expect(await balances()).toMatchObject({ stars: 0, balls: 0, rewardRows: 0, claimRows: 1 });
  });

  it("stale running before reward batch can be safely stolen and completed", async () => {
    const now = 1_800_000_000;
    await db.prepare(`
      INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json, created_at, updated_at)
      VALUES (101, ?, ?, 'running', 'stale-lock', '{}', ?, ?)
    `).bind(USER_ID, TASK_KEY, now - 1000, now - WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS - 1).run();

    await claim(101, BASE_A, "recovery-token", now);
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, rewardRows: 2, claimRows: 1 });
    const row = await db.prepare(`SELECT status, lock_token FROM weekly_challenge_task_claims WHERE weekly_challenge_id = 101 AND user_id = ? AND task_key = ?`).bind(USER_ID, TASK_KEY).first() as any;
    expect(row.status).toBe("completed");
    expect(row.lock_token).toBeNull();
  });

  it("post-batch crash recovery marks completed without changing balances again", async () => {
    const now = 1_800_000_000;
    await db.prepare(`INSERT INTO user_season_progress (user_id, season_number, stars, level) VALUES (?, ?, 3, 1)`).bind(USER_ID, SEASON_ID).run();
    await db.prepare(`UPDATE users SET balls = 1 WHERE id = ?`).bind(USER_ID).run();
    await db.prepare(`INSERT INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, status, granted_at) VALUES (?, 'weekly_challenge_task', ?, ?, 'stars', 3, 'granted', ?)`).bind(USER_ID, TASK_KEY, `${BASE_A}:stars`, now).run();
    await db.prepare(`INSERT INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, status, granted_at) VALUES (?, 'weekly_challenge_task', ?, ?, 'balls', 1, 'granted', ?)`).bind(USER_ID, TASK_KEY, `${BASE_A}:balls`, now).run();
    await db.prepare(`
      INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json, created_at, updated_at)
      VALUES (101, ?, ?, 'running', 'stale-after-batch', '{}', ?, ?)
    `).bind(USER_ID, TASK_KEY, now - 1000, now - WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS - 1).run();

    await claim(101, BASE_A, "recovery-token", now);
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, rewardRows: 2, claimRows: 1 });
    expect(await n(`SELECT COUNT(*) n FROM weekly_challenge_task_claims WHERE status = 'completed'`)).toBe(1);
  });

  it("partial stale reward grants only missing components", async () => {
    const now = 1_800_000_000;
    await db.prepare(`INSERT INTO user_season_progress (user_id, season_number, stars, level) VALUES (?, ?, 3, 1)`).bind(USER_ID, SEASON_ID).run();
    await db.prepare(`INSERT INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, status, granted_at) VALUES (?, 'weekly_challenge_task', ?, ?, 'stars', 3, 'granted', ?)`).bind(USER_ID, TASK_KEY, `${BASE_A}:stars`, now).run();
    await db.prepare(`
      INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json, created_at, updated_at)
      VALUES (101, ?, ?, 'running', 'partial-lock', '{}', ?, ?)
    `).bind(USER_ID, TASK_KEY, now - 1000, now - WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS - 1).run();

    await claim(101, BASE_A, "recovery-token", now);
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, rewardRows: 2, claimRows: 1 });
  });

  it("concurrent claims do not duplicate stars, balls, ledgers, or claim rows", async () => {
    const [a, b] = await Promise.allSettled([
      claim(101, BASE_A, "token-a"),
      claim(101, BASE_A, "token-b"),
    ]);
    expect([a.status, b.status]).toContain("fulfilled");
    if (a.status === "rejected") expect(String(a.reason?.message || a.reason)).toBe("WEEKLY_TASK_CLAIM_IN_PROGRESS");
    if (b.status === "rejected") expect(String(b.reason?.message || b.reason)).toBe("WEEKLY_TASK_CLAIM_IN_PROGRESS");
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, rewardRows: 2, claimRows: 1 });
    await claim(101, BASE_A, "token-repeat");
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, rewardRows: 2, claimRows: 1 });
  });

  it("grants and deduplicates a V2 perfect reward with a basic case", async () => {
    const taskKey = "weekly_challenge_result";
    const base = `weekly_challenge_task:201:${taskKey}:${USER_ID}`;
    const reward: WeeklyTaskReward = { stars: 5, balls: 0, case_type: "basic", case_count: 1 };
    const grant = async (token: string) => claimWeeklyChallengeTaskReward({
      db,
      userId: USER_ID,
      seasonId: SEASON_ID,
      taskKey,
      base,
      reward,
      challengeId: 201,
      nowSeconds: 1_800_000_010,
      nowMs: 1_800_000_010_000,
      lockToken: token,
      snapshot: { tier: "perfect", task_schema_version: 2 },
    });
    await grant("perfect-a");
    expect(await balances()).toMatchObject({ stars: 5, balls: 0, basicCases: 1, rewardRows: 2, claimRows: 1 });
    const claimRow = await db.prepare(`SELECT status, reward_snapshot_json FROM weekly_challenge_task_claims WHERE weekly_challenge_id = 201 AND user_id = ? AND task_key = ?`).bind(USER_ID, taskKey).first() as any;
    expect(claimRow.status).toBe("completed");
    const snapshot = JSON.parse(String(claimRow.reward_snapshot_json || "{}"));
    expect(snapshot).toMatchObject({
      tier: "perfect",
      task_schema_version: 2,
      reward: { stars: 5, balls: 0, case_type: "basic", case_count: 1 },
    });
    expect(snapshot.component_keys).toEqual([`${base}:stars`, `${base}:case:basic`]);
    await grant("perfect-b");
    expect(await balances()).toMatchObject({ stars: 5, balls: 0, basicCases: 1, rewardRows: 2, claimRows: 1 });
  });

  it("grants N boost rows (one per unit) and deduplicates on replay + concurrency", async () => {
    const taskKey = "weekly_challenge_result";
    const base = `weekly_challenge_task:203:${taskKey}:${USER_ID}`;
    // Gold tier with a boost: 3⭐ + 1 мяч + 2 extra_joker boosts.
    const reward: WeeklyTaskReward = { stars: 3, balls: 1, case_type: null, case_count: 0, boost_type: "extra_joker", boost_count: 2 };
    const grant = (token: string, nowSeconds = 1_800_000_040) => claimWeeklyChallengeTaskReward({
      db,
      userId: USER_ID,
      seasonId: SEASON_ID,
      taskKey,
      base,
      reward,
      challengeId: 203,
      nowSeconds,
      nowMs: nowSeconds * 1000,
      lockToken: token,
      snapshot: { tier: "gold", task_schema_version: 2 },
    });
    await grant("boost-a");
    // 2 boost rows granted; ledger has stars + balls + boost = 3 rows.
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, jokerBoosts: 2, rewardRows: 3, claimRows: 1 });
    const snapshot = JSON.parse(String((await db.prepare(`SELECT reward_snapshot_json FROM weekly_challenge_task_claims WHERE weekly_challenge_id = 203 AND user_id = ? AND task_key = ?`).bind(USER_ID, taskKey).first() as any)?.reward_snapshot_json || "{}"));
    expect(snapshot.component_keys).toEqual([`${base}:stars`, `${base}:balls`, `${base}:boost:extra_joker`]);
    // Replay must NOT add more boost rows.
    await grant("boost-b");
    expect(await balances()).toMatchObject({ stars: 3, balls: 1, jokerBoosts: 2, rewardRows: 3, claimRows: 1 });
    // The boost ledger row uses reward_type='boost' and stores the subtype in case_type.
    const boostLedger = await db.prepare(`SELECT reward_type, amount, case_type FROM reward_ledger WHERE unique_key = ?`).bind(`${base}:boost:extra_joker`).first() as any;
    expect(boostLedger).toMatchObject({ reward_type: "boost", amount: 2, case_type: "extra_joker" });
  });

  it("V2 perfect concurrent claims and stale recovery do not duplicate the basic case", async () => {
    const taskKey = "weekly_challenge_result";
    const base = `weekly_challenge_task:202:${taskKey}:${USER_ID}`;
    const reward: WeeklyTaskReward = { stars: 5, balls: 0, case_type: "basic", case_count: 1 };
    const grant = (token: string, nowSeconds = 1_800_000_020) => claimWeeklyChallengeTaskReward({
      db,
      userId: USER_ID,
      seasonId: SEASON_ID,
      taskKey,
      base,
      reward,
      challengeId: 202,
      nowSeconds,
      nowMs: nowSeconds * 1000,
      lockToken: token,
      snapshot: { tier: "perfect", task_schema_version: 2 },
    });
    const [a, b] = await Promise.allSettled([grant("perfect-concurrent-a"), grant("perfect-concurrent-b")]);
    expect([a.status, b.status]).toContain("fulfilled");
    expect(await balances()).toMatchObject({ stars: 5, balls: 0, basicCases: 1, rewardRows: 2, claimRows: 1 });
    await db.prepare(`UPDATE weekly_challenge_task_claims SET status = 'running', lock_token = 'stale-perfect', updated_at = ? WHERE weekly_challenge_id = 202 AND user_id = ? AND task_key = ?`)
      .bind(1_800_000_020 - WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS - 2, USER_ID, taskKey).run();
    await grant("perfect-recovery", 1_800_000_030);
    expect(await balances()).toMatchObject({ stars: 5, balls: 0, basicCases: 1, rewardRows: 2, claimRows: 1 });
  });
});

describe("A/B flow and archive pagination", () => {
  async function seedChallenges(count: number) {
    for (let i = 1; i <= count; i += 1) {
      const id = 100 + i;
      await db.prepare(`
        INSERT INTO season_prediction_weekly_challenges (id, season_prediction_season_id, code, title, status, deadline_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, SEASON_ID, `w${i}`, `Week ${i}`, i === count ? "active" : "completed", 2_000_000_000 - i).run();
      await db.prepare(`
        INSERT INTO season_prediction_weekly_challenge_entries (weekly_challenge_id, user_id, status, answers_json)
        VALUES (?, ?, 'completed', '{}')
      `).bind(id, USER_ID).run();
    }
  }

  it("A can be claimed from archive while active B remains independent", async () => {
    await seedChallenges(2);
    const score = { total_points: 4, max_possible_points: 5, correct_answers: 4 };
    const aBefore = buildWeeklyChallengeTasksForUser({
      userId: USER_ID,
      seasonId: SEASON_ID,
      challenge: { id: 101, title: "A", status: "completed" },
      entry: { status: "completed", answers: {} },
      activeQuestionKeys: ["a", "b", "c", "d", "e"],
      score,
      seasonSubmittedCount: 0,
      claimedUniqueKeys: [],
    }).find((task) => task.key === TASK_KEY);
    const bBefore = buildWeeklyChallengeTasksForUser({
      userId: USER_ID,
      seasonId: SEASON_ID,
      challenge: { id: 102, title: "B", status: "active" },
      entry: { status: "completed", answers: {} },
      activeQuestionKeys: ["a", "b", "c", "d", "e"],
      score,
      seasonSubmittedCount: 0,
      claimedUniqueKeys: [],
    }).find((task) => task.key === TASK_KEY);
    expect(aBefore?.claimable).toBe(true);
    expect(bBefore?.claimable).toBe(true);

    const archive = await listWeeklyChallengeArchiveCandidates(db, { seasonId: SEASON_ID, userId: USER_ID, currentChallengeId: 102, limit: 10 });
    expect(archive.rows.map((row) => Number(row.id))).toEqual([101]);
    await claim(101, BASE_A, "archive-token");

    const claimedKeys = [`${BASE_A}:stars`, `${BASE_A}:balls`];
    const aAfter = buildWeeklyChallengeTasksForUser({
      userId: USER_ID,
      seasonId: SEASON_ID,
      challenge: { id: 101, title: "A", status: "completed" },
      entry: { status: "completed", answers: {} },
      activeQuestionKeys: ["a", "b", "c", "d", "e"],
      score,
      seasonSubmittedCount: 0,
      claimedUniqueKeys: claimedKeys,
    }).find((task) => task.key === TASK_KEY);
    const bAfter = buildWeeklyChallengeTasksForUser({
      userId: USER_ID,
      seasonId: SEASON_ID,
      challenge: { id: 102, title: "B", status: "active" },
      entry: { status: "completed", answers: {} },
      activeQuestionKeys: ["a", "b", "c", "d", "e"],
      score,
      seasonSubmittedCount: 0,
      claimedUniqueKeys: claimedKeys,
    }).find((task) => task.key === TASK_KEY);
    expect(aAfter?.claimed).toBe(true);
    expect(bAfter?.claimed).toBe(false);
    expect(bAfter?.claimable).toBe(true);
    await claim(102, BASE_B, "b-token");
    expect(await balances()).toMatchObject({ stars: 6, balls: 2, rewardRows: 4, claimRows: 2 });
  });

  it("archive uses stable deadline/id cursor beyond the first page and excludes current/draft/no-entry", async () => {
    await seedChallenges(7);
    await db.prepare(`INSERT INTO season_prediction_weekly_challenges (id, season_prediction_season_id, code, title, status, deadline_at) VALUES (300, ?, 'draft', 'Draft', 'draft', 3000)`).bind(SEASON_ID).run();
    await db.prepare(`INSERT INTO season_prediction_weekly_challenges (id, season_prediction_season_id, code, title, status, deadline_at) VALUES (301, ?, 'noentry', 'No entry', 'completed', 3001)`).bind(SEASON_ID).run();
    const first = await listWeeklyChallengeArchiveCandidates(db, { seasonId: SEASON_ID, userId: USER_ID, currentChallengeId: 107, limit: 3 });
    expect(first.rows.map((row) => Number(row.id))).toEqual([101, 102, 103]);
    expect(first.nextCursor).toBe("1999999997:103");
    const second = await listWeeklyChallengeArchiveCandidates(db, { seasonId: SEASON_ID, userId: USER_ID, currentChallengeId: 107, limit: 3, cursor: first.nextCursor });
    expect(second.rows.map((row) => Number(row.id))).toEqual([104, 105, 106]);
    expect(second.nextCursor).toBeNull();
  });
});
