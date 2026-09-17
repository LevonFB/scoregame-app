// Звёзды не сгорают: остаток предыдущего сезона переезжает в активируемый
// (carryOverSeasonStars, вызывается из activateSeason).
//
// Тест гоняет НАСТОЯЩУЮ экспортированную функцию против локальной D1
// (getPlatformProxy) — именно потому, что вся её корректность живёт в SQL и в
// атомарности batch: три шага (зафиксировать перенос → начислить → списать со
// старого сезона) обязаны применяться вместе, иначе повтор задвоил бы балансы.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { carryOverSeasonStars } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-star-carryover");
const OLD_SEASON = 1;
const NEW_SEASON = 2;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: any;

async function run(sql: string, ...binds: unknown[]) {
  return db.prepare(sql).bind(...binds).run();
}

async function stars(userId: number, season: number): Promise<number> {
  const row = (await db
    .prepare(`SELECT stars FROM user_season_progress WHERE user_id = ? AND season_number = ?`)
    .bind(userId, season)
    .first()) as any;
  return Number(row?.stars ?? 0);
}

beforeAll(async () => {
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as D1Database;
  env = { DB: db };
  await run(`CREATE TABLE IF NOT EXISTS user_season_progress (
    user_id INTEGER NOT NULL, season_number INTEGER NOT NULL,
    stars INTEGER DEFAULT 0, level INTEGER DEFAULT 1,
    PRIMARY KEY(user_id, season_number))`);
  // Схема миграции 0141.
  await run(`CREATE TABLE IF NOT EXISTS star_carryover (
    user_id INTEGER NOT NULL, to_season INTEGER NOT NULL, from_season INTEGER NOT NULL,
    amount INTEGER NOT NULL, applied INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, to_season))`);
});

afterAll(async () => {
  await proxy?.dispose();
  try { rmSync(PERSIST, { recursive: true, force: true }); } catch { /* каталог мог не создаться */ }
});

beforeEach(async () => {
  await run(`DELETE FROM user_season_progress`);
  await run(`DELETE FROM star_carryover`);
});

describe("carryOverSeasonStars", () => {
  it("переносит остаток в новый сезон и списывает со старого", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 250);

    const carried = await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);

    expect(carried).toBe(1);
    expect(await stars(1, NEW_SEASON)).toBe(250);
    expect(await stars(1, OLD_SEASON)).toBe(0);
  });

  it("повторный вызов ничего не задваивает", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 120);

    await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);
    const second = await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);

    expect(second).toBe(0);
    expect(await stars(1, NEW_SEASON)).toBe(120);
  });

  it("складывается с уже начисленным в новом сезоне, а не затирает его", async () => {
    // Порядок не гарантирован: человек мог успеть выполнить задание до переноса.
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 40);
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, NEW_SEASON, 15);

    await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);

    expect(await stars(1, NEW_SEASON)).toBe(55);
  });

  it("нулевые балансы не создают строк переноса", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 0);

    const carried = await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);

    expect(carried).toBe(0);
    const row = (await db.prepare(`SELECT COUNT(*) AS n FROM star_carryover`).first()) as any;
    expect(Number(row?.n ?? 0)).toBe(0);
  });

  it("переносит всех пользователей разом", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 10);
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 2, OLD_SEASON, 20);
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 3, OLD_SEASON, 0);

    const carried = await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);

    expect(carried).toBe(2);
    expect(await stars(1, NEW_SEASON)).toBe(10);
    expect(await stars(2, NEW_SEASON)).toBe(20);
    expect(await stars(3, NEW_SEASON)).toBe(0);
  });

  it("цепочка сезонов не возвращает уже перенесённое", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 90);

    await carryOverSeasonStars(env, OLD_SEASON, NEW_SEASON);
    await carryOverSeasonStars(env, NEW_SEASON, 3);

    expect(await stars(1, 3)).toBe(90);
    expect(await stars(1, NEW_SEASON)).toBe(0);
    expect(await stars(1, OLD_SEASON)).toBe(0);
  });

  it("одинаковые сезоны и мусорные номера игнорируются", async () => {
    await run(`INSERT INTO user_season_progress (user_id, season_number, stars) VALUES (?, ?, ?)`, 1, OLD_SEASON, 70);

    expect(await carryOverSeasonStars(env, OLD_SEASON, OLD_SEASON)).toBe(0);
    expect(await carryOverSeasonStars(env, Number.NaN, NEW_SEASON)).toBe(0);
    expect(await stars(1, OLD_SEASON)).toBe(70);
  });
});
