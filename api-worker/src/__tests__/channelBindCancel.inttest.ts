// Covers the channel-bind cancellation added 2026-07-22 (bot «❌ Отменить привязку»
// + POST /leagues/channel/cancel-bind). Both write the same UPDATE against
// pending_channel_binds, so this pins the parts that can silently break in prod:
//   - the 0030 CHECK constraint actually accepts 'cancelled'
//   - the bot cancels ONLY 'pending' (it fires while the request_chat keyboard is up)
//   - the API cancels 'pending' AND 'completed' (channel picked, league not created yet)
//   - neither touches an already-'used' bind (a created league must stay intact)
//   - neither touches another user's bind
// The route itself is inline in the fetch router and cannot be imported; the SQL below
// is copied verbatim from the two call sites.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { rmSync } from "node:fs";
import path from "node:path";

const PERSIST = path.resolve(process.cwd(), ".wrangler-int-bindcancel");
const USER = 7701;
const OTHER_USER = 7702;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: D1Database;

// Schema copied from the LIVE prod D1 (verified 2026-07-22), not from the migrations.
// Known drift: prod's CHECK also allows 'used' (written by POST /leagues after the
// league row is created), but migrations 0030/0031 never added it — a database built
// from the committed migrations would reject that write. Tracked separately; this test
// mirrors production so the cancellation behaviour is exercised against the real CHECK.
async function createSchema() {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pending_channel_binds (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled', 'used')),
      league_name TEXT DEFAULT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      selected_chat_id INTEGER DEFAULT NULL,
      selected_chat_title TEXT DEFAULT NULL,
      selected_chat_username TEXT DEFAULT NULL,
      completed_at INTEGER DEFAULT NULL,
      selected_chat_photo_url TEXT DEFAULT NULL
    )
  `).run();
}

async function seed(id: string, userId: number, status: string) {
  await db.prepare(
    `INSERT INTO pending_channel_binds (id, user_id, telegram_user_id, token, status, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, userId, `tok_${id}`, status, Date.now() + 900_000, Date.now()).run();
}

const statusOf = async (id: string) =>
  String(((await db.prepare(`SELECT status FROM pending_channel_binds WHERE id = ?`).bind(id).first()) as any)?.status);

// --- SQL under test (verbatim from bot-worker handleBindCancel) ---
const botCancel = (tgUserId: number) =>
  db.prepare(`UPDATE pending_channel_binds SET status = 'cancelled' WHERE telegram_user_id = ? AND status = 'pending'`)
    .bind(tgUserId).run();

// --- SQL under test (verbatim from api-worker POST /leagues/channel/cancel-bind) ---
const apiCancelAll = (userId: number) =>
  db.prepare(`UPDATE pending_channel_binds SET status = 'cancelled' WHERE user_id = ? AND status IN ('pending','completed')`)
    .bind(userId).run();

const apiCancelByToken = (token: string, userId: number) =>
  db.prepare(`UPDATE pending_channel_binds SET status = 'cancelled' WHERE token = ? AND user_id = ? AND status IN ('pending','completed')`)
    .bind(token, userId).run();

beforeAll(async () => {
  rmSync(PERSIST, { recursive: true, force: true });
  proxy = await getPlatformProxy({ persist: { path: PERSIST } });
  db = proxy.env.DB as unknown as D1Database;
  await createSchema();
});
afterAll(async () => {
  await proxy?.dispose();
  rmSync(PERSIST, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.prepare(`DELETE FROM pending_channel_binds`).run();
});

describe("channel bind cancellation", () => {
  it("the 0030 CHECK constraint accepts 'cancelled'", async () => {
    await seed("b1", USER, "pending");
    await expect(botCancel(USER)).resolves.toBeTruthy();
    expect(await statusOf("b1")).toBe("cancelled");
  });

  it("bot cancel: hits 'pending' and reports changes>0", async () => {
    await seed("b1", USER, "pending");
    const res = await botCancel(USER);
    expect(Number(res.meta?.changes || 0)).toBe(1);
    expect(await statusOf("b1")).toBe("cancelled");
  });

  it("bot cancel: reports changes=0 when nothing is pending (drives the «нет активной привязки» reply)", async () => {
    await seed("b1", USER, "expired");
    const res = await botCancel(USER);
    expect(Number(res.meta?.changes || 0)).toBe(0);
    expect(await statusOf("b1")).toBe("expired");
  });

  it("bot cancel: leaves a 'completed' bind alone (channel already picked)", async () => {
    await seed("b1", USER, "completed");
    const res = await botCancel(USER);
    expect(Number(res.meta?.changes || 0)).toBe(0);
    expect(await statusOf("b1")).toBe("completed");
  });

  it("api cancel: kills both 'pending' and 'completed'", async () => {
    await seed("b1", USER, "pending");
    await seed("b2", USER, "completed");
    const res = await apiCancelAll(USER);
    expect(Number(res.meta?.changes || 0)).toBe(2);
    expect(await statusOf("b1")).toBe("cancelled");
    expect(await statusOf("b2")).toBe("cancelled");
  });

  it("api cancel: never touches a 'used' bind (the league it created must stay intact)", async () => {
    await seed("b1", USER, "used");
    const res = await apiCancelAll(USER);
    expect(Number(res.meta?.changes || 0)).toBe(0);
    expect(await statusOf("b1")).toBe("used");
  });

  it("api cancel: never touches an 'expired' bind or another user's bind", async () => {
    await seed("mine", USER, "expired");
    await seed("theirs", OTHER_USER, "pending");
    const res = await apiCancelAll(USER);
    expect(Number(res.meta?.changes || 0)).toBe(0);
    expect(await statusOf("mine")).toBe("expired");
    expect(await statusOf("theirs")).toBe("pending");
  });

  it("api cancel by token: only that token, and not another user's same-status bind", async () => {
    await seed("b1", USER, "pending");
    await seed("b2", USER, "completed");
    await seed("theirs", OTHER_USER, "pending");
    const res = await apiCancelByToken("tok_b1", USER);
    expect(Number(res.meta?.changes || 0)).toBe(1);
    expect(await statusOf("b1")).toBe("cancelled");
    expect(await statusOf("b2")).toBe("completed");
    expect(await statusOf("theirs")).toBe("pending");
  });

  it("api cancel by token: a foreign token is a no-op (IDOR guard)", async () => {
    await seed("theirs", OTHER_USER, "pending");
    const res = await apiCancelByToken("tok_theirs", USER);
    expect(Number(res.meta?.changes || 0)).toBe(0);
    expect(await statusOf("theirs")).toBe("pending");
  });
});
