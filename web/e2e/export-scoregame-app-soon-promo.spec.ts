import { expect, test } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

// Собранный ролик самодостаточен (ассеты вшиты как data URI сборкой
// social-media/video/build.mjs), поэтому маршрут нужен только под сам HTML.
const projectRoot = path.resolve(process.cwd(), "..");
const promoPath = path.join(projectRoot, "social-media", "video", "scoregame-app-soon-promo.html");
const outputDir = path.join(projectRoot, "social-media", "teasers");
const outputPath = path.join(outputDir, "scoregame-app-soon-promo.webm");
const coverPath = path.join(outputDir, "scoregame-app-soon-promo-cover.png");
const actionPath = path.join(outputDir, "scoregame-app-soon-promo-action.png");

test("exports the ScoreGame app promo with the СКОРО finale", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));

  await page.route("http://scoregame.local/social-media/video/scoregame-app-soon-promo.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: readFileSync(promoPath),
    });
  });

  await page.goto("http://scoregame.local/social-media/video/scoregame-app-soon-promo.html");
  await page.waitForFunction(() => window.__teaserReady === true);

  await page.evaluate(() => window.renderTeaserFrame(3400));
  await page.locator("#teaser").screenshot({ path: actionPath });
  await page.evaluate(() => window.renderTeaserFrame(10400));
  await page.locator("#teaser").screenshot({ path: coverPath });

  const downloadPromise = page.waitForEvent("download", { timeout: 40_000 });
  await page.evaluate(() => window.exportScoreGameTeaser());
  const download = await downloadPromise;
  await download.saveAs(outputPath);

  expect(download.suggestedFilename()).toBe("scoregame-app-soon-promo.webm");
  expect(statSync(outputPath).size).toBeGreaterThan(100_000);

  await page.route("http://scoregame.local/scoregame-app-soon-promo.webm", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "video/webm",
      body: readFileSync(outputPath),
    });
  });
  await page.setContent('<video id="result"></video>');
  const metadata = await page.locator("#result").evaluate(async (video: HTMLVideoElement) => {
    const response = await fetch("http://scoregame.local/scoregame-app-soon-promo.webm");
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
  expect(metadata.duration).toBeGreaterThanOrEqual(10.8);
  expect(metadata.duration).toBeLessThanOrEqual(11.6);
  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});

declare global {
  interface Window {
    __teaserReady: boolean;
    exportScoreGameTeaser: () => Promise<number | undefined>;
    renderTeaserFrame: (time: number) => void;
  }
}
