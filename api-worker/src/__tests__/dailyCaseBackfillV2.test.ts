import { describe, expect, it } from "vitest";
import {
  BACKFILL_V2_CRON,
  buildCaseIdempotencyKey,
  buildJobKey,
  classifyLock,
  isBackfillV2Cron,
  isValidMatchdayKey,
  resolveBackfillParams,
} from "../dailyCaseBackfillV2";

describe("isBackfillV2Cron", () => {
  it("matches only the dedicated 07:15 MSK cron", () => {
    expect(isBackfillV2Cron(BACKFILL_V2_CRON)).toBe(true);
    expect(isBackfillV2Cron("15 4 * * *")).toBe(true);
  });
  it("does not match the */10 or daily-sync crons", () => {
    expect(isBackfillV2Cron("*/10 * * * *")).toBe(false);
    expect(isBackfillV2Cron("1 0 * * *")).toBe(false);
    expect(isBackfillV2Cron(undefined)).toBe(false);
    expect(isBackfillV2Cron("")).toBe(false);
  });
});

describe("isValidMatchdayKey", () => {
  it("accepts valid calendar dates", () => {
    expect(isValidMatchdayKey("2026-06-14")).toBe(true);
    expect(isValidMatchdayKey("2020-01-01")).toBe(true);
  });
  it("rejects malformed or impossible dates", () => {
    expect(isValidMatchdayKey("2026-13-40")).toBe(false);
    expect(isValidMatchdayKey("2026-6-1")).toBe(false);
    expect(isValidMatchdayKey("not-a-date")).toBe(false);
    expect(isValidMatchdayKey("")).toBe(false);
    expect(isValidMatchdayKey(undefined as any)).toBe(false);
    expect(isValidMatchdayKey("2026-02-30")).toBe(false);
  });
});

describe("buildJobKey / idempotency key", () => {
  it("builds a stable job key per matchday", () => {
    expect(buildJobKey("2026-06-14")).toBe("daily-case-backfill:2026-06-14");
    expect(buildJobKey("2026-06-14")).toBe(buildJobKey("2026-06-14"));
  });
  it("builds a stable per-case idempotency key", () => {
    expect(buildCaseIdempotencyKey("2026-06-14", 777)).toBe("daily-case:2026-06-14:777:daily_free");
  });
});

describe("classifyLock", () => {
  const NOW = 1_000_000;
  const STALE = 60_000;

  it("claims when no job exists", () => {
    expect(classifyLock(null, NOW, STALE)).toBe("claim_new");
  });
  it("does not re-run a completed job", () => {
    expect(classifyLock({ status: "completed" }, NOW, STALE)).toBe("already_completed");
  });
  it("allows retry of a failed job", () => {
    expect(classifyLock({ status: "failed" }, NOW, STALE)).toBe("claim_retry");
  });
  it("allows claiming a pending job", () => {
    expect(classifyLock({ status: "pending" }, NOW, STALE)).toBe("claim_retry");
  });
  it("a fresh running job is owned by someone else", () => {
    expect(classifyLock({ status: "running", heartbeat_at: NOW - 1000 }, NOW, STALE)).toBe("already_running");
  });
  it("a stale running job can be taken over", () => {
    expect(classifyLock({ status: "running", heartbeat_at: NOW - STALE - 1 }, NOW, STALE)).toBe("claim_stale");
  });
  it("running exactly at the stale boundary is takeable", () => {
    expect(classifyLock({ status: "running", heartbeat_at: NOW - STALE }, NOW, STALE)).toBe("claim_stale");
  });
  it("dry_run_completed never owns the production job", () => {
    expect(classifyLock({ status: "dry_run_completed" }, NOW, STALE)).toBe("claim_retry");
  });
});

describe("resolveBackfillParams", () => {
  it("projects flags to runtime params (minutes -> ms)", () => {
    const p = resolveBackfillParams({
      dailyCaseBackfillBatchSize: 200,
      dailyCaseBackfillMaxBatches: 20,
      dailyCaseBackfillStaleLockMinutes: 15,
    });
    expect(p.batchSize).toBe(200);
    expect(p.maxBatches).toBe(20);
    expect(p.staleLockMs).toBe(15 * 60_000);
  });
});
