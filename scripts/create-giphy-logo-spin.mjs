import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const bodyPath = resolve(root, "web/public/sg-logo-blue.png");
const outlinePath = resolve(root, "web/public/sg-logo-cream.png");
const outputPath = resolve(root, "artifacts/giphy/scoregame-logo-spin.gif");
const previewPath = resolve(root, "artifacts/giphy/scoregame-logo-spin-preview.png");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const html = String.raw`<!doctype html>
<meta charset="utf-8">
<title>ScoreGame sticker renderer</title>
<script>
const WIDTH = 512;
const HEIGHT = 320;
const FRAME_COUNT = 24;
const FRAME_DELAY_CS = 8;

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = path;
  });
}

function tintedMask(image, fill) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawLayer(ctx, image, centerX, top, width, height, offsetX, scaleX) {
  ctx.save();
  ctx.translate(centerX + offsetX, 0);
  ctx.scale(scaleX, 1);
  ctx.drawImage(image, -width / 2, top, width, height);
  ctx.restore();
}

async function render() {
  const [bodyImage, outlineImage] = await Promise.all([
    loadImage("/body.png"),
    loadImage("/outline.png"),
  ]);
  const outlineFront = tintedMask(outlineImage, "#fff3d9");
  const bodyFront = tintedMask(bodyImage, "#007aff");
  const outlineSide = tintedMask(outlineImage, "#b78b4a");
  const bodySide = tintedMask(bodyImage, "#003d8f");
  const outlineBack = tintedMask(outlineImage, "#d7b878");
  const bodyBack = tintedMask(bodyImage, "#0057b8");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const logoWidth = 448;
  const logoHeight = logoWidth * 157 / 320;
  const top = (HEIGHT - logoHeight) / 2;
  const frames = [];

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    const angle = frame / FRAME_COUNT * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const scaleX = cosine;
    const thickness = 17 * Math.abs(sine);
    const direction = sine >= 0 ? -1 : 1;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (let depth = Math.ceil(thickness); depth >= 1; depth--) {
      const offset = direction * depth;
      drawLayer(ctx, outlineSide, WIDTH / 2, top, logoWidth, logoHeight, offset, scaleX);
      drawLayer(ctx, bodySide, WIDTH / 2, top, logoWidth, logoHeight, offset, scaleX);
    }
    const backFacing = cosine < 0;
    drawLayer(ctx, backFacing ? outlineBack : outlineFront, WIDTH / 2, top, logoWidth, logoHeight, 0, scaleX);
    drawLayer(ctx, backFacing ? bodyBack : bodyFront, WIDTH / 2, top, logoWidth, logoHeight, 0, scaleX);
    frames.push(await new Promise((resolve) => canvas.toBlob(resolve, "image/png")));
  }

  await Promise.all(frames.map((png, index) => fetch("/frame/" + index, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: png,
  })));
  document.title = "done";
}

render().catch((error) => {
  document.title = "error";
  document.body.textContent = String(error && error.stack || error);
});
</script>`;

await mkdir(dirname(outputPath), { recursive: true });
const [body, outline] = await Promise.all([readFile(bodyPath), readFile(outlinePath)]);
const frameDir = await mkdtemp(resolve(tmpdir(), "scoregame-giphy-frames-"));

let resolveSaved;
let rejectSaved;
let savedParts = 0;
const saved = new Promise((resolvePromise, rejectPromise) => {
  resolveSaved = resolvePromise;
  rejectSaved = rejectPromise;
});

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.url === "/body.png" || request.url === "/outline.png") {
      response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      response.end(request.url === "/body.png" ? body : outline);
      return;
    }
    if (request.url?.startsWith("/frame/") && request.method === "POST") {
      const index = Number(request.url.slice("/frame/".length));
      if (!Number.isInteger(index) || index < 0 || index >= 24) throw new Error("Invalid frame index");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      await writeFile(resolve(frameDir, `frame-${String(index).padStart(2, "0")}.png`), Buffer.concat(chunks));
      response.writeHead(204);
      response.end();
      savedParts++;
      if (savedParts === 24) resolveSaved();
      return;
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    rejectSaved(error);
    response.writeHead(500);
    response.end(String(error));
  }
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
const chromeProfile = await mkdtemp(resolve(tmpdir(), "scoregame-giphy-chrome-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${chromeProfile}`,
  `http://127.0.0.1:${address.port}/`,
], { stdio: "ignore" });

const timeout = setTimeout(() => rejectSaved(new Error("Timed out rendering GIF")), 60_000);
try {
  await saved;
} finally {
  clearTimeout(timeout);
  chrome.kill("SIGTERM");
  server.close();
  await rm(chromeProfile, { recursive: true, force: true });
}

await writeFile(previewPath, await readFile(resolve(frameDir, "frame-00.png")));
const swift = spawn("swift", [
  resolve(root, "scripts/normalize-giphy-gif.swift"),
  frameDir,
  outputPath,
], {
  stdio: "inherit",
  env: {
    ...process.env,
    SWIFT_MODULECACHE_PATH: resolve(tmpdir(), "scoregame-swift-cache"),
    CLANG_MODULE_CACHE_PATH: resolve(tmpdir(), "scoregame-clang-cache"),
  },
});
const swiftExit = await new Promise((resolvePromise, rejectPromise) => {
  swift.once("error", rejectPromise);
  swift.once("exit", resolvePromise);
});
await rm(frameDir, { recursive: true, force: true });
if (swiftExit !== 0) throw new Error(`Swift GIF encoder exited with code ${swiftExit}`);

console.log(outputPath);
