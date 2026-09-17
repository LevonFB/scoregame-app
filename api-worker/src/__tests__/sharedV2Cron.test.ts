// Stage 16 — unit tests for the shared V2 cron dispatcher pure helpers.

import { describe, expect, it } from "vitest";
import { SHARED_V2_CRON, isSharedV2Cron, isDailyBackfillWindow } from "../sharedV2Cron";
import { resolveApiFlags } from "../featureFlags";

describe("Stage 16 — shared cron constant & matcher", () => {
  it("the single shared trigger is 5 * * * *", () => {
    expect(SHARED_V2_CRON).toBe("5 * * * *");
    expect(isSharedV2Cron("5 * * * *")).toBe(true);
  });
  it("old dedicated V2 crons no longer match (dead schedules removed)", () => {
    expect(isSharedV2Cron("15 4 * * *")).toBe(false);
    expect(isSharedV2Cron("7 * * * *")).toBe(false);
    expect(isSharedV2Cron("*/10 * * * *")).toBe(false);
    expect(isSharedV2Cron("1 0 * * *")).toBe(false);
    expect(isSharedV2Cron(undefined)).toBe(false);
  });
});

describe("Stage 16 — daily backfill window", () => {
  const at = (h) => new Date(Date.UTC(2026, 0, 1, h, 5, 0));
  it("in-window only at the configured UTC hour (default 4)", () => {
    expect(isDailyBackfillWindow(at(4), 4)).toBe(true);
    expect(isDailyBackfillWindow(at(3), 4)).toBe(false);
    expect(isDailyBackfillWindow(at(5), 4)).toBe(false);
    expect(isDailyBackfillWindow(at(0), 4)).toBe(false);
  });
  it("hour is configurable", () => {
    expect(isDailyBackfillWindow(at(9), 9)).toBe(true);
    expect(isDailyBackfillWindow(at(9), 4)).toBe(false);
  });
});

describe("Stage 16 — dailyCaseBackfillHourUtc flag", () => {
  it("defaults to 4; rejects garbage/out-of-range", () => {
    expect(resolveApiFlags({}).dailyCaseBackfillHourUtc).toBe(4);
    expect(resolveApiFlags({ DAILY_CASE_BACKFILL_HOUR_UTC: "x" }).dailyCaseBackfillHourUtc).toBe(4);
    expect(resolveApiFlags({ DAILY_CASE_BACKFILL_HOUR_UTC: "24" }).dailyCaseBackfillHourUtc).toBe(4);
    expect(resolveApiFlags({ DAILY_CASE_BACKFILL_HOUR_UTC: "-1" }).dailyCaseBackfillHourUtc).toBe(4);
    expect(resolveApiFlags({ DAILY_CASE_BACKFILL_HOUR_UTC: "9" }).dailyCaseBackfillHourUtc).toBe(9);
  });
});
