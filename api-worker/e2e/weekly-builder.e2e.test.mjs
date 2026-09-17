// Weekly Challenge Admin Builder + User Mode release-gate HTTP smoke.
// Real local api-worker HTTP endpoints, isolated Miniflare D1 only. Never touches
// production. Auth is real Telegram initData HMAC (admin = ADMIN_IDS) — no test bypass.
//
// Run: node --test --test-concurrency=1 e2e/weekly-builder.e2e.test.mjs
//      (package.json: smoke:weekly-builder)

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
const USER = { id: 7654321, first_name: "Builder User", username: "builder_user" };
const ADMIN = { id: 222333, first_name: "Builder Admin", username: "builder_admin" };
const USER_INIT = buildInitData(USER, BOT_TOKEN);
const ADMIN_INIT = buildInitData(ADMIN, BOT_TOKEN);

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1run = (persistTo, file) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--file", file]);

function freshEnv(name) {
  const persistTo = `.wrangler-e2e-weekly-builder-${name}`;
  rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  d1run(persistTo, "e2e/fixtures/schema.sql");
  d1run(persistTo, "e2e/fixtures/seed.sql");
  d1run(persistTo, "e2e/fixtures/weekly-v2.sql");
  return persistTo;
}

async function boot(persistTo, vars = {}) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo, experimental: { disableExperimentalWarning: true },
    vars: {
      INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true",
      ADMIN_IDS: String(ADMIN.id), ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false",
      WEEKLY_FINALIZER_V2_ENABLED: "false", ...vars,
    },
  });
}

function authHeaders(initData) {
  return { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData };
}
const userHeaders = () => authHeaders(USER_INIT);
const adminHeaders = () => authHeaders(ADMIN_INIT);

async function requestJson(worker, p, { method = "GET", headers = userHeaders(), body } = {}) {
  const res = await worker.fetch(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
function expectOk(response, label) {
  assert.equal(response.status, 200, `${label} status ${response.status}: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.ok, true, `${label} ok: ${JSON.stringify(response.body)}`);
  return response.body;
}
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Match pool with explicit match_id so template match_refs are deterministic ("m1".."m5").
function matchPool() {
  const base = nowSeconds() + 86400;
  return [
    ["m1", "PL", "Arsenal", "Manchester City"],
    ["m2", "PD", "Real Madrid", "Barcelona"],
    ["m3", "SA", "Inter", "Juventus"],
    ["m4", "BL1", "Bayern", "Dortmund"],
    ["m5", "FL1", "PSG", "Marseille"],
  ].map(([match_id, tournament_code, home_team_name, away_team_name], i) => ({
    match_id, tournament_code, home_team_name, away_team_name, kickoff_at: base + i * 3600,
    provider: "e2e", provider_match_id: `e2e-${i + 1}`, metadata: { competition_type: "club" },
  }));
}

// Builder-equivalent template question payloads (what the FE registry generates).
function templateQuestions() {
  return [
    {
      question_key: "match_of_week", title: "Кто победит?", question_type: "single_select", status: "active", sort_order: 10,
      options: [{ id: "home", label: "Победа Arsenal" }, { id: "draw", label: "Ничья" }, { id: "away", label: "Победа City" }],
      config: { template_key: "match_result", match_ref: "m1", home_team_name: "Arsenal", away_team_name: "Manchester City", match_pool_only: true },
    },
    {
      question_key: "league_of_week", title: "Где больше ничьих?", question_type: "single_select", status: "active", sort_order: 20,
      options: [{ id: "group_1", label: "Группа A" }, { id: "group_2", label: "Группа B" }, { id: "equal", label: "Равенство" }],
      config: { template_key: "group_most_draws", calculation: "draws_count", tie_behavior: "equal_option", match_pool_only: true,
        groups: [{ id: "group_1", title: "Группа A", match_ids: ["m1", "m2"] }, { id: "group_2", title: "Группа B", match_ids: ["m3", "m4"] }] },
    },
    {
      question_key: "duel_of_week", title: "Кто забьёт больше?", question_type: "single_select", status: "active", sort_order: 30,
      options: [{ id: "player_a", label: "Игрок A" }, { id: "player_b", label: "Игрок B" }, { id: "equal", label: "Поровну" }],
      config: { template_key: "player_goals_duel", void_if_player_did_not_play: true, match_pool_only: true,
        side_a: { kind: "player", name: "Saka", team_name: "Arsenal", match_ref: "m1" }, side_b: { kind: "player", name: "Haaland", team_name: "City", match_ref: "m1" } },
    },
    {
      question_key: "upset_of_week", title: "Кто из андердогов не проиграет?", question_type: "single_select", status: "active", sort_order: 40,
      options: [{ id: "upset_1", label: "Marseille", team_name: "Marseille", match_ref: "m5" }, { id: "upset_2", label: "Dortmund", team_name: "Dortmund", match_ref: "m4" }, { id: "no_upset", label: "Сенсаций не будет" }],
      config: { template_key: "underdog_not_lose", match_pool_only: true },
    },
    {
      question_key: "event_of_week", title: "Будет матч с 5+ голами?", question_type: "single_select", status: "active", sort_order: 50,
      options: [{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }],
      config: { template_key: "any_five_plus_goals", event_type: "any_five_plus_goals", scope: { type: "all_pool", match_refs: [] }, match_pool_only: true },
    },
  ];
}

async function createDraft(worker, { code, title = "Builder smoke", mode = null } = {}) {
  const created = expectOk(await requestJson(worker, "/admin/season-predictions/weekly-challenges", {
    method: "POST", headers: adminHeaders(),
    body: { code: code || `wb_${Date.now()}`, title, status: "draft", task_schema_version: 2, bonus_question_key: "upset" },
  }), "create draft");
  if (mode) {
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${created.challenge.id}`, {
      method: "PUT", headers: adminHeaders(), body: { competition_mode: mode },
    }), "set mode");
  }
  return created.challenge;
}

test("club builder: mode, template questions, read-back, activation", async () => {
  const persistTo = freshEnv("club");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_club", mode: "club" });
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: templateQuestions() } }), "questions");

    const detail = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, { headers: adminHeaders() }), "read back");
    assert.equal(detail.challenge.competition_mode, "club", "mode persisted");
    const league = detail.questions.find((q) => q.question_key === "league_of_week");
    assert.equal(league.template_key, "group_most_draws", "template_key surfaced");
    assert.equal(league.display_category, "Расклад недели", "display category");

    // Activate (5 active templates + bonus active + pool).
    const act = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, {
      method: "PUT", headers: adminHeaders(),
      body: { status: "active", open_at: nowSeconds() - 60, deadline_at: nowSeconds() + 86400, close_at: nowSeconds() + 172800 },
    });
    assert.equal(act.status, 200, `activate: ${JSON.stringify(act.body)}`);
    assert.equal(act.body.ok, true, `activate ok: ${JSON.stringify(act.body)}`);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("template validation: group match outside pool → 422", async () => {
  const persistTo = freshEnv("validate");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_val", mode: "club" });
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    const bad = templateQuestions().map((q) => q.question_key === "league_of_week"
      ? { ...q, config: { ...q.config, groups: [{ id: "group_1", title: "A", match_ids: ["m1"] }, { id: "group_2", title: "B", match_ids: ["ghost"] }] } }
      : q);
    const res = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: bad } });
    assert.equal(res.status, 422, `expected 422: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, "WEEKLY_TEMPLATE_VALIDATION_FAILED");
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("national-team builder: mode + Расклад groups persist", async () => {
  const persistTo = freshEnv("national");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_nat", mode: "national_team" });
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: templateQuestions() } }), "questions");
    const detail = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, { headers: adminHeaders() }), "read back");
    assert.equal(detail.challenge.competition_mode, "national_team");
    const league = detail.questions.find((q) => q.question_key === "league_of_week");
    assert.ok(Array.isArray(league.config.groups) && league.config.groups.length === 2, "groups persisted");
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("legacy question (no template_key) persists verbatim + maps to Расклад недели", async () => {
  const persistTo = freshEnv("legacy");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_legacy" });
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    const legacy = [{
      question_key: "league_of_week", title: "Старый вопрос", question_type: "single_select", status: "active", sort_order: 10,
      options: [{ id: "PL", label: "АПЛ" }, { id: "PD", label: "Ла Лига" }], config: { calculation: "average_goals_per_match" },
    }];
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: legacy } }), "save legacy");
    const detail = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, { headers: adminHeaders() }), "read");
    const q = detail.questions.find((x) => x.question_key === "league_of_week");
    assert.equal(q.template_key, null, "legacy template_key null");
    assert.equal(q.display_category, "Расклад недели", "legacy maps to Расклад недели");
    assert.deepEqual(q.options.map((o) => o.id), ["PL", "PD"], "legacy options verbatim");
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("task rewards: default→custom persists across saves, reaches user tasks, locks after activation", async () => {
  const persistTo = freshEnv("rewards");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_rewards", mode: "club" });

    // GET → defaults.
    const def = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { headers: adminHeaders() }), "get rewards");
    assert.equal(def.source, "default");
    assert.equal(def.rewards.participation.stars, 2);

    // PUT custom (participation 7⭐, upset bonus 9⭐).
    const custom = JSON.parse(JSON.stringify(def.rewards));
    custom.participation.stars = 7;
    custom.bonus.upset_of_week.stars = 9;
    const put = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { method: "PUT", headers: adminHeaders(), body: { rewards: custom } }), "put rewards");
    assert.equal(put.source, "custom");
    assert.equal(put.rewards.participation.stars, 7);

    // GET → custom.
    const after = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { headers: adminHeaders() }), "get custom");
    assert.equal(after.source, "custom");

    // Saving matches + questions must NOT reset rewards (settings merge preserves them).
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: templateQuestions() } }), "questions");
    const stillCustom = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { headers: adminHeaders() }), "still custom");
    assert.equal(stillCustom.rewards.participation.stars, 7, "rewards preserved after match/question saves");

    // Invalid PUT (empty reward) rejected.
    const empty = JSON.parse(JSON.stringify(custom)); empty.participation = { stars: 0, balls: 0, basic_cases: 0 };
    const emptyRes = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { method: "PUT", headers: adminHeaders(), body: { rewards: empty } });
    assert.notEqual(emptyRes.status, 200, "empty reward rejected");

    // Activate, then the custom amount must reach the user task catalog.
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, { method: "PUT", headers: adminHeaders(), body: { status: "active", open_at: nowSeconds() - 60, deadline_at: nowSeconds() + 86400, close_at: nowSeconds() + 172800 } }), "activate");
    const userTasks = expectOk(await requestJson(worker, "/weekly-challenge/tasks", { headers: userHeaders() }), "user tasks");
    const participation = (userTasks.tasks || []).find((t) => t.key === "weekly_challenge_participation");
    assert.ok(participation, "participation task present");
    assert.equal(participation.reward.stars, 7, "user sees custom participation reward");

    // After activation rewards are locked (direct PUT rejected too).
    const locked = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/task-rewards`, { method: "PUT", headers: adminHeaders(), body: { rewards: custom } });
    assert.equal(locked.status, 409, `expected lock 409: ${JSON.stringify(locked.body)}`);
    assert.equal(locked.body.error, "WEEKLY_TASK_REWARDS_LOCKED_AFTER_ENTRIES_OR_PUBLISH");
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("admin list is newest-first; safe delete removes empty draft, protects active/entries", async () => {
  const persistTo = freshEnv("delete");
  const worker = await boot(persistTo);
  try {
    // Create two drafts; the newer one must come first in the admin list.
    const a = await createDraft(worker, { code: "wb_del_a", title: "Старый" });
    const b = await createDraft(worker, { code: "wb_del_b", title: "Новый" });
    const list = expectOk(await requestJson(worker, "/admin/season-predictions/weekly-challenges", { headers: adminHeaders() }), "list");
    assert.equal(list.challenges[0].id, b.id, "newest draft first");

    // Non-existent → 404.
    const missing = await requestJson(worker, "/admin/season-predictions/weekly-challenges/999999", { method: "DELETE", headers: adminHeaders() });
    assert.equal(missing.status, 404);

    // Empty draft deletes; the other draft is untouched.
    const del = expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${a.id}`, { method: "DELETE", headers: adminHeaders() }), "delete a");
    assert.equal(del.deleted_challenge_id, a.id);
    const after = expectOk(await requestJson(worker, "/admin/season-predictions/weekly-challenges", { headers: adminHeaders() }), "list after");
    assert.ok(!after.challenges.some((c) => c.id === a.id), "a removed");
    assert.ok(after.challenges.some((c) => c.id === b.id), "b kept");
    // Repeat delete → 404.
    const repeat = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${a.id}`, { method: "DELETE", headers: adminHeaders() });
    assert.equal(repeat.status, 404);

    // Active challenge cannot be deleted (forbidden status), even with no entries.
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: templateQuestions() } }), "questions");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}`, { method: "PUT", headers: adminHeaders(), body: { status: "active", open_at: nowSeconds() - 60, deadline_at: nowSeconds() + 86400, close_at: nowSeconds() + 172800 } }), "activate");
    const activeDel = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}`, { method: "DELETE", headers: adminHeaders() });
    assert.equal(activeDel.status, 409);
    assert.equal(activeDel.body.error, "WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS");

    // With a user entry, even after moving back to draft, delete is blocked by entries.
    expectOk(await requestJson(worker, `/season-predictions/weekly-challenges/${b.id}/draft`, { method: "PUT", headers: userHeaders(), body: { answers: { match_of_week: "home" } } }), "user draft");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}`, { method: "PUT", headers: adminHeaders(), body: { status: "draft" } }), "back to draft");
    const entryDel = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}`, { method: "DELETE", headers: adminHeaders() });
    assert.equal(entryDel.status, 409);
    assert.equal(entryDel.body.error, "WEEKLY_CHALLENGE_DELETE_HAS_ENTRIES");

    // Non-admin (valid user) cannot delete → 403.
    const forbidden = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${b.id}`, { method: "DELETE", headers: userHeaders() });
    assert.equal(forbidden.status, 403);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});

test("competition_mode locks after a user entry; user draft/submit round-trips arbitrary ids", async () => {
  const persistTo = freshEnv("lock");
  const worker = await boot(persistTo);
  try {
    const ch = await createDraft(worker, { code: "wb_lock", mode: "club" });
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/matches`, { method: "PUT", headers: adminHeaders(), body: { matches: matchPool() } }), "matches");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}/questions`, { method: "PUT", headers: adminHeaders(), body: { questions: templateQuestions() } }), "questions");
    expectOk(await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, {
      method: "PUT", headers: adminHeaders(),
      body: { status: "active", open_at: nowSeconds() - 60, deadline_at: nowSeconds() + 86400, close_at: nowSeconds() + 172800 },
    }), "activate");

    // User saves a draft with builder-generated (arbitrary) option ids.
    const draft = expectOk(await requestJson(worker, `/season-predictions/weekly-challenges/${ch.id}/draft`, {
      method: "PUT", headers: userHeaders(),
      body: { answers: { match_of_week: "home", league_of_week: "group_1", duel_of_week: "player_b", upset_of_week: "upset_1", event_of_week: "no" } },
    }), "user draft");
    assert.equal(draft.entry.answers.upset_of_week, "upset_1", "arbitrary id stored");

    // Mode change is now locked (entry exists).
    const lock = await requestJson(worker, `/admin/season-predictions/weekly-challenges/${ch.id}`, { method: "PUT", headers: adminHeaders(), body: { competition_mode: "national_team" } });
    assert.notEqual(lock.status, 200, `mode change should fail: ${JSON.stringify(lock.body)}`);
    assert.match(JSON.stringify(lock.body), /WEEKLY_COMPETITION_MODE_LOCKED/);

    // User submits successfully.
    const submit = expectOk(await requestJson(worker, `/season-predictions/weekly-challenges/${ch.id}/submit`, {
      method: "POST", headers: userHeaders(),
      body: { answers: { match_of_week: "home", league_of_week: "group_1", duel_of_week: "player_b", upset_of_week: "upset_1", event_of_week: "no" } },
    }), "user submit");
    assert.equal(submit.entry.status, "submitted");
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});
