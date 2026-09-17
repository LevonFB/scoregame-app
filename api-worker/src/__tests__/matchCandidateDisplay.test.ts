import { describe, expect, it } from "vitest";
import { passesProviderDisplayFilter } from "../matchCandidateDisplay";
import { buildImportMatchRow, normalizeImportCandidate, type ImportSourceMeta } from "../matchSourceImport";

describe("passesProviderDisplayFilter (AllSports-only candidate visibility)", () => {
  it("shows AllSports candidates that resolve to the catalog", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "AllSports API", sourceId: null, catalogResolved: true, allSportsOnly: true })).toBe(true);
  });

  it("hides legacy Football-Data rows (no source_id) while AllSports-only", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: null, catalogResolved: true, allSportsOnly: true })).toBe(false);
  });

  it("shows imported Football-Data candidates (source_id set) — the M5.1 fix", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: 7, catalogResolved: true, allSportsOnly: true })).toBe(true);
  });

  it("shows imported AllSports candidates (source_id set)", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "AllSports API", sourceId: 3, catalogResolved: true, allSportsOnly: true })).toBe(true);
  });

  it("still hides imported candidates that do NOT resolve to the catalog (no garbage)", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: 7, catalogResolved: false, allSportsOnly: true })).toBe(false);
  });

  it("returns every row unchanged when not AllSports-only", () => {
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: null, catalogResolved: false, allSportsOnly: false })).toBe(true);
    expect(passesProviderDisplayFilter({ apiProvider: "whatever", sourceId: undefined, catalogResolved: false, allSportsOnly: false })).toBe(true);
  });

  it("treats source_id 0 / undefined / null consistently", () => {
    // 0 is a valid id only if used; our ids are >0, but the helper just needs non-null.
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: 0, catalogResolved: true, allSportsOnly: true })).toBe(true);
    expect(passesProviderDisplayFilter({ apiProvider: "Football-Data", sourceId: undefined, catalogResolved: true, allSportsOnly: true })).toBe(false);
  });
});

// Imported rows must carry the right competition_type/match_type so the (unchanged)
// mode filter isMatchAllowedInMode accepts them in the matching mode.
describe("imported row mode typing", () => {
  const baseRaw = {
    preview_id: "1:football_data:101",
    provider: "football_data",
    provider_match_id: "101",
    source_id: 1,
    competition_name: "Premier League",
    match_mode: "club",
    home_team: "Arsenal",
    away_team: "Chelsea",
    kickoff_utc: "2026-08-15T16:30:00Z",
    status: "SCHEDULED",
  };

  it("a club source produces club competition_type/match_type", () => {
    const meta: ImportSourceMeta = { competitionKey: "PL", competitionLabel: "Premier League", competitionType: "club", apiProvider: "Football-Data" };
    const row = buildImportMatchRow(normalizeImportCandidate(baseRaw), meta);
    expect(row.competition_type).toBe("club");
    expect(row.match_type).toBe("club");
  });

  it("a national source produces national_team competition_type/match_type", () => {
    const meta: ImportSourceMeta = { competitionKey: "WC", competitionLabel: "FIFA World Cup", competitionType: "national_team", apiProvider: "Football-Data" };
    const row = buildImportMatchRow(normalizeImportCandidate({ ...baseRaw, match_mode: "national" }), meta);
    expect(row.competition_type).toBe("national_team");
    expect(row.match_type).toBe("national_team");
  });

  it("never carries is_pick (publication stays manual via Apply Selection)", () => {
    const meta: ImportSourceMeta = { competitionKey: "PL", competitionLabel: "Premier League", competitionType: "club", apiProvider: "Football-Data" };
    const row = buildImportMatchRow(normalizeImportCandidate(baseRaw), meta);
    expect("is_pick" in row).toBe(false);
  });
});
