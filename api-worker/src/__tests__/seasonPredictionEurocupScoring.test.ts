import { describe, it, expect } from "vitest";
import {
  scoreSeasonPredictionEurocupLeagueStageEntry,
  EUROCUPS_FORMULA_VERSION,
  EUROCUPS_LEAGUE_STAGE_MAX_POINTS,
} from "../seasonPredictionEurocupScoring";

// Official ordering o1..o36 (o1 = position 1).
const OFFICIAL = Array.from({ length: 36 }, (_, i) => `o${i + 1}`);

function entry(top8: string[], zone: string[], winner: string | null = null) {
  return { stage: "league_stage", league_stage: { top8_team_ids: top8, zone_9_24_team_ids: zone, winner_team_id: winner } };
}
function slice(from: number, to: number) {
  return OFFICIAL.slice(from - 1, to); // 1-based inclusive
}
function score(userTable: unknown) {
  return scoreSeasonPredictionEurocupLeagueStageEntry({ userTable, officialOrderedIds: OFFICIAL });
}

describe("scoreSeasonPredictionEurocupLeagueStageEntry — eurocups_v2", () => {
  it("perfect prediction scores 100/100 with all bonuses", () => {
    const res = score(entry(slice(1, 8), slice(9, 24)));
    expect(res.formula_version).toBe(EUROCUPS_FORMULA_VERSION);
    expect(res.total_points).toBe(100);
    expect(res.max_possible_points).toBe(EUROCUPS_LEAGUE_STAGE_MAX_POINTS);
    expect(res.points_pct).toBe(1);
    expect(res.top8_points).toBe(32);
    expect(res.playoff_9_24_points).toBe(32);
    expect(res.qualified_top24_points).toBe(0);
    expect(res.bonus_points).toBe(36);
    expect(res.top8_correct).toBe(8);
    expect(res.playoff_9_24_correct).toBe(16);
    expect(res.top24_correct).toBe(24);
    expect(res.warnings).toHaveLength(0);
  });

  it("partial zone swap: no exact, but +1 qualified credit each, all_top24 bonus", () => {
    // o9 (official 9–24) placed into top8; o1 (official top8) placed into 9–24.
    const top8 = ["o9", ...slice(2, 8)];          // 7 exact top8 + o9 wrong zone
    const zone = ["o1", ...slice(10, 24)];        // 15 exact 9–24 + o1 wrong zone
    const res = score(entry(top8, zone));
    expect(res.top8_correct).toBe(7);
    expect(res.playoff_9_24_correct).toBe(15);
    expect(res.qualified_top24_points).toBe(2); // o9 + o1, +1 each
    expect(res.top24_correct).toBe(24);
    // 7*4 + 15*2 + 2 + all_top24(12) = 28 + 30 + 2 + 12 = 72
    expect(res.total_points).toBe(72);
    const bonusMap = Object.fromEntries((res.breakdown as any).bonuses.map((b: any) => [b.key, b.earned]));
    expect(bonusMap.all_top8_correct).toBe(false);
    expect(bonusMap.all_9_24_correct).toBe(false);
    expect(bonusMap.all_top24_correct).toBe(true);
  });

  it("a team from official 25–36 earns 0 points", () => {
    // Replace o24 in the zone with o25 (official eliminated).
    const zone = [...slice(9, 23), "o25"];
    const res = score(entry(slice(1, 8), zone));
    const team = (res.breakdown as any).teams.find((t: any) => t.team_id === "o25");
    expect(team.points).toBe(0);
    expect(team.status).toBe("eliminated");
    expect(res.playoff_9_24_correct).toBe(15);
  });

  it("all_top24 earned but top8/9_24 bonuses false when subzones are mixed", () => {
    const top8 = slice(17, 24); // official 9–24 teams placed in top8
    const zone = slice(1, 16);  // official top8 (1–8) + official 9–16 placed in 9–24
    const res = score(entry(top8, zone));
    expect(res.top8_correct).toBe(0);
    expect(res.playoff_9_24_correct).toBe(8); // o9..o16 exact
    expect(res.top24_correct).toBe(24);
    const bonusMap = Object.fromEntries((res.breakdown as any).bonuses.map((b: any) => [b.key, b.earned]));
    expect(bonusMap.all_top24_correct).toBe(true);
    expect(bonusMap.all_top8_correct).toBe(false);
    expect(bonusMap.all_9_24_correct).toBe(false);
  });

  it("predicted winner is stored but earns 0 and does not change max", () => {
    const res = score(entry(slice(1, 8), slice(9, 24), "o1"));
    expect(res.predicted_winner_team_id).toBe("o1");
    expect(res.winner_points).toBe(0);
    expect(res.max_possible_points).toBe(100);
    expect((res.breakdown as any).winner.status).toBe("pending_official_champion");
  });

  it("unknown user team scores 0 with a warning (does not throw)", () => {
    const top8 = ["ghost", ...slice(2, 8)];
    const res = score(entry(top8, slice(9, 24)));
    expect(res.warnings.some((w) => w.includes("ghost"))).toBe(true);
    const ghost = (res.breakdown as any).teams.find((t: any) => t.team_id === "ghost");
    expect(ghost.points).toBe(0);
    expect(ghost.status).toBe("unknown_team");
  });

  it("rejects duplicate team in top8", () => {
    const top8 = ["o1", "o1", ...slice(3, 8)];
    expect(() => score(entry(top8, slice(9, 24)))).toThrow("EUROCUP_USER_TOP8_DUPLICATE");
  });

  it("rejects insufficient top8 (7 teams)", () => {
    expect(() => score(entry(slice(1, 7), slice(9, 24)))).toThrow("EUROCUP_USER_TOP8_INVALID");
  });

  it("rejects overlap between top8 and 9–24", () => {
    const zone = ["o1", ...slice(10, 24)]; // o1 also in top8
    expect(() => score(entry(slice(1, 8), zone))).toThrow("EUROCUP_USER_ZONE_OVERLAP");
  });

  it("throws when the official table is not 36 teams", () => {
    expect(() => scoreSeasonPredictionEurocupLeagueStageEntry({
      userTable: entry(slice(1, 8), slice(9, 24)),
      officialOrderedIds: OFFICIAL.slice(0, 30),
    })).toThrow("EUROCUP_OFFICIAL_TABLE_NOT_36");
  });
});
