// Резолв четырёх новых типов на живой D1. Проверяется не столько «верный ответ» (его
// покрывают юнит-тесты чистых функций), сколько граничное поведение записи: вопрос,
// который уже решён, повторно не переписывается, выключенный не трогается вовсе, а
// «у кого больше» без своей метрики в статистике остаётся открытым.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import {
  resolveCleanSheetBonusQuestions,
  resolveTeamTotalGoalsBonusQuestions,
  resolveStatLeaderBonusQuestion,
  savePickBonusAnswers,
} from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-bonus-types");
const DAY = "2026-08-29";
const MATCH = "17001122";

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
      rule_json TEXT,
      status TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, match_id, question_type)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pick_bonus_answers (
      day TEXT NOT NULL,
      match_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'advances_team',
      answer TEXT NOT NULL,
      is_correct INTEGER,
      reward_stars INTEGER DEFAULT 0,
      reward_granted_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (day, match_id, user_id, question_type)
    )
  `).run();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.prepare(`DELETE FROM match_bonus_questions`).run();
  await db.prepare(`DELETE FROM pick_bonus_answers`).run();
});

async function seed(questionType: string, opts: { enabled?: number; rule?: object } = {}) {
  await db.prepare(
    `INSERT INTO match_bonus_questions (day, match_id, question_type, is_enabled, rule_json) VALUES (?, ?, ?, ?, ?)`
  ).bind(DAY, MATCH, questionType, opts.enabled ?? 1, opts.rule ? JSON.stringify(opts.rule) : null).run();
}
async function get(questionType: string) {
  return (await db.prepare(
    `SELECT correct_answer, resolved_at, resolved_source FROM match_bonus_questions WHERE day=? AND match_id=? AND question_type=?`
  ).bind(DAY, MATCH, questionType).first()) as any;
}

describe("clean_sheet", () => {
  it("закрывается счётом без обращения к провайдеру", async () => {
    await seed("clean_sheet");
    await resolveCleanSheetBonusQuestions(env as any, DAY, MATCH, 2, 0);
    const q = await get("clean_sheet");
    expect(q.correct_answer).toBe("home");
    expect(q.resolved_source).toBe("auto");
  });

  it("не трогает выключенный вопрос", async () => {
    await seed("clean_sheet", { enabled: 0 });
    await resolveCleanSheetBonusQuestions(env as any, DAY, MATCH, 1, 0);
    expect((await get("clean_sheet")).correct_answer).toBeNull();
  });

  it("не переписывает уже решённый вопрос", async () => {
    await seed("clean_sheet");
    await resolveCleanSheetBonusQuestions(env as any, DAY, MATCH, 1, 0);
    await resolveCleanSheetBonusQuestions(env as any, DAY, MATCH, 0, 1);
    expect((await get("clean_sheet")).correct_answer).toBe("home");
  });
});

describe("team_total_goals", () => {
  it("считает голы стороны из правила, а не тотал матча", async () => {
    await seed("team_total_goals", { rule: { metric: "goals", side: "away", operator: "gte", threshold: 2 } });
    await resolveTeamTotalGoalsBonusQuestions(env as any, DAY, MATCH, 3, 1);
    expect((await get("team_total_goals")).correct_answer).toBe("no");
  });

  it("правило без стороны ведёт себя как тотал матча", async () => {
    await seed("team_total_goals", { rule: { metric: "goals", operator: "gte", threshold: 4 } });
    await resolveTeamTotalGoalsBonusQuestions(env as any, DAY, MATCH, 3, 1);
    expect((await get("team_total_goals")).correct_answer).toBe("yes");
  });

  it("без правила остаётся открытым", async () => {
    await seed("team_total_goals");
    await resolveTeamTotalGoalsBonusQuestions(env as any, DAY, MATCH, 3, 1);
    expect((await get("team_total_goals")).correct_answer).toBeNull();
  });
});

describe("stat_leader", () => {
  it("сравнивает стороны настроенной метрики", async () => {
    await seed("stat_leader", { rule: { metric: "shots", operator: "gte", threshold: 0 } });
    await resolveStatLeaderBonusQuestion(env as any, DAY, MATCH, {
      shots: { home: 9, away: 14 },
      corners: { home: 8, away: 1 },
    });
    expect((await get("stat_leader")).correct_answer).toBe("away");
  });

  it("равенство показателя — это «поровну», а не пустой ответ", async () => {
    await seed("stat_leader", { rule: { metric: "corners", operator: "gte", threshold: 0 } });
    await resolveStatLeaderBonusQuestion(env as any, DAY, MATCH, { corners: { home: 5, away: 5 } });
    expect((await get("stat_leader")).correct_answer).toBe("none");
  });

  it("без нужной метрики в статистике вопрос остаётся открытым", async () => {
    await seed("stat_leader", { rule: { metric: "possession", operator: "gte", threshold: 0 } });
    await resolveStatLeaderBonusQuestion(env as any, DAY, MATCH, { possession: null, corners: { home: 5, away: 2 } });
    const q = await get("stat_leader");
    expect(q.correct_answer).toBeNull();
    expect(q.resolved_at).toBeNull();
  });
});

// Сквозная проверка связки «ответ игрока ↔ ответ резолвера». Ломается она не в
// арифметике, а на ключах: вариант, предложенный игроку, и значение, записанное
// резолвером, должны совпасть посимвольно — грант считает ответ верным ровно по
// строгому равенству строк. Сама выдача звёзд здесь не вызывается: она общая для всех
// типов и от нового вопроса не зависит, поэтому проверяется именно совпадение.
async function savedAnswer(userId: number, questionType: string) {
  return (await db.prepare(
    `SELECT answer FROM pick_bonus_answers WHERE day=? AND match_id=? AND user_id=? AND question_type=?`
  ).bind(DAY, MATCH, userId, questionType).first()) as any;
}

describe("ответ игрока совпадает с ответом резолвера", () => {
  it("clean_sheet: «обе на ноль» сохраняется и совпадает на 0:0", async () => {
    await seed("clean_sheet");
    await savePickBonusAnswers(env as any, DAY, 501, MATCH, { clean_sheet: "both" });
    expect((await savedAnswer(501, "clean_sheet")).answer).toBe("both");

    await resolveCleanSheetBonusQuestions(env as any, DAY, MATCH, 0, 0);
    const question = await get("clean_sheet");
    expect(question.correct_answer).toBe((await savedAnswer(501, "clean_sheet")).answer);
  });

  it("stat_leader: «поровну» сохраняется и совпадает при равных угловых", async () => {
    await seed("stat_leader", { rule: { metric: "corners", operator: "gte", threshold: 0 } });
    await savePickBonusAnswers(env as any, DAY, 502, MATCH, { stat_leader: "none" });
    expect((await savedAnswer(502, "stat_leader")).answer).toBe("none");

    await resolveStatLeaderBonusQuestion(env as any, DAY, MATCH, { corners: { home: 4, away: 4 } });
    const question = await get("stat_leader");
    expect(question.correct_answer).toBe((await savedAnswer(502, "stat_leader")).answer);
  });

  it("team_total_goals: ответ «нет» расходится с верным «да» и не совпадает", async () => {
    await seed("team_total_goals", { rule: { metric: "goals", side: "home", operator: "gte", threshold: 2 } });
    await savePickBonusAnswers(env as any, DAY, 503, MATCH, { team_total_goals: "no" });
    await resolveTeamTotalGoalsBonusQuestions(env as any, DAY, MATCH, 3, 0);
    const question = await get("team_total_goals");
    expect(question.correct_answer).toBe("yes");
    expect((await savedAnswer(503, "team_total_goals")).answer).toBe("no");
  });

  it("выключенный вопрос ответ не принимает", async () => {
    await seed("penalty_awarded", { enabled: 0 });
    await savePickBonusAnswers(env as any, DAY, 504, MATCH, { penalty_awarded: "yes" });
    expect(await savedAnswer(504, "penalty_awarded")).toBeNull();
  });
});
