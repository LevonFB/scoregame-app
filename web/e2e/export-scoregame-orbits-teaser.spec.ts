import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const teaserPath = path.join(projectRoot, "social-media", "video", "scoregame-teaser-orbits.html");
const outputDir = path.join(projectRoot, "social-media", "teasers");
const outputPath = path.join(outputDir, "scoregame-orbits-teaser.webm");
const coverPath = path.join(outputDir, "scoregame-orbits-teaser-cover.png");
const actionPath = path.join(outputDir, "scoregame-orbits-teaser-action.png");

test("exports the ScoreGame game-modes orbits teaser", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

  await page.route("http://scoregame.local/social-media/video/scoregame-teaser-orbits.html", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: readFileSync(teaserPath) });
  });

  await page.goto("http://scoregame.local/social-media/video/scoregame-teaser-orbits.html");
  await page.waitForFunction(() => window.__teaserReady === true);

  await page.evaluate(() => window.renderTeaserFrame(5800));
  await page.locator("#teaser").screenshot({ path: actionPath });
  await page.evaluate(() => window.renderTeaserFrame(10500));
  await page.locator("#teaser").screenshot({ path: coverPath });

  const downloadPromise = page.waitForEvent("download", { timeout: 40_000 });
  await page.evaluate(() => window.exportScoreGameTeaser());
  const download = await downloadPromise;
  await download.saveAs(outputPath);

  expect(download.suggestedFilename()).toBe("scoregame-teaser-orbits.webm");
  expect(statSync(outputPath).size).toBeGreaterThan(100_000);
  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<number | undefined>;
    renderTeaserFrame: (time: number) => void;
  }
}
