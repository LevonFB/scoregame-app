import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

function visibilityBody() {
  return {
    ok: true,
    is_admin: false,
    sections: {
      home: { visible: true, visibility: "visible_to_all" },
      leaderboard: { visible: true, visibility: "visible_to_all" },
    },
    flags: { useScopedLeaderboardOnStartup: false },
  };
}

function mockBody(pathname: string) {
  const empty = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [], rows: [], sections: [], list: [], data: [] };
  if (pathname.includes("/me/profile")) return { ok: true, user: { id: 777777, first_name: "E2E", balls: 0, stars: 0 } };
  if (pathname.includes("/me/boosts")) return { ok: true, boosts: [], balls: 0 };
  if (pathname.includes("/leaderboard")) return { ok: true, leaderboard: [], me: { userId: "777777", points: 0, rank: null }, isAdmin: false };
  return empty;
}

async function setupMockedApp(page: Page, sink: { api: string[]; bracket: string[] }) {
  // Block the real Telegram SDK so our injected stub (with test initData) is not
  // overwritten by telegram-web-app.js (which yields empty initData outside Telegram).
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    sink.api.push(url.pathname);
    // World Cup bracket was fully removed — any /brackets/* or /wc2026* hit is a regression.
    if (url.pathname.includes("/brackets/") || url.pathname.includes("/wc2026")) {
      sink.bracket.push(url.pathname + url.search);
    }
    const body = url.pathname.includes("/app-sections/visibility") ? visibilityBody() : mockBody(url.pathname);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

// World Cup bracket was removed: the app must boot and never call any WC endpoint.
test("smoke: app boots and makes zero World Cup bracket requests", async ({ page }) => {
  const sink = { api: [] as string[], bracket: [] as string[] };
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await setupMockedApp(page, sink);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  expect(sink.api.length, "app reached backend transport").toBeGreaterThan(0);
  expect(sink.bracket, `unexpected WC bracket calls: ${sink.bracket.join(", ")}`).toHaveLength(0);
  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});

// Deep-link to the removed bracket tab must not resurrect WC requests or crash.
test("smoke: deep-link to removed bracket tab does not call WC endpoints", async ({ page }) => {
  const sink = { api: [] as string[], bracket: [] as string[] };
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await setupMockedApp(page, sink);
  await page.goto("/?tgWebAppStartParam=bracket", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);

  const bodyText = (await page.locator("body").innerText()).trim();
  expect(bodyText.length).toBeGreaterThan(0);
  expect(sink.bracket, `unexpected WC bracket calls: ${sink.bracket.join(", ")}`).toHaveLength(0);
  expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
});
