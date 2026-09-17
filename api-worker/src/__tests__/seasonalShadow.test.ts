// Stage 13 — unit tests for seasonal quest shadow pure helpers.

import { describe, expect, it } from "vitest";
import {
  buildSeasonalEvent,
  classifySeasonalShadow,
  shouldRunSeasonalShadow,
  type SeasonalQuestCompareInput,
} from "../seasonalShadow";
import { resolveApiFlags } from "../featureFlags";
import { isQuestApplyUser, parseUserIdAllowlist, shouldSkipReadReconcile, type ApplyFlagState } from "../questShadow";

const base: SeasonalQuestCompareInput = {
  supported: true, hasStoredRow: true, expectedProgress: 5, storedProgress: 5,
  expectedCompleted: true, storedCompleted: true, expectedRewardEligible: true, storedRewarded: true,
};
const c = (o: Partial<SeasonalQuestCompareInput> = {}) => classifySeasonalShadow({ ...base, ...o });

describe("Stage 13 — flag defaults", () => {
  it("defaults off → current behavior", () => {
    const f = resolveApiFlags({});
    expect(f.seasonalEventSyncV2).toBe(false);
    expect(f.seasonalEventSyncShadow).toBe(false);
  });
  it("garbage cannot enable", () => {
    expect(resolveApiFlags({ SEASONAL_EVENT_SYNC_V2_ENABLED: "x" }).seasonalEventSyncV2).toBe(false);
    expect(resolveApiFlags({ SEASONAL_EVENT_SYNC_V2_ENABLED: "true" }).seasonalEventSyncV2).toBe(true);
  });
});

describe("Stage 13 — shouldRunSeasonalShadow", () => {
  it("V2 off → no run", () => expect(shouldRunSeasonalShadow({ seasonalEventSyncV2: false, seasonalEventSyncShadow: false }).run).toBe(false));
  it("V2 on + shadow on → run", () => expect(shouldRunSeasonalShadow({ seasonalEventSyncV2: true, seasonalEventSyncShadow: true }).run).toBe(true));
  it("V2 on + shadow off → no run + warn (apply forbidden)", () => {
    const d = shouldRunSeasonalShadow({ seasonalEventSyncV2: true, seasonalEventSyncShadow: false });
    expect(d.run).toBe(false);
    expect(d.warn).toBe(true);
  });
});

describe("Stage 13 — classifySeasonalShadow", () => {
  it("all equal → match", () => expect(c()).toBe("match"));
  it("unsupported condition", () => expect(c({ supported: false })).toBe("unsupported"));
  it("expected completed but no stored row → missing_progress", () =>
    expect(c({ hasStoredRow: false, storedCompleted: false, storedRewarded: false })).toBe("missing_progress"));
  it("completion differs → completion_mismatch", () =>
    expect(c({ expectedCompleted: false, expectedRewardEligible: false })).toBe("completion_mismatch"));
  it("reward differs → reward_mismatch", () =>
    expect(c({ storedRewarded: false })).toBe("reward_mismatch"));
  it("progress differs (stored row) → progress_mismatch", () =>
    expect(c({ expectedProgress: 4, storedProgress: 3, expectedCompleted: false, storedCompleted: false, expectedRewardEligible: false, storedRewarded: false, hasStoredRow: true })).toBe("progress_mismatch"));
  it("incomplete + no row + partial expected progress → match (legacy stores nothing)", () =>
    expect(c({ hasStoredRow: false, expectedProgress: 3, storedProgress: 0, expectedCompleted: false, storedCompleted: false, expectedRewardEligible: false, storedRewarded: false })).toBe("match"));
  it("already completed & rewarded, still met → match", () => expect(c()).toBe("match"));
});

describe("Stage 13 — buildSeasonalEvent", () => {
  it("stable id per type/season/user", () => {
    expect(buildSeasonalEvent("case_opened", 42, "season:7").event_id).toBe("seasonal-evt:case_opened:season:7:42");
  });
});

describe("Stage 14 — seasonal apply flags & gating", () => {
  it("master flag default off; garbage cannot enable", () => {
    expect(resolveApiFlags({}).seasonalEventApplyV2).toBe(false);
    expect(resolveApiFlags({ SEASONAL_EVENT_APPLY_V2_ENABLED: "x" }).seasonalEventApplyV2).toBe(false);
    expect(resolveApiFlags({ SEASONAL_EVENT_APPLY_V2_ENABLED: "true" }).seasonalEventApplyV2).toBe(true);
  });
  it("empty allowlists include nobody; only positive ints", () => {
    expect(parseUserIdAllowlist("").size).toBe(0);
    expect([...parseUserIdAllowlist("5, 0, -3, abc, 9")].sort((a, b) => a - b)).toEqual([5, 9]);
  });
  // Gating reuses the Stage 5 generic helpers (isQuestApplyUser / shouldSkipReadReconcile).
  const f = (over: Partial<ApplyFlagState> = {}): ApplyFlagState => ({ applyV2: true, applyUserIds: new Set([5]), skipReconcileUserIds: new Set([5]), ...over });
  it("apply only for apply-allowlisted user when master on", () => {
    expect(isQuestApplyUser(5, f())).toBe(true);
    expect(isQuestApplyUser(9, f())).toBe(false);
    expect(isQuestApplyUser(5, f({ applyV2: false }))).toBe(false); // master off
  });
  it("read-skip needs all three: master + apply allowlist + skip allowlist", () => {
    expect(shouldSkipReadReconcile(5, f()).skip).toBe(true);
    expect(shouldSkipReadReconcile(5, f({ applyV2: false })).skip).toBe(false);
    expect(shouldSkipReadReconcile(5, f({ applyUserIds: new Set([1]) })).skip).toBe(false);
    expect(shouldSkipReadReconcile(5, f({ skipReconcileUserIds: new Set([1]) })).skip).toBe(false);
  });
  it("removing the ID restores legacy (no skip)", () => {
    expect(shouldSkipReadReconcile(5, f({ skipReconcileUserIds: new Set() })).skip).toBe(false);
  });
});
