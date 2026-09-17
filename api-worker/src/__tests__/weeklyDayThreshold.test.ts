import { describe, expect, it } from "vitest";
import { countWeeklyPotentialDays, resolveWeeklyThreshold } from "../index";

// 2026-W35 runs Mon 2026-08-24 .. Sun 2026-08-30 (UTC).
const SCOPE = { weekKey: "2026-W35", seasonId: 1 };
const ms = (iso: string) => Date.parse(iso);

describe("weekly day-count threshold", () => {
  it("keeps the full target on Monday when only today's matches are ingested", () => {
    const potential = countWeeklyPotentialDays(SCOPE, ["2026-08-24"], ms("2026-08-24T18:00:00Z"));
    expect(potential).toBe(7);
    expect(resolveWeeklyThreshold("weekly_active_days_3", 3, potential)).toBe(3);
  });

  it("keeps the full target mid-week while enough days are still ahead", () => {
    const potential = countWeeklyPotentialDays(SCOPE, ["2026-08-24", "2026-08-25"], ms("2026-08-25T20:00:00Z"));
    expect(resolveWeeklyThreshold("weekly_active_days_3", 3, potential)).toBe(3);
  });

  it("clamps the target on a genuinely short week once the days are gone", () => {
    // Saturday evening, only one game day happened and one calendar day is left.
    const potential = countWeeklyPotentialDays(SCOPE, ["2026-08-24"], ms("2026-08-29T21:00:00Z"));
    expect(potential).toBe(3);
    expect(resolveWeeklyThreshold("weekly_active_days_3", 3, potential)).toBe(3);

    // Sunday after the last day is over: nothing more can be added.
    const closed = countWeeklyPotentialDays(SCOPE, ["2026-08-24"], ms("2026-08-31T00:30:00Z"));
    expect(closed).toBe(1);
    expect(resolveWeeklyThreshold("weekly_active_days_3", 3, closed)).toBe(1);
  });

  it("never returns fewer potential days than the week already produced", () => {
    const potential = countWeeklyPotentialDays(
      SCOPE,
      ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29"],
      ms("2026-08-31T00:30:00Z")
    );
    expect(potential).toBe(6);
  });

  it("leaves non day-count quests untouched", () => {
    expect(resolveWeeklyThreshold("global_double_exact_week", 2, 1)).toBe(2);
  });
});
