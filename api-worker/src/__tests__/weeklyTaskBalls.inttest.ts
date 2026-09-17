// Проверяет утверждение аудита экономики 2026-07-22, на котором основана миграция 0131:
// недельные задания начисляют ТОЛЬКО звёзды, а `tasks_catalog.reward_balls` кодом
// игнорируется. Тест намеренно выставляет reward_balls = 2 — ровно то состояние,
// которое лежало в проде до 0131, — и убеждается, что мячи не начисляются.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { checkWeeklyQuests } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-wtb");
// ISO-неделя 2026-W19 = 4–10 мая 2026 (пн–вс), матч ставим в среду внутри окна.
const WEEK_KEY = "2026-W19";
const MATCH_START = "2026-05-06T18:00:00Z";
const DAY = "2026-05-06";
const SEASON_ID = 1;
const USER = 501;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let env: any;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS seasons (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, status TEXT, starts_at TEXT, ends_at TEXT, display_order INTEGER, is_visible INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS matches (match_id TEXT PRIMARY KEY, day TEXT, matchday_key TEXT, start_time TEXT, lock_time TEXT, status TEXT, is_pick INTEGER DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS picks (day TEXT, match_id TEXT, user_id INTEGER, home INTEGER, away INTEGER, joker INTEGER DEFAULT 0, double_chance INTEGER DEFAULT 0, updated_at INTEGER, PRIMARY KEY(day,match_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS results (day TEXT, match_id TEXT, home INTEGER, away INTEGER, PRIMARY KEY(day,match_id))`,
  `CREATE TABLE IF NOT EXISTS pick_bonus_answers (day TEXT, match_id TEXT, user_id INTEGER, question_type TEXT, answer TEXT, PRIMARY KEY(day,match_id,user_id,question_type))`,
  `CREATE TABLE IF NOT EXISTS match_bonus_questions (day TEXT, match_id TEXT, question_type TEXT, is_enabled INTEGER DEFAULT 0, points_award INTEGER DEFAULT 1, correct_answer TEXT, resolved_at INTEGER, PRIMARY KEY(day,match_id,question_type))`,
  `CREATE TABLE IF NOT EXISTS tasks_catalog (task_key TEXT PRIMARY KEY, task_type TEXT, scope TEXT, period_type TEXT, emoji TEXT, title TEXT, description TEXT, reward_stars INTEGER DEFAULT 0, reward_balls INTEGER DEFAULT 0, progress_target INTEGER, progress_kind TEXT, phase TEXT, rarity TEXT, sort_order INTEGER, ranking_based INTEGER DEFAULT 0, is_enabled INTEGER DEFAULT 1, league_only INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS user_task_progress (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, progress INTEGER, completed_at INTEGER, reward_granted INTEGER DEFAULT 0, shown_at INTEGER, PRIMARY KEY(user_id,season_id,task_key,instance_key))`,
  `CREATE TABLE IF NOT EXISTS stars_ledger (user_id INTEGER, season_id INTEGER, source TEXT, task_key TEXT, instance_key TEXT, stars INTEGER, created_at INTEGER, metadata_json TEXT, UNIQUE(user_id,season_id,task_key,instance_key))`,
  `CREATE TABLE IF NOT EXISTS balls_ledger (user_id INTEGER, season_id INTEGER, task_key TEXT, instance_key TEXT, balls INTEGER, source TEXT, created_at INTEGER, UNIQUE(user_id,season_id,task_key,instance_key))`,
  `CREATE TABLE IF NOT EXISTS user_season_progress (user_id INTEGER, season_number INTEGER, stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1, gold_avatar_frame INTEGER DEFAULT 0, PRIMARY KEY(user_id,season_number))`,
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, balls INTEGER DEFAULT 0)`,
  // Нужны, потому что checkWeeklyQuests в конце дергает getWeeklyBonusCaseState →
  // tryGrantTaskCaseReward (Premium case за полный набор глобальных недельных, §10).
  `CREATE TABLE IF NOT EXISTS user_cases (user_id INTEGER, case_type TEXT, quantity INTEGER DEFAULT 0, PRIMARY KEY(user_id,case_type))`,
  `CREATE TABLE IF NOT EXISTS case_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, case_type TEXT, amount INTEGER, quantity_before INTEGER, quantity_after INTEGER, operation_type TEXT, comment TEXT, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS user_boosts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, boost_type TEXT, status TEXT, purchased_at INTEGER, used_at INTEGER, used_on_day TEXT)`,
];

const n = async (sql: string) => Number((await env.DB.prepare(sql).first() as any)?.n ?? 0);

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  env = proxy.env;
  for (const s of SCHEMA) await env.DB.prepare(s).run();
});
afterAll(async () => { await proxy?.dispose(); rmSync(PERSIST, { recursive: true, force: true }); });

beforeEach(async () => {
  for (const t of ["matches", "picks", "results", "pick_bonus_answers", "match_bonus_questions", "tasks_catalog", "user_task_progress", "stars_ledger", "balls_ledger", "user_season_progress", "users", "user_cases", "case_transactions", "user_boosts"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO seasons (id,name,slug,status,starts_at,ends_at,display_order,is_visible,created_at,updated_at) VALUES (?,'S','s','active','2020-01-01T00:00:00Z','2099-12-31T23:59:59Z',1,1,'2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')`).bind(SEASON_ID).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, balls) VALUES (?, 0)`).bind(USER).run();

  // Недельное задание «прогнозы в N игровых дней»: порог 1, чтобы хватило одного пика.
  // reward_balls = 2 — состояние прода до миграции 0131.
  await env.DB.prepare(`
    INSERT OR REPLACE INTO tasks_catalog
      (task_key, task_type, scope, period_type, emoji, title, description,
       reward_stars, reward_balls, progress_target, progress_kind, phase, rarity, sort_order, ranking_based, is_enabled, league_only)
    VALUES ('weekly_active_days_3','seasonal','global','weekly','📅','На дистанции','Прогнозы в игровые дни',
       3, 2, 1, 'counter', 'scores_updated', 'rare', 200, 0, 1, 0)
  `).run();

  await env.DB.prepare(`INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES ('m1', ?, ?, ?, ?, 'FINISHED', 1)`)
    .bind(DAY, DAY, MATCH_START, MATCH_START).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, double_chance, updated_at) VALUES (?, 'm1', ?, 2, 1, 0, 0, 1)`)
    .bind(DAY, USER).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, 'm1', 2, 1)`).bind(DAY).run();
});

describe("недельные задания: звёзды выплачиваются, reward_balls игнорируется", () => {
  it("начисляет звёзды и НЕ начисляет мячи, даже когда reward_balls = 2", async () => {
    await checkWeeklyQuests(env, USER, { weekKey: WEEK_KEY, seasonId: SEASON_ID }, "scores_updated");

    // Звёзды: задание засчитано и оплачено — иначе тест ничего не проверяет.
    expect(await n(`SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id = ${USER} AND task_key = 'weekly_active_days_3'`)).toBe(1);
    expect(await n(`SELECT COALESCE(SUM(stars),0) AS n FROM stars_ledger WHERE user_id = ${USER}`)).toBe(3);

    // Мячи: ни строки в леджере, ни движения баланса, несмотря на reward_balls = 2.
    expect(await n(`SELECT COUNT(*) AS n FROM balls_ledger WHERE user_id = ${USER}`)).toBe(0);
    expect(await n(`SELECT COALESCE(balls,0) AS n FROM users WHERE id = ${USER}`)).toBe(0);
  });

  it("контроль: проверка мячей способна поймать начисление (не всегда-зелёная)", async () => {
    // Если бы код платил мячи, строка в balls_ledger выглядела бы так — убеждаемся,
    // что ассерты выше действительно её увидят.
    await env.DB.prepare(`INSERT INTO balls_ledger (user_id, season_id, task_key, instance_key, balls, source, created_at) VALUES (?, ?, 'weekly_active_days_3', 'week:${WEEK_KEY}', 2, 'task_reward', 1)`)
      .bind(USER, SEASON_ID).run();
    expect(await n(`SELECT COUNT(*) AS n FROM balls_ledger WHERE user_id = ${USER}`)).toBe(1);
  });

  it("повторный вызов не создаёт вторую выплату звёзд (идемпотентность)", async () => {
    await checkWeeklyQuests(env, USER, { weekKey: WEEK_KEY, seasonId: SEASON_ID }, "scores_updated");
    await checkWeeklyQuests(env, USER, { weekKey: WEEK_KEY, seasonId: SEASON_ID }, "scores_updated");
    expect(await n(`SELECT COALESCE(SUM(stars),0) AS n FROM stars_ledger WHERE user_id = ${USER}`)).toBe(3);
    expect(await n(`SELECT COUNT(*) AS n FROM balls_ledger WHERE user_id = ${USER}`)).toBe(0);
  });
});

// ── Правки плана docs/weekly-tasks-plan-2026-07-22.md ──────────────────────────
// Полный набор из трёх канонических недельных заданий + управляемое расписание недели.
describe("недельные задания: адаптивный порог, Double Chance за 2 из 3, изоляция Premium", () => {
  const DAYS = ["2026-05-04", "2026-05-05", "2026-05-06"]; // пн–ср внутри 2026-W19
  const scope = { weekKey: WEEK_KEY, seasonId: SEASON_ID };

  // Заводим ровно `dayCount` игровых дней недели. Матч 1 — точный счёт, остальные —
  // угаданный исход (очки есть, точного счёта нет).
  async function seedWeek(dayCount: number, picksInDays = dayCount) {
    for (const t of ["matches", "picks", "results"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
    for (let i = 0; i < dayCount; i++) {
      const day = DAYS[i];
      const mid = `w${i}`;
      await env.DB.prepare(`INSERT OR REPLACE INTO matches (match_id, day, matchday_key, start_time, lock_time, status, is_pick) VALUES (?, ?, ?, ?, ?, 'FINISHED', 1)`)
        .bind(mid, day, day, `${day}T18:00:00Z`, `${day}T18:00:00Z`).run();
      if (i >= picksInDays) continue;
      await env.DB.prepare(`INSERT OR REPLACE INTO picks (day, match_id, user_id, home, away, joker, double_chance, updated_at) VALUES (?, ?, ?, 2, 1, 0, 0, 1)`)
        .bind(day, mid, USER).run();
      // i === 0 → точный счёт, иначе только исход
      await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, ?, ?, 1)`)
        .bind(day, mid, i === 0 ? 2 : 3).run();
    }
  }

  async function seedThreeQuests() {
    await env.DB.prepare(`DELETE FROM tasks_catalog`).run();
    const rows: Array<[string, string, number, number]> = [
      // task_key, title, reward_stars, progress_target
      ["weekly_active_days_3", "На дистанции", 3, 3],
      ["weekly_points_days_3", "Ровная игра", 3, 3],
      ["global_double_exact_week", "Точный дубль", 6, 2],
    ];
    for (const [key, title, stars, target] of rows) {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO tasks_catalog
          (task_key, task_type, scope, period_type, emoji, title, description,
           reward_stars, reward_balls, progress_target, progress_kind, phase, rarity, sort_order, ranking_based, is_enabled, league_only)
        VALUES (?, 'seasonal','global','weekly','📅', ?, 'x', ?, 0, ?, 'counter', 'scores_updated', 'rare', 200, 0, 1, 0)
      `).bind(key, title, stars, target).run();
    }
  }

  const boosts = () => n(`SELECT COUNT(*) AS n FROM user_boosts WHERE user_id = ${USER} AND boost_type = 'double_chance'`);
  const premium = () => n(`SELECT COALESCE(quantity,0) AS n FROM user_cases WHERE user_id = ${USER} AND case_type = 'premium'`);

  beforeEach(seedThreeQuests);

  it("короткая неделя (2 игровых дня): порог 3 сжимается до 2, задания засчитываются", async () => {
    await seedWeek(2);
    await checkWeeklyQuests(env, USER, scope, "scores_updated");

    // Оба «дневных» задания закрыты, хотя progress_target = 3, а дней всего 2.
    expect(await n(`SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id = ${USER} AND task_key = 'weekly_active_days_3'`)).toBe(1);
    expect(await n(`SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id = ${USER} AND task_key = 'weekly_points_days_3'`)).toBe(1);
    // «Точный дубль» требует 2 точных счёта — угадан только один, задание не закрыто.
    expect(await n(`SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id = ${USER} AND task_key = 'global_double_exact_week'`)).toBe(0);
  });

  it("полная неделя (3 дня), прогнозы только в 2: порог остаётся 3, задание НЕ закрыто", async () => {
    await seedWeek(3, 2);
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    expect(await n(`SELECT COUNT(*) AS n FROM stars_ledger WHERE user_id = ${USER} AND task_key = 'weekly_active_days_3'`)).toBe(0);
    expect(await boosts()).toBe(0); // и веха «2 из 3» тоже не достигнута
  });

  it("2 из 3 → ровно один Double Chance, Premium не выдаётся", async () => {
    await seedWeek(2);
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    expect(await boosts()).toBe(1);
    expect(await premium()).toBe(0);
  });

  it("повторные вызовы не выдают второй Double Chance (идемпотентность)", async () => {
    await seedWeek(2);
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    expect(await boosts()).toBe(1);
  });

  it("3 из 3 → и Double Chance, и Premium", async () => {
    await seedWeek(3);
    // Второй точный счёт, чтобы закрыть «Точный дубль» (2 совпадения).
    await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, 'w1', 2, 1)`).bind(DAYS[1]).run();
    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    expect(await boosts()).toBe(1);
    expect(await premium()).toBe(1);
  });

  it("новое глобальное недельное задание НЕ ужесточает Premium (изоляция набора)", async () => {
    await seedWeek(3);
    await env.DB.prepare(`INSERT OR REPLACE INTO results (day, match_id, home, away) VALUES (?, 'w1', 2, 1)`).bind(DAYS[1]).run();
    // Четвёртое глобальное задание, заведомо невыполнимое.
    await env.DB.prepare(`
      INSERT OR REPLACE INTO tasks_catalog
        (task_key, task_type, scope, period_type, emoji, title, description,
         reward_stars, reward_balls, progress_target, progress_kind, phase, rarity, sort_order, ranking_based, is_enabled, league_only)
      VALUES ('weekly_future_quest','seasonal','global','weekly','🆕','Новое','x', 5, 0, 99, 'counter', 'scores_updated', 'rare', 300, 0, 1, 0)
    `).run();

    await checkWeeklyQuests(env, USER, scope, "scores_updated");
    expect(await premium()).toBe(1); // до правки было бы 0: defs.length стал бы 4
  });
});
