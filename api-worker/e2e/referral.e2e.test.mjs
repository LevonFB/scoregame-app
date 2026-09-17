// Referral program v1 release-gate HTTP smoke — real local api-worker over an
// isolated Miniflare D1. Exercises the FULL flow over HTTP: claim (attach rules,
// self-referral, already-played users, src_ attribution), first-pick activation
// with both-side rewards, idempotency, /referrals dashboard, and the admin
// config/stats endpoints (auth + validation). Never touches production.
//
// Run: node --test --test-concurrency=1 e2e/referral.e2e.test.mjs
//      (package.json: smoke:referral)

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

const INVITER = { id: 8101, first_name: "Inviter", username: "ref_inviter" };
const FRIEND = { id: 8202, first_name: "Friend", username: "ref_friend" };
const SELFIE = { id: 8303, first_name: "Selfie", username: "ref_selfie" };
const VETERAN = { id: 777777, first_name: "Veteran", username: "ref_veteran" }; // has a seeded pick
const CHANNEL_USER = { id: 8404, first_name: "FromTikTok", username: "ref_channel" };
const ADMIN = { id: 222334, first_name: "Ref Admin", username: "ref_admin" };

const refCode = (u) => `ref_${u.id.toString(36)}`;

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER_JS, ...args], {
    cwd: apiRoot, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  }).toString();
}
const d1run = (persistTo, file) => wrangler(["d1", "execute", "scoregame_db", "--local", "--persist-to", persistTo, "--file", file]);

function freshEnv(name) {
  const persistTo = `.wrangler-e2e-referral-${name}`;
  rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  d1run(persistTo, "e2e/fixtures/schema.sql");
  d1run(persistTo, "e2e/fixtures/seed.sql");
  d1run(persistTo, "e2e/fixtures/weekly-v2.sql");
  d1run(persistTo, "e2e/fixtures/lucky-token.sql");
  d1run(persistTo, "e2e/fixtures/referral.sql");
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

async function req(worker, p, { method = "GET", headers, body } = {}) {
  const res = await worker.fetch(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// Signed initData per user; start_param travels INSIDE the signature like Telegram does.
const initOf = (user, startParam) => buildInitData(user, BOT_TOKEN, startParam ? { startParam } : {});
const headersOf = (user, startParam) => authHeaders(initOf(user, startParam));

test("referral: claim rules, first-pick rewards, dashboard, admin config", async () => {
  const persistTo = freshEnv("main");
  const worker = await boot(persistTo);
  try {
    // 0. Inviter must exist before anyone can attach to them — POST /picks is a
    // light authed endpoint that upserts the user row.
    const warm = await req(worker, "/picks", { method: "POST", headers: headersOf(INVITER), body: { day: "2026-06-20" } });
    assert.equal(warm.status, 200, JSON.stringify(warm.body));

    // 1. Unknown inviter id → silently not attached (no enumeration signal).
    const ghost = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(FRIEND, "ref_zzzz9"), body: {} });
    assert.equal(ghost.body.ok, true);
    assert.equal(ghost.body.attached, false, JSON.stringify(ghost.body));

    // 2. Fresh user + valid code → attached, referrer named, reward promised.
    const claim = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(FRIEND, refCode(INVITER)), body: {} });
    assert.equal(claim.body.attached, true, JSON.stringify(claim.body));
    assert.ok(String(claim.body.referrer_name || "").length > 0, "referrer name present");
    assert.ok(String(claim.body.invitee_reward_label || "").includes("жетон"), JSON.stringify(claim.body));

    // 3. Replay / different code afterwards → write-once holds.
    const replay = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(FRIEND, refCode(SELFIE)), body: {} });
    assert.equal(replay.body.attached, false, "referred_by is write-once");

    // 4. Self-referral → rejected.
    await req(worker, "/me/profile", { headers: headersOf(SELFIE) });
    const selfie = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(SELFIE, refCode(SELFIE)), body: {} });
    assert.equal(selfie.body.attached, false, "self-referral must not attach");

    // 5. A user who already has picks (seeded veteran) can never be attributed.
    const vet = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(VETERAN, refCode(INVITER)), body: {} });
    assert.equal(vet.body.attached, false, "users with picks are not attributable");

    // 6. src_ channel attribution: not "attached", but recorded once.
    const src = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(CHANNEL_USER, "src_tiktok"), body: {} });
    assert.equal(src.body.ok, true);
    assert.equal(src.body.attached, false);
    const srcAgain = await req(worker, "/referral/claim", { method: "POST", headers: headersOf(CHANNEL_USER, "src_mu1"), body: {} });
    assert.equal(srcAgain.body.ok, true, "second src claim is a silent no-op");

    // 7. Inviter dashboard before activation: 1 pending, 0 activated.
    let dash = await req(worker, "/referrals", { headers: headersOf(INVITER) });
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    assert.equal(dash.body.pending, 1, JSON.stringify(dash.body));
    assert.equal(dash.body.activated, 0);
    assert.equal(`ref_${dash.body.code}`, refCode(INVITER), "personal code matches");
    // link needs a live getMe (bot identity); with the fake test token it is null.
    if (dash.body.link) assert.ok(String(dash.body.link).includes(refCode(INVITER)), "personal link carries the code");
    assert.ok(Array.isArray(dash.body.milestones) && dash.body.milestones.length === 3, "default 3/5/10 ladder");

    // 8. Friend's FIRST saved pick → welcome token to friend, daily case to inviter.
    const pick = await req(worker, "/pick", { method: "POST", headers: headersOf(FRIEND), body: { matchId: "e2e-m1", home: 2, away: 0 } });
    assert.equal(pick.status, 200, JSON.stringify(pick.body));
    const toast = (pick.body.newAchievements || []).find((a) => a.id === "referral_welcome");
    assert.ok(toast, `referral toast present: ${JSON.stringify(pick.body.newAchievements)}`);
    const friendWheel = await req(worker, "/fortune/config", { headers: headersOf(FRIEND) });
    assert.equal(friendWheel.body.lucky_tokens, 1, "friend got exactly one welcome token");

    // 9. Second pick (edit) → no double payout.
    const pick2 = await req(worker, "/pick", { method: "POST", headers: headersOf(FRIEND), body: { matchId: "e2e-m1", home: 3, away: 1 } });
    assert.equal(pick2.status, 200);
    assert.ok(!(pick2.body.newAchievements || []).some((a) => a.id === "referral_welcome"), "no repeat toast");
    const friendWheel2 = await req(worker, "/fortune/config", { headers: headersOf(FRIEND) });
    assert.equal(friendWheel2.body.lucky_tokens, 1, "still one token after pick edit");

    // 10. Dashboard after activation: activated=1, milestones not yet achieved.
    dash = await req(worker, "/referrals", { headers: headersOf(INVITER) });
    assert.equal(dash.body.activated, 1, JSON.stringify(dash.body));
    assert.equal(dash.body.pending, 0);
    assert.equal(dash.body.milestones[0].achieved, false);

    // 11. Admin stats reflect the whole story (attach, activation, reward, source).
    const stats = await req(worker, "/admin/economy/referral/stats", { headers: headersOf(ADMIN) });
    assert.equal(stats.status, 200, JSON.stringify(stats.body));
    assert.equal(stats.body.attached, 1);
    assert.equal(stats.body.activated, 1);
    assert.equal(stats.body.rewarded, 1);
    assert.equal(stats.body.top_inviters?.[0]?.inviter_id, INVITER.id);
    assert.deepEqual(stats.body.sources, [{ source: "tiktok", users: 1 }], "src_tiktok recorded once, src_mu1 ignored");

    // 12. Admin config: GET returns defaults; invalid PUT rejected outright.
    const cfg = await req(worker, "/admin/economy/referral/config", { headers: headersOf(ADMIN) });
    assert.equal(cfg.body.config?.enabled, true, JSON.stringify(cfg.body));
    const badPut = await req(worker, "/admin/economy/referral/config", {
      method: "PUT", headers: headersOf(ADMIN),
      body: { config: { ...cfg.body.config, per_friend_reward: { type: "stars", amount: 100 } } },
    });
    assert.equal(badPut.status, 400, JSON.stringify(badPut.body));
    assert.equal(badPut.body.error, "INVALID_REFERRAL_CONFIG");

    // 13. Valid PUT persists and is served back.
    const newCfg = { ...cfg.body.config, daily_cap: 5, per_friend_reward: { type: "premium_case", amount: 1 } };
    const goodPut = await req(worker, "/admin/economy/referral/config", { method: "PUT", headers: headersOf(ADMIN), body: { config: newCfg } });
    assert.equal(goodPut.body.ok, true, JSON.stringify(goodPut.body));
    const cfg2 = await req(worker, "/admin/economy/referral/config", { headers: headersOf(ADMIN) });
    assert.equal(cfg2.body.config?.daily_cap, 5);
    assert.equal(cfg2.body.config?.per_friend_reward?.type, "premium_case");

    // 14. Non-admin cannot read or write the admin endpoints.
    const nonAdminGet = await req(worker, "/admin/economy/referral/config", { headers: headersOf(FRIEND) });
    assert.ok(nonAdminGet.status === 401 || nonAdminGet.status === 403, `status ${nonAdminGet.status}`);
    const nonAdminPut = await req(worker, "/admin/economy/referral/config", { method: "PUT", headers: headersOf(FRIEND), body: { config: newCfg } });
    assert.ok(nonAdminPut.status === 401 || nonAdminPut.status === 403, `status ${nonAdminPut.status}`);
    const nonAdminStats = await req(worker, "/admin/economy/referral/stats", { headers: headersOf(FRIEND) });
    assert.ok(nonAdminStats.status === 401 || nonAdminStats.status === 403, `status ${nonAdminStats.status}`);
  } finally {
    await worker.stop();
    rmSync(path.join(apiRoot, persistTo), { recursive: true, force: true });
  }
});
