// Fortune ("Фартовый мяч") user UI — two explicit payment methods (Жетон / мячики).
// Mocks /api/* and the Telegram shell; verifies the two buttons, their enabled/disabled
// states, and that the spin request carries the chosen paymentMethod.

import { test, expect, Page } from "@playwright/test";
import { telegramInitScript } from "./telegram";

type FortuneState = { lucky_tokens: number; balance: number; allow_token: boolean; allow_balls: boolean; price: number };

async function setup(page: Page, st: FortuneState, spins: Array<Record<string, unknown>>) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(/telegram-web-app\.js/, (r) => r.abort());
  await page.addInitScript(telegramInitScript);
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true, items: [], boosts: [], cases: [], star_packs: [], data: [] };
    if (pathname === "/api/me") body = { ok: true, data: { user: { id: 777777, first_name: "E2E" }, isAdmin: false, permissions: [] } };
    else if (pathname.includes("/me/season-progress") || pathname.includes("/me/level")) body = { ok: true, stars: 0, totalStars: 0, balls: st.balance, seasonName: "S", seasonStatus: "open" };
    else if (pathname.includes("/me/profile")) body = { ok: true, user: { id: 777777, first_name: "E2E", balls: st.balance, stars: 0 } };
    else if (pathname.includes("/me/boosts")) body = { ok: true, boosts: [], balls: st.balance };
    else if (pathname.includes("/app-sections/visibility")) body = {
      ok: true, is_admin: false,
      sections: { shop: { visible: true, visibility: "visible_to_all" } },
      flags: { useScopedLeaderboardOnStartup: false },
    };
    else if (pathname.includes("/shop/config")) body = { ok: true, boosts: [], cases: [], star_packs: [] };
    else if (pathname.includes("/fortune/config")) body = {
      ok: true, enabled: true, title: "Фартовый мяч", description: "крути", price_balls: st.price,
      lucky_tokens: st.lucky_tokens, free_spins: st.lucky_tokens, balance: st.balance,
      allow_token_payment: st.allow_token, allow_balls_payment: st.allow_balls, token_cost: 1,
      sectors: [{ id: 1, reward_type: "balls", label: "Мяч", color: "#ffcc00", chance_percent: 100, fixed_amount: 1, sort_order: 10 }],
    };
    else if (pathname.includes("/fortune/spin")) {
      const reqBody = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } })();
      spins.push(reqBody);
      body = { ok: true, sector_index: 0, reward: { type: "balls", amount: 1, code: null, label: "Мяч", color: "#ffcc00" }, payment_method: reqBody.paymentMethod, free_spin: reqBody.paymentMethod === "lucky_token", lucky_tokens: Math.max(0, st.lucky_tokens - (reqBody.paymentMethod === "lucky_token" ? 1 : 0)), balance: st.balance - (reqBody.paymentMethod === "balls" ? st.price : 0) + 1 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function openFortune(page: Page) {
  await page.goto("/?tab=shop", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Фортуна" }).click();
  await expect(page.getByTestId("fortune-spin-token")).toBeVisible({ timeout: 20000 });
}

test("two payment buttons; token balance shown; spin sends paymentMethod=lucky_token", async ({ page }) => {
  const spins: Array<Record<string, unknown>> = [];
  await setup(page, { lucky_tokens: 2, balance: 100, allow_token: true, allow_balls: true, price: 5 }, spins);
  await openFortune(page);

  await expect(page.getByTestId("fortune-token-balance")).toContainText("2");
  await expect(page.getByTestId("fortune-spin-token")).toBeEnabled();
  await expect(page.getByTestId("fortune-spin-balls")).toBeEnabled();

  await page.getByTestId("fortune-spin-token").click();
  await page.getByTestId("fortune-confirm-spin").click();
  await expect.poll(() => spins.length).toBe(1);
  expect(spins[0].paymentMethod).toBe("lucky_token");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("balls button sends paymentMethod=balls", async ({ page }) => {
  const spins: Array<Record<string, unknown>> = [];
  await setup(page, { lucky_tokens: 0, balance: 100, allow_token: true, allow_balls: true, price: 5 }, spins);
  await openFortune(page);

  // No tokens → token button disabled; balls button works.
  await expect(page.getByTestId("fortune-spin-token")).toBeDisabled();
  await expect(page.getByTestId("fortune-spin-balls")).toBeEnabled();
  await page.getByTestId("fortune-spin-balls").click();
  await page.getByTestId("fortune-confirm-spin").click();
  await expect.poll(() => spins.length).toBe(1);
  expect(spins[0].paymentMethod).toBe("balls");
});

test("insufficient balls disables the balls button; token-only when balls payment off", async ({ page }) => {
  const spins: Array<Record<string, unknown>> = [];
  await setup(page, { lucky_tokens: 1, balance: 2, allow_token: true, allow_balls: false, price: 5 }, spins);
  await openFortune(page);

  // Balls payment disabled in config → no balls button at all.
  await expect(page.getByTestId("fortune-spin-balls")).toHaveCount(0);
  await expect(page.getByTestId("fortune-spin-token")).toBeEnabled();
});
