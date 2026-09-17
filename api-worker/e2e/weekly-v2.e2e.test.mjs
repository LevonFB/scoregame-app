// Weekly Challenge Tasks V2 release-gate smoke.
// Real local api-worker HTTP endpoints, isolated Miniflare D1 only.
//
// Run: node --test --test-concurrency=1 e2e/weekly-v2.e2e.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";
import { buildInitData } from "./helpers/initData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");

const BOT_TOKEN = "123456:E2E-TEST-TOKEN";
const INTERNAL_SECRET = "e2e-internal-secret";
const USER = { id: 777777, first_name: "Weekly User", username: "weekly_user" };
const ADMIN = { id: 111111, first_name: "Weekly Admin", username: "weekly_admin" };
const USER_INIT = buildInitData(USER, BOT_TOKEN);
const ADMIN_INIT = buildInitData(ADMIN, BOT_TOKEN);

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}

const d1 = (persistTo, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--command", sql]);
const d1file = (persistTo, file) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--file", file]);
const d1json = (persistTo, sql) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--command", sql, "--json"]);

function d1num(persistTo, sql) {
  const out = d1json(persistTo, sql);
  const match = out.match(/"n"\s*:\s*(-?\d+)/);
  return match ? Number(match[1]) : 0;
}

function freshEnv(name) {
  const persistTo = `.wrangler-e2e-weekly-v2-${name}`;
  rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  d1file(persistTo, "e2e/fixtures/schema.sql");
  d1file(persistTo, "e2e/fixtures/seed.sql");
  d1file(persistTo, "e2e/fixtures/weekly-v2.sql");
  return persistTo;
}

async function boot(persistTo, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true,
    persistTo,
    experimental: { disableExperimentalWarning: true },
    vars: {
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      ANTI_ABUSE_DISABLE: "true",
      ADMIN_IDS: String(ADMIN.id),
      ALLOWED_ORIGIN: "*",
      DAILY_CASE_LAZY_FALLBACK_ENABLED: "false",
      WEEKLY_FINALIZER_V2_ENABLED: "false",
      ...vars,
    },
  });
}

function authHeaders(initData) {
  return {
    "content-type": "application/json",
    "x-internal-secret": INTERNAL_SECRET,
    "x-scoregame-internal-source": "front-worker",
    "x-telegram-init-data": initData,
  };
}

const userHeaders = () => authHeaders(USER_INIT);
const adminHeaders = () => authHeaders(ADMIN_INIT);

async function requestJson(worker, path, { method = "GET", headers = userHeaders(), body } = {}) {
  const res = await worker.fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function expectOk(response, label) {
  assert.equal(response.status, 200, `${label} status ${response.status}: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.ok, true, `${label} ok`);
  return response.body;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function matchPool() {
  const base = nowSeconds() + 86400;
  return [
    ["PL", "Arsenal", "Manchester City"],
    ["PD", "Real Madrid", "Barcelona"],
    ["SA", "Inter", "Juventus"],
    ["BL1", "Bayern", "Borussia Dortmund"],
    ["FL1", "PSG", "Marseille"],
  ].map(([tournament_code, home_team_name, away_team_name], index) => ({
    tournament_code,
    home_team_name,
    away_team_name,
    kickoff_at: base + index * 3600,
    provider: "e2e",
    provider_match_id: `e2e-${index + 1}`,
  }));
}

const QUESTION_KEYS = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"];
const OPTION_IDS = {
  match_of_week: ["home", "draw", "away"],
  league_of_week: ["PL", "PD", "SA"],
  duel_of_week: ["player_a", "player_b", "equal"],
  upset_of_week: ["upset_a", "no_upset"],
  event_of_week: ["yes", "no"],
};
const CORRECT = {
  match_of_week: "home",
  league_of_week: "PL",
  duel_of_week: "player_a",
  upset_of_week: "upset_a",
  event_of_week: "yes",
};

function questions({ disabledKey = null } = {}) {
  return QUESTION_KEYS.map((key, index) => ({
    question_key: key,
    title: `Question ${index + 1}`,
    description: `E2E ${key}`,
    question_type: "single_select",
    status: key === disabledKey ? "disabled" : "active",
    sort_order: (index + 1) * 10,
    options: OPTION_IDS[key].map((id) => ({ id, label: `${key}:${id}` })),
    config: {},
  }));
}

function answers(overrides = {}) {
  return { ...CORRECT, ...overrides };
}

async function createChallengeDraft(worker, {
  code = `weekly_v2_${Date.now()}`,
  title = "Weekly V2 E2E",
  schema = 2,
  bonus = "upset",
} = {}) {
  const created = expectOk(await requestJson(worker, "/admin/season-predictions/weekly-challenges", {
    method: "POST",
    headers: adminHeaders(),
    body: {
      code,
      title,
      description: "E2E challenge",
      status: "draft",
      open_at: nowSeconds() - 60,
      deadline_at: nowSeconds() + 86400,
      close_at: nowSeconds() + 172800,
      task_schema_version: schema,
      bonus_question_key: bonus,
    },
  }), "create challenge");
  return created.challenge;
}

async function setupChallenge(worker, opts = {}) {
  const challenge = await createChallengeDraft(worker, opts);
  const id = challenge.id;
  expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${id}/matches`, {
    method: "PUT",
    headers: adminHeaders(),
    body: { matches: matchPool() },
  }), "save matches");
  const savedQuestions = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${id}/questions`, {
    method: "PUT",
    headers: adminHeaders(),
    body: { questions: questions({ disabledKey: opts.disabledKey || null }) },
  }), "save questions");
  return { challenge, questions: savedQuestions.questions };
}

async function activateChallenge(worker, id, patch = {}) {
  return requestJson(worker, `/admin/season-predictions/weekly-challenges/${id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: {
      status: "active",
      open_at: nowSeconds() - 60,
      deadline_at: nowSeconds() + 86400,
      close_at: nowSeconds() + 172800,
      ...patch,
    },
  });
}

async function setupActiveChallenge(worker, opts = {}) {
  const created = await setupChallenge(worker, opts);
  const activated = expectOk(await activateChallenge(worker, created.challenge.id, {
    task_schema_version: opts.schema ?? 2,
    bonus_question_key: opts.bonus ?? "upset",
  }), "activate challenge");
  return { challenge: activated.challenge, questions: created.questions };
}

function byKey(tasks, key) {
  const task = (tasks || []).find((t) => t.key === key);
  assert.ok(task, `expected task ${key}`);
  return task;
}

async function getTasks(worker, challengeId = null) {
  const suffix = challengeId == null ? "" : `?challenge_id=${challengeId}`;
  return expectOk(await requestJson(worker, `/weekly-challenge/tasks${suffix}`), "get weekly tasks");
}

async function submitAll(worker, challengeId, answerPatch = {}) {
  return expectOk(await requestJson(worker, `/season-predictions/weekly-challenges/${challengeId}/submit`, {
    method: "POST",
    body: { answers: answers(answerPatch) },
  }), "submit weekly");
}

async function putOfficialAnswers(worker, challengeId, questionRows, statuses = {}) {
  const payload = questionRows.map((q) => ({
    question_id: q.id,
    official_status: statuses[q.question_key] || "confirmed",
    official_answer_option_id: statuses[q.question_key] === "void" ? null : CORRECT[q.question_key],
    official_note: "e2e",
  }));
  return expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${challengeId}/official-answers`, {
    method: "PUT",
    headers: adminHeaders(),
    body: { answers: payload },
  }), "official answers");
}

async function lockAndRecalc(worker, challengeId, questionRows, officialStatuses = {}) {
  expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${challengeId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: { status: "locked" },
  }), "lock challenge");
  await putOfficialAnswers(worker, challengeId, questionRows, officialStatuses);
  return expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${challengeId}/recalculate`, {
    method: "POST",
    headers: adminHeaders(),
    body: {},
  }), "recalculate");
}

async function claim(worker, taskKey, challengeId) {
  return requestJson(worker, `/weekly-challenge/tasks/${taskKey}/claim`, {
    method: "POST",
    body: { challenge_id: challengeId },
  });
}

function seedArchiveChallenges(persistTo) {
  d1(persistTo, `
    INSERT INTO season_prediction_weekly_challenges
      (id, season_prediction_season_id, code, title, status, deadline_at, settings_json, task_schema_version, bonus_question_key, created_at, updated_at)
    VALUES
      (501, 100, 'archive_v1', 'Archive V1', 'completed', 1001, '{}', 1, NULL, 1, 1),
      (502, 100, 'archive_v2', 'Archive V2', 'completed', 1002, '{}', 2, 'upset', 1, 1);
  `);
  d1(persistTo, `
    INSERT INTO season_prediction_weekly_challenge_entries
      (id, user_id, weekly_challenge_id, status, answers_json, submitted_at, last_submitted_at, created_at, updated_at)
    VALUES
      (5011, ${USER.id}, 501, 'completed', '{"match_of_week":"home","league_of_week":"PL","duel_of_week":"player_a","upset_of_week":"upset_a","event_of_week":"no"}', 10, 10, 10, 10),
      (5021, ${USER.id}, 502, 'completed', '{"match_of_week":"home","league_of_week":"PL","duel_of_week":"player_a","upset_of_week":"upset_a","event_of_week":"no"}', 10, 10, 10, 10);
  `);
  for (const challengeId of [501, 502]) {
    d1(persistTo, `
      INSERT INTO season_prediction_weekly_challenge_questions
        (weekly_challenge_id, question_key, title, question_type, options_json, config_json, status, sort_order, official_status, official_answer_option_id, created_at, updated_at)
      VALUES
        (${challengeId}, 'match_of_week', 'Match', 'single_select', '[]', '{}', 'active', 1, 'confirmed', 'home', 1, 1),
        (${challengeId}, 'league_of_week', 'League', 'single_select', '[]', '{}', 'active', 2, 'confirmed', 'PL', 1, 1),
        (${challengeId}, 'duel_of_week', 'Duel', 'single_select', '[]', '{}', 'active', 3, 'confirmed', 'player_a', 1, 1),
        (${challengeId}, 'upset_of_week', 'Upset', 'single_select', '[]', '{}', 'active', 4, 'confirmed', 'upset_a', 1, 1),
        (${challengeId}, 'event_of_week', 'Event', 'single_select', '[]', '{}', 'active', 5, 'confirmed', 'yes', 1, 1);
    `);
  }
  d1(persistTo, `
    INSERT INTO season_prediction_weekly_challenge_scores
      (weekly_challenge_id, user_id, entry_id, formula_version, total_points, max_possible_points, points_pct, correct_answers, wrong_answers, void_questions, unanswered_questions, breakdown_json, scored_at, created_at, updated_at)
    VALUES
      (501, ${USER.id}, 5011, 'weekly_challenge_v1', 4, 5, 80, 4, 1, 0, 0, '{"questions":[{"question_key":"match_of_week","status":"correct","points":1},{"question_key":"league_of_week","status":"correct","points":1},{"question_key":"duel_of_week","status":"correct","points":1},{"question_key":"upset_of_week","status":"correct","points":1},{"question_key":"event_of_week","status":"wrong","points":0}]}', 10, 10, 10),
      (502, ${USER.id}, 5021, 'weekly_challenge_v1', 4, 5, 80, 4, 1, 0, 0, '{"questions":[{"question_key":"match_of_week","status":"correct","points":1},{"question_key":"league_of_week","status":"correct","points":1},{"question_key":"duel_of_week","status":"correct","points":1},{"question_key":"upset_of_week","status":"wrong","points":0},{"question_key":"event_of_week","status":"correct","points":1}]}', 10, 10, 10);
  `);
  d1(persistTo, `
    INSERT INTO season_prediction_recalc_log (triggered_by_admin_id, trigger_reason, status, formula_version, formula_config_json, started_at, finished_at)
    VALUES
      (${ADMIN.id}, 'weekly:501', 'completed', 'weekly_challenge_v1', '{}', 10, 10),
      (${ADMIN.id}, 'weekly:502', 'completed', 'weekly_challenge_v1', '{}', 10, 10);
  `);
  d1(persistTo, `
    INSERT INTO reward_ledger (user_id, source_type, source_id, unique_key, reward_type, amount, status, granted_at, metadata_json)
    VALUES
      (${USER.id}, 'weekly_challenge_task', 'weekly_challenge_started', 'weekly_challenge_task:501:weekly_challenge_started:${USER.id}:stars', 'stars', 1, 'granted', 1, '{}'),
      (${USER.id}, 'weekly_challenge_task', 'weekly_challenge_all_answered', 'weekly_challenge_task:501:weekly_challenge_all_answered:${USER.id}:stars', 'stars', 1, 'granted', 1, '{}'),
      (${USER.id}, 'weekly_challenge_task', 'weekly_challenge_submitted', 'weekly_challenge_task:501:weekly_challenge_submitted:${USER.id}:stars', 'stars', 2, 'granted', 1, '{}'),
      (${USER.id}, 'weekly_challenge_task', 'weekly_challenge_score_3', 'weekly_challenge_task:501:weekly_challenge_score_3:${USER.id}:stars', 'stars', 2, 'granted', 1, '{}'),
      (${USER.id}, 'weekly_challenge_task', 'weekly_challenge_participation', 'weekly_challenge_task:502:weekly_challenge_participation:${USER.id}:stars', 'stars', 2, 'granted', 1, '{}');
  `);
  d1(persistTo, `
    INSERT INTO weekly_challenge_task_claims (weekly_challenge_id, user_id, task_key, status, reward_snapshot_json, created_at, updated_at, completed_at)
    VALUES (502, ${USER.id}, 'weekly_challenge_participation', 'completed', '{"reward":{"stars":2,"balls":0,"case_type":null,"case_count":0},"task_schema_version":2}', 1, 1, 1);
  `);
}

test("auth safety: weekly admin endpoints require admin Telegram auth", async () => {
  const p = freshEnv("auth");
  const w = await boot(p);
  try {
    const unauth = await requestJson(w, "/admin/season-predictions/weekly-challenges", { headers: { "content-type": "application/json" } });
    assert.notEqual(unauth.status, 200);
    const regular = await requestJson(w, "/admin/season-predictions/weekly-challenges", { headers: userHeaders() });
    assert.notEqual(regular.status, 200);
    const admin = await requestJson(w, "/admin/season-predictions/weekly-challenges", { headers: adminHeaders() });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.ok, true);
  } finally {
    await w.stop();
  }
});

test("admin lifecycle: creates V2, validates bonus, activates, and locks task config", async () => {
  const p = freshEnv("admin");
  const w = await boot(p);
  try {
    const { challenge } = await setupChallenge(w, { code: "admin_lifecycle", bonus: "upset" });
    assert.equal(challenge.task_schema_version, 2);
    assert.equal(challenge.bonus_question_key, "upset");

    const noBonus = await activateChallenge(w, challenge.id, { bonus_question_key: "" });
    assert.notEqual(noBonus.status, 200);
    assert.match(String(noBonus.body.error || ""), /WEEKLY_V2_BONUS_QUESTION_REQUIRED/);

    const invalidBonus = await activateChallenge(w, challenge.id, { bonus_question_key: "unknown" });
    assert.notEqual(invalidBonus.status, 200);

    const disabled = await setupChallenge(w, { code: "disabled_bonus", bonus: "upset", disabledKey: "upset_of_week" });
    const disabledActivation = await activateChallenge(w, disabled.challenge.id, { bonus_question_key: "upset" });
    assert.notEqual(disabledActivation.status, 200);

    const active = expectOk(await activateChallenge(w, challenge.id, { bonus_question_key: "upset" }), "valid activation").challenge;
    assert.equal(active.status, "active");

    // V1 is retired: a requested schema downgrade on an active challenge is ignored
    // (the version is pinned to the current value), so the challenge stays V2.
    const activeSchemaChange = await requestJson(w, `/admin/season-predictions/weekly-challenges/${challenge.id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: { task_schema_version: 1 },
    });
    assert.equal(activeSchemaChange.status, 200, "schema-downgrade request is accepted but ignored");
    assert.equal(activeSchemaChange.body.challenge.task_schema_version, 2, "challenge remains V2");

    await requestJson(w, `/season-predictions/weekly-challenges/${challenge.id}/draft`, {
      method: "PUT",
      body: { answers: { match_of_week: "home" } },
    });
    const entrySchemaChange = await requestJson(w, `/admin/season-predictions/weekly-challenges/${challenge.id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: { bonus_question_key: "event" },
    });
    assert.notEqual(entrySchemaChange.status, 200, "challenge with entries cannot change bonus");

    d1(p, `UPDATE season_prediction_weekly_challenges SET status = 'completed' WHERE id = ${challenge.id};`);
    // V1 can no longer be created: a create request asking for schema 1 yields V2.
    const forcedV2 = await setupChallenge(w, { code: "v1_retired", schema: 1, bonus: null });
    assert.equal(forcedV2.challenge.task_schema_version, 2, "create forces V2 even when schema 1 is requested");
    assert.equal(forcedV2.challenge.bonus_question_key, "upset", "create assigns default bonus when none requested");
  } finally {
    await w.stop();
  }
});

test("user V2 flow: draft, submit, participation claim, and idempotent repeat", async () => {
  const p = freshEnv("user-flow");
  const w = await boot(p);
  try {
    const { challenge } = await setupActiveChallenge(w, { code: "user_flow" });

    let tasks = await getTasks(w);
    assert.deepEqual(tasks.tasks.map((t) => t.key).sort(), ["weekly_challenge_bonus", "weekly_challenge_participation", "weekly_challenge_result"].sort());
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").progress.current, 0);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_bonus").status, "in_progress");
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").status, "in_progress");

    expectOk(await requestJson(w, `/season-predictions/weekly-challenges/${challenge.id}/draft`, {
      method: "PUT",
      body: { answers: { match_of_week: "home" } },
    }), "draft one answer");
    tasks = await getTasks(w);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").progress.current, 1);

    expectOk(await requestJson(w, `/season-predictions/weekly-challenges/${challenge.id}/draft`, {
      method: "PUT",
      body: { answers: answers() },
    }), "draft all answers");
    tasks = await getTasks(w);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").progress.current, 2);

    await submitAll(w, challenge.id);
    tasks = await getTasks(w);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").progress.current, 3);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").status, "claimable");
    assert.equal(byKey(tasks.tasks, "weekly_challenge_bonus").status, "waiting_results");
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").status, "waiting_results");

    const beforeStars = d1num(p, `SELECT COALESCE(stars, 0) AS n FROM user_season_progress WHERE user_id = ${USER.id} AND season_number = 1;`);
    const firstClaim = expectOk(await claim(w, "weekly_challenge_participation", challenge.id), "claim participation");
    assert.equal(firstClaim.reward.stars, 2);
    const afterStars = d1num(p, `SELECT COALESCE(stars, 0) AS n FROM user_season_progress WHERE user_id = ${USER.id} AND season_number = 1;`);
    assert.equal(afterStars - beforeStars, 2);

    const secondClaim = expectOk(await claim(w, "weekly_challenge_participation", challenge.id), "repeat participation claim");
    assert.equal(secondClaim.already_claimed, true);
    const finalStars = d1num(p, `SELECT COALESCE(stars, 0) AS n FROM user_season_progress WHERE user_id = ${USER.id} AND season_number = 1;`);
    assert.equal(finalStars, afterStars);
    tasks = await getTasks(w);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_participation").status, "claimed");
  } finally {
    await w.stop();
  }
});

test("result tiers: gold, perfect with concurrent claim, bonus void, and 3/3 gold", async () => {
  const p = freshEnv("tiers");
  const w = await boot(p);
  try {
    const gold = await setupActiveChallenge(w, { code: "gold_4_of_5", bonus: "upset" });
    await submitAll(w, gold.challenge.id, { event_of_week: "no" });
    await lockAndRecalc(w, gold.challenge.id, gold.questions);
    let tasks = await getTasks(w, gold.challenge.id);
    const goldResult = byKey(tasks.tasks, "weekly_challenge_result");
    assert.equal(goldResult.status, "claimable");
    assert.equal(goldResult.meta.tier, "gold");
    assert.equal(goldResult.progress.current, 4);
    assert.equal(goldResult.progress.target, 5);
    assert.deepEqual(goldResult.reward, { stars: 3, balls: 1, case_type: null, case_count: 0 });
    assert.equal(tasks.tasks.some((t) => t.key === "weekly_challenge_score_4" || t.key === "weekly_challenge_perfect"), false);

    const starsBeforeGold = d1num(p, `SELECT COALESCE(stars, 0) AS n FROM user_season_progress WHERE user_id = ${USER.id} AND season_number = 1;`);
    const ballsBeforeGold = d1num(p, `SELECT COALESCE(balls, 0) AS n FROM users WHERE id = ${USER.id};`);
    expectOk(await claim(w, "weekly_challenge_result", gold.challenge.id), "claim gold");
    expectOk(await claim(w, "weekly_challenge_result", gold.challenge.id), "repeat gold");
    assert.equal(d1num(p, `SELECT COALESCE(stars, 0) AS n FROM user_season_progress WHERE user_id = ${USER.id} AND season_number = 1;`) - starsBeforeGold, 3);
    assert.equal(d1num(p, `SELECT COALESCE(balls, 0) AS n FROM users WHERE id = ${USER.id};`) - ballsBeforeGold, 1);
    const goldSnapshot = d1json(p, `SELECT reward_snapshot_json FROM weekly_challenge_task_claims WHERE weekly_challenge_id = ${gold.challenge.id} AND task_key = 'weekly_challenge_result';`);
    assert.match(goldSnapshot, /tier\\":\\"gold/);

    const perfect = await setupActiveChallenge(w, { code: "perfect_5_of_5", bonus: "upset" });
    await submitAll(w, perfect.challenge.id);
    await lockAndRecalc(w, perfect.challenge.id, perfect.questions);
    tasks = await getTasks(w, perfect.challenge.id);
    const perfectResult = byKey(tasks.tasks, "weekly_challenge_result");
    assert.equal(perfectResult.meta.tier, "perfect");
    assert.deepEqual(perfectResult.reward, { stars: 5, balls: 0, case_type: "basic", case_count: 1 });
    const casesBefore = d1num(p, `SELECT COALESCE(quantity, 0) AS n FROM user_cases WHERE user_id = ${USER.id} AND case_type = 'basic';`);
    const [c1, c2] = await Promise.all([
      claim(w, "weekly_challenge_result", perfect.challenge.id),
      claim(w, "weekly_challenge_result", perfect.challenge.id),
    ]);
    assert.ok([200, 409].includes(c1.status), `first concurrent status ${c1.status}`);
    assert.ok([200, 409].includes(c2.status), `second concurrent status ${c2.status}`);
    assert.equal(d1num(p, `SELECT COALESCE(quantity, 0) AS n FROM user_cases WHERE user_id = ${USER.id} AND case_type = 'basic';`) - casesBefore, 1);
    assert.equal(d1num(p, `SELECT COUNT(*) AS n FROM reward_ledger WHERE unique_key = 'weekly_challenge_task:${perfect.challenge.id}:weekly_challenge_result:${USER.id}:case:basic';`), 1);

    const bonusVoid = await setupActiveChallenge(w, { code: "bonus_void", bonus: "upset" });
    await submitAll(w, bonusVoid.challenge.id);
    await lockAndRecalc(w, bonusVoid.challenge.id, bonusVoid.questions, { upset_of_week: "void" });
    tasks = await getTasks(w, bonusVoid.challenge.id);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_bonus").status, "void");
    assert.equal(byKey(tasks.tasks, "weekly_challenge_bonus").claimable, false);

    const nonBonusVoid = await setupActiveChallenge(w, { code: "non_bonus_void", bonus: "upset" });
    await submitAll(w, nonBonusVoid.challenge.id);
    await lockAndRecalc(w, nonBonusVoid.challenge.id, nonBonusVoid.questions, { event_of_week: "void" });
    tasks = await getTasks(w, nonBonusVoid.challenge.id);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").meta.tier, "perfect");
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").progress.current, 4);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").progress.target, 4);

    const threeOfThree = await setupActiveChallenge(w, { code: "three_of_three", bonus: "upset" });
    await submitAll(w, threeOfThree.challenge.id);
    await lockAndRecalc(w, threeOfThree.challenge.id, threeOfThree.questions, { league_of_week: "void", event_of_week: "void" });
    tasks = await getTasks(w, threeOfThree.challenge.id);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").progress.current, 3);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").progress.target, 3);
    assert.equal(byKey(tasks.tasks, "weekly_challenge_result").meta.tier, "gold");
  } finally {
    await w.stop();
  }
});

test("archive: V1 and V2 claimables stay isolated and exact challenge_id is required", async () => {
  const p = freshEnv("archive");
  seedArchiveChallenges(p);
  const w = await boot(p);
  try {
    const current = await setupActiveChallenge(w, { code: "current_v2", bonus: "upset" });
    await submitAll(w, current.challenge.id, { match_of_week: "home" });

    const currentTasks = await getTasks(w);
    assert.equal(currentTasks.active_challenge.id, current.challenge.id);

    let archive = expectOk(await requestJson(w, "/weekly-challenge/tasks/unclaimed?limit=1"), "archive page 1");
    assert.equal(archive.items.length, 1);
    assert.equal(archive.items[0].challenge.id, 502);
    assert.equal(archive.items[0].tasks[0].key, "weekly_challenge_result");
    assert.ok(archive.next_cursor, "expected cursor for second archive item");
    const page2 = expectOk(await requestJson(w, `/weekly-challenge/tasks/unclaimed?limit=1&cursor=${encodeURIComponent(archive.next_cursor)}`), "archive page 2");
    assert.equal(page2.items.length, 1);
    assert.equal(page2.items[0].challenge.id, 501);
    assert.equal(page2.items[0].tasks[0].key, "weekly_challenge_score_4");
    assert.equal(new Set([...archive.items, ...page2.items].map((i) => i.challenge.id)).size, 2, "pagination has no duplicates");

    const wrongChallenge = await claim(w, "weekly_challenge_score_4", 502);
    assert.notEqual(wrongChallenge.status, 200, "exact challenge_id prevents cross-claim");

    expectOk(await claim(w, "weekly_challenge_score_4", 501), "claim V1 archive");
    archive = expectOk(await requestJson(w, "/weekly-challenge/tasks/unclaimed"), "archive after V1 claim");
    assert.deepEqual(archive.items.map((i) => i.challenge.id), [502]);

    expectOk(await claim(w, "weekly_challenge_result", 502), "claim V2 archive");
    archive = expectOk(await requestJson(w, "/weekly-challenge/tasks/unclaimed"), "archive after all claims");
    assert.equal(archive.items.length, 0);
    assert.equal(archive.total_claimable, 0);
  } finally {
    await w.stop();
  }
});
