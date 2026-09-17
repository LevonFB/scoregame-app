// Regression test for the #7 fix: player-based bonus questions must NOT be
// auto-resolved to "no" when the provider returned no scorer data, unless the
// match is a confirmed goalless result (forceNoGoals). Otherwise a real scorer
// gets marked wrong and the reward is silently lost, with the question frozen
// as auto-resolved. Calls the real exported resolver functions against a local D1.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";
import { resolvePlayerBonusQuestions, resolveUserGoalscorerBonusQuestions } from "../index";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-bonus-resolve");
const DAY = "2026-07-10";
const MATCH = "m1";

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;
let env: { DB: D1Database };

async function createSchema() {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS match_bonus_questions (
      day TEXT NOT NULL,
      match_id TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'advances_team',
      is_enabled INTEGER NOT NULL DEFAULT 0,
      points_award INTEGER NOT NULL DEFAULT 1,
      correct_answer TEXT,
      target_player_id TEXT,
      target_player_name TEXT,
      player_config_json TEXT,
      resolved_at INTEGER,
      resolved_source TEXT,
      status TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, match_id, question_type)
    )
  `).run();
}

async function seedPlayerScores(targetId: string, targetName: string) {
  await db.prepare(`
    INSERT INTO match_bonus_questions (day, match_id, question_type, is_enabled, target_player_id, target_player_name)
    VALUES (?, ?, 'player_scores', 1, ?, ?)
  `).bind(DAY, MATCH, targetId, targetName).run();
}

async function seedUserGoalscorer() {
  await db.prepare(`
    INSERT INTO match_bonus_questions (day, match_id, question_type, is_enabled, player_config_json)
    VALUES (?, ?, 'user_goalscorer', 1, '{}')
  `).bind(DAY, MATCH).run();
}

async function getQuestion(questionType: string) {
  return (await db.prepare(
    `SELECT correct_answer, resolved_at, resolved_source FROM match_bonus_questions WHERE day=? AND match_id=? AND question_type=?`
  ).bind(DAY, MATCH, questionType).first()) as any;
}

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  env = { DB: db };
  await createSchema();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.prepare(`DELETE FROM match_bonus_questions`).run();
});

describe("#7 player_scores resolve safety", () => {
  it("does NOT resolve to 'no' when provider gave no scorer data and match is not goalless", async () => {
    await seedPlayerScores("p99", "Some Player");
    // Empty scorer data, forceNoGoals=false → must stay unresolved.
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_scores", [], [], false);
    const q = await getQuestion("player_scores");
    expect(q.resolved_at).toBeNull();
    expect(q.correct_answer).toBeNull();
  });

  it("resolves to 'no' on empty data ONLY when the match is a confirmed 0:0 (forceNoGoals)", async () => {
    await seedPlayerScores("p99", "Some Player");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_scores", [], [], true);
    const q = await getQuestion("player_scores");
    expect(q.resolved_at).not.toBeNull();
    expect(q.correct_answer).toBe("no");
  });

  it("resolves to 'yes' when the target player id is among the scorers", async () => {
    await seedPlayerScores("p42", "Scoring Star");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_scores", ["p42", "p7"], ["Scoring Star", "Other"], false);
    const q = await getQuestion("player_scores");
    expect(q.correct_answer).toBe("yes");
    expect(q.resolved_source).toBe("auto");
  });

  it("resolves to 'no' when scorers exist but the target is not among them", async () => {
    await seedPlayerScores("p42", "Scoring Star");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_scores", ["p7"], ["Other"], false);
    const q = await getQuestion("player_scores");
    expect(q.correct_answer).toBe("no");
  });
});

describe("player_assists resolve safety", () => {
  async function seedPlayerAssists(targetId: string, targetName: string) {
    await db.prepare(`
      INSERT INTO match_bonus_questions (day, match_id, question_type, is_enabled, target_player_id, target_player_name)
      VALUES (?, ?, 'player_assists', 1, ?, ?)
    `).bind(DAY, MATCH, targetId, targetName).run();
  }

  it("stays open when the feed carried no assist data at all", async () => {
    await seedPlayerAssists("p99", "Some Player");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_assists", [], [], false);
    const q = await getQuestion("player_assists");
    expect(q.resolved_at).toBeNull();
    expect(q.correct_answer).toBeNull();
  });

  it("resolves to 'no' when an assist was ruled out (every goal a penalty/own goal, or 0:0)", async () => {
    await seedPlayerAssists("p99", "Some Player");
    // The caller passes forceNoGoals=true for assistNoneProven as well as for 0:0.
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_assists", [], [], true);
    const q = await getQuestion("player_assists");
    expect(q.correct_answer).toBe("no");
    expect(q.resolved_source).toBe("auto");
  });

  it("resolves to 'yes' when the target player is among the assistants", async () => {
    await seedPlayerAssists("p42", "Playmaker");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_assists", ["p42"], ["Playmaker"], false);
    const q = await getQuestion("player_assists");
    expect(q.correct_answer).toBe("yes");
  });

  it("resolves to 'no' when assists exist but the target is not among them", async () => {
    await seedPlayerAssists("p42", "Playmaker");
    await resolvePlayerBonusQuestions(env as any, DAY, MATCH, "player_assists", ["p7"], ["Other"], false);
    const q = await getQuestion("player_assists");
    expect(q.correct_answer).toBe("no");
  });
});

describe("#7 user_goalscorer resolve safety (already-safe path, guarded)", () => {
  it("does NOT resolve with empty scorer data unless forceNoGoals", async () => {
    await seedUserGoalscorer();
    await resolveUserGoalscorerBonusQuestions(env as any, DAY, MATCH, [], [], false);
    const q = await getQuestion("user_goalscorer");
    expect(q.resolved_at).toBeNull();
  });

  it("resolves with empty scorers when the match is a confirmed 0:0", async () => {
    await seedUserGoalscorer();
    await resolveUserGoalscorerBonusQuestions(env as any, DAY, MATCH, [], [], true);
    const q = await getQuestion("user_goalscorer");
    expect(q.resolved_at).not.toBeNull();
    expect(q.correct_answer).toBe("[]");
  });
});
