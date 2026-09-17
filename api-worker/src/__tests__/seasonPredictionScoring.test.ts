import { describe, it, expect } from "vitest";
import {
  scoreSeasonPredictionTopLeagueEntry,
  computeMaxPossiblePoints,
  buildAwardsBreakdown,
  TOP5_V1_CONFIG,
  type ScoreEntryInput,
} from "../seasonPredictionScoring";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ZONES_20 = {
  champion: [1, 1], champions_league: [1, 4], europa_league: [5, 5],
  conference_league: [6, 6], relegation: [18, 20], playoff: [],
} as Record<string, unknown>;

const ZONES_18 = {
  champion: [1, 1], champions_league: [1, 4], europa_league: [5, 5],
  conference_league: [6, 6], relegation: [17, 18], playoff: [16, 16],
} as Record<string, unknown>;

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}
function table(order: string[]) {
  return { ordered_team_ids: order };
}
function swap(order: string[], a: number, b: number): string[] {
  const copy = [...order];
  [copy[a], copy[b]] = [copy[b], copy[a]];
  return copy;
}
function baseInput(official: string[], user: string[], zones: Record<string, unknown>, teamCount: number): ScoreEntryInput {
  return {
    userTable: table(user),
    officialTable: table(official),
    zonesSnapshot: zones,
    teamIdsSnapshot: official,
    teamCount,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("scoreSeasonPredictionTopLeagueEntry — top5_v1", () => {
  it("perfect 20-team prediction scores 163/163", () => {
    const official = ids(20);
    const res = scoreSeasonPredictionTopLeagueEntry(baseInput(official, official, ZONES_20, 20));
    expect(res.max_possible_points).toBe(163);
    expect(res.total_points).toBe(163);
    expect(res.points_pct).toBe(1);
    expect(res.exact_positions).toBe(20);
    expect(res.errors_le_2).toBe(20);
    expect(res.champion_correct).toBe(1);
    expect(res.ucl_zone_correct).toBe(4);
    expect(res.ucl_zone_full).toBe(1);
    expect(res.relegation_zone_correct).toBe(3);
    expect(res.relegation_zone_full).toBe(1);
    expect(res.warnings).toHaveLength(0);
  });

  it("ЛЕ/ЛК zone-full: perfect → 1/1; misplacing the EL team drops europa_zone_full", () => {
    const official = ids(20);
    const perfect = scoreSeasonPredictionTopLeagueEntry(baseInput(official, official, ZONES_20, 20));
    expect(perfect.europa_zone_correct).toBe(1);
    expect(perfect.europa_zone_full).toBe(1);
    expect(perfect.conference_zone_correct).toBe(1);
    expect(perfect.conference_zone_full).toBe(1);
    // Move t5 (pos5, ЛЕ) ↔ t7 (pos7, no zone): t5 leaves the ЛЕ zone → europa_zone_full 0,
    // while the ЛК team (pos6) is untouched.
    const off = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 4, 6), ZONES_20, 20));
    expect(off.europa_zone_correct).toBe(0);
    expect(off.europa_zone_full).toBe(0);
    expect(off.conference_zone_full).toBe(1);
  });

  it("perfect 18-team prediction scores 152/152", () => {
    const official = ids(18);
    const res = scoreSeasonPredictionTopLeagueEntry(baseInput(official, official, ZONES_18, 18));
    expect(res.max_possible_points).toBe(152);
    expect(res.total_points).toBe(152);
    expect(res.relegation_zone_correct).toBe(2);
    expect(res.relegation_zone_full).toBe(1);
  });

  it("position errors 0/1/2/3 award 5/3/1/0", () => {
    const official = ids(20);
    // Adjacent swap at positions 10/11 (0-indexed 9/10): both error 1 → +3 each.
    const off1 = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 9, 10), ZONES_20, 20));
    expect(off1.total_points).toBe(163 - 4); // two teams lose 2 each (5→3)
    expect(off1.exact_positions).toBe(18);
    expect(off1.errors_le_1).toBe(20);

    // Swap positions 10/12 (indices 9/11): both error 2 → +1 each.
    const off2 = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 9, 11), ZONES_20, 20));
    expect(off2.total_points).toBe(163 - 8); // two teams lose 4 each (5→1)
    expect(off2.errors_le_2).toBe(20);

    // Swap positions 10/13 (indices 9/12): both error 3 → 0 each.
    const off3 = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 9, 12), ZONES_20, 20));
    expect(off3.total_points).toBe(163 - 10); // two teams lose 5 each, consistency still holds (18≥10)
    expect(off3.errors_le_2).toBe(18);
  });

  it("champion bonus only when official champion sits at user position 1", () => {
    const official = ids(20);
    // Swap positions 1/2 → champion t1 drops to pos2, loses champion bonus + ucl exactness.
    const res = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 0, 1), ZONES_20, 20));
    expect(res.champion_correct).toBe(0);
    expect(res.champion_points).toBe(0);
  });

  it("ЛЧ bonus: 4/4 → +10, 3/4 → +5", () => {
    const official = ids(20);
    const full = scoreSeasonPredictionTopLeagueEntry(baseInput(official, official, ZONES_20, 20));
    expect(full.ucl_zone_correct).toBe(4);
    expect(full.ucl_zone_full).toBe(1);

    // Move t4 (pos4, ЛЧ) ↔ t7 (pos7, no zone): only 3/4 remain in ЛЧ.
    const almost = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 3, 6), ZONES_20, 20));
    expect(almost.ucl_zone_correct).toBe(3);
    expect(almost.ucl_zone_full).toBe(0);
    // bonus moves 10 → 5; table loses 10 (two error-3 teams); zone loses 3 (t4).
    expect(almost.total_points).toBe(163 - 10 - 3 - 5);
  });

  it("relegation bonus: full +8 (20-team), partial +4", () => {
    const official = ids(20);
    const full = scoreSeasonPredictionTopLeagueEntry(baseInput(official, official, ZONES_20, 20));
    expect(full.relegation_zone_full).toBe(1);

    // Move t18 (pos18, relegation) ↔ t15 (pos15, no zone): 2/3 relegation correct.
    const partial = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 17, 14), ZONES_20, 20));
    expect(partial.relegation_zone_correct).toBe(2);
    expect(partial.relegation_zone_full).toBe(0);
  });

  it("relegation partial 1/2 for 18-team league", () => {
    const official = ids(18);
    // Move t17 (pos17, relegation) ↔ t14 (pos14): 1/2 relegation correct.
    const partial = scoreSeasonPredictionTopLeagueEntry(baseInput(official, swap(official, 16, 13), ZONES_18, 18));
    expect(partial.relegation_zone_correct).toBe(1);
    expect(partial.relegation_zone_full).toBe(0);
  });

  it("consistency bonus absent when fewer than 10 teams within error ≤2", () => {
    const official = ids(20);
    const reversed = [...official].reverse();
    const res = scoreSeasonPredictionTopLeagueEntry(baseInput(official, reversed, ZONES_20, 20));
    expect(res.errors_le_2).toBeLessThan(10);
    // No consistency bonus contribution.
    const hasConsistency = (res.breakdown.bonuses as Array<{ key: string }>).some((b) => b.key === "consistency_le2");
    expect(hasConsistency).toBe(false);
  });

  it("awards_correct counted, awards_points stays 0", () => {
    const official = ids(20);
    const res = scoreSeasonPredictionTopLeagueEntry({
      ...baseInput(official, official, ZONES_20, 20),
      userAwards: {
        top_scorer: { award_option_id: 101 },
        top_assistant: { award_option_id: 999 },
        golden_glove: { award_option_id: 301 },
      },
      officialAwards: [
        { award_type: "top_scorer", award_option_id: 101 },
        { award_type: "top_assistant", award_option_id: 201 },
        { award_type: "golden_glove", award_option_id: 301 },
      ],
    });
    expect(res.awards_correct).toBe(2);
    expect(res.awards_points).toBe(0);
  });

  it("duplicate + missing user teams do not crash, surface warnings", () => {
    const official = ids(20);
    const user = [...official];
    user[5] = user[4]; // duplicate t5, drops t6 (missing)
    user.push("ghost"); // unknown team not in official
    const res = scoreSeasonPredictionTopLeagueEntry(baseInput(official, user, ZONES_20, 20));
    expect(res.total_points).toBeGreaterThan(0);
    expect(res.warnings.some((w) => w.startsWith("USER_TABLE_DUPLICATES"))).toBe(true);
    expect(res.warnings.some((w) => w.startsWith("USER_TEAMS_NOT_IN_OFFICIAL"))).toBe(true);
  });

  it("empty official table throws (critical)", () => {
    expect(() => scoreSeasonPredictionTopLeagueEntry(baseInput([], ids(20), ZONES_20, 20)))
      .toThrow("OFFICIAL_TABLE_EMPTY");
  });

  it("computeMaxPossiblePoints matches 163/152 for 20/18 team zones", () => {
    expect(computeMaxPossiblePoints(ZONES_20, 20, TOP5_V1_CONFIG)).toBe(163);
    expect(computeMaxPossiblePoints(ZONES_18, 18, TOP5_V1_CONFIG)).toBe(152);
  });

  it("attaches awards breakdown without changing points (awards_points stays 0)", () => {
    const official = ids(20);
    const res = scoreSeasonPredictionTopLeagueEntry({
      ...baseInput(official, official, ZONES_20, 20),
      userAwards: {
        top_scorer: { player_name: "Šeško", team_name: "Man Utd" },
        top_assistant: { player_name: "Bruno", team_name: "Man Utd" },
      },
      officialAwards: [
        { award_type: "top_scorer", player_name: "Haaland", team_name: "Man City" },
        { award_type: "top_assistant", player_name: "Bruno", team_name: "Man Utd" },
      ],
    });
    // points are unchanged by the awards detail
    expect(res.awards_points).toBe(0);
    expect(res.total_points).toBe(163);
    expect(res.max_possible_points).toBe(163);
    const awards = (res.breakdown as any).awards as any[];
    expect(Array.isArray(awards)).toBe(true);
    const scorer = awards.find((a) => a.award_type === "top_scorer");
    const assist = awards.find((a) => a.award_type === "top_assistant");
    expect(scorer.correct).toBe(false);
    expect(scorer.official_player_name).toBe("Haaland");
    expect(scorer.user_player_name).toBe("Šeško");
    expect(assist.correct).toBe(true);
    expect(res.awards_correct).toBe(1);
  });
});

describe("buildAwardsBreakdown", () => {
  it("marks a correct pick green and a miss with both names", () => {
    const items = buildAwardsBreakdown(
      {
        top_scorer: { player_name: "Šeško", team_name: "Man Utd" },
        top_assistant: { player_name: "Bruno", team_name: "Man Utd" },
      },
      [
        { award_type: "top_scorer", player_name: "Haaland", team_name: "Man City" },
        { award_type: "top_assistant", player_name: "Bruno", team_name: "Man Utd" },
      ],
    );
    const scorer = items.find((i) => i.award_type === "top_scorer")!;
    const assist = items.find((i) => i.award_type === "top_assistant")!;
    expect(scorer.correct).toBe(false);
    expect(scorer.official_confirmed).toBe(true);
    expect(assist.correct).toBe(true);
  });

  it("top_assister official maps to top_assistant user pick (compat)", () => {
    const items = buildAwardsBreakdown(
      { top_assister: { player_name: "Bruno", team_name: "Man Utd" } },
      [{ award_type: "top_assister", player_name: "Bruno", team_name: "Man Utd" }],
    );
    expect(items).toHaveLength(1);
    expect(items[0].award_type).toBe("top_assistant");
    expect(items[0].correct).toBe(true);
  });

  it("shows official-not-confirmed when only the user picked", () => {
    const items = buildAwardsBreakdown(
      { golden_glove: { player_name: "Lammens", team_name: "Man Utd" } },
      [],
    );
    expect(items).toHaveLength(1);
    expect(items[0].official_confirmed).toBe(false);
    expect(items[0].user_player_name).toBe("Lammens");
    expect(items[0].official_player_name).toBeNull();
    expect(items[0].correct).toBe(false);
  });

  it("shows not-picked when only the official exists", () => {
    const items = buildAwardsBreakdown(
      {},
      [{ award_type: "top_scorer", player_name: "Haaland", team_name: "Man City" }],
    );
    expect(items).toHaveLength(1);
    expect(items[0].user_player_name).toBeNull();
    expect(items[0].official_player_name).toBe("Haaland");
    expect(items[0].official_confirmed).toBe(true);
  });

  it("handles missing/empty awards data safely (no rows, no throw)", () => {
    expect(buildAwardsBreakdown(null, null)).toEqual([]);
    expect(buildAwardsBreakdown(undefined, undefined)).toEqual([]);
    expect(buildAwardsBreakdown("garbage", [])).toEqual([]);
  });
});
