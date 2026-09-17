import { describe, expect, it } from "vitest";
import {
  aggregateCandidatePreview,
  candidateFingerprint,
  dedupeCandidates,
  toCandidatePreview,
  type CandidatePreviewMatch,
  type SourceContribution,
  type SourceFetchResult,
} from "../matchSourceCandidates";
import type { MatchSourcePreviewMatch } from "../matchSourcePreview";

function candidate(over: Partial<CandidatePreviewMatch> = {}): CandidatePreviewMatch {
  return {
    preview_id: over.preview_id || "1:football_data:101",
    provider: over.provider || "football_data",
    provider_match_id: over.provider_match_id || "101",
    source_id: over.source_id ?? 1,
    source_title: over.source_title || "Premier League",
    competition_name: over.competition_name || "Premier League",
    match_mode: over.match_mode || "club",
    home_team: over.home_team || "Arsenal",
    away_team: over.away_team || "Manchester City",
    kickoff_utc: over.kickoff_utc || "2026-08-15T14:00:00Z",
    status: over.status ?? "TIMED",
    stage: over.stage ?? null,
    accepted: true,
    ...over,
  };
}

function srcResult(over: Partial<SourceFetchResult> = {}): SourceFetchResult {
  return {
    source_id: over.source_id ?? 1,
    title: over.title || "PL",
    provider: over.provider || "football_data",
    fetch_scope: over.fetch_scope || "competition",
    http_status: over.http_status ?? 200,
    duration_ms: over.duration_ms ?? 100,
    received: over.received ?? 0,
    normalized: over.normalized ?? 0,
    accepted: over.accepted ?? 0,
    rejected: over.rejected ?? 0,
    error: over.error ?? null,
    warnings: over.warnings ?? [],
    from_cache: over.from_cache ?? false,
  };
}

describe("toCandidatePreview", () => {
  it("maps an accepted preview match into a candidate with source info", () => {
    const m: MatchSourcePreviewMatch = {
      provider: "allsports",
      provider_match_id: "555",
      provider_competition_id: "8",
      provider_competition_code: null,
      competition_name: "LaLiga",
      competition_type: "club",
      match_mode: "club",
      home_team: "Barcelona",
      away_team: "Real Madrid",
      home_team_id: "1",
      away_team_id: "2",
      kickoff_utc: "2026-08-15T18:00:00Z",
      status: "notstarted",
      stage: "1",
      accepted: true,
      rejection_reasons: [],
    };
    const c = toCandidatePreview(m, { id: 9, title: "LaLiga source" });
    expect(c.preview_id).toBe("9:allsports:555");
    expect(c.source_id).toBe(9);
    expect(c.source_title).toBe("LaLiga source");
    expect(c.accepted).toBe(true);
  });
});

describe("dedupe", () => {
  it("dedupes the same match coming from two providers and folds refs", () => {
    const a = candidate({ preview_id: "1:football_data:101", provider: "football_data", provider_match_id: "101", source_id: 1, source_title: "FD PL" });
    const b = candidate({ preview_id: "2:allsports:777", provider: "allsports", provider_match_id: "777", source_id: 2, source_title: "AS PL", kickoff_utc: "2026-08-15T14:05:00Z" });
    const { canonical, deduped } = dedupeCandidates([a, b]);
    expect(canonical).toHaveLength(1);
    expect(deduped).toBe(1);
    expect(canonical[0].provider_refs).toHaveLength(2);
    expect(canonical[0].duplicate_of).toBeNull();
  });

  it("does NOT dedupe matches in a different kickoff bucket", () => {
    const a = candidate({ kickoff_utc: "2026-08-15T14:00:00Z" });
    const b = candidate({ preview_id: "x", provider_match_id: "999", kickoff_utc: "2026-08-15T19:00:00Z" });
    const { canonical, deduped } = dedupeCandidates([a, b]);
    expect(canonical).toHaveLength(2);
    expect(deduped).toBe(0);
  });

  it("does NOT dedupe reversed fixtures (home/away swapped)", () => {
    const a = candidate({ home_team: "Arsenal", away_team: "Chelsea" });
    const b = candidate({ preview_id: "y", provider_match_id: "888", home_team: "Chelsea", away_team: "Arsenal" });
    const { canonical, deduped } = dedupeCandidates([a, b]);
    expect(canonical).toHaveLength(2);
    expect(deduped).toBe(0);
  });

  it("fingerprint is stable across minor name punctuation/case", () => {
    const a = candidate({ competition_name: "Premier League", home_team: "Arsenal", away_team: "Man City" });
    const b = candidate({ competition_name: "premier  league", home_team: "ARSENAL", away_team: "man city" });
    expect(candidateFingerprint(a)).toBe(candidateFingerprint(b));
  });
});

describe("aggregateCandidatePreview", () => {
  it("merges source results and totals diagnostics", () => {
    const c1: SourceContribution = {
      result: srcResult({ source_id: 1, received: 5, normalized: 5, accepted: 2, rejected: 3 }),
      candidates: [candidate({ preview_id: "1:fd:1", provider_match_id: "1" }), candidate({ preview_id: "1:fd:2", provider_match_id: "2", home_team: "X", away_team: "Y" })],
    };
    const c2: SourceContribution = {
      result: srcResult({ source_id: 2, provider: "allsports", fetch_scope: "daily_filtered_by_league_id", received: 1, normalized: 1, accepted: 1, rejected: 0 }),
      candidates: [candidate({ preview_id: "2:as:9", provider: "allsports", provider_match_id: "9", kickoff_utc: "2026-08-15T14:05:00Z" })],
    };
    const out = aggregateCandidatePreview([c1, c2], 321);
    expect(out.diagnostics.total_received).toBe(6);
    expect(out.diagnostics.total_accepted).toBe(3);
    expect(out.diagnostics.total_rejected).toBe(3);
    expect(out.diagnostics.duration_ms).toBe(321);
    // c1[0] and c2[0] are the same fixture from two providers → deduped to 1
    expect(out.diagnostics.total_deduped).toBe(1);
    expect(out.matches).toHaveLength(2);
    expect(out.warnings.join(" ")).toContain("daily scope");
    expect(out.warnings.join(" ")).toContain("Объединено дубликатов");
  });

  it("a failing source does not break the aggregate", () => {
    const ok: SourceContribution = {
      result: srcResult({ source_id: 1, received: 1, normalized: 1, accepted: 1 }),
      candidates: [candidate({ preview_id: "1:fd:1" })],
    };
    const bad: SourceContribution = {
      result: srcResult({ source_id: 2, error: "FOOTBALL_DATA_HTTP_403" }),
      candidates: [],
    };
    const out = aggregateCandidatePreview([ok, bad], 50);
    expect(out.matches).toHaveLength(1);
    expect(out.source_results).toHaveLength(2);
    expect(out.warnings.join(" ")).toContain("Часть источников вернула ошибку");
  });

  it("warns when zero matches are produced", () => {
    const empty: SourceContribution = { result: srcResult({ received: 3, normalized: 3, accepted: 0, rejected: 3 }), candidates: [] };
    const out = aggregateCandidatePreview([empty], 10);
    expect(out.matches).toHaveLength(0);
    expect(out.warnings.join(" ")).toContain("0 подходящих матчей");
  });
});
