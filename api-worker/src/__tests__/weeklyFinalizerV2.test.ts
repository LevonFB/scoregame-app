import { describe, expect, it } from "vitest";
import {
  buildWeeklyJobKey,
  classifyLock,
  isValidWeekKey,
  isWeeklyFinalizerCron,
  resolveWeeklyParams,
  WEEKLY_FINALIZER_CRON,
} from "../weeklyFinalizerV2";

describe("weekly job key", () => {
  it("uniquely includes season + week", () => {
    expect(buildWeeklyJobKey(3, "2026-W24")).toBe("weekly-finalizer:3:2026-W24");
    expect(buildWeeklyJobKey(3, "2026-W24")).not.toBe(buildWeeklyJobKey(4, "2026-W24"));
    expect(buildWeeklyJobKey(3, "2026-W24")).not.toBe(buildWeeklyJobKey(3, "2026-W25"));
  });
});

describe("isWeeklyFinalizerCron", () => {
  it("matches only the dedicated hourly cron", () => {
    expect(isWeeklyFinalizerCron(WEEKLY_FINALIZER_CRON)).toBe(true);
    expect(isWeeklyFinalizerCron("5 * * * *")).toBe(true);
  });
  it("does not match other crons", () => {
    expect(isWeeklyFinalizerCron("*/10 * * * *")).toBe(false);
    expect(isWeeklyFinalizerCron("15 4 * * *")).toBe(false);
    expect(isWeeklyFinalizerCron(undefined)).toBe(false);
  });
});

describe("isValidWeekKey", () => {
  it("accepts plain week tokens, rejects separators/empties", () => {
    expect(isValidWeekKey("2026-W24")).toBe(true);
    expect(isValidWeekKey("")).toBe(false);
    expect(isValidWeekKey("a/b")).toBe(false);
    expect(isValidWeekKey("a:b")).toBe(false);
    expect(isValidWeekKey("with space")).toBe(false);
    expect(isValidWeekKey(undefined as any)).toBe(false);
  });
});

describe("classifyLock (reused) + params", () => {
  it("re-exported classifyLock behaves identically", () => {
    expect(classifyLock(null, 0, 1000)).toBe("claim_new");
    expect(classifyLock({ status: "completed" }, 0, 1000)).toBe("already_completed");
    expect(classifyLock({ status: "running", heartbeat_at: -5000 }, 0, 1000)).toBe("claim_stale");
  });
  it("resolveWeeklyParams maps minutes to ms", () => {
    const p = resolveWeeklyParams({ weeklyFinalizerMaxPeriods: 10, weeklyFinalizerStaleLockMinutes: 30 });
    expect(p.maxPeriods).toBe(10);
    expect(p.staleLockMs).toBe(30 * 60_000);
  });
});
