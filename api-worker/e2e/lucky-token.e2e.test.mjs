// Lucky token ("Жетон") release-gate HTTP smoke — real local api-worker over an
// isolated Miniflare D1. Exercises the Фартовый мяч spin (two explicit payment
// methods), idempotency, admin manual grant/revoke, and admin config validation.
// Never touches production.
//
// Run: node --test --test-concurrency=1 e2e/lucky-token.e2e.test.mjs
//      (package.json: smoke:lucky-token)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unstable_dev } from "wrangler";
import { buildInitData } from "./helpers/initData.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const WRANGLER_JS = path.resolve(apiRoot, "node_modules/wrangler/bin/wrangler.js");

const BOT_TOKEN = "123456:E2E-TEST-TOKEN";
const INTERNAL_SECRET = "e2e-internal-secret";
const USER = { id: 7654399, first_name: "Token User", username: "token_user" };
const ADMIN = { id: 222334, first_name: "Token Admin", username: "token_admin" };
const USER_INIT = buildInitData(USER, BOT_TOKEN);
const ADMIN_INIT = buildInitData(ADMIN, BOT_TOKEN);

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1run = (persistTo, file) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--file", file]);

function freshEnv(name) {
  const persistTo = `.wrangler-e2e-lucky-token-${name}`;
  rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  d1run(persistTo, "e2e/fixtures/schema.sql");
  d1run(persistTo, "e2e/fixtures/seed.sql");
  d1run(persistTo, "e2e/fixtures/weekly-v2.sql");
  d1run(persistTo, "e2e/fixtures/lucky-token.sql");
  return persistTo;
}

async function boot(persistTo) {
  return unstable_dev("src/index.ts", {
    local: true, persistTo, experimental: { disableExperimentalWarning: true },
    vars: {
      INTERNAL_API_SECRET: INTERNAL_SECRET, TELEGRAM_BOT_TOKEN: BOT_TOKEN, ANTI_ABUSE_DISABLE: "true",
      ADMIN_IDS: String(ADMIN.id), ALLOWED_ORIGIN: "*", DAILY_CASE_LAZY_FALLBACK_ENABLED: "false",
      WEEKLY_FINALIZER_V2_ENABLED: "false",
    },
  });
}

function authHeaders(initData) {
  return { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET, "x-scoregame-internal-source": "front-worker", "x-telegram-init-data": initData };
}
const userHeaders = () => authHeaders(USER_INIT);
const adminHeaders = () => authHeaders(ADMIN_INIT);

async function req(worker, p, { method = "GET", headers = userHeaders(), body } = {}) {
  const res = await worker.fetch(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}-${Date.now()}`);

test("lucky token: two explicit payment methods, idempotency, admin grant/revoke, config guard", async () => {
  const persistTo = freshEnv("main");
  const worker = await boot(persistTo);
  try {
    // Create the user row (upsert) and confirm the wheel starts with 0 tokens.
    let cfg = await req(worker, "/fortune/config");
    assert.equal(cfg.body.enabled, true, JSON.stringify(cfg.body));
    assert.equal(cfg.body.lucky_tokens, 0);
    assert.equal(cfg.body.allow_token_payment, true);
    assert.equal(cfg.body.allow_balls_payment, true);

    // 1. paymentMethod is required (no implicit fallback).
    const noMethod = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: uuid() } });
    assert.equal(noMethod.body.error, "PAYMENT_METHOD_REQUIRED", JSON.stringify(noMethod.body));

    // 2. token payment with 0 tokens → rejected, nothing charged.
    const noTokens = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: uuid(), paymentMethod: "lucky_token" } });
    assert.equal(noTokens.body.error, "INSUFFICIENT_LUCKY_TOKENS", JSON.stringify(noTokens.body));

    // 3. admin grants 2 tokens (manual grant requires a reason).
    const grant = await req(worker, "/admin/users/lucky-tokens", { method: "POST", headers: adminHeaders(), body: { identifier: USER.id, amount: 2, comment: "e2e grant" } });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    assert.equal(grant.body.newBalance, 2);
    cfg = await req(worker, "/fortune/config");
    assert.equal(cfg.body.lucky_tokens, 2);

    // 4. spin paid with a lucky token → exactly one token debited; reward is balls.
    const spinId1 = uuid();
    const spin1 = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: spinId1, paymentMethod: "lucky_token" } });
    assert.equal(spin1.status, 200, JSON.stringify(spin1.body));
    assert.equal(spin1.body.payment_method, "lucky_token");
    assert.equal(spin1.body.lucky_tokens, 1, "one token debited");
    assert.equal(spin1.body.reward.type, "balls");

    // 5. idempotent replay with the same spinId → no second debit.
    const replay = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: spinId1, paymentMethod: "lucky_token" } });
    assert.equal(replay.body.duplicate, true, JSON.stringify(replay.body));
    assert.equal(replay.body.lucky_tokens, 1, "replay must not debit again");

    // 6. balls payment: needs enough balls. Grant balls, then spin with balls.
    await req(worker, "/admin/users/balls", { method: "POST", headers: adminHeaders(), body: { identifier: USER.id, amount: 20, comment: "e2e balls" } });
    const spin2 = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: uuid(), paymentMethod: "balls" } });
    assert.equal(spin2.status, 200, JSON.stringify(spin2.body));
    assert.equal(spin2.body.payment_method, "balls");
    assert.equal(spin2.body.lucky_tokens, 1, "balls payment must not touch tokens");
    // balls before this spin: 1 (token-spin reward) + 20 (admin grant) = 21; −5 price +1 reward = 17
    assert.equal(spin2.body.balance, 17, JSON.stringify(spin2.body));

    // 7. token balance can never go below zero (manual revoke too large).
    const overRevoke = await req(worker, "/admin/users/lucky-tokens", { method: "POST", headers: adminHeaders(), body: { identifier: USER.id, amount: -99, comment: "e2e over-revoke" } });
    assert.notEqual(overRevoke.body.ok, true, JSON.stringify(overRevoke.body));
    cfg = await req(worker, "/fortune/config");
    assert.equal(cfg.body.lucky_tokens, 1, "balance unchanged after failed revoke");

    // 8. admin cannot disable BOTH payment methods on an active wheel.
    const bothOff = await req(worker, "/admin/economy/fortune/config", { method: "PUT", headers: adminHeaders(), body: { title: "Фартовый мяч", price_balls: 5, is_active: 1, allow_token_payment: 0, allow_balls_payment: 0 } });
    assert.equal(bothOff.body.error, "BOTH_PAYMENTS_DISABLED", JSON.stringify(bothOff.body));

    // 9. disabling only balls is allowed; then a balls spin is rejected by the server.
    const tokenOnly = await req(worker, "/admin/economy/fortune/config", { method: "PUT", headers: adminHeaders(), body: { title: "Фартовый мяч", price_balls: 5, is_active: 1, allow_token_payment: 1, allow_balls_payment: 0 } });
    assert.equal(tokenOnly.body.ok, true, JSON.stringify(tokenOnly.body));
    const ballsBlocked = await req(worker, "/fortune/spin", { method: "POST", body: { spinId: uuid(), paymentMethod: "balls" } });
    assert.equal(ballsBlocked.body.error, "BALLS_PAYMENT_DISABLED", JSON.stringify(ballsBlocked.body));
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});
