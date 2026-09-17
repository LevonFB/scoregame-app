// Stage 1 E2E — api-worker against a LOCAL miniflare D1 (no remote calls,
// no real Telegram / football providers). Boots the real worker via
// wrangler unstable_dev and drives it over HTTP.
//
// Run: node --test e2e/api.e2e.test.mjs   (see package.json "test:e2e")

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";
import { buildInitData } from "./helpers/initData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const PERSIST = ".wrangler-e2e";

const BOT_TOKEN = "123456:E2E-TEST-TOKEN";
const INTERNAL_SECRET = "e2e-internal-secret";
const TEST_USER = { id: 777777, first_name: "E2E", username: "e2e_tester" };

const VARS = {
  INTERNAL_API_SECRET: INTERNAL_SECRET,
  TELEGRAM_BOT_TOKEN: BOT_TOKEN,
  ANTI_ABUSE_DISABLE: "true",
  ADMIN_IDS: "1",
  ALLOWED_ORIGIN: "*",
};

function runSql(file) {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "scoregame_db", "--local", "--persist-to", PERSIST, "--file", `e2e/fixtures/${file}`],
    { cwd: apiRoot, stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, shell: process.platform === "win32" }
  );
}

function authHeaders(initData) {
  return {
    "content-type": "application/json",
    "x-internal-secret": INTERNAL_SECRET,
    "x-scoregame-internal-source": "front-worker",
    "x-telegram-init-data": initData,
  };
}

let workerDefault; // booted with NO flag vars  => pure defaults
let workerExplicit; // booted WITH explicit default-valued flag vars
let workerScopedAdmin; // scoped-compare flag ON + test user is admin

before(async () => {
  rmSync(path.join(apiRoot, PERSIST), { recursive: true, force: true });
  runSql("schema.sql");
  runSql("seed.sql");

  workerDefault = await unstable_dev("src/index.ts", {
    local: true,
    persistTo: PERSIST,
    experimental: { disableExperimentalWarning: true },
    vars: { ...VARS },
  });

  workerExplicit = await unstable_dev("src/index.ts", {
    local: true,
    persistTo: PERSIST,
    experimental: { disableExperimentalWarning: true },
    vars: {
      ...VARS,
      // Documented Stage-1 defaults set EXPLICITLY (must match no-env behavior).
      USE_SCOPED_LEADERBOARD_ON_STARTUP: "false",
      DAILY_CASE_BACKFILL_V2_ENABLED: "false",
      DAILY_CASE_LAZY_FALLBACK_ENABLED: "true",
      QUEST_EVENT_SYNC_V2_ENABLED: "false",
      QUEST_EVENT_SYNC_SHADOW_MODE: "false",
      WEEKLY_FINALIZER_V2_ENABLED: "false",
      WEEKLY_GET_FALLBACK_ENABLED: "true",
    },
  });

  workerScopedAdmin = await unstable_dev("src/index.ts", {
    local: true,
    persistTo: PERSIST,
    experimental: { disableExperimentalWarning: true },
    vars: {
      ...VARS,
      ADMIN_IDS: String(TEST_USER.id), // test user is admin => shadow compare runs
      USE_SCOPED_LEADERBOARD_ON_STARTUP: "true",
    },
  });
});

after(async () => {
  await workerDefault?.stop();
  await workerExplicit?.stop();
  await workerScopedAdmin?.stop();
});

// --- E2E-1: stack boots, public health endpoint works against local D1 ---
test("E2E-1 health endpoint boots against local D1", async () => {
  const res = await workerDefault.fetch("/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

// --- E2E-2/auth: read endpoint requires the security layer ---
test("E2E-2 /picks rejects unauthenticated request", async () => {
  const res = await workerDefault.fetch("/picks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day: "2026-06-20" }),
  });
  assert.notEqual(res.status, 200); // 403 FRONT_PROXY_REQUIRED or 401
});

// --- E2E-3 (read backbone): a saved prediction reads back with the same score ---
test("E2E-3 seeded prediction reads back with correct score", async () => {
  const initData = buildInitData(TEST_USER, BOT_TOKEN);
  const res = await workerDefault.fetch("/picks", {
    method: "POST",
    headers: authHeaders(initData),
    body: JSON.stringify({ day: "2026-06-20" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  const pick = (body.picks || []).find((p) => p.matchId === "e2e-m1");
  assert.ok(pick, "expected seeded pick e2e-m1 in response");
  assert.equal(pick.home, 2);
  assert.equal(pick.away, 1);
});

// --- E2E-3b (real write flow): save a prediction, then read it back ---
test("E2E-3b POST /pick saves and reads back the new score", async () => {
  const initData = buildInitData(TEST_USER, BOT_TOKEN);
  const writeRes = await workerDefault.fetch("/pick", {
    method: "POST",
    headers: authHeaders(initData),
    body: JSON.stringify({ matchId: "e2e-m1", home: 3, away: 0 }),
  });
  assert.equal(writeRes.status, 200, `write status ${writeRes.status}`);
  const writeBody = await writeRes.json();
  assert.equal(writeBody.ok, true);

  const readRes = await workerDefault.fetch("/picks", {
    method: "POST",
    headers: authHeaders(initData),
    body: JSON.stringify({ day: "2026-06-20" }),
  });
  const readBody = await readRes.json();
  const pick = (readBody.picks || []).find((p) => p.matchId === "e2e-m1");
  assert.ok(pick, "expected saved pick");
  assert.equal(pick.home, 3);
  assert.equal(pick.away, 0);
});

// --- E2E-4: explicit default flags produce identical behavior to no-env ---
test("E2E-4 default flags do not change response shape/status", async () => {
  const initData = buildInitData(TEST_USER, BOT_TOKEN);
  const body = JSON.stringify({ day: "2026-06-20" });

  const [r1, r2] = await Promise.all([
    workerDefault.fetch("/picks", { method: "POST", headers: authHeaders(initData), body }),
    workerExplicit.fetch("/picks", { method: "POST", headers: authHeaders(initData), body }),
  ]);
  assert.equal(r1.status, r2.status);
  const [b1, b2] = [await r1.json(), await r2.json()];
  assert.equal(b1.ok, b2.ok);
  // Same set of matchIds with same scores from both flag configurations.
  const norm = (b) => (b.picks || []).map((p) => `${p.matchId}:${p.home}-${p.away}`).sort();
  assert.deepEqual(norm(b1), norm(b2));
});

// --- Stage 2 / Part A: visibility endpoint exposes frontend flags (default false) ---
test("S2 /app-sections/visibility exposes frontend flags (default false)", async () => {
  const res = await workerDefault.fetch("/app-sections/visibility", {
    headers: { "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.flags, "expected flags object");
  assert.equal(body.flags.useScopedLeaderboardOnStartup, false);
  // World Cup bracket was removed — its lazy-load flag must no longer be exposed.
  assert.equal(body.flags.bracketLazyLoad, undefined);
});

// --- Stage 2 / Part B — E2E-5: legacy POST /leaderboard contract preserved (default) ---
test("S2 E2E-5 legacy /leaderboard returns leaderboard+me+isAdmin (default flags)", async () => {
  const initData = buildInitData(TEST_USER, BOT_TOKEN);
  const res = await workerDefault.fetch("/leaderboard", {
    method: "POST",
    headers: authHeaders(initData),
    body: JSON.stringify({ initData }),
  });
  assert.equal(res.status, 200, `status ${res.status}`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.leaderboard), "leaderboard array present");
  assert.ok(body.me && typeof body.me === "object", "me present");
  assert.equal(typeof body.isAdmin, "boolean");
});

// --- Stage 2 / Part B — E2E-6: scoped shadow compare ON does NOT change the contract ---
test("S2 E2E-6 scoped compare mode keeps the legacy response contract", async () => {
  const initData = buildInitData(TEST_USER, BOT_TOKEN);
  const res = await workerScopedAdmin.fetch("/leaderboard", {
    method: "POST",
    headers: authHeaders(initData),
    body: JSON.stringify({ initData }),
  });
  assert.equal(res.status, 200, `status ${res.status}`);
  const body = await res.json();
  // User still gets the legacy result; compare runs server-side (logged, not returned).
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.leaderboard));
  assert.ok(body.me && typeof body.me === "object");
  assert.equal(body.isAdmin, true); // test user is admin in this worker
});
