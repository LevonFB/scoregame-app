import { describe, expect, it } from "vitest";
import { AUTO_SELECTION_ENABLED, isAutoModeRejected, isAutoPickAllowed } from "../autoSelectionPolicy";

describe("autoSelectionPolicy (M6.1 manual-only)", () => {
  it("AUTO selection is disabled by default", () => {
    expect(AUTO_SELECTION_ENABLED).toBe(false);
  });

  it("isAutoPickAllowed is false by default for every caller intent", () => {
    // With the master switch off (default), no caller can trigger auto-pick.
    expect(isAutoPickAllowed(true)).toBe(false);
    expect(isAutoPickAllowed(false)).toBe(false);
    expect(isAutoPickAllowed(undefined)).toBe(false);
  });

  it("isAutoPickAllowed requires BOTH opt-in and the master switch", () => {
    expect(isAutoPickAllowed(true, true)).toBe(true); // rollback path
    expect(isAutoPickAllowed(false, true)).toBe(false); // not requested
    expect(isAutoPickAllowed(undefined, true)).toBe(false); // cron / default caller
    expect(isAutoPickAllowed(true, false)).toBe(false); // switch off
  });

  it("cron-style callers (no opt-in) never auto-pick, even if the switch were on", () => {
    expect(isAutoPickAllowed(undefined, true)).toBe(false);
  });

  it("PUT /admin/day/top3 AUTO is rejected while disabled, MANUAL/REST are not", () => {
    expect(isAutoModeRejected("AUTO")).toBe(true);
    expect(isAutoModeRejected("MANUAL")).toBe(false);
    expect(isAutoModeRejected("REST")).toBe(false);
  });

  it("AUTO is accepted only when the master switch is explicitly enabled (rollback)", () => {
    expect(isAutoModeRejected("AUTO", true)).toBe(false);
    expect(isAutoModeRejected("AUTO", false)).toBe(true);
  });
});
