import { describe, expect, it } from "vitest";
import {
  isValidMatchSourceMode,
  isValidMatchSourceProvider,
  isValidMatchSourceStatus,
  normalizeMatchSourceInput,
  serializeMatchSourceRule,
  type MatchSourceRuleRow,
} from "../matchSourceRules";

const baseFootballData = {
  title: "Premier League",
  provider: "football_data",
  provider_competition_code: "PL",
  match_mode: "club",
  status: "enabled",
  sort_order: 100,
  country: "England",
  include_friendlies: false,
  date_window_before: 0,
  date_window_after: 0,
};

const baseAllsports = {
  title: "La Liga",
  provider: "allsports",
  provider_competition_id: "302",
  match_mode: "club",
  status: "test_only",
  sort_order: 50,
};

describe("match source rules — validators", () => {
  it("validates provider", () => {
    expect(isValidMatchSourceProvider("football_data")).toBe(true);
    expect(isValidMatchSourceProvider("allsports")).toBe(true);
    expect(isValidMatchSourceProvider("rapidapi")).toBe(false);
    expect(isValidMatchSourceProvider(null)).toBe(false);
  });

  it("validates match_mode", () => {
    expect(isValidMatchSourceMode("club")).toBe(true);
    expect(isValidMatchSourceMode("national")).toBe(true);
    expect(isValidMatchSourceMode("national_teams")).toBe(false);
  });

  it("validates status", () => {
    expect(isValidMatchSourceStatus("enabled")).toBe(true);
    expect(isValidMatchSourceStatus("disabled")).toBe(true);
    expect(isValidMatchSourceStatus("test_only")).toBe(true);
    expect(isValidMatchSourceStatus("paused")).toBe(false);
  });
});

describe("match source rules — normalizeMatchSourceInput", () => {
  it("accepts a valid football_data source (code-based)", () => {
    const out = normalizeMatchSourceInput(baseFootballData);
    expect(out.provider).toBe("football_data");
    expect(out.provider_competition_code).toBe("PL");
    expect(out.provider_competition_id).toBeNull();
    expect(out.match_mode).toBe("club");
    expect(out.include_friendlies).toBe(0);
  });

  it("accepts a football_data source identified by numeric id only", () => {
    const out = normalizeMatchSourceInput({
      ...baseFootballData,
      provider_competition_code: "",
      provider_competition_id: "2021",
    });
    expect(out.provider_competition_id).toBe("2021");
    expect(out.provider_competition_code).toBeNull();
  });

  it("accepts a valid allsports source", () => {
    const out = normalizeMatchSourceInput(baseAllsports);
    expect(out.provider).toBe("allsports");
    expect(out.provider_competition_id).toBe("302");
    expect(out.status).toBe("test_only");
    expect(out.sort_order).toBe(50);
  });

  it("defaults sort_order to 100 when omitted", () => {
    const out = normalizeMatchSourceInput({ ...baseFootballData, sort_order: undefined });
    expect(out.sort_order).toBe(100);
  });

  it("normalizes integer-boolean include_friendlies (1/0/true/false)", () => {
    expect(normalizeMatchSourceInput({ ...baseFootballData, include_friendlies: 1 }).include_friendlies).toBe(1);
    expect(normalizeMatchSourceInput({ ...baseFootballData, include_friendlies: "1" }).include_friendlies).toBe(1);
    expect(normalizeMatchSourceInput({ ...baseFootballData, include_friendlies: true }).include_friendlies).toBe(1);
    expect(normalizeMatchSourceInput({ ...baseFootballData, include_friendlies: false }).include_friendlies).toBe(0);
  });

  it("trims optional text and converts empty strings to null", () => {
    const out = normalizeMatchSourceInput({ ...baseFootballData, season: "  ", notes: "  hi  ", country: "" });
    expect(out.season).toBeNull();
    expect(out.country).toBeNull();
    expect(out.notes).toBe("hi");
  });

  it("rejects empty title", () => {
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, title: "   " })).toThrow("TITLE_REQUIRED");
  });

  it("rejects invalid provider", () => {
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, provider: "rapidapi" })).toThrow("INVALID_PROVIDER");
  });

  it("rejects invalid match_mode", () => {
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, match_mode: "national_teams" })).toThrow("INVALID_MATCH_MODE");
  });

  it("rejects invalid status", () => {
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, status: "paused" })).toThrow("INVALID_STATUS");
  });

  it("rejects out-of-range date windows", () => {
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, date_window_before: 20 })).toThrow("INVALID_DATE_WINDOW_BEFORE");
    expect(() => normalizeMatchSourceInput({ ...baseFootballData, date_window_after: -1 })).toThrow("INVALID_DATE_WINDOW_AFTER");
  });

  it("requires a competition code or id for football_data", () => {
    expect(() => normalizeMatchSourceInput({
      ...baseFootballData,
      provider_competition_code: "",
      provider_competition_id: "",
    })).toThrow("PROVIDER_COMPETITION_REQUIRED");
  });

  it("requires a competition id for allsports", () => {
    expect(() => normalizeMatchSourceInput({
      ...baseAllsports,
      provider_competition_id: "",
    })).toThrow("PROVIDER_COMPETITION_REQUIRED");
  });
});

describe("match source rules — serializeMatchSourceRule", () => {
  it("normalizes integer booleans to JSON booleans and never leaks unknown fields", () => {
    const row: MatchSourceRuleRow = {
      id: 7,
      title: "Serie A",
      provider: "football_data",
      provider_competition_id: null,
      provider_competition_code: "SA",
      match_mode: "club",
      status: "enabled",
      sort_order: 10,
      season: null,
      country: "Italy",
      include_friendlies: 1,
      date_window_before: 2,
      date_window_after: 3,
      notes: null,
      created_at: "2026-06-07T00:00:00.000Z",
      updated_at: "2026-06-07T00:00:00.000Z",
    };
    const dto = serializeMatchSourceRule(row);
    expect(dto.include_friendlies).toBe(true);
    expect(dto.date_window_before).toBe(2);
    expect(dto.id).toBe(7);
    expect(Object.keys(dto)).not.toContain("token");
  });
});
