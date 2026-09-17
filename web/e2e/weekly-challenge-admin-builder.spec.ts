// Weekly Challenge Admin Builder — dedicated release-gate Playwright spec.
// Drives the REAL builder UI through a stateful admin-API mock that persists writes,
// re-hydrates on reload, and serializes template_key / display_category /
// competition_mode exactly like the backend. (Backend lifecycle + template validation
// are additionally proven against a real worker by api-worker/e2e/weekly-builder.e2e.test.mjs.)

import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";
import { weeklyQuestionDisplayCategory, getWeeklyTemplate } from "../app/season-predictions/weeklyTemplates";

type StoredQuestion = {
  id: number; weekly_challenge_id: number; question_key: string; title: string; description: string | null;
  question_type: string; options: Array<{ id: string; label: string }>; config: Record<string, unknown>;
  status: string; sort_order: number;
};
type Stored = {
  id: number; season_prediction_season_id: number; code: string; title: string; description: string | null;
  status: string; open_at: number | null; deadline_at: number | null; close_at: number | null; sort_order: number;
  task_schema_version: number; bonus_question_key: string | null; settings: Record<string, unknown>;
  match_pool: Array<Record<string, unknown>>; questions: StoredQuestion[];
  edit_state: { state: string; structural_locked: boolean; entries: number; drafts: number; submitted: number; scores: number };
  rewards?: RewardsConfig | null;
  created_at?: number;
};

const STATUS_ORDER: Record<string, number> = { draft: 0, active: 1, locked: 2, scoring: 3, completed: 4, archived: 5 };
function deletionFor(c: Stored) {
  const counts = { entries: c.edit_state.entries, claims: 0, rewards: 0, scores: c.edit_state.scores };
  const deletable = (c.status === "draft" || c.status === "archived") && counts.entries === 0 && counts.scores === 0;
  const error = deletable ? null : (c.status !== "draft" && c.status !== "archived") ? "WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS" : counts.entries > 0 ? "WEEKLY_CHALLENGE_DELETE_HAS_ENTRIES" : "WEEKLY_CHALLENGE_DELETE_HAS_DEPENDENCIES";
  return { deletable, error, counts };
}

type RewardComp = { stars: number; balls: number; case_type: string | null; case_count: number; lucky_tokens: number; boost_type?: string | null; boost_count?: number };
type RewardsConfig = { version: number; participation: RewardComp; bonus: Record<string, RewardComp>; result: Record<string, RewardComp> };
const rcc = (stars: number, balls = 0, case_type: string | null = null, case_count = 0, lucky_tokens = 0): RewardComp => ({ stars, balls, case_type, case_count, lucky_tokens });
const REWARD_DEFAULTS: RewardsConfig = {
  version: 1,
  participation: rcc(2),
  bonus: { match_of_week: rcc(1), league_of_week: rcc(1), duel_of_week: rcc(1), upset_of_week: rcc(2), event_of_week: rcc(1) },
  result: { start: { ...rcc(1), boost_type: "double_chance", boost_count: 1 }, bronze: rcc(1), silver: rcc(2), gold: rcc(3, 1), perfect: rcc(5, 0, "basic", 1) },
};
const REWARD_LIMITS = { stars: { min: 0, max: 50 }, balls: { min: 0, max: 20 }, case_count: { min: 0, max: 5 }, lucky_tokens: { min: 0, max: 10 } };
const REWARD_CASE_OPTIONS = ["basic", "premium", "daily_free"];

function resolveMode(settings: Record<string, unknown>): string {
  const v = String(settings?.competition_mode ?? "").trim();
  return v === "club" || v === "national_team" ? v : "unspecified";
}
function serializeQuestion(q: StoredQuestion) {
  const tk = String((q.config as Record<string, unknown>)?.template_key ?? "").trim();
  return { ...q, template_key: tk && getWeeklyTemplate(tk) ? tk : null, display_category: weeklyQuestionDisplayCategory(q.question_key) };
}
function serializeChallenge(c: Stored) {
  return {
    id: c.id, season_prediction_season_id: c.season_prediction_season_id, code: c.code, title: c.title,
    description: c.description, status: c.status, open_at: c.open_at, deadline_at: c.deadline_at, close_at: c.close_at,
    sort_order: c.sort_order, task_schema_version: c.task_schema_version, bonus_question_key: c.bonus_question_key,
    settings: c.settings, competition_mode: resolveMode(c.settings),
    match_count: c.match_pool.length, question_count: c.questions.length, created_at: c.created_at ?? 0,
  };
}

function candidateMatches() {
  const base = Math.floor(Date.now() / 1000) + 86400;
  return [
    { id: "m1", competition_code: "PL", competition_label: "Premier League", competition_type: "club", home_name: "Arsenal", away_name: "Manchester City", start_time_utc: new Date(base * 1000).toISOString(), api_provider: "fd" },
    { id: "m2", competition_code: "PD", competition_label: "LaLiga", competition_type: "club", home_name: "Real Madrid", away_name: "Barcelona", start_time_utc: new Date(base * 1000).toISOString(), api_provider: "fd" },
    { id: "n1", competition_code: "WCQ", competition_label: "World Cup Qualifiers", competition_type: "national_team", home_name: "Испания", away_name: "Италия", start_time_utc: new Date(base * 1000).toISOString(), api_provider: "as" },
    { id: "n2", competition_code: "WCQ", competition_label: "World Cup Qualifiers", competition_type: "national_team", home_name: "Бразилия", away_name: "Аргентина", start_time_utc: new Date(base * 1000).toISOString(), api_provider: "as" },
  ];
}

async function setupAdmin(page: Page, seed?: Stored | Stored[]) {
  await page.addInitScript(telegramInitScript);
  await page.route(/telegram-web-app\.js/, (r) => r.abort());

  const store = new Map<number, Stored>();
  let nextId = 200;
  for (const s of (Array.isArray(seed) ? seed : seed ? [seed] : [])) store.set(s.id, s);

  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const reqBody = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } })();
    const idMatch = pathname.match(/^\/admin\/season-predictions\/weekly-challenges\/(\d+)(\/.*)?$/);

    if (pathname === "/me") return route.fulfill(json({ ok: true, data: { user: { id: 777777 }, isAdmin: true, permissions: ["all"] } }));
    if (pathname === "/admin/season-predictions/config") return route.fulfill(json({ ok: true, season: { id: 100, code: "club_2026_27", title: "E2E", status: "open", settings: {} }, tournaments: [] }));
    if (pathname === "/admin/season-predictions/reset/summary") return route.fulfill(json({ ok: true, seasonCode: "club_2026_27", counts: {} }));
    if (pathname === "/admin/season-predictions/task-rewards") return route.fulfill(json({ ok: true, items: [], summary: { enabled_count: 0, max_balls: 0, max_stars: 0, max_cases: 0, cases_by_type: {}, by_category: {}, by_group: {} }, warnings: [], case_options: [""] }));
    if (pathname === "/admin/day/candidates") return route.fulfill(json({ ok: true, matches: candidateMatches(), matchMode: "club", effectiveMatchMode: "club" }));

    if (pathname === "/admin/season-predictions/weekly-challenges" && method === "GET") {
      const challenges = [...store.values()].sort((a, b) => (STATUS_ORDER[a.status] ?? 6) - (STATUS_ORDER[b.status] ?? 6) || (b.created_at ?? 0) - (a.created_at ?? 0) || b.id - a.id);
      return route.fulfill(json({ ok: true, season: { id: 100, code: "club_2026_27", title: "E2E" }, challenges: challenges.map(serializeChallenge) }));
    }
    if (pathname === "/admin/season-predictions/weekly-challenges" && method === "POST") {
      const id = nextId++;
      const c: Stored = {
        id, season_prediction_season_id: 100, code: String(reqBody.code || `c${id}`), title: String(reqBody.title || "New"), description: null,
        status: "draft", open_at: null, deadline_at: null, close_at: null, sort_order: 100, task_schema_version: 2, bonus_question_key: "upset",
        settings: {}, match_pool: [], questions: [], edit_state: { state: "unused", structural_locked: false, entries: 0, drafts: 0, submitted: 0, scores: 0 },
        created_at: Math.floor(Date.now() / 1000) + id,
      };
      store.set(id, c);
      return route.fulfill(json({ ok: true, challenge: serializeChallenge(c) }));
    }
    if (idMatch) {
      const id = Number(idMatch[1]);
      const sub = idMatch[2] || "";
      const c = store.get(id);
      if (!c) return route.fulfill(json({ ok: false, error: "WEEKLY_CHALLENGE_NOT_FOUND" }, 404));

      if (sub === "" && method === "GET") {
        return route.fulfill(json({ ok: true, challenge: serializeChallenge(c), match_pool: c.match_pool, questions: c.questions.map(serializeQuestion), question_edit_state: c.edit_state, deletion: deletionFor(c) }));
      }
      if (sub === "" && method === "DELETE") {
        const d = deletionFor(c);
        if (!d.deletable) return route.fulfill(json({ ok: false, error: d.error, status: c.status, counts: d.counts }, 409));
        store.delete(id);
        return route.fulfill(json({ ok: true, deleted_challenge_id: id }));
      }
      if (sub === "" && method === "PUT") {
        if (reqBody.title !== undefined) c.title = String(reqBody.title);
        if (reqBody.description !== undefined) c.description = reqBody.description;
        if (reqBody.status !== undefined) c.status = String(reqBody.status);
        if (reqBody.sort_order !== undefined) c.sort_order = Number(reqBody.sort_order) || 100;
        if (reqBody.task_schema_version !== undefined) c.task_schema_version = Number(reqBody.task_schema_version) >= 2 ? 2 : 1;
        if (reqBody.bonus_question_key !== undefined) c.bonus_question_key = reqBody.bonus_question_key;
        if (reqBody.settings_json !== undefined) c.settings = { ...c.settings, ...(reqBody.settings_json || {}) };
        if (reqBody.competition_mode !== undefined) {
          if (reqBody.competition_mode) c.settings = { ...c.settings, competition_mode: reqBody.competition_mode };
          else { const s = { ...c.settings }; delete (s as Record<string, unknown>).competition_mode; c.settings = s; }
        }
        return route.fulfill(json({ ok: true, challenge: serializeChallenge(c), warnings: [] }));
      }
      if (sub === "/matches" && method === "PUT") {
        c.match_pool = (reqBody.matches || []).map((m: Record<string, unknown>, i: number) => ({ id: i + 1, weekly_challenge_id: id, ...m, metadata: m.metadata || {} }));
        return route.fulfill(json({ ok: true, match_pool: c.match_pool }));
      }
      if (sub === "/questions" && method === "PUT") {
        c.questions = (reqBody.questions || []).map((q: Record<string, unknown>, i: number) => ({ id: i + 1, weekly_challenge_id: id, ...q }));
        return route.fulfill(json({ ok: true, questions: c.questions.map(serializeQuestion), warnings: [] }));
      }
      if (sub === "/official-answers" && method === "GET") {
        return route.fulfill(json({ ok: true, challenge: serializeChallenge(c), questions: [], stats: { active_questions: 0, confirmed: 0, void: 0, pending: 0 }, lifecycle: { challenge_status: c.status, can_recalc: false, results_stale: false, scores_count: 0, last_recalc_at: null, official_updated_at: null } }));
      }
      if (sub === "/scores/summary" && method === "GET") return route.fulfill(json({ ok: true, summary: null }));
      if (sub === "/task-rewards" && method === "GET") {
        const rewards = c.rewards ?? REWARD_DEFAULTS;
        const locked = c.status !== "draft" || c.edit_state.entries > 0;
        return route.fulfill(json({
          ok: true, task_schema_version: c.task_schema_version, editable: c.task_schema_version >= 2,
          source: c.rewards ? "custom" : "default", malformed: false, locked, lock_reason: locked ? "Вызов опубликован — награды изменить нельзя." : null,
          entries_count: c.edit_state.entries, claims_count: 0, limits: REWARD_LIMITS, defaults: REWARD_DEFAULTS, case_options: REWARD_CASE_OPTIONS, rewards,
          bonus_question_key: c.bonus_question_key, max_reward: { stars: 0, balls: 0, cases: {} },
        }));
      }
      if (sub === "/task-rewards" && method === "PUT") {
        if (c.status !== "draft" || c.edit_state.entries > 0) return route.fulfill(json({ ok: false, error: "WEEKLY_TASK_REWARDS_LOCKED_AFTER_ENTRIES_OR_PUBLISH" }, 409));
        c.rewards = reqBody.rewards as RewardsConfig;
        return route.fulfill(json({ ok: true, source: "custom", rewards: c.rewards }));
      }
      if (sub === "/task-rewards/reset" && method === "POST") {
        c.rewards = null;
        return route.fulfill(json({ ok: true, source: "default", rewards: REWARD_DEFAULTS }));
      }
      return route.fulfill(json({ ok: true }));
    }
    return route.fulfill(json({ ok: true }));
  });
}

async function openBuilder(page: Page) {
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expect(page.getByTestId("weekly-admin-root")).toBeVisible();
}

async function createDraft(page: Page, code: string, title: string) {
  await page.getByPlaceholder("week_1").fill(code);
  await page.getByPlaceholder("Вызов недели #1").fill(title);
  await page.getByRole("button", { name: "Создать вызов" }).click();
  await expect(page.getByTestId("weekly-admin-mode-select")).toBeVisible();
}

// AdminCollapsibleSection header is a <button aria-expanded>. Expand if collapsed.
async function expandSection(page: Page, name: RegExp) {
  const header = page.getByRole("button", { name }).first();
  if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
}

test("club flow: create, mode, match selector, save, reload hydration", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "club_builder", "Клубный вызов");

  // Save the mode first; saving matches reloads detail and would otherwise reset it.
  await page.getByTestId("weekly-admin-mode-select").selectOption("club");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();
  await expect(page.getByTestId("weekly-admin-mode-select")).toHaveValue("club");
  // Match selector over /admin/day/candidates → pick two club matches.
  await page.getByRole("button", { name: "Загрузить матчи" }).click();
  await page.getByTestId("weekly-admin-candidate-m1").check();
  await page.getByTestId("weekly-admin-candidate-m2").check();
  await page.getByRole("button", { name: "Сохранить пул матчей" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  // Mode hydrated, and the challenge selector chip shows the 2 persisted matches.
  await expect(page.getByTestId("weekly-admin-mode-select")).toHaveValue("club");
  await expect(page.getByRole("button", { name: /Клубный вызов/ })).toContainText("2 матч");
});

test("national-team flow: mode + Расклад недели templates + reload", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "nat_builder", "Сборные вызов");

  await page.getByTestId("weekly-admin-mode-select").selectOption("national_team");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();

  // The league_of_week card is relabelled "Расклад недели" with group templates.
  await expandSection(page, /3\. Вопросы/);
  await expect(page.getByText("Расклад недели").first()).toBeVisible();
  const leagueTemplate = page.getByTestId("weekly-admin-template-league_of_week");
  await expect(leagueTemplate).toBeVisible();
  await expect(leagueTemplate).toContainText("В какой группе матчей будет выше средняя результативность?");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expect(page.getByTestId("weekly-admin-mode-select")).toHaveValue("national_team");
});

test("custom title + reset to default", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "title_builder", "Заголовки");
  await expandSection(page, /3\. Вопросы/);

  // match_of_week default template = match_result → default title.
  const def = getWeeklyTemplate("match_result")!.title;
  const card = page.getByTestId("weekly-admin-template-match_of_week").locator("xpath=ancestor::*[contains(@style,'border-left')][1]");
  const titleInput = card.getByRole("textbox").first();
  await expect(titleInput).toHaveValue(def);
  await titleInput.fill("Мой свой текст вопроса");
  await card.getByRole("button", { name: "Вернуть стандартный текст" }).click();
  await expect(titleInput).toHaveValue(def);
});

test("legacy challenge shows Custom / Legacy", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const legacy: Stored = {
    id: 900, season_prediction_season_id: 100, code: "legacy", title: "Старый вызов", description: null,
    status: "draft", open_at: null, deadline_at: null, close_at: null, sort_order: 100, task_schema_version: 1, bonus_question_key: null,
    settings: {}, match_pool: [],
    questions: [{ id: 1, weekly_challenge_id: 900, question_key: "league_of_week", title: "Старый вопрос", description: null, question_type: "single_select", options: [{ id: "PL", label: "АПЛ" }, { id: "PD", label: "Ла Лига" }], config: { calculation: "average_goals_per_match" }, status: "active", sort_order: 1 }],
    edit_state: { state: "unused", structural_locked: false, entries: 0, drafts: 0, submitted: 0, scores: 0 },
  };
  await setupAdmin(page, legacy);
  await openBuilder(page);
  await expandSection(page, /3\. Вопросы/);
  await expect(page.getByText("Custom / Legacy").first()).toBeVisible();
});

test("schema lock: controls read-only + reason when published with entries", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const locked: Stored = {
    id: 901, season_prediction_season_id: 100, code: "locked", title: "Закрытый вызов", description: null,
    status: "active", open_at: 1, deadline_at: 4102444800, close_at: 4102448400, sort_order: 100, task_schema_version: 2, bonus_question_key: "upset",
    settings: { competition_mode: "club" }, match_pool: [{ id: 1, match_id: "m1", home_team_name: "A", away_team_name: "B" }],
    questions: [{ id: 1, weekly_challenge_id: 901, question_key: "match_of_week", title: "Q", description: null, question_type: "single_select", options: [{ id: "home", label: "H" }, { id: "away", label: "A" }], config: { template_key: "match_result", match_ref: "m1" }, status: "active", sort_order: 1 }],
    edit_state: { state: "has_submissions", structural_locked: true, entries: 3, drafts: 0, submitted: 3, scores: 0 },
  };
  await setupAdmin(page, locked);
  await openBuilder(page);
  await expect(page.getByTestId("weekly-admin-mode-select")).toBeDisabled();
  await expect(page.getByTestId("weekly-admin-task-schema-display")).toBeVisible();
  await expect(page.getByTestId("weekly-admin-template-match_of_week")).toBeDisabled();
  await expect(page.getByTestId("weekly-admin-lock-reason")).toBeVisible();
});

test("bonus selector: pick + save + reload keeps the choice (event question is ready by default)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "bonus_builder", "Бонус");

  // event_of_week (any_five_plus_goals, scope=all_pool) is valid with no extra input → ready.
  await expandSection(page, /4\. Бонусный вопрос/);
  await page.getByTestId("weekly-admin-bonus-card-event").click();
  await expect(page.getByTestId("weekly-admin-bonus-card-event")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Сохранить настройки" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expandSection(page, /4\. Бонусный вопрос/);
  await expect(page.getByTestId("weekly-admin-bonus-card-event")).toHaveAttribute("aria-checked", "true");
});

test("visual validation: empty pool blocks activation (save disabled + checklist ✗)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "val_builder", "Валидация");

  // Switch to active with an empty pool → activation problems → save is blocked.
  await page.getByLabel("Статус").selectOption("active");
  await expect(page.getByRole("button", { name: "Сохранить настройки" })).toBeDisabled();
  // The activation checklist surfaces the missing pool.
  await expandSection(page, /5\. Предпросмотр и активация/);
  await expect(page.getByText("Пул матчей заполнен")).toBeVisible();
});

test("task rewards: edit participation, save, reload persists, reset to defaults", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "rewards_builder", "Награды");

  await expandSection(page, /Награды за задания/);
  await expect(page.getByTestId("weekly-rewards-editor")).toBeVisible();
  await expect(page.getByTestId("weekly-rewards-max")).toBeVisible();

  const stars = page.getByTestId("weekly-rewards-input-participation-stars");
  await expect(stars).toHaveValue("2");
  await stars.fill("5");
  await page.getByRole("button", { name: "Сохранить награды" }).click();
  await expect(page.getByText("Награды сохранены.")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expandSection(page, /Награды за задания/);
  await expect(page.getByTestId("weekly-rewards-input-participation-stars")).toHaveValue("5");

  await page.getByRole("button", { name: "Сбросить к стандартным" }).click();
  await expect(page.getByText("Возвращены стандартные значения.")).toBeVisible();
  await expect(page.getByTestId("weekly-rewards-input-participation-stars")).toHaveValue("2");
});

test("task rewards: pick a specific case type for the perfect tier and persist", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "case_builder", "Кейс");

  await expandSection(page, /Награды за задания/);
  // perfect tier ships with 1 case → its type selector is shown; switch basic → premium.
  const caseType = page.getByTestId("weekly-rewards-case-type-result-perfect");
  await expect(caseType).toBeVisible();
  await expect(caseType).toHaveValue("basic");
  await caseType.selectOption("premium");
  await page.getByRole("button", { name: "Сохранить награды" }).click();
  await expect(page.getByText("Награды сохранены.")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expandSection(page, /Награды за задания/);
  await expect(page.getByTestId("weekly-rewards-case-type-result-perfect")).toHaveValue("premium");
});

test("task rewards: case is chosen per task, independently of other tasks", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "percase", "Кейс по заданию");

  await expandSection(page, /Награды за задания/);
  // Participation ships with NO case → selector visible and empty; choosing a type
  // turns it into "1 case of that type" and reveals the quantity field.
  const partCase = page.getByTestId("weekly-rewards-case-type-participation");
  await expect(partCase).toBeVisible();
  await expect(partCase).toHaveValue("");
  await expect(page.getByTestId("weekly-rewards-input-participation-case_count")).toHaveCount(0);
  await partCase.selectOption("premium");
  await expect(page.getByTestId("weekly-rewards-input-participation-case_count")).toHaveValue("1");

  // A different task (match bonus) is untouched — proving the choice is per task.
  await expect(page.getByTestId("weekly-rewards-case-type-bonus-match_of_week")).toHaveValue("");
  await page.getByRole("button", { name: "Сохранить награды" }).click();
  await expect(page.getByText("Награды сохранены.")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expandSection(page, /Награды за задания/);
  await expect(page.getByTestId("weekly-rewards-case-type-participation")).toHaveValue("premium");
  await expect(page.getByTestId("weekly-rewards-input-participation-case_count")).toHaveValue("1");
  await expect(page.getByTestId("weekly-rewards-case-type-bonus-match_of_week")).toHaveValue("");
});

test("task rewards: locked read-only when published", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const locked: Stored = {
    id: 902, season_prediction_season_id: 100, code: "rlock", title: "Закрытые награды", description: null,
    status: "active", open_at: 1, deadline_at: 4102444800, close_at: 4102448400, sort_order: 100, task_schema_version: 2, bonus_question_key: "upset",
    settings: { competition_mode: "club" }, match_pool: [{ id: 1, match_id: "m1", home_team_name: "A", away_team_name: "B" }],
    questions: [{ id: 1, weekly_challenge_id: 902, question_key: "match_of_week", title: "Q", description: null, question_type: "single_select", options: [{ id: "home", label: "H" }, { id: "away", label: "A" }], config: { template_key: "match_result", match_ref: "m1" }, status: "active", sort_order: 1 }],
    edit_state: { state: "has_submissions", structural_locked: true, entries: 3, drafts: 0, submitted: 3, scores: 0 },
  };
  await setupAdmin(page, locked);
  await openBuilder(page);
  await expandSection(page, /Награды за задания/);
  await expect(page.getByTestId("weekly-rewards-lock")).toBeVisible();
  await expect(page.getByTestId("weekly-rewards-input-participation-stars")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Сохранить награды" })).toBeDisabled();
});

test("admin builder mobile 390×844 has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAdmin(page);
  await openBuilder(page);
  await createDraft(page, "mob_builder", "Мобильный вызов");
  await page.getByTestId("weekly-admin-mode-select").selectOption("national_team");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

function challengeStub(id: number, status: string, title: string, createdAt: number, entries = 0): Stored {
  return {
    id, season_prediction_season_id: 100, code: `c${id}`, title, description: null,
    status, open_at: null, deadline_at: null, close_at: null, sort_order: 100, task_schema_version: 2, bonus_question_key: "upset",
    settings: { competition_mode: "club" }, match_pool: [], questions: [],
    edit_state: { state: entries > 0 ? "has_submissions" : "unused", structural_locked: entries > 0, entries, drafts: 0, submitted: entries, scores: 0 },
    created_at: createdAt,
  };
}

test("list: newest draft auto-selected over older archived; search + filters", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page, [
    challengeStub(801, "archived", "Старый архив", 1000),
    challengeStub(802, "draft", "Свежий черновик", 9000),
    challengeStub(803, "completed", "Завершённый прошлый", 2000),
  ]);
  await openBuilder(page);
  // The newest draft is auto-selected (settings title field reflects it).
  await expect(page.getByTestId("weekly-admin-challenge-card-802")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("weekly-admin-challenge-card-801")).toHaveAttribute("aria-pressed", "false");
  // Draft sorts before archived in the list (DOM order).
  const cards = page.locator('[data-testid^="weekly-admin-challenge-card-"]');
  await expect(cards.first()).toHaveAttribute("data-testid", "weekly-admin-challenge-card-802");

  // Search by title.
  await page.getByTestId("weekly-admin-search").fill("архив");
  await expect(page.getByTestId("weekly-admin-challenge-card-801")).toBeVisible();
  await expect(page.getByTestId("weekly-admin-challenge-card-802")).toHaveCount(0);
  await page.getByTestId("weekly-admin-search").fill("");

  // Hide archived.
  await page.getByTestId("weekly-admin-hide-archived").check();
  await expect(page.getByTestId("weekly-admin-challenge-card-801")).toHaveCount(0);
  await page.getByTestId("weekly-admin-hide-archived").uncheck();

  // Status filter = drafts.
  await page.getByTestId("weekly-admin-status-filter").selectOption("draft");
  await expect(page.getByTestId("weekly-admin-challenge-card-802")).toBeVisible();
  await expect(page.getByTestId("weekly-admin-challenge-card-803")).toHaveCount(0);
});

test("delete: empty draft removable via confirm; selects next; protected challenge blocked", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await setupAdmin(page, [
    challengeStub(811, "draft", "Удаляемый черновик", 9000),
    challengeStub(812, "draft", "Другой черновик", 5000),
    challengeStub(813, "active", "С участниками", 8000, 3),
  ]);
  await openBuilder(page);
  await expect(page.getByTestId("weekly-admin-challenge-card-811")).toHaveAttribute("aria-pressed", "true");

  // Danger zone → confirm requires the exact word.
  await expandSection(page, /Опасная зона/);
  await page.getByRole("button", { name: "Удалить вызов" }).click();
  await expect(page.getByTestId("weekly-admin-delete-dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Удалить безвозвратно" })).toBeDisabled();
  await page.getByTestId("weekly-admin-delete-confirm-input").fill("УДАЛИТЬ");
  await expect(page.getByRole("button", { name: "Удалить безвозвратно" })).toBeEnabled();
  await page.getByRole("button", { name: "Удалить безвозвратно" }).click();

  // Card gone; next newest draft (812) auto-selected.
  await expect(page.getByTestId("weekly-admin-challenge-card-811")).toHaveCount(0);
  await expect(page.getByTestId("weekly-admin-challenge-card-812")).toHaveAttribute("aria-pressed", "true");

  // Protected challenge (active + entries) shows the blocked reason, no delete button.
  await page.getByTestId("weekly-admin-challenge-card-813").click();
  await expandSection(page, /Опасная зона/);
  await expect(page.getByTestId("weekly-admin-delete-blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Удалить вызов" })).toHaveCount(0);
});

test("delete dialog fits mobile 390×844 without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupAdmin(page, [challengeStub(821, "draft", "Мобильное удаление", 9000)]);
  await openBuilder(page);
  await expandSection(page, /Опасная зона/);
  await page.getByRole("button", { name: "Удалить вызов" }).click();
  await expect(page.getByTestId("weekly-admin-delete-dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
