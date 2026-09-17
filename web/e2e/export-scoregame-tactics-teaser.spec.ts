import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const teaserPath = path.join(projectRoot, "social-media", "teasers", "scoregame-tactics-teaser.html");
const logoPath = path.join(projectRoot, "social-media", "brand", "scoregame-logo-original.jpg");
const outputPath = path.join(projectRoot, "social-media", "teasers", "scoregame-tactics-teaser.webm");
const coverPath = path.join(projectRoot, "social-media", "teasers", "scoregame-tactics-teaser-cover.png");
const actionPath = path.join(projectRoot, "social-media", "teasers", "scoregame-tactics-teaser-action.png");

test("exports the ScoreGame tactics teaser", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

  await page.route("http://scoregame.local/social-media/teasers/scoregame-tactics-teaser.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: readFileSync(teaserPath),
    });
  });
  await page.route("http://scoregame.local/social-media/brand/scoregame-logo-original.jpg", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/jpeg",
      body: readFileSync(logoPath),
    });
  });

  await page.goto("http://scoregame.local/social-media/teasers/scoregame-tactics-teaser.html");
  await page.waitForFunction(() => window.__teaserReady === true);
  await page.evaluate(() => window.renderTeaserFrame(2900));
  await page.locator("#teaser").screenshot({ path: actionPath });
  await page.evaluate(() => window.renderTeaserFrame(6200));
  await page.locator("#teaser").screenshot({ path: coverPath });

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.evaluate(() => window.exportScoreGameTeaser());
  const download = await downloadPromise;
  await download.saveAs(outputPath);

  expect(download.suggestedFilename()).toBe("scoregame-tactics-teaser.webm");
  expect(statSync(outputPath).size).toBeGreaterThan(100_000);
  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<void>;
    renderTeaserFrame: (time: number) => void;
  }
}
