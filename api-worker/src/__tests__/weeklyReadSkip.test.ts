// Stage 7 — unit tests for the GET /quests/weekly read-skip decision.
// Pure decision (decideWeeklyGetGate) + allowlist parsing. No DB, no I/O.

import { describe, expect, it } from "vitest";
import { decideWeeklyGetGate, weeklyJobStateOf, type WeeklyJobState } from "../weeklyFinalizerV2";
import { parseUserIdAllowlist } from "../questShadow";

const gate = (over: Partial<Parameters<typeof decideWeeklyGetGate>[0]> = {}) =>
  decideWeeklyGetGate({ v2Enabled: true, inAllowlist: false, fallbackEnabled: true, jobState: "missing", ...over });

describe("Stage 7 — allowlist parsing", () => {
  it("default empty env → nobody affected", () => {
    expect(parseUserIdAllowlist(undefined).size).toBe(0);
    expect(parseUserIdAllowlist("").size).toBe(0);
    expect(parseUserIdAllowlist("   ").size).toBe(0);
  });
  it("only positive integers accepted; invalid tokens ignored", () => {
    const ids = parseUserIdAllowlist("123, 0, -5, abc, 4.5, 777, 99");
    expect([...ids].sort((a, b) => a - b)).toEqual([99, 123, 777]);
  });
});

describe("Stage 7 — V2 off ignores allowlist", () => {
  for (const jobState of ["completed", "failed", "missing", "running_fresh"] as WeeklyJobState[]) {
    it(`V2 off + allowlisted (${jobState}) → legacy runs (Stage 6 behavior)`, () => {
      const d = gate({ v2Enabled: false, inAllowlist: true, jobState });
      expect(d.runLegacy).toBe(true);
      expect(d.reason).toBe("v2_off_legacy");
    });
  }
});

describe("Stage 7 — allowlisted user (V2 on) → pure read, never legacy", () => {
  const cases: Array<[WeeklyJobState, string]> = [
    ["completed", "v2_completed"],
    ["running_fresh", "v2_running"],
    ["running_stale", "v2_stale_skip"],
    ["failed", "v2_failed_skip"],
    ["missing", "v2_absent_skip"],
  ];
  for (const [jobState, reason] of cases) {
    it(`allowlist + ${jobState} → skip legacy (${reason})`, () => {
      const d = gate({ inAllowlist: true, jobState });
      expect(d.runLegacy).toBe(false);
      expect(d.operation).toBe("weekly_get_reconcile_skipped");
      expect(d.reason).toBe(reason);
    });
  }
  it("allowlist + failed → does NOT run legacy even with global fallback on", () => {
    expect(gate({ inAllowlist: true, jobState: "failed", fallbackEnabled: true }).runLegacy).toBe(false);
  });
});

describe("Stage 7 — non-allowlist user keeps Stage 6 behavior", () => {
  it("completed → skip", () => {
    const d = gate({ inAllowlist: false, jobState: "completed" });
    expect(d.runLegacy).toBe(false);
    expect(d.operation).toBe("weekly_get_finalize_skipped");
  });
  it("fresh running → skip", () => {
    expect(gate({ inAllowlist: false, jobState: "running_fresh" }).runLegacy).toBe(false);
  });
  it("failed + fallback on → legacy fallback", () => {
    const d = gate({ inAllowlist: false, jobState: "failed", fallbackEnabled: true });
    expect(d.runLegacy).toBe(true);
    expect(d.operation).toBe("weekly_get_legacy_fallback");
  });
  it("missing + fallback off → skip (no finalize)", () => {
    const d = gate({ inAllowlist: false, jobState: "missing", fallbackEnabled: false });
    expect(d.runLegacy).toBe(false);
    expect(d.reason).toBe("fallback_disabled");
  });
  it("stale running + fallback on → legacy fallback", () => {
    expect(gate({ inAllowlist: false, jobState: "running_stale", fallbackEnabled: true }).runLegacy).toBe(true);
  });
});

describe("Stage 7 — fail-safe on job-status read error", () => {
  it("allowlist + read_error → safe legacy fallback, never completed", () => {
    const d = gate({ inAllowlist: true, jobState: "read_error" });
    expect(d.runLegacy).toBe(true);
    expect(d.operation).toBe("job_status_read_failed_fallback");
    expect(d.propagateError).toBeFalsy();
  });
  it("non-allowlist + read_error → propagate (no fabricated completed)", () => {
    const d = gate({ inAllowlist: false, jobState: "read_error" });
    expect(d.runLegacy).toBe(false);
    expect(d.propagateError).toBe(true);
  });
});

describe("Stage 7 — removing a user from allowlist restores legacy fallback", () => {
  it("same failed job: in allowlist skips, out of allowlist falls back", () => {
    expect(gate({ inAllowlist: true, jobState: "failed", fallbackEnabled: true }).runLegacy).toBe(false);
    expect(gate({ inAllowlist: false, jobState: "failed", fallbackEnabled: true }).runLegacy).toBe(true);
  });
});

describe("Stage 7 — weeklyJobStateOf mapping", () => {
  it("null → missing", () => expect(weeklyJobStateOf(null, "claimable")).toBe("missing"));
  it("completed → completed", () => expect(weeklyJobStateOf({ status: "completed" }, "x")).toBe("completed"));
  it("failed → failed", () => expect(weeklyJobStateOf({ status: "failed" }, "x")).toBe("failed"));
  it("running + already_running → running_fresh", () => expect(weeklyJobStateOf({ status: "running" }, "already_running")).toBe("running_fresh"));
  it("running + stale → running_stale", () => expect(weeklyJobStateOf({ status: "running" }, "stale_takeover")).toBe("running_stale"));
  it("pending → missing", () => expect(weeklyJobStateOf({ status: "pending" }, "claimable")).toBe("missing"));
});
