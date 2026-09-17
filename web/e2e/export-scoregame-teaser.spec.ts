import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd(), "..");
const teaserPath = path.join(projectRoot, "social-media", "teasers", "scoregame-soon-teaser.html");
const logoPath = path.join(projectRoot, "social-media", "brand", "scoregame-logo-original.jpg");
const outputPath = path.join(projectRoot, "social-media", "teasers", "scoregame-soon-teaser.webm");
const coverPath = path.join(projectRoot, "social-media", "teasers", "scoregame-soon-teaser-cover.png");

test("exports the ScoreGame soon teaser", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

  await page.route("http://scoregame.local/social-media/teasers/scoregame-soon-teaser.html", async (route) => {
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

  await page.goto("http://scoregame.local/social-media/teasers/scoregame-soon-teaser.html");
  await page.waitForFunction(() => window.__teaserReady === true);
  await page.evaluate(() => window.renderTeaserFrame(6200));
  await page.locator("#teaser").screenshot({ path: coverPath });

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.evaluate(() => window.exportScoreGameTeaser());
  const download = await downloadPromise;
  await download.saveAs(outputPath);

  expect(download.suggestedFilename()).toBe("scoregame-soon-teaser.webm");
  expect(statSync(outputPath).size).toBeGreaterThan(100_000);

  await page.route("http://scoregame.local/scoregame-soon-teaser.webm", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: readFileSync(outputPath),
    });
  });
  await page.setContent('<video id="result"></video>');
  const metadata = await page.locator("#result").evaluate(async (video: HTMLVideoElement) => {
    const response = await fetch("http://scoregame.local/scoregame-soon-teaser.webm");
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
    const result = {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
    URL.revokeObjectURL(objectUrl);
    return result;
  });
  expect(metadata.width).toBe(1080);
  expect(metadata.height).toBe(1920);
  expect(metadata.duration).toBeGreaterThanOrEqual(6.8);
  expect(metadata.duration).toBeLessThanOrEqual(7.5);
  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<number | undefined>;
    renderTeaserFrame: (time: number) => void;
  }
}
