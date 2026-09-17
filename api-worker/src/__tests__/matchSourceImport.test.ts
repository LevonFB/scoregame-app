import { describe, expect, it } from "vitest";
import {
  apiProviderForImport,
  buildImportMatchRow,
  importFingerprint,
  MAX_IMPORT_CANDIDATES,
  normalizeImportCandidate,
  type ImportSourceMeta,
} from "../matchSourceImport";

function rawCandidate(over: Record<string, any> = {}) {
  return {
    preview_id: "1:football_data:101",
    provider: "football_data",
    provider_match_id: "101",
    source_id: 1,
    source_title: "Premier League",
    competition_name: "Premier League",
    match_mode: "club",
    home_team: "Arsenal",
    away_team: "Chelsea",
    kickoff_utc: "2026-08-15T16:30:00Z",
    status: "SCHEDULED",
    stage: null,
    ...over,
  };
}

describe("normalizeImportCandidate", () => {
  it("accepts a valid payload and trims fields", () => {
    const c = normalizeImportCandidate(rawCandidate({ home_team: "  Arsenal  ", status: "scheduled" }));
    expect(c.provider).toBe("football_data");
    expect(c.provider_match_id).toBe("101");
    expect(c.home_team).toBe("Arsenal");
    expect(c.status).toBe("SCHEDULED");
    expect(c.match_mode).toBe("club");
  });

  it("ignores a client-supplied is_pick (never read)", () => {
    const c = normalizeImportCandidate(rawCandidate({ is_pick: 1 }));
    expect((c as any).is_pick).toBeUndefined();
  });

  it("rejects an invalid provider", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ provider: "rapidapi" }))).toThrow("INVALID_PROVIDER");
  });

  it("rejects an empty provider_match_id", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ provider_match_id: "  " }))).toThrow("PROVIDER_MATCH_ID_REQUIRED");
  });

  it("rejects an invalid match_mode", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ match_mode: "national_teams" }))).toThrow("INVALID_MATCH_MODE");
  });

  it("rejects empty teams", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ home_team: "" }))).toThrow("EMPTY_TEAMS");
    expect(() => normalizeImportCandidate(rawCandidate({ away_team: "   " }))).toThrow("EMPTY_TEAMS");
  });

  it("rejects an invalid kickoff", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ kickoff_utc: "not-a-date" }))).toThrow("INVALID_KICKOFF");
  });

  it("rejects an unsafe status", () => {
    expect(() => normalizeImportCandidate(rawCandidate({ status: "DELETED" }))).toThrow("INVALID_STATUS");
  });

  it("MAX_IMPORT_CANDIDATES is 3", () => {
    expect(MAX_IMPORT_CANDIDATES).toBe(3);
  });
});

describe("importFingerprint", () => {
  it("matches the same fixture across a small kickoff drift (same 30-min bucket)", () => {
    const a = importFingerprint("2026-08-15", "PL", "Arsenal", "Chelsea", "2026-08-15T16:30:00Z");
    const b = importFingerprint("2026-08-15", "PL", "arsenal", "chelsea", "2026-08-15T16:35:00Z");
    expect(a).toBe(b);
  });

  it("differs for reversed fixtures", () => {
    const a = importFingerprint("2026-08-15", "PL", "Arsenal", "Chelsea", "2026-08-15T16:30:00Z");
    const b = importFingerprint("2026-08-15", "PL", "Chelsea", "Arsenal", "2026-08-15T16:30:00Z");
    expect(a).not.toBe(b);
  });

  it("differs across a different kickoff bucket", () => {
    const a = importFingerprint("2026-08-15", "PL", "Arsenal", "Chelsea", "2026-08-15T16:30:00Z");
    const b = importFingerprint("2026-08-15", "PL", "Arsenal", "Chelsea", "2026-08-15T19:30:00Z");
    expect(a).not.toBe(b);
  });
});

describe("buildImportMatchRow", () => {
  const meta: ImportSourceMeta = {
    competitionKey: "PL",
    competitionLabel: "Premier League",
    competitionType: "club",
    apiProvider: "Football-Data",
  };

  it("maps a candidate to an upsertMatches row without any is_pick field", () => {
    const c = normalizeImportCandidate(rawCandidate());
    const row = buildImportMatchRow(c, meta);
    expect(row.match_id).toBe("101");
    expect(row.competition).toBe("PL");
    expect(row.competition_type).toBe("club");
    expect(row.match_type).toBe("club");
    expect(row.home).toBe("Arsenal");
    expect(row.start_time).toBe("2026-08-15T16:30:00Z");
    expect(row.status).toBe("SCHEDULED");
    expect(row.api_provider).toBe("Football-Data");
    // The row never carries is_pick — upsertMatches defaults it to 0 / preserves it.
    expect("is_pick" in row).toBe(false);
  });

  it("maps provider → api_provider label", () => {
    expect(apiProviderForImport("football_data")).toBe("Football-Data");
    expect(apiProviderForImport("allsports")).toBe("AllSports API");
  });
});
