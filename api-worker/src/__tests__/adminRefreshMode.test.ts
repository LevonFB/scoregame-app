import { describe, expect, it } from "vitest";
import { decideAdminRefresh } from "../adminRefreshMode";

describe("decideAdminRefresh (M6 safe-by-default)", () => {
  it("does nothing when candidates already exist and no refresh was requested", () => {
    expect(decideAdminRefresh({ hasCandidates: true, refreshRequested: false, legacyAuto: false })).toBe("none");
  });

  it("an explicit normal refresh resolves to SAFE (never AUTO)", () => {
    expect(decideAdminRefresh({ hasCandidates: true, refreshRequested: true, legacyAuto: false })).toBe("safe");
  });

  it("an implicit empty-day refresh resolves to SAFE — no hidden AUTO fallback", () => {
    expect(decideAdminRefresh({ hasCandidates: false, refreshRequested: false, legacyAuto: false })).toBe("safe");
  });

  it("legacy AUTO only runs when explicitly requested", () => {
    expect(decideAdminRefresh({ hasCandidates: true, refreshRequested: true, legacyAuto: true })).toBe("legacy-auto");
    expect(decideAdminRefresh({ hasCandidates: false, refreshRequested: false, legacyAuto: true })).toBe("legacy-auto");
  });

  it("never returns legacy-auto unless the legacyAuto flag is set", () => {
    const combos = [
      { hasCandidates: true, refreshRequested: false },
      { hasCandidates: true, refreshRequested: true },
      { hasCandidates: false, refreshRequested: false },
      { hasCandidates: false, refreshRequested: true },
    ];
    for (const c of combos) {
      expect(decideAdminRefresh({ ...c, legacyAuto: false })).not.toBe("legacy-auto");
    }
  });
});
