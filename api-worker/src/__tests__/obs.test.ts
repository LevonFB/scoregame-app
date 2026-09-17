import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent, makeRunId, OpCounters, redact } from "../obs";

describe("makeRunId", () => {
  it("returns a non-empty unique-ish string", () => {
    const a = makeRunId();
    const b = makeRunId();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe("redact strips sensitive keys at any depth", () => {
  it("drops top-level secrets but keeps benign fields", () => {
    const out = redact({
      operation: "x",
      user_id: 123,
      token: "abc",
      initData: "user=...",
      first_name: "Ivan",
    });
    expect(out).toHaveProperty("operation", "x");
    expect(out).toHaveProperty("user_id", 123);
    expect(out).not.toHaveProperty("token");
    expect(out).not.toHaveProperty("initData");
    expect(out).not.toHaveProperty("first_name");
  });

  it("drops nested secrets", () => {
    const out = redact({ meta: { secret: "s", count: 3 } }) as { meta: Record<string, unknown> };
    expect(out.meta).toHaveProperty("count", 3);
    expect(out.meta).not.toHaveProperty("secret");
  });
});

describe("logEvent", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it("emits exactly one JSON line", () => {
    logEvent({ operation: "test_op", status: "ok", duration_ms: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.operation).toBe("test_op");
    expect(parsed.service).toBe("api-worker");
    expect(parsed.status).toBe("ok");
  });

  it("never includes secrets / initData / token in output", () => {
    logEvent({
      operation: "auth",
      token: "SUPER_SECRET",
      initData: "user=evil",
      telegram_bot_token: "123:abc",
      ok: true,
    });
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain("SUPER_SECRET");
    expect(line).not.toContain("user=evil");
    expect(line).not.toContain("123:abc");
    expect(JSON.parse(line).ok).toBe(true);
  });

  it("does not throw on an empty/minimal payload", () => {
    expect(() => logEvent({ operation: "" })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("OpCounters", () => {
  it("starts at zero and increments correctly", () => {
    const c = new OpCounters();
    expect(c.snapshot().logical_db_reads).toBe(0);
    c.read();
    c.read(3);
    c.write();
    c.quest_reconcile_calls += 1;
    const snap = c.snapshot();
    expect(snap.logical_db_reads).toBe(4);
    expect(snap.logical_db_writes).toBe(1);
    expect(snap.quest_reconcile_calls).toBe(1);
  });

  it("snapshot exposes all documented counters", () => {
    const snap = new OpCounters().snapshot();
    for (const k of [
      "logical_db_reads",
      "logical_db_writes",
      "quest_reconcile_calls",
      "leaderboard_calls",
      "backfill_calls",
      "weekly_finalize_calls",
      "flag_skips",
      "lock_skips",
      "processed_users",
      "processed_matches",
      "processed_periods",
    ]) {
      expect(snap).toHaveProperty(k, 0);
    }
  });
});
