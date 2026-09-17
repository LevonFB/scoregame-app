import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

type WeeklyTaskStatus = "in_progress" | "waiting_results" | "claimable" | "claimed" | "completed" | "void" | "failed";

const challenge = {
  id: 42,
  title: "Weekly V2 E2E",
  status: "active",
  task_schema_version: 2,
  bonus_question_key: "upset",
  deadline_at: 4102444800,
};

function reward(stars = 0, balls = 0, case_type: string | null = null, case_count = 0) {
  return { stars, balls, case_type, case_count };
}

function task(key: string, status: WeeklyTaskStatus, progress: { current: number; target: number }, extra: Record<string, unknown> = {}) {
  return {
    key,
    title: key === "weekly_challenge_participation" ? "Заверши Вызов недели" : key === "weekly_challenge_bonus" ? "Бонус: сенсация недели" : "Итог недели",
    description: "E2E task",
    scope: "current_weekly_challenge",
    group: key === "weekly_challenge_participation" ? "activity" : "result",
    status,
    progress,
    reward: key === "weekly_challenge_participation" ? reward(2) : key === "weekly_challenge_result" ? reward(3, 1) : reward(2),
    claimable: status === "claimable",
    claimed: status === "claimed",
    deferred: false,
    steps: key === "weekly_challenge_participation" ? [
      { key: "started", title: "Начат", completed: progress.current >= 1 },
      { key: "answered", title: "5 ответов", completed: progress.current >= 2 },
      { key: "submitted", title: "Подтверждён", completed: progress.current >= 3 },
    ] : undefined,
    ...extra,
  };
}

const activeTasks = () => [
  task("weekly_challenge_participation", "in_progress", { current: 0, target: 3 }),
  task("weekly_challenge_bonus", "in_progress", { current: 0, target: 1 }),
  task("weekly_challenge_result", "in_progress", { current: 0, target: 1 }, { meta: { tier: null } }),
];

const waitingTasks = () => [
  task("weekly_challenge_participation", "claimable", { current: 3, target: 3 }),
  task("weekly_challenge_bonus", "waiting_results", { current: 0, target: 1 }, { future_reason: "Ждём финальный подсчёт" }),
  task("weekly_challenge_result", "waiting_results", { current: 0, target: 1 }, { future_reason: "Ждём финальный подсчёт" }),
];

const goldTasks = () => [
  task("weekly_challenge_participation", "claimed", { current: 3, target: 3 }),
  task("weekly_challenge_bonus", "failed", { current: 0, target: 1 }),
  task("weekly_challenge_result", "claimable", { current: 4, target: 5 }, { meta: { tier: "gold", pct: 0.8, max_possible_points: 5 } }),
];

const perfectAndVoidTasks = () => [
  task("weekly_challenge_participation", "claimed", { current: 3, target: 3 }),
  task("weekly_challenge_bonus", "void", { current: 0, target: 1 }, { future_reason: "Вопрос отменён" }),
  task("weekly_challenge_result", "claimable", { current: 5, target: 5 }, { reward: reward(5, 0, "basic", 1), meta: { tier: "perfect" } }),
];

function progressFor(tasks: ReturnType<typeof activeTasks>) {
  return {
    current: tasks.filter((t) => t.status === "completed" || t.status === "claimable" || t.status === "claimed").length,
    target: tasks.length,
  };
}

function basicBody(pathname: string) {
  const empty = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [], rows: [], sections: [], list: [], data: [] };
  if (pathname === "/api/me") return { ok: true, data: { user: { id: 777777, first_name: "E2E" }, isAdmin: true, permissions: ["all"] } };
  if (pathname.includes("/me/profile")) return { ok: true, user: { id: 777777, first_name: "E2E", balls: 0, stars: 0, level: 1 } };
  if (pathname.includes("/me/boosts")) return { ok: true, boosts: [], balls: 0 };
  if (pathname.includes("/app-sections/visibility")) {
    return {
      ok: true,
      is_admin: true,
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
  }
  if (pathname.includes("/season-predictions/weekly-challenges/active")) {
    return {
      ok: true,
      challenge,
      match_pool: [],
      questions: [],
      entry: null,
      status: "not_started",
    };
  }
  if (pathname.includes("/season-predictions/weekly-challenges/42/my-score")) {
    return { ok: true, challenge, entry: null, score: null, has_score: false, results_stale: false, official_status: "active" };
  }
  return empty;
}

async function setupUserApp(page: Page, mode: "active" | "waiting" | "gold" | "perfect_void" | "archive") {
  let claimed = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/api/weekly-challenge/tasks") {
      let tasks: ReturnType<typeof activeTasks> = mode === "waiting" ? waitingTasks() : mode === "gold" ? goldTasks() : mode === "perfect_void" ? perfectAndVoidTasks() : activeTasks();
      if (claimed) tasks = tasks.map((t) => t.key === "weekly_challenge_participation" ? { ...t, status: "claimed", claimable: false, claimed: true } : t);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, active_challenge: challenge, tasks, progress: progressFor(tasks) }) });
      return;
    }
    if (pathname === "/api/weekly-challenge/tasks/unclaimed") {
      const items = mode === "archive" ? [
        { challenge: { ...challenge, id: 11, title: "Archive V1", task_schema_version: 1 }, tasks: [task("weekly_challenge_score_4", "claimable", { current: 4, target: 4 }, { reward: reward(3, 1) })], claimable_count: 1, reward_summary: { stars: 3, balls: 1, cases: [] } },
        { challenge: { ...challenge, id: 12, title: "Archive V2", task_schema_version: 2 }, tasks: [task("weekly_challenge_result", "claimable", { current: 4, target: 5 }, { meta: { tier: "gold" } })], claimable_count: 1, reward_summary: { stars: 3, balls: 1, cases: [] } },
      ] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items, total_claimable: items.length, next_cursor: null }) });
      return;
    }
    if (pathname.includes("/api/weekly-challenge/tasks/") && pathname.endsWith("/claim")) {
      claimed = true;
      const responseTask = { ...waitingTasks()[0], status: "claimed", claimable: false, claimed: true };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, claimed: true, reward: reward(2), task: responseTask, balance: { stars: 2, balls: 0 } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(basicBody(pathname)) });
  });
}

async function openWeeklyTasks(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => window.dispatchEvent(new Event("open-achievements")));
  await page.getByTestId("quests-category-modes").click();
  await page.getByTestId("quests-tab-weekly_challenge").click();
  await expect(page.getByTestId("weekly-tasks-section")).toBeVisible();
}

test("user UI active V2 shows exactly three tasks on mobile", async ({ page }) => {
  await setupUserApp(page, "active");
  await openWeeklyTasks(page);

  await expect(page.locator('[data-testid^="weekly-task-card-"]')).toHaveCount(3);
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_participation")).toBeVisible();
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_bonus")).toBeVisible();
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_result")).toBeVisible();
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_started")).toHaveCount(0);
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_score_4")).toHaveCount(0);
  await expect(page.getByTestId("weekly-tasks-progress")).not.toContainText("4/6");
  // Hero now shows 5 user-facing goals (3 participation steps + bonus + result).
  await expect(page.getByTestId("weekly-tasks-progress")).toContainText("0/5");
  await expect(page.getByTestId("weekly-tasks-summary")).toContainText("5 целей");
  await expect(page.getByTestId("weekly-task-progress-weekly_challenge_participation")).toHaveText("0/3");
  await expect(page.getByTestId("weekly-task-steps-weekly_challenge_participation")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("user UI waiting results and participation claim persist after reload", async ({ page }) => {
  await setupUserApp(page, "waiting");
  await openWeeklyTasks(page);

  await expect(page.getByTestId("weekly-task-card-weekly_challenge_participation")).toHaveAttribute("data-status", "claimable");
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_bonus")).toHaveAttribute("data-status", "waiting_results");
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_result")).toHaveAttribute("data-status", "waiting_results");

  await page.getByTestId("weekly-task-card-weekly_challenge_participation").click();
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_participation")).toHaveAttribute("data-status", "claimed");

  await page.reload({ waitUntil: "domcontentloaded" });
  await openWeeklyTasks(page);
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_participation")).toHaveAttribute("data-status", "claimed");
});

test("user UI renders gold result reward", async ({ page }) => {
  await setupUserApp(page, "gold");
  await openWeeklyTasks(page);
  await expect(page.getByTestId("weekly-task-progress-weekly_challenge_result")).toHaveText("4/5");
  await expect(page.getByTestId("weekly-task-reward-weekly_challenge_result").locator("img")).toHaveCount(2);
});

test("user UI renders perfect case reward and void bonus", async ({ page }) => {
  await setupUserApp(page, "perfect_void");
  await openWeeklyTasks(page);
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_bonus")).toHaveAttribute("data-status", "void");
  await expect(page.getByTestId("weekly-task-reward-weekly_challenge_result").locator("img")).toHaveCount(2);
});

test("user UI renders V1 and V2 archive groups", async ({ page }) => {
  await setupUserApp(page, "archive");
  await openWeeklyTasks(page);
  await expect(page.getByTestId("weekly-tasks-archive")).toBeVisible();
  await expect(page.getByTestId("weekly-task-card-weekly_challenge_score_4")).toHaveAttribute("data-challenge-id", "11");
  await expect(page.locator('[data-testid="weekly-task-card-weekly_challenge_result"][data-challenge-id="12"]')).toBeVisible();
});

function adminChallenge(status = "active") {
  return {
    id: 42,
    season_prediction_season_id: 100,
    code: "admin_weekly_v2",
    title: "Admin Weekly V2",
    description: "Admin E2E",
    status,
    open_at: 1,
    deadline_at: 4102444800,
    close_at: 4102448400,
    sort_order: 100,
    settings: {},
    task_schema_version: 2,
    bonus_question_key: "upset",
    match_count: 5,
    question_count: 5,
  };
}

function adminQuestions() {
  return ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"].map((key, index) => ({
    id: index + 1,
    weekly_challenge_id: 42,
    question_key: key,
    title: `Question ${index + 1}`,
    description: "Admin E2E",
    question_type: "single_select",
    options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    config: {},
    status: "active",
    sort_order: index + 1,
  }));
}

async function setupAdminApp(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === "/api/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { user: { id: 777777 }, isAdmin: true, permissions: ["all"] } }) });
      return;
    }
    if (pathname === "/api/admin/season-predictions/config") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, season: { id: 100, code: "club_2026_27", title: "E2E", status: "open", settings: {} }, tournaments: [] }) });
      return;
    }
    if (pathname === "/api/admin/season-predictions/reset/summary") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, seasonCode: "club_2026_27", counts: {} }) });
      return;
    }
    if (pathname === "/api/admin/season-predictions/task-rewards") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          items: [],
          summary: {
            enabled_count: 0,
            max_balls: 0,
            max_stars: 0,
            max_cases: 0,
            cases_by_type: {},
            by_category: {},
            by_group: {},
          },
          warnings: [],
          case_options: ["", "premium", "daily_free"],
        }),
      });
      return;
    }
    if (pathname === "/api/admin/season-predictions/weekly-challenges") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, season: { id: 100, code: "club_2026_27", title: "E2E" }, challenges: [adminChallenge()] }) });
      return;
    }
    if (pathname === "/api/admin/season-predictions/weekly-challenges/42") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, challenge: adminChallenge(), match_pool: [], questions: adminQuestions(), question_edit_state: { state: "locked", structural_locked: true, entries: 1, drafts: 0, submitted: 1, scores: 0 } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

test("admin UI shows V2 controls read-only and V2 preview", async ({ page }) => {
  await setupAdminApp(page);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.getByTestId("admin-tab-season_predictions").click();
  await page.getByTestId("season-predictions-group-weekly_challenge").click();
  await expect(page.getByTestId("weekly-admin-root")).toBeVisible();
  await expect(page.getByTestId("weekly-admin-task-schema-display")).toContainText("V2");
  await expect(page.getByTestId("weekly-admin-mode-select")).toBeDisabled();
  await expect(page.getByTestId("weekly-admin-v2-preview")).toContainText("participation");
  // W-UX: once locked (published / has entries) the bonus shows a lock banner that
  // names the current selection — not silently disabled cards.
  await expect(page.getByTestId("weekly-admin-bonus-lock")).toContainText("Сенсация недели");
});
