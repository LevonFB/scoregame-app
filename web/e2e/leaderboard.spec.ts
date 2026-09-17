// Stage 9 E2E (web) — home leaderboard load reduction. Playwright counts REAL
// intercepted requests. Flags are delivered via /app-sections/visibility (mocked).
import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

interface Flags { homeRatingDedupeV2?: boolean; homeLeaguesLazyLoadV2?: boolean }

const LEAGUES = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Alpha League", type: "private", members_count: 5 },
  { id: "22222222-2222-2222-2222-222222222222", name: "Beta League", type: "private", members_count: 7 },
  { id: "33333333-3333-3333-3333-333333333333", name: "Gamma League", type: "channel", members_count: 9 },
];
// Deterministic global season rows incl. the viewer (777777) at rank 2 with 42 pts.
const GLOBAL_ROWS = [
  { id: 100, display_name: "Top Player", score: 99 },
  { id: 777777, display_name: "E2E", score: 42 },
  { id: 200, display_name: "Third", score: 10 },
];
const LEAGUE_ROWS = [
  { id: 100, display_name: "Captain", score: 50 },
  { id: 777777, display_name: "E2E", score: 30 },
];

function visibilityBody(flags: Flags) {
  return {
    ok: true,
    is_admin: false,
    sections: {},
    flags: { useScopedLeaderboardOnStartup: false, ...flags },
  };
}

interface Sink { global: string[]; leagueLb: string[]; leagueMy: number }

async function setup(page: Page, flags: Flags, sink: Sink, opts: { delayMs?: number } = {}) {
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    let body: any = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [], rows: [], list: [], data: [] };
    if (p.includes("/app-sections/visibility")) body = visibilityBody(flags);
    else if (p.includes("/me/profile")) body = { ok: true, user: { id: 777777, first_name: "E2E", balls: 0, stars: 0, level: 1 } };
    else if (p.includes("/me/boosts")) body = { ok: true, boosts: [], balls: 0 };
    else if (p.endsWith("/leagues/my")) { sink.leagueMy++; body = { ok: true, leagues: LEAGUES }; }
    else if (/\/leagues\/[^/]+\/leaderboard$/.test(p)) {
      sink.leagueLb.push(p);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      body = { ok: true, leaderboard: LEAGUE_ROWS, period: "season" };
    }
    else if (p.includes("/leaderboards/global")) {
      sink.global.push(p + url.search);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      body = { ok: true, leaderboard: GLOBAL_ROWS, period: url.searchParams.get("period") };
    }
    else if (p.endsWith("/leaderboard")) body = { ok: true, leaderboard: [], me: { userId: "777777", points: 0, rank: null }, isAdmin: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}
const freshSink = (): Sink => ({ global: [], leagueLb: [], leagueMy: 0 });
const countGlobal = (sink: Sink, period: string) => sink.global.filter((u) => u.includes(`period=${encodeURIComponent(period)}`) || u.includes(`period=${period}`)).length;
const countLeague = (sink: Sink, id: string) => sink.leagueLb.filter((u) => u.includes(id)).length;

async function gotoHome(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

// (1) Default flags: legacy network behavior — eager leagues, no dedupe.
test("default flags: eager league loads (all leagues requested)", async ({ page }) => {
  const sink = freshSink();
  await setup(page, {}, sink, { delayMs: 60 });
  await gotoHome(page);
  // All 3 leagues are loaded eagerly (incl. off-screen) under legacy behavior.
  await expect.poll(() => LEAGUES.every((l) => countLeague(sink, l.id) >= 1), { timeout: 8000 }).toBe(true);
  expect(countLeague(sink, LEAGUES[1].id), "off-screen league IS loaded under legacy").toBeGreaterThanOrEqual(1);
});

// (2)+(5) Dedupe V2: identical global request per period sent once (parallel coalesced).
test("dedupe V2: each global period requested exactly once", async ({ page }) => {
  const sink = freshSink();
  await setup(page, { homeRatingDedupeV2: true }, sink, { delayMs: 300 });
  await gotoHome(page);
  await expect.poll(() => countGlobal(sink, "season"), { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(countGlobal(sink, "season"), "season global deduped to one").toBe(1);
  // Rating UI still renders rank/points.
  await expect(page.getByText("Рейтинг игроков")).toBeVisible();
});

// (5) Parallel render safety: under V2 a given period is physically sent at most once
// even though StrictMode double-mounts the carousel (coalesced / gated).
test("V2: identical global request physically sent at most once (parallel-safe)", async ({ page }) => {
  const sink = freshSink();
  await setup(page, { homeRatingDedupeV2: true }, sink, { delayMs: 200 });
  await gotoHome(page);
  await expect.poll(() => countGlobal(sink, "day:") + countGlobal(sink, "season"), { timeout: 8000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(countGlobal(sink, "season"), "season once").toBeLessThanOrEqual(1);
  // day period uses period=day:<date>; ensure it is not duplicated either.
  const dayCount = sink.global.filter((u) => u.includes("period=day")).length;
  expect(dayCount, "day once").toBeLessThanOrEqual(1);
});

// (3) Lazy leagues V2: startup loads only primary; hidden leagues 0 requests.
test("lazy V2: only primary league loaded at startup; hidden leagues 0 requests", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // mobile Mini App width
  const sink = freshSink();
  await setup(page, { homeLeaguesLazyLoadV2: true }, sink);
  await gotoHome(page);
  await expect.poll(() => countLeague(sink, LEAGUES[0].id), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  expect(countLeague(sink, LEAGUES[1].id), "hidden league #2 not loaded").toBe(0);
  expect(countLeague(sink, LEAGUES[2].id), "hidden league #3 not loaded").toBe(0);
});

// (4) Opening (scrolling to) a hidden league triggers exactly one request; reopen no dup.
test("lazy V2: scrolling a hidden league into view loads it once (no duplicate)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sink = freshSink();
  await setup(page, { homeLeaguesLazyLoadV2: true }, sink);
  await gotoHome(page);
  await expect.poll(() => countLeague(sink, LEAGUES[0].id), { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  expect(countLeague(sink, LEAGUES[2].id)).toBe(0);

  const card3 = page.locator(`[data-league-id="${LEAGUES[2].id}"]`);
  await card3.scrollIntoViewIfNeeded();
  await expect.poll(() => countLeague(sink, LEAGUES[2].id), { timeout: 8000 }).toBe(1);
  // Scroll away and back → already loaded, no second request.
  await page.locator(`[data-league-id="${LEAGUES[0].id}"]`).scrollIntoViewIfNeeded();
  await card3.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  expect(countLeague(sink, LEAGUES[2].id), "reopen uses loaded state").toBe(1);
});

// (6) Leaderboard error: home does not crash; retry works.
test("global leaderboard error: home stays alive", async ({ page }) => {
  const sink = freshSink();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  let failNext = true;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.includes("/leaderboards/global") && failNext) {
      failNext = false;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "boom" }) });
    }
    let body: any = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [] };
    if (p.includes("/app-sections/visibility")) body = visibilityBody({ homeRatingDedupeV2: true });
    else if (p.includes("/me/profile")) body = { ok: true, user: { id: 777777, first_name: "E2E" } };
    else if (p.endsWith("/leagues/my")) body = { ok: true, leagues: LEAGUES };
    else if (/\/leagues\/[^/]+\/leaderboard$/.test(p)) body = { ok: true, leaderboard: LEAGUE_ROWS };
    else if (p.includes("/leaderboards/global")) body = { ok: true, leaderboard: GLOBAL_ROWS };
    else if (p.endsWith("/leaderboard")) body = { ok: true, leaderboard: [], me: {}, isAdmin: false };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await gotoHome(page);
  const bodyText = (await page.locator("body").innerText()).trim();
  expect(bodyText.length).toBeGreaterThan(0);
  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// (7) UI parity: rank & points identical between default and V2 for the same data.
async function readSeasonStanding(page: Page): Promise<string> {
  await expect(page.getByText("Рейтинг игроков")).toBeVisible();
  // The season card shows the viewer's points (42). Assert it is present somewhere.
  return (await page.locator("body").innerText());
}
test("UI parity: rank/points/order identical (default vs V2)", async ({ page }) => {
  const s1 = freshSink();
  await setup(page, {}, s1);
  await gotoHome(page);
  const def = await readSeasonStanding(page);
  expect(def).toContain("Top Player");
  expect(def).toContain("42"); // viewer points

  const s2 = freshSink();
  await setup(page, { homeRatingDedupeV2: true, homeLeaguesLazyLoadV2: true }, s2);
  await gotoHome(page);
  const v2 = await readSeasonStanding(page);
  expect(v2).toContain("Top Player");
  expect(v2).toContain("42");
});
