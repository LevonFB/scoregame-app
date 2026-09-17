// Stage 1+2 E2E (bot-worker) — scheduled smoke + maintenance throttle, against a
// LOCAL miniflare D1. No real Telegram calls (no bot_users +
// USER_NOTIFICATIONS_ENABLED=false => no outbound sendMessage).
//
// Each throttle test uses its OWN persist dir so the Cache API throttle marker
// (which miniflare persists to disk via persistTo) is isolated between tests.
//
// Run: npm run test:e2e   (node --test e2e/bot.e2e.test.mjs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const botRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(botRoot, "node_modules/wrangler/bin/wrangler.js");

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: botRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
function d1(persist, extra) {
  return wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persist, ...extra]);
}
function pendingCount(persist) {
  const out = d1(persist, ["--command", "SELECT COUNT(*) AS pending FROM maintenance_events WHERE dispatched_at IS NULL;", "--json"]);
  const m = out.match(/"pending"\s*:\s*(\d+)/);
  assert.ok(m, `cannot parse pending from: ${out}`);
  return Number(m[1]);
}

const BASE_VARS = {
  BOT_TOKEN: "123456:E2E-TEST-TOKEN",
  WEBHOOK_SECRET: "e2e-webhook-secret",
  MINIAPP_URL: "https://example.test/",
  ADMIN_IDS: "1",
  USER_NOTIFICATIONS_ENABLED: "false",
};

// Fresh, isolated environment (own D1 + own Cache) seeded with N pending events.
function freshEnv(name, pendingEvents) {
  const persist = `.wrangler-e2e-${name}`;
  rmSync(path.join(botRoot, persist), { recursive: true, force: true });
  d1(persist, ["--file", "e2e/fixtures/schema.sql"]);
  for (let i = 0; i < pendingEvents; i++) {
    d1(persist, ["--command", `INSERT INTO maintenance_events (type, message) VALUES ('START', 'e2e-${i}');`]);
  }
  return persist;
}
async function bootBot(persist, vars) {
  return unstable_dev("src/index.ts", {
    local: true,
    persistTo: persist,
    experimental: { disableExperimentalWarning: true },
    vars: { ...BASE_VARS, ...vars },
  });
}
async function tick(worker) {
  const res = await worker.fetch("/cdn-cgi/handler/scheduled", { method: "POST" });
  assert.equal(res.status, 200);
}

// --- E2E-5: scheduled tick completes with notifications disabled ---
test("E2E-5 bot scheduled tick completes (notifications disabled)", async () => {
  const persist = freshEnv("e5", 0);
  const worker = await bootBot(persist, {});
  try {
    await tick(worker);
  } finally {
    await worker.stop();
  }
});

// --- E2E-8: throttle OFF => each tick performs a maintenance poll ---
test("E2E-8 throttle off: two ticks => two maintenance polls", async () => {
  const persist = freshEnv("e8", 2);
  const worker = await bootBot(persist, { MAINTENANCE_POLL_THROTTLE_ENABLED: "false" });
  try {
    await tick(worker);
    await tick(worker);
    assert.equal(pendingCount(persist), 0, "both pending events should be dispatched");
  } finally {
    await worker.stop();
  }
});

// --- E2E-9: throttle ON => second tick within interval skips the maintenance poll ---
test("E2E-9 throttle on (10m): only the first tick polls within interval", async () => {
  const persist = freshEnv("e9", 2);
  const worker = await bootBot(persist, { MAINTENANCE_POLL_THROTTLE_ENABLED: "true", MAINTENANCE_POLL_INTERVAL_MINUTES: "10" });
  try {
    await tick(worker); // polls => consumes 1
    await tick(worker); // within 10m interval => maintenance poll skipped
    assert.equal(pendingCount(persist), 1, "second within-interval tick must not poll maintenance");
  } finally {
    await worker.stop();
  }
});

// --- E2E-10: fail-safe — invalid interval falls back to safe default, event not lost ---
test("E2E-10 invalid interval => safe default, scheduled never throws, event processed", async () => {
  const persist = freshEnv("e10", 1);
  const worker = await bootBot(persist, { MAINTENANCE_POLL_THROTTLE_ENABLED: "true", MAINTENANCE_POLL_INTERVAL_MINUTES: "not-a-number" });
  try {
    await tick(worker);
    assert.equal(pendingCount(persist), 0, "pending event must still be processed under fail-safe config");
  } finally {
    await worker.stop();
  }
});
