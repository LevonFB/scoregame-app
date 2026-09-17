import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { checkDailyQuests, evaluateDailyQuestMet, runDailyQuestShadow } from "../index";
import { buildQuestEvent, classifyQuestShadow } from "../questShadow";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-qc");
const DAY = "2026-05-03";
let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let env: any;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY, day TEXT, matchday_key TEXT, start_time TEXT, lock_time TEXT, status TEXT, is_pick INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(day,match_id,user_id))`,
  // Minimal `results` table — only the columns the dq_read_game evaluator joins on
  // (match_id, day) and compares (home, away). Test-fixture only; not production schema.
  `CREATE TABLE IF NOT EXISTS results (day TEXT, match_id TEXT, home INTEGER, away INTEGER, PRIMARY KEY(day,match_id))`,
  `CREATE TABLE IF NOT EXISTS user_day_stats (user_id INTEGER, day TEXT, points INTEGER DEFAULT 0, outcome_count INTEGER DEFAULT 0, diff_count INTEGER DEFAULT 0, exact_count INTEGER DEFAULT 0, had_joker INTEGER DEFAULT 0, joker_points INTEGER DEFAULT 0, earliest_pick_time INTEGER, PRIMARY KEY(user_id,day))`,
  `CREATE TABLE IF NOT EXISTS daily_quest_progress (user_id INTEGER, day TEXT, quest_id TEXT, completed INTEGER DEFAULT 0, stars_awarded INTEGER DEFAULT 0, completed_at INTEGER, PRIMARY KEY(user_id,day,quest_id))`,
  `CREATE TABLE IF NOT EXISTS daily_cases (user_id INTEGER, day TEXT, earned INTEGER DEFAULT 0, earned_at INTEGER, opened_at INTEGER, PRIMARY KEY(user_id,day))`,
  `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,case_type))`,
  `CREATE TABLE IF NOT EXISTS case_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, case_type TEXT, amount INTEGER, quantity_before INTEGER, quantity_after INTEGER, operation_type TEXT, comment TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS user_task_progress (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, progress INTEGER, completed_at INTEGER, reward_granted INTEGER DEFAULT 0, shown_at INTEGER, PRIMARY KEY(user_id,season_id,task_key,instance_key))`,
  `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id,season_id,task_key,instance_key))`,
  `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY(user_id,season_number))`,
  `CREATE TABLE IF NOT EXISTS scores_agg (user_id INTEGER, period TEXT, points INTEGER DEFAULT 0, PRIMARY KEY(user_id,period))`,
  `CREATE TABLE IF NOT EXISTS tasks_catalog (task_key TEXT PRIMARY KEY, sort_order INTEGER, is_enabled INTEGER, league_only INTEGER, reward_stars INTEGER, emoji TEXT, phase TEXT, rarity TEXT)`,
  `CREATE TABLE IF NOT EXISTS leagues (id TEXT PRIMARY KEY, owner_id INTEGER, type TEXT, name TEXT, created_at TEXT, deleted_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS league_members (league_id TEXT, user_id INTEGER, PRIMARY KEY(league_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS league_day_stats (league_id TEXT, day TEXT, user_id INTEGER, points INTEGER DEFAULT 0, exact_count INTEGER DEFAULT 0, joker_points INTEGER DEFAULT 0, earliest_pick_time INTEGER, PRIMARY KEY(league_id,day,user_id))`,
];

async function resetData() {
  for (const t of ["matches", "picks", "results", "user_day_stats", "daily_quest_progress", "daily_cases", "user_cases", "case_transactions", "user_task_progress", "stars_ledger", "user_season_progress", "scores_agg", "league_members", "league_day_stats", "leagues"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}
const q = (id: string, league = false, phase = "pick_saved") => ({ id, stars: 1, league, phase });
const met = (uid: number, quest: any, ctx: any) => evaluateDailyQuestMet(env, uid, DAY, quest, ctx);
const N = async (sql: string) => Number((await env.DB.prepare(sql).first() as any)?.n ?? 0);

async function seedPickMatch(uid: number, joker = 0, lockFuture = true) {
  const lock = lockFuture ? "2099-01-01T17:55:00Z" : "2000-01-01T00:00:00Z";
  await env.DB.prepare(`INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('m1', ?, ?, '2099-01-01T18:00:00Z', ?, 'TIMED', 1)`).bind(DAY, DAY, lock).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, updated_at) VALUES (?, 'm1', ?, 1, 0, ?, 1)`).bind(DAY, uid, joker).run();
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  env = proxy.env;
  for (const s of SCHEMA) await env.DB.prepare(s).run();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });
beforeEach(async () => {
  await resetData();
  await env.DB.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible,created_at,updated_at) VALUES (1,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`).run();
});

// ── Part A: per-quest met / not-met via the SHARED evaluator (isolated) ──
describe("per-quest met / not-met (shared evaluateDailyQuestMet)", () => {
  it("dq_full_day", async () => {
    await seedPickMatch(1, 0, true);
    expect(await met(1, q("dq_full_day"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(true);
    expect(await met(2, q("dq_full_day"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(false); // user 2 no pick
  });
  it("dq_early_start", async () => {
    await seedPickMatch(1, 0, true); // pick now, match start 2099 → >3h early
    expect(await met(1, q("dq_early_start"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(true);
    expect(await met(2, q("dq_early_start"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(false);
  });
  it("dq_captain", async () => {
    await seedPickMatch(1, 1, true); // joker pick
    await seedPickMatch(2, 0, true);
    expect(await met(1, q("dq_captain"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(true);
    expect(await met(2, q("dq_captain"), { totalMatches: 1, dayStats: null, userLeagues: [] })).toBe(false);
  });
  it("dq_read_game", async () => {
    // dq_read_game is evaluated from a real picks⋈results⋈matches join (sign of the pick must
    // match the sign of the result), NOT from dayStats — so seed an actual pick + result.
    await seedPickMatch(1, 0, true); // pick home=1, away=0 (home-win sign)
    await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, 'm1', 2, 1)`).bind(DAY).run();
    expect(await met(1, q("dq_read_game", false, "scores_updated"), { totalMatches: 1, dayStats: { outcome_count: 1 }, userLeagues: [] })).toBe(true);
    // sign mismatch (pick home-win vs result away-win) → not a genuine read
    await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, 'm1', 0, 2)`).bind(DAY).run();
    expect(await met(1, q("dq_read_game", false, "scores_updated"), { totalMatches: 1, dayStats: { outcome_count: 0, diff_count: 0, exact_count: 0 }, userLeagues: [] })).toBe(false);
  });
  it("dq_feel_score", async () => {
    expect(await met(1, q("dq_feel_score", false, "scores_updated"), { totalMatches: 1, dayStats: { diff_count: 1 }, userLeagues: [] })).toBe(true);
    expect(await met(1, q("dq_feel_score", false, "scores_updated"), { totalMatches: 1, dayStats: { diff_count: 0 }, userLeagues: [] })).toBe(false);
  });
  it("dq_exact_score", async () => {
    expect(await met(1, q("dq_exact_score", false, "scores_updated"), { totalMatches: 1, dayStats: { exact_count: 1 }, userLeagues: [] })).toBe(true);
    expect(await met(1, q("dq_exact_score", false, "scores_updated"), { totalMatches: 1, dayStats: { exact_count: 0 }, userLeagues: [] })).toBe(false);
  });
  it("dq_joker_played", async () => {
    expect(await met(1, q("dq_joker_played", false, "scores_updated"), { totalMatches: 1, dayStats: { had_joker: 1, joker_points: 3 }, userLeagues: [] })).toBe(true);
    expect(await met(1, q("dq_joker_played", false, "scores_updated"), { totalMatches: 1, dayStats: { had_joker: 1, joker_points: 0 }, userLeagues: [] })).toBe(false);
  });
  it("dq_league_points", async () => {
    expect(await met(1, q("dq_league_points", true, "scores_updated"), { totalMatches: 1, dayStats: { points: 2 }, userLeagues: ["L1"] })).toBe(true);
    expect(await met(1, q("dq_league_points", true, "scores_updated"), { totalMatches: 1, dayStats: { points: 0 }, userLeagues: ["L1"] })).toBe(false);
    expect(await met(1, q("dq_league_points", true, "scores_updated"), { totalMatches: 1, dayStats: { points: 2 }, userLeagues: [] })).toBe(false); // no league
  });
  it("dq_league_win", async () => {
    // all matches finished + user top of league_day_stats (>=2 participants) + points>0
    await env.DB.prepare(`INSERT INTO matches (match_id, day, matchday_key, lock_time, status, is_pick) VALUES ('m1', ?, ?, '2000-01-01T00:00:00Z', 'FINISHED', 1)`).bind(DAY, DAY).run();
    await env.DB.prepare(`INSERT INTO leagues (id, owner_id, type) VALUES ('L1', 1, 'private')`).run();
    await env.DB.prepare(`INSERT INTO league_day_stats (league_id, day, user_id, points) VALUES ('L1', ?, 1, 10), ('L1', ?, 2, 3)`).bind(DAY, DAY).run();
    expect(await met(1, q("dq_league_win", true, "scores_updated"), { totalMatches: 1, dayStats: { points: 10 }, userLeagues: ["L1"] })).toBe(true);
    expect(await met(2, q("dq_league_win", true, "scores_updated"), { totalMatches: 1, dayStats: { points: 3 }, userLeagues: ["L1"] })).toBe(false); // not #1
  });
});

// ── Part B: legacy apply == shadow compute (match) + shadow writes nothing ──
describe("legacy reconcile vs shadow (full cascade)", () => {
  it("pick_saved quests: legacy completes them and shadow classifies match; shadow writes nothing", async () => {
    await seedPickMatch(1, 1, true); // joker pick before lock, early → full_day + early_start + captain met
    await checkDailyQuests(env, 1, DAY, "pick_saved", []); // legacy apply (full cascade)

    const stored = new Map<string, any>();
    for (const r of (await env.DB.prepare(`SELECT quest_id, completed, stars_awarded FROM daily_quest_progress WHERE user_id=1 AND day=?`).bind(DAY).all() as any).results) stored.set(r.quest_id, r);
    for (const id of ["dq_full_day", "dq_early_start", "dq_captain"]) {
      expect(stored.get(id)?.completed, `${id} applied by legacy`).toBe(1);
      const m = await met(1, q(id), { totalMatches: 1, dayStats: null, userLeagues: [] });
      const res = classifyQuestShadow({ supported: true, hasStoredRow: true, expectedCompleted: m, storedCompleted: true, expectedRewardEligible: m, storedRewarded: (stored.get(id)?.stars_awarded ?? 0) > 0 });
      expect(res, `${id} shadow==legacy`).toBe("match");
    }

    const before = { dqp: await N(`SELECT COUNT(*) n FROM daily_quest_progress`), led: await N(`SELECT COUNT(*) n FROM stars_ledger`), usp: await N(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress`) };
    await runDailyQuestShadow(env, buildQuestEvent("prediction_saved", 1, DAY, { matchId: "m1" }), []);
    const after = { dqp: await N(`SELECT COUNT(*) n FROM daily_quest_progress`), led: await N(`SELECT COUNT(*) n FROM stars_ledger`), usp: await N(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress`) };
    expect(after).toEqual(before); // shadow changed nothing
  });

  it("event apply is idempotent: repeating checkDailyQuests does not duplicate reward", async () => {
    await seedPickMatch(1, 1, true);
    await checkDailyQuests(env, 1, DAY, "pick_saved", []);
    const snap = { dqp: await N(`SELECT COUNT(*) n FROM daily_quest_progress WHERE user_id=1`), led: await N(`SELECT COUNT(*) n FROM stars_ledger WHERE user_id=1`), stars: await N(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=1`) };
    await checkDailyQuests(env, 1, DAY, "pick_saved", []); // repeat same event
    const snap2 = { dqp: await N(`SELECT COUNT(*) n FROM daily_quest_progress WHERE user_id=1`), led: await N(`SELECT COUNT(*) n FROM stars_ledger WHERE user_id=1`), stars: await N(`SELECT COALESCE(SUM(stars),0) n FROM user_season_progress WHERE user_id=1`) };
    expect(snap2).toEqual(snap); // no duplicate progress / ledger / stars
    expect(snap.led).toBeGreaterThanOrEqual(1);
  });
});

// ── Part C: already-completed / missing / repeat edge cases ──
describe("edge cases", () => {
  it("already completed (met + stored) → match", async () => {
    await seedPickMatch(1, 1, true);
    await env.DB.prepare(`INSERT INTO daily_quest_progress (user_id, day, quest_id, completed, stars_awarded) VALUES (1, ?, 'dq_captain', 1, 1)`).bind(DAY).run();
    const m = await met(1, q("dq_captain"), { totalMatches: 1, dayStats: null, userLeagues: [] });
    expect(classifyQuestShadow({ supported: true, hasStoredRow: true, expectedCompleted: m, storedCompleted: true, expectedRewardEligible: m, storedRewarded: true })).toBe("match");
  });
  it("met but missing stored row → missing_progress", async () => {
    await seedPickMatch(1, 1, true);
    const m = await met(1, q("dq_captain"), { totalMatches: 1, dayStats: null, userLeagues: [] });
    expect(classifyQuestShadow({ supported: true, hasStoredRow: false, expectedCompleted: m, storedCompleted: false, expectedRewardEligible: m, storedRewarded: false })).toBe("missing_progress");
  });
  it("repeated shadow run writes nothing", async () => {
    await seedPickMatch(1, 1, true);
    const before = await N(`SELECT COUNT(*) n FROM daily_quest_progress`);
    const ev = buildQuestEvent("prediction_saved", 1, DAY, { matchId: "m1" });
    await runDailyQuestShadow(env, ev, []);
    await runDailyQuestShadow(env, ev, []);
    expect(await N(`SELECT COUNT(*) n FROM daily_quest_progress`)).toBe(before);
  });
});
