// Weekly Challenge — auth-safety release-gate suite.
// Proves there is NO production auth bypass: every admin/user branch is exercised
// against the real local api-worker with real Telegram initData HMAC. Isolated
// Miniflare D1 only. No deploy, no production secrets.
//
// Run: node --test --test-concurrency=1 e2e/weekly-auth-safety.e2e.test.mjs
//      (package.json: smoke:weekly-auth)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";
import { buildInitData } from "./helpers/initData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");

const BOT_TOKEN = "123456:E2E-TEST-TOKEN";
const INTERNAL_SECRET = "e2e-internal-secret";
const ADMIN = { id: 424242, first_name: "Auth Admin" };
const USER = { id: 515151, first_name: "Auth User" };
const nowSec = () => Math.floor(Date.now() / 1000);

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1run = (p, file) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", p, "--file", file]);

function freshEnv() {
  const p = `.wrangler-e2e-weekly-auth`;
  rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  d1run(p, "e2e/fixtures/schema.sql");
  d1run(p, "e2e/fixtures/seed.sql");
  d1run(p, "e2e/fixtures/weekly-v2.sql");
  return p;
}
async function boot(p) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo: p, experimental: { disableExperimentalWarning: true },
    vars: { INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true", ADMIN_IDS: String(ADMIN.id), ALLOWED_ORIGIN: "*" },
  });
}

// Front-proxy-trusted internal headers (required to reach the auth layer at all).
const proxy = { "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker" };
function headers(initData, extra = {}) {
  return { "content-type": "application/json", ...proxy, ...(initData ? { "x-telegram-init-data": initData } : {}), ...extra };
}
async function req(worker, p, { method = "GET", initData, extra = {}, body, omitProxy = false } = {}) {
  const h = omitProxy
    ? { "content-type": "application/json", ...(initData ? { "x-telegram-init-data": initData } : {}), ...extra }
    : headers(initData, extra);
  const res = await worker.fetch(p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const VALID_ADMIN = buildInitData(ADMIN, BOT_TOKEN);
const VALID_USER = buildInitData(USER, BOT_TOKEN);
const EXPIRED_USER = buildInitData(USER, BOT_TOKEN, { authDate: nowSec() - 8 * 86400 });
function badHash(initData) {
  const params = new URLSearchParams(initData);
  params.set("hash", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  return params.toString();
}
// Valid HMAC for USER, then swap the user payload to the admin id → signature no longer matches.
function forgedAdmin() {
  const params = new URLSearchParams(VALID_USER);
  params.set("user", JSON.stringify(ADMIN));
  return params.toString();
}

const ADMIN_PATH = "/admin/season-predictions/weekly-challenges";
const USER_DRAFT_PATH = "/season-predictions/weekly-challenges/999999/draft";

test("admin auth: every branch", async () => {
  const p = freshEnv();
  const worker = await boot(p);
  try {
    // no initData → rejected (not 200, not granted)
    const noInit = await req(worker, ADMIN_PATH);
    assert.notEqual(noInit.status, 200, "no-initData must not be 200");
    assert.notEqual(noInit.body.ok, true);

    // bad HMAC → rejected
    const bad = await req(worker, ADMIN_PATH, { initData: badHash(VALID_ADMIN) });
    assert.notEqual(bad.status, 200, "bad-hash must not be 200");

    // valid non-admin user → 403 FORBIDDEN
    const nonAdmin = await req(worker, ADMIN_PATH, { initData: VALID_USER });
    assert.equal(nonAdmin.status, 403, `non-admin expected 403, got ${nonAdmin.status}`);
    assert.equal(nonAdmin.body.error, "FORBIDDEN");

    // valid non-admin + spoofed admin header/body → still 403 (admin = ADMIN_IDS only)
    const spoof = await req(worker, ADMIN_PATH, { initData: VALID_USER, extra: { "x-admin": "true", "x-is-admin": "1" } });
    assert.equal(spoof.status, 403, "header spoof must not grant admin");

    // forged admin id (broken signature) → rejected, never admin
    const forged = await req(worker, ADMIN_PATH, { initData: forgedAdmin() });
    assert.notEqual(forged.status, 200, "forged admin id must not be 200");

    // valid admin → 200
    const ok = await req(worker, ADMIN_PATH, { initData: VALID_ADMIN });
    assert.equal(ok.status, 200, `valid admin expected 200, got ${ok.status}: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.ok, true);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  }
});

test("user auth: every branch", async () => {
  const p = freshEnv();
  const worker = await boot(p);
  try {
    // no initData → 401
    const noInit = await req(worker, USER_DRAFT_PATH, { method: "PUT", body: { answers: {} } });
    assert.equal(noInit.status, 401, `no-initData expected 401, got ${noInit.status}`);

    // bad HMAC → 401
    const bad = await req(worker, USER_DRAFT_PATH, { method: "PUT", initData: badHash(VALID_USER), body: { answers: {} } });
    assert.equal(bad.status, 401, `bad-hash expected 401, got ${bad.status}`);

    // expired auth_date → 401
    const expired = await req(worker, USER_DRAFT_PATH, { method: "PUT", initData: EXPIRED_USER, body: { answers: {} } });
    assert.equal(expired.status, 401, `expired expected 401, got ${expired.status}`);

    // user-id swap after HMAC → 401
    const forged = await req(worker, USER_DRAFT_PATH, { method: "PUT", initData: forgedAdmin(), body: { answers: {} } });
    assert.equal(forged.status, 401, `forged expected 401, got ${forged.status}`);

    // valid user → auth passes (404 for the nonexistent challenge, NOT 401/403)
    const valid = await req(worker, USER_DRAFT_PATH, { method: "PUT", initData: VALID_USER, body: { answers: {} } });
    assert.equal(valid.status, 404, `valid user expected 404 (auth passed), got ${valid.status}: ${JSON.stringify(valid.body)}`);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  }
});

test("front-proxy gate: admin path without internal headers is rejected", async () => {
  const p = freshEnv();
  const worker = await boot(p);
  try {
    const res = await req(worker, ADMIN_PATH, { initData: VALID_ADMIN, omitProxy: true });
    assert.equal(res.status, 403, `direct access expected 403, got ${res.status}`);
    assert.equal(res.body.code, "FRONT_PROXY_REQUIRED", `expected FRONT_PROXY_REQUIRED, got ${JSON.stringify(res.body)}`);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, p), { recursive: true, force: true });
  }
});

test("test-bypass audit: worker runtime has no auth-bypass hooks", () => {
  const src = readFileSync(path.join(apiRoot, "src", "index.ts"), "utf8");
  const forbidden = ["x-test-user", "x-test-admin", "x-e2e-user", "x-e2e-admin", "bypassauth", "bypass_auth", "skiptelegramauth", "skip_telegram_auth", "testauth", "test_auth_bypass"];
  const lower = src.toLowerCase();
  for (const token of forbidden) {
    assert.ok(!lower.includes(token), `worker src must not contain auth-bypass hook: ${token}`);
  }
  // The only test-auth helper lives under e2e/ (never imported by the worker runtime).
  assert.ok(!src.includes('from "./e2e') && !src.includes("from './e2e"), "worker must not import e2e helpers");
});
