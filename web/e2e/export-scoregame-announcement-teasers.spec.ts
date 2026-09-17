import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const teaserPath = path.join(projectRoot, "social-media", "teasers", "scoregame-announcement-teasers.html");
const logoPath = path.join(projectRoot, "social-media", "brand", "scoregame-logo-original.jpg");

const scenes = [
  {
    query: "score",
    filename: "scoregame-unknown-score-teaser.webm",
    cover: "scoregame-unknown-score-teaser-cover.png",
    action: "scoregame-unknown-score-teaser-action.png",
    actionTime: 2750,
  },
  {
    query: "telegram",
    filename: "scoregame-telegram-teaser.webm",
    cover: "scoregame-telegram-teaser-cover.png",
    action: "scoregame-telegram-teaser-action.png",
    actionTime: 2600,
  },
] as const;

for (const scene of scenes) {
  test(`exports the ${scene.query} announcement teaser`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

    await page.route("**/social-media/teasers/scoregame-announcement-teasers.html*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: readFileSync(teaserPath),
      });
    });
    await page.route("**/social-media/brand/scoregame-logo-original.jpg", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: readFileSync(logoPath),
      });
    });

    await page.goto(`http://scoregame.local/social-media/teasers/scoregame-announcement-teasers.html?scene=${scene.query}`);
    await page.waitForFunction(() => window.__teaserReady === true);
    await page.evaluate((time) => window.renderTeaserFrame(time), scene.actionTime);
    await page.locator("#teaser").screenshot({
      path: path.join(projectRoot, "social-media", "teasers", scene.action),
    });
    await page.evaluate(() => window.renderTeaserFrame(6200));
    await page.locator("#teaser").screenshot({
      path: path.join(projectRoot, "social-media", "teasers", scene.cover),
    });

    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await page.evaluate(() => window.exportScoreGameTeaser());
    const download = await downloadPromise;
    const outputPath = path.join(projectRoot, "social-media", "teasers", scene.filename);
    await download.saveAs(outputPath);

    expect(download.suggestedFilename()).toBe(scene.filename);
    expect(statSync(outputPath).size).toBeGreaterThan(100_000);
    expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
  });
}

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<void>;
    renderTeaserFrame: (time: number) => void;
    setScoreGameTeaserScene: (scene: "score" | "telegram") => void;
  }
}
