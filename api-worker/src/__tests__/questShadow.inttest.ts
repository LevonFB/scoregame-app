import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { evaluateDailyQuestMet, runDailyQuestShadow } from "../index";
import { buildQuestEvent, classifyQuestShadow } from "../questShadow";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-qs");
const MD = "2026-05-02";
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let env: any;

async function createSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY, day TEXT, matchday_key TEXT, start_time TEXT, lock_time TEXT, status TEXT, is_pick INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(day,match_id,user_id))`,
    `CREATE TABLE IF NOT EXISTS user_day_stats (user_id INTEGER, day TEXT, points INTEGER, outcome_count INTEGER, diff_count INTEGER, exact_count INTEGER, had_joker INTEGER, joker_points INTEGER, earliest_pick_time INTEGER, PRIMARY KEY(user_id,day))`,
    `CREATE TABLE IF NOT EXISTS daily_quest_progress (user_id INTEGER, day TEXT, quest_id TEXT, completed INTEGER DEFAULT 0, stars_awarded INTEGER DEFAULT 0, completed_at INTEGER, PRIMARY KEY(user_id,day,quest_id))`,
    `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,case_type))`,
    `CREATE TABLE IF NOT EXISTS tasks_catalog (task_key TEXT PRIMARY KEY, sort_order INTEGER, is_enabled INTEGER, league_only INTEGER, reward_stars INTEGER, emoji TEXT, phase TEXT, rarity TEXT)`,
    `CREATE TABLE IF NOT EXISTS league_members (league_id TEXT, user_id INTEGER, PRIMARY KEY(league_id,user_id))`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
}
async function reset() {
  for (const t of ["matches", "picks", "user_day_stats", "daily_quest_progress", "user_cases", "tasks_catalog", "league_members"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}
const DQ_CAPTAIN = { id: "dq_captain", stars: 1, league: false, phase: "pick_saved" };
const count = async (sql: string) => Number((await env.DB.prepare(sql).first() as any)?.n ?? 0);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  env = proxy.env;
  await createSchema();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(reset);

async function seedJokerPick(uid: number) {
  await env.DB.prepare(`INSERT INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('m1', ?, ?, '2099-01-01T18:00:00Z', '2099-01-01T17:55:00Z', 'TIMED', 1)`).bind(MD, MD).run();
  await env.DB.prepare(`INSERT INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES (?, 'm1', ?, 1, 0, 1, 1)`).bind(MD, uid).run();
}

describe("evaluateDailyQuestMet (shared rules, read-only) over real D1", () => {
  it("dq_captain met=true when a joker pick exists", async () => {
    await seedJokerPick(1);
    const met = await evaluateDailyQuestMet(env, 1, MD, DQ_CAPTAIN, { totalMatches: 1, dayStats: null, userLeagues: [] });
    expect(met).toBe(true);
  });
  it("dq_captain met=false without a joker pick", async () => {
    await env.DB.prepare(`INSERT INTO matches (match_id, day, matchday_key, lock_time, is_pick) VALUES ('m1', ?, ?, '2099-01-01T17:55:00Z', 1)`).bind(MD, MD).run();
    await env.DB.prepare(`INSERT INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES (?, 'm1', 2, 1, 0, 0, 1)`).bind(MD).run();
    const met = await evaluateDailyQuestMet(env, 2, MD, DQ_CAPTAIN, { totalMatches: 1, dayStats: null, userLeagues: [] });
    expect(met).toBe(false);
  });
});

describe("shadow compute vs stored (classification)", () => {
  it("expected==stored → match", async () => {
    await seedJokerPick(1);
    await env.DB.prepare(`INSERT INTO daily_quest_progress (user_id, day, quest_id, completed, stars_awarded) VALUES (1, ?, 'dq_captain', 1, 1)`).bind(MD).run();
    const met = await evaluateDailyQuestMet(env, 1, MD, DQ_CAPTAIN, { totalMatches: 1, dayStats: null, userLeagues: [] });
    const res = classifyQuestShadow({ supported: true, hasStoredRow: true, expectedCompleted: met, storedCompleted: true, expectedRewardEligible: met, storedRewarded: true });
    expect(res).toBe("match");
  });
  it("expected completed but no stored row → missing_progress", async () => {
    await seedJokerPick(1);
    const met = await evaluateDailyQuestMet(env, 1, MD, DQ_CAPTAIN, { totalMatches: 1, dayStats: null, userLeagues: [] });
    const res = classifyQuestShadow({ supported: true, hasStoredRow: false, expectedCompleted: met, storedCompleted: false, expectedRewardEligible: met, storedRewarded: false });
    expect(res).toBe("missing_progress");
  });
});

describe("runDailyQuestShadow performs NO writes", () => {
  it("daily_quest_progress and user_cases are unchanged after a shadow run", async () => {
    await seedJokerPick(1); // joker pick, but NO stored quest progress
    const before = { dqp: await count(`SELECT COUNT(*) n FROM daily_quest_progress`), uc: await count(`SELECT COUNT(*) n FROM user_cases`) };
    const event = buildQuestEvent("prediction_saved", 1, MD, { matchId: "m1" });
    await runDailyQuestShadow(env, event, []);
    const after = { dqp: await count(`SELECT COUNT(*) n FROM daily_quest_progress`), uc: await count(`SELECT COUNT(*) n FROM user_cases`) };
    expect(after.dqp).toBe(before.dqp);
    expect(after.uc).toBe(before.uc);
    // Specifically: shadow did NOT insert the dq_captain row it would have detected.
    expect(await count(`SELECT COUNT(*) n FROM daily_quest_progress WHERE user_id=1 AND quest_id='dq_captain'`)).toBe(0);
  });
});
