import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const teaserPath = path.join(projectRoot, "social-media", "video", "scoregame-teaser-flap.html");
const outputDir = path.join(projectRoot, "social-media", "teasers");
const outputPath = path.join(outputDir, "scoregame-flap-teaser.webm");
const coverPath = path.join(outputDir, "scoregame-flap-teaser-cover.png");
const actionPath = path.join(outputDir, "scoregame-flap-teaser-action.png");

test("exports the ScoreGame split-flap teaser", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

  await page.route("http://scoregame.local/social-media/video/scoregame-teaser-flap.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: readFileSync(teaserPath),
    });
  });

  await page.goto("http://scoregame.local/social-media/video/scoregame-teaser-flap.html");
  await page.waitForFunction(() => window.__teaserReady === true);

  await page.evaluate(() => window.renderTeaserFrame(6000));
  await page.locator("#teaser").screenshot({ path: actionPath });
  await page.evaluate(() => window.renderTeaserFrame(8700));
  await page.locator("#teaser").screenshot({ path: coverPath });

  const downloadPromise = page.waitForEvent("download", { timeout: 40_000 });
  await page.evaluate(() => window.exportScoreGameTeaser());
  const download = await downloadPromise;
  await download.saveAs(outputPath);

  expect(download.suggestedFilename()).toBe("scoregame-teaser-flap.webm");
  expect(statSync(outputPath).size).toBeGreaterThan(100_000);

  await page.route("http://scoregame.local/scoregame-flap-teaser.webm", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: readFileSync(outputPath),
    });
  });
  await page.setContent('<video id="result"></video>');
  const metadata = await page.locator("#result").evaluate(async (video: HTMLVideoElement) => {
    const response = await fetch("http://scoregame.local/scoregame-flap-teaser.webm");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    video.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(video.error), { once: true });
      video.load();
    });
    if (!Number.isFinite(video.duration)) {
      await new Promise<void>((resolve) => {
        video.addEventListener("durationchange", () => resolve(), { once: true });
        video.currentTime = Number.MAX_SAFE_INTEGER;
      });
    }
    const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    URL.revokeObjectURL(objectUrl);
    return result;
  });

  expect(metadata.width).toBe(1080);
  expect(metadata.height).toBe(1920);
  expect(metadata.duration).toBeGreaterThanOrEqual(8.8);
  expect(metadata.duration).toBeLessThanOrEqual(9.6);
  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<number | undefined>;
    renderTeaserFrame: (time: number) => void;
  }
}
