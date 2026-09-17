// Оба новых вопроса резолвятся автоматически, но из разных источников, и ошибаются
// они по-разному:
//   both_teams_score  — только из уже финализированного счёта, провайдер не нужен;
//   first_goal_minute — только из /incidents, потому что минуту из счёта не вывести.
// Второй поэтому обязан молчать, когда фид не ответил: замороженное «гола не было»
// обнуляет верный прогноз безвозвратно (тот же класс бага, что чинили для ассистов).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { resolveBothTeamsScoreBonusQuestions, resolveFirstGoalMinuteBonusQuestion } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-new-bonus");
const DAY = "2026-08-18";
const MATCH = "16707704";

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS match_bonus_questions (
      day TEXT NOT NULL,
      match_id TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'advances_team',
      is_enabled INTEGER NOT NULL DEFAULT 0,
      points_award INTEGER NOT NULL DEFAULT 1,
      correct_answer TEXT,
      resolved_at INTEGER,
      resolved_source TEXT,
      status TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, match_id, question_type)
    )
  `).run();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.prepare(`DELETE FROM match_bonus_questions`).run();
});

async function seed(questionType: string, enabled = 1) {
  await db.prepare(
    `INSERT INTO match_bonus_questions (day, match_id, question_type, is_enabled) VALUES (?, ?, ?, ?)`
  ).bind(DAY, MATCH, questionType, enabled).run();
}
async function get(questionType: string) {
  return (await db.prepare(
    `SELECT correct_answer, resolved_at, resolved_source FROM match_bonus_questions WHERE day=? AND match_id=? AND question_type=?`
  ).bind(DAY, MATCH, questionType).first()) as any;
}

describe("both_teams_score", () => {
  it("даёт 'yes', когда забили обе", async () => {
    await seed("both_teams_score");
    await resolveBothTeamsScoreBonusQuestions(env as any, DAY, MATCH, 1, 1);
    const q = await get("both_teams_score");
    expect(q.correct_answer).toBe("yes");
    expect(q.resolved_source).toBe("auto");
  });

  it("даёт 'no' при сухом счёте и при 0:0", async () => {
    await seed("both_teams_score");
    await resolveBothTeamsScoreBonusQuestions(env as any, DAY, MATCH, 3, 0);
    expect((await get("both_teams_score")).correct_answer).toBe("no");

    await db.prepare(`DELETE FROM match_bonus_questions`).run();
    await seed("both_teams_score");
    await resolveBothTeamsScoreBonusQuestions(env as any, DAY, MATCH, 0, 0);
    expect((await get("both_teams_score")).correct_answer).toBe("no");
  });

  it("не трогает выключенный вопрос", async () => {
    await seed("both_teams_score", 0);
    await resolveBothTeamsScoreBonusQuestions(env as any, DAY, MATCH, 1, 1);
    expect((await get("both_teams_score")).resolved_at).toBeNull();
  });

  it("не перетирает ручной ответ администратора", async () => {
    await seed("both_teams_score");
    await db.prepare(
      `UPDATE match_bonus_questions SET correct_answer='no', resolved_at=1, resolved_source='manual' WHERE day=? AND match_id=? AND question_type='both_teams_score'`
    ).bind(DAY, MATCH).run();
    await resolveBothTeamsScoreBonusQuestions(env as any, DAY, MATCH, 2, 2);
    const q = await get("both_teams_score");
    expect(q.correct_answer).toBe("no");
    expect(q.resolved_source).toBe("manual");
  });
});

describe("first_goal_minute", () => {
  it("записывает интервал первого гола", async () => {
    await seed("first_goal_minute");
    await resolveFirstGoalMinuteBonusQuestion(env as any, DAY, MATCH, "31_60");
    const q = await get("first_goal_minute");
    expect(q.correct_answer).toBe("31_60");
    expect(q.resolved_source).toBe("auto");
  });

  it("принимает 'none' как «гола не было»", async () => {
    await seed("first_goal_minute");
    await resolveFirstGoalMinuteBonusQuestion(env as any, DAY, MATCH, "none");
    expect((await get("first_goal_minute")).correct_answer).toBe("none");
  });

  it("отвергает ключ, которого нет среди интервалов, и оставляет вопрос открытым", async () => {
    await seed("first_goal_minute");
    await resolveFirstGoalMinuteBonusQuestion(env as any, DAY, MATCH, "91_120");
    const q = await get("first_goal_minute");
    expect(q.resolved_at).toBeNull();
    expect(q.correct_answer).toBeNull();
  });

  it("не перетирает уже проставленный ответ", async () => {
    await seed("first_goal_minute");
    await resolveFirstGoalMinuteBonusQuestion(env as any, DAY, MATCH, "1_30");
    await resolveFirstGoalMinuteBonusQuestion(env as any, DAY, MATCH, "61_90");
    expect((await get("first_goal_minute")).correct_answer).toBe("1_30");
  });
});
