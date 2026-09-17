import { describe, it, expect } from "vitest";
import {
  buildEurocupLeagueStageZonesSnapshot,
  EUROCUP_TEAM_COUNT,
  isEurocupCode,
  validateEurocupOfficialTable,
} from "../seasonPredictionEurocup";

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `t${i + 1}`);
}
const ALLOWED = ids(EUROCUP_TEAM_COUNT); // t1..t36

// Object table shape with explicit positions, as the admin editor sends it.
function tableWithPositions(order: string[]) {
  return { ordered_teams: order.map((id, i) => ({ team_ref: id, position: i + 1 })) };
}

describe("isEurocupCode", () => {
  it("accepts UCL/UEL/UECL and rejects top-5 codes", () => {
    expect(isEurocupCode("UCL")).toBe(true);
    expect(isEurocupCode("UEL")).toBe(true);
    expect(isEurocupCode("UECL")).toBe(true);
    expect(isEurocupCode("PL")).toBe(false);
    expect(isEurocupCode("")).toBe(false);
    expect(isEurocupCode(null)).toBe(false);
  });
});

describe("buildEurocupLeagueStageZonesSnapshot", () => {
  it("fixes top8 / 9–24 / eliminated zones for 36 teams", () => {
    const z = buildEurocupLeagueStageZonesSnapshot();
    expect(z.top8).toEqual({ from: 1, to: 8, label: "Топ-8" });
    expect(z.playoff_9_24).toEqual({ from: 9, to: 24, label: "9–24" });
    expect(z.eliminated).toEqual({ from: 25, to: 36, label: "Вылет" });
  });
});

describe("validateEurocupOfficialTable", () => {
  it("accepts a valid 36-team ordered_team_ids table", () => {
    const ordered = validateEurocupOfficialTable({ ordered_team_ids: ALLOWED }, ALLOWED);
    expect(ordered).toHaveLength(36);
    expect(ordered[0]).toBe("t1");
    expect(ordered[35]).toBe("t36");
  });

  it("accepts explicit positions and returns ids sorted by position", () => {
    const shuffled = tableWithPositions([...ALLOWED].reverse());
    // positions 1..36 assigned in reversed-array order → ordered output follows position
    const ordered = validateEurocupOfficialTable(shuffled, ALLOWED);
    expect(ordered).toHaveLength(36);
    expect(ordered[0]).toBe("t36"); // reversed array's first element got position 1
  });

  it("rejects 35 teams", () => {
    expect(() => validateEurocupOfficialTable({ ordered_team_ids: ids(35) }, ALLOWED)).toThrow("EUROCUP_TABLE_INCOMPLETE");
  });

  it("rejects 37 teams", () => {
    expect(() => validateEurocupOfficialTable({ ordered_team_ids: [...ALLOWED, "t37"] }, ids(37))).toThrow("EUROCUP_TABLE_INCOMPLETE");
  });

  it("rejects duplicate team_id", () => {
    const dup = [...ids(35), "t1"]; // 36 entries but t1 twice, t36 missing
    expect(() => validateEurocupOfficialTable({ ordered_team_ids: dup }, ALLOWED)).toThrow("EUROCUP_TABLE_HAS_DUPLICATES");
  });

  it("rejects duplicate / out-of-range position", () => {
    const rows = ALLOWED.map((id, i) => ({ team_ref: id, position: i + 1 }));
    rows[1].position = 1; // duplicate position 1
    expect(() => validateEurocupOfficialTable({ ordered_teams: rows }, ALLOWED)).toThrow("EUROCUP_TABLE_BAD_POSITIONS");
  });

  it("rejects a team that does not belong to the tournament", () => {
    const foreign = [...ids(35), "other_team"];
    expect(() => validateEurocupOfficialTable({ ordered_team_ids: foreign }, ALLOWED)).toThrow("EUROCUP_TABLE_HAS_UNKNOWN_TEAM");
  });

  it("rejects an empty row id", () => {
    const rows = ALLOWED.map((id) => ({ team_ref: id }));
    (rows[3] as any).team_ref = "";
    expect(() => validateEurocupOfficialTable({ ordered_teams: rows }, ALLOWED)).toThrow();
  });
});
