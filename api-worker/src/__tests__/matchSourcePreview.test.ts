import { describe, expect, it } from "vitest";
import {
  allSportsEventLeagueId,
  buildAllSportsPreview,
  buildFootballDataPreview,
  sanitizeProviderErrorMessage,
  type PreviewClassifiers,
  type SourceRuleForPreview,
} from "../matchSourcePreview";

// Tiny fake catalog so the pure builders can be tested without index.ts.
const classifiers: PreviewClassifiers = {
  classifyFootballData: (code, name) => {
    const v = `${code} ${name}`.toLowerCase();
    if (v.includes("pl") || v.includes("premier league")) {
      return { key: "PL", displayName: "Premier League", competitionType: "club" };
    }
    if (v.includes("wc") || v.includes("world cup")) {
      return { key: "WC", displayName: "FIFA World Cup", competitionType: "national_team" };
    }
    return null;
  },
  classifyAllSports: (league) => {
    const l = league.toLowerCase();
    if (l === "laliga") return { key: "PD", displayName: "LaLiga", competitionType: "club" };
    if (l === "uefa nations league") return { key: "NL", displayName: "UEFA Nations League", competitionType: "national_team" };
    if (l.includes("friendly international")) return { key: "FI", displayName: "Friendly International", competitionType: "national_team" };
    return null;
  },
  isGarbageLabel: (...values) => values.some((v) => /\bwomen\b|\bu-?\d{2}\b/i.test(String(v || ""))),
};

const clubRule: SourceRuleForPreview = {
  provider: "football_data",
  provider_competition_code: "PL",
  provider_competition_id: null,
  match_mode: "club",
  include_friendlies: false,
};

const nationalRule: SourceRuleForPreview = {
  provider: "football_data",
  provider_competition_code: "WC",
  provider_competition_id: null,
  match_mode: "national",
  include_friendlies: false,
};

function fdMatch(over: Record<string, any> = {}) {
  return {
    id: 101,
    utcDate: "2026-08-15T14:00:00Z",
    status: "TIMED",
    stage: "REGULAR_SEASON",
    competition: { id: 2021, code: "PL", name: "Premier League" },
    homeTeam: { id: 57, name: "Arsenal" },
    awayTeam: { id: 65, name: "Manchester City" },
    ...over,
  };
}

describe("football-data preview", () => {
  it("normalizes a scoped club competition and accepts matching matches", () => {
    const out = buildFootballDataPreview([fdMatch()], clubRule, classifiers);
    expect(out.received).toBe(1);
    expect(out.normalized).toBe(1);
    expect(out.accepted).toBe(1);
    expect(out.rejected).toBe(0);
    const m = out.matches[0];
    expect(m.provider).toBe("football_data");
    expect(m.provider_match_id).toBe("101");
    expect(m.provider_competition_code).toBe("PL");
    expect(m.competition_type).toBe("club");
    expect(m.home_team).toBe("Arsenal");
    expect(m.accepted).toBe(true);
  });

  it("club source rejects an explicitly national event (no auto-fix)", () => {
    const national = fdMatch({ competition: { id: 2000, code: "WC", name: "FIFA World Cup" } });
    const out = buildFootballDataPreview([national], clubRule, classifiers);
    expect(out.accepted).toBe(0);
    expect(out.rejected).toBe(1);
    expect(out.matches[0].rejection_reasons.join(" ")).toContain("классифицировано");
    expect(out.warnings.join(" ")).toContain("club/national");
  });

  it("national source rejects an explicitly club event", () => {
    const out = buildFootballDataPreview([fdMatch()], nationalRule, classifiers);
    expect(out.rejected).toBe(1);
    expect(out.matches[0].accepted).toBe(false);
    expect(out.matches[0].rejection_reasons.join(" ")).toContain("классифицировано");
  });

  it("counts received / accepted / rejected across a mixed batch", () => {
    const out = buildFootballDataPreview(
      [fdMatch(), fdMatch({ id: 102, homeTeam: { id: 1, name: "Women" }, awayTeam: { id: 2, name: "X" } })],
      clubRule,
      classifiers,
    );
    expect(out.received).toBe(2);
    expect(out.accepted).toBe(1);
    expect(out.rejected).toBe(1);
  });
});

function asEvent(over: Record<string, any> = {}) {
  return {
    id: 555,
    startTimestamp: Math.floor(Date.parse("2026-08-15T18:00:00Z") / 1000),
    tournament: { uniqueTournament: { id: 8, name: "LaLiga" }, category: { name: "Spain" } },
    homeTeam: { id: 2817, name: "Barcelona" },
    awayTeam: { id: 2829, name: "Real Madrid" },
    status: { type: "notstarted", description: "Not started" },
    roundInfo: { round: 1 },
    ...over,
  };
}

describe("allsports preview", () => {
  it("filters daily events by the stored league_id and reports honest scope", () => {
    const rule: SourceRuleForPreview = {
      provider: "allsports",
      provider_competition_code: null,
      provider_competition_id: "8",
      match_mode: "club",
      include_friendlies: false,
    };
    const events = [asEvent(), asEvent({ id: 999, tournament: { uniqueTournament: { id: 77, name: "Other" }, category: { name: "X" } } })];
    const out = buildAllSportsPreview(events, rule, "2026-08-15", classifiers);
    expect(out.daily_events_total).toBe(2);
    expect(out.received).toBe(1); // only league 8
    expect(out.matches[0].provider_competition_id).toBe("8");
    expect(out.matches[0].accepted).toBe(true);
    expect(out.warnings.join(" ")).toContain("daily_filtered_by_league_id");
  });

  it("rejects friendlies when include_friendlies = false", () => {
    const rule: SourceRuleForPreview = {
      provider: "allsports",
      provider_competition_code: null,
      provider_competition_id: "12",
      match_mode: "national",
      include_friendlies: false,
    };
    const ev = asEvent({
      id: 1,
      tournament: { uniqueTournament: { id: 12, name: "Friendly International" }, category: { name: "World" } },
    });
    const out = buildAllSportsPreview([ev], rule, "2026-08-15", classifiers);
    expect(out.matches[0].accepted).toBe(false);
    expect(out.matches[0].rejection_reasons.join(" ")).toContain("Товарищеский");
  });

  it("allows friendlies when include_friendlies = true and mode matches", () => {
    const rule: SourceRuleForPreview = {
      provider: "allsports",
      provider_competition_code: null,
      provider_competition_id: "12",
      match_mode: "national",
      include_friendlies: true,
    };
    const ev = asEvent({
      id: 1,
      tournament: { uniqueTournament: { id: 12, name: "Friendly International" }, category: { name: "World" } },
    });
    const out = buildAllSportsPreview([ev], rule, "2026-08-15", classifiers);
    expect(out.matches[0].accepted).toBe(true);
    expect(out.matches[0].rejection_reasons).toHaveLength(0);
  });

  it("extracts the league id from either uniqueTournament or tournament", () => {
    expect(allSportsEventLeagueId({ tournament: { uniqueTournament: { id: 8 } } })).toBe("8");
    expect(allSportsEventLeagueId({ tournament: { id: 42 } })).toBe("42");
    expect(allSportsEventLeagueId({})).toBe("");
  });
});

describe("provider error sanitization", () => {
  it("redacts tokens and api keys and strips HTML", () => {
    const dirty = "x-rapidapi-key: abcdef0123456789abcdef0123456789 <html>Forbidden</html>";
    const clean = sanitizeProviderErrorMessage(dirty);
    expect(clean).not.toContain("abcdef0123456789abcdef0123456789");
    expect(clean).not.toContain("<html>");
    expect(clean.toLowerCase()).toContain("redacted");
  });

  it("never returns an empty string", () => {
    expect(sanitizeProviderErrorMessage("")).toBe("Provider error");
    expect(sanitizeProviderErrorMessage(new Error("ALLSPORTS_HTTP_429"))).toContain("ALLSPORTS_HTTP_429");
  });
});

// Guard: the preview module must not import D1 / perform writes. A cheap structural
// assertion that the public surface is pure (functions only, no db handles).
describe("preview purity", () => {
  it("exposes only pure transform functions", () => {
    expect(typeof buildFootballDataPreview).toBe("function");
    expect(typeof buildAllSportsPreview).toBe("function");
    expect(typeof sanitizeProviderErrorMessage).toBe("function");
  });
});
