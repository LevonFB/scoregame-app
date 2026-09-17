// Weekly Challenge builder — USER renderer release-gate Playwright smoke.
// Boots `next dev`, stubs Telegram, route-mocks /api/* (no real api-worker / D1).
// Verifies the generic renderer for the new templates: competition-mode badge,
// "Расклад недели" category (league_of_week relabel), group context, arbitrary
// option labels, and mobile (390×844) has no horizontal overflow.

import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

const CHALLENGE_ID = 50;

function templateQuestions() {
  // league_of_week first (sort_order 10) so the "Расклад недели" card is step 1.
  return [
    {
      id: 2, weekly_challenge_id: CHALLENGE_ID, question_key: "league_of_week",
      title: "В какой группе матчей будет больше ничьих?", description: null, question_type: "single_select",
      status: "active", sort_order: 10, template_key: "group_most_draws", display_category: "Расклад недели",
      options: [{ id: "group_1", label: "Группа A" }, { id: "group_2", label: "Группа B" }, { id: "equal", label: "Равенство" }],
      config: { template_key: "group_most_draws", calculation: "draws_count", tie_behavior: "equal_option",
        groups: [{ id: "group_1", title: "Группа A", match_ids: ["m1", "m2"] }, { id: "group_2", title: "Группа B", match_ids: ["m3"] }] },
    },
    {
      id: 1, weekly_challenge_id: CHALLENGE_ID, question_key: "match_of_week",
      title: "Кто победит в матче недели?", description: null, question_type: "single_select",
      status: "active", sort_order: 20, template_key: "match_result", display_category: "Матч недели",
      options: [{ id: "home", label: "Победа Arsenal" }, { id: "draw", label: "Ничья" }, { id: "away", label: "Победа City" }],
      config: { template_key: "match_result", match_ref: "m1", home_team_name: "Arsenal", away_team_name: "Manchester City" },
    },
  ];
}

function challenge(mode: "club" | "national_team") {
  return {
    id: CHALLENGE_ID, season_prediction_season_id: 100, code: "user_builder", title: "Вызов недели — конструктор",
    description: null, status: "active", open_at: 1, deadline_at: 4102444800, close_at: 4102448400, sort_order: 100,
    task_schema_version: 2, bonus_question_key: "league", settings: { competition_mode: mode }, competition_mode: mode,
    match_count: 3, question_count: 2,
  };
}

function activeBody(mode: "club" | "national_team", entry: unknown = null) {
  return { ok: true, season: { id: 100, code: "club_2026_27" }, challenge: challenge(mode),
    match_pool: [
      { id: 1, weekly_challenge_id: CHALLENGE_ID, match_id: "m1", tournament_code: "PL", home_team_name: "Arsenal", away_team_name: "Manchester City", kickoff_at: 4102444800, status: null, score_home: null, score_away: null, sort_order: 1, metadata: {} },
    ],
    questions: templateQuestions(), entry, status: entry ? "submitted" : "not_started" };
}

async function setup(page: Page, mode: "club" | "national_team", entry: unknown = null) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [], rows: [], sections: [], list: [], data: [] };
    if (pathname === "/api/me") body = { ok: true, data: { user: { id: 777777, first_name: "E2E" }, isAdmin: false, permissions: [] } };
    else if (pathname.includes("/me/profile")) body = { ok: true, user: { id: 777777, first_name: "E2E", balls: 0, stars: 0, level: 1 } };
    else if (pathname.includes("/me/boosts")) body = { ok: true, boosts: [], balls: 0 };
    else if (pathname.includes("/app-sections/visibility")) body = {
      ok: true, is_admin: false,
      sections: {
        predictions: { visible: true, visibility: "visible_to_all" },
        season_predictions: { visible: true, visibility: "visible_to_all" },
        weekly_challenge: { visible: true, visibility: "visible_to_all" },
        tasks: { visible: true, visibility: "visible_to_all" },
        leagues: { visible: true, visibility: "visible_to_all" },
        leaderboard: { visible: true, visibility: "visible_to_all" },
        shop: { visible: true, visibility: "visible_to_all" },
        profile: { visible: true, visibility: "visible_to_all" },
        info: { visible: true, visibility: "visible_to_all" },
      },
      flags: { useScopedLeaderboardOnStartup: false },
    };
    else if (pathname.includes("/weekly-challenges/active")) body = activeBody(mode, entry);
    else if (pathname.endsWith("/my-score")) body = { ok: true, challenge: challenge(mode), entry: null, score: null, has_score: false, results_stale: false, official_status: "active" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function openEditor(page: Page) {
  // The initial ?tab URL isn't honoured (SSR useState init) — navigate via the home
  // weekly card (the whole card is a button), which routes to the standalone weekly tab.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByTestId("weekly-home-card").click();
  await expect(page.getByText("5 быстрых вопросов на ближайший футбольный уикенд")).toBeVisible({ timeout: 20000 });
  await page.locator('[aria-label^="Вызов недели — конструктор"]').first().click();
}

test("home card: mode badge, progress, contextual CTA", async ({ page }) => {
  await setup(page, "national_team");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("weekly-home-card")).toBeVisible();
  await expect(page.getByTestId("weekly-home-mode")).toHaveText("Матчи сборных");
  await expect(page.getByTestId("weekly-home-cta")).toHaveText("Начать вызов");
  await expect(page.getByTestId("weekly-home-progress")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("club challenge: mode badge, Расклад недели, group composition, options", async ({ page }) => {
  await setup(page, "club");
  await openEditor(page);

  await expect(page.getByTestId("weekly-mode-badge")).toHaveText("Клубный футбол");
  await expect(page.getByText("Расклад недели").first()).toBeVisible();
  // Group composition (not the bare "Группа A (2)" text).
  await expect(page.getByTestId("weekly-group-composition")).toBeVisible();
  await expect(page.getByText("Сравниваются 2 группы")).toBeVisible();
  await page.getByTestId("weekly-group-toggle-group_1").click();
  await expect(page.getByTestId("weekly-group-composition").getByText("Arsenal — Manchester City")).toBeVisible();
  await expect(page.getByText("Равенство").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("national-team challenge: badge Матчи сборных", async ({ page }) => {
  await setup(page, "national_team");
  await openEditor(page);
  await expect(page.getByTestId("weekly-mode-badge")).toHaveText("Матчи сборных");
  await expect(page.getByText("Расклад недели").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("submitted entry re-opens on the review screen, not the first question", async ({ page }) => {
  const entry = { status: "submitted", answers: { league_of_week: "group_1", match_of_week: "home" }, last_submitted_at: 4102444000 };
  await setup(page, "club", entry);
  await openEditor(page);
  // Returning to an already-submitted challenge lands on "Проверка ответов",
  // not the "Вопрос 1 из N" stepper.
  await expect(page.getByRole("heading", { name: "Проверка ответов" })).toBeVisible();
  await expect(page.getByText(/Вопрос 1 из/)).toHaveCount(0);
  // The review still lets the user jump back to the questions.
  await expect(page.getByText("← К вопросам")).toBeVisible();
});
