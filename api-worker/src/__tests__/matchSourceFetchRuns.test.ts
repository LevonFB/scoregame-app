import { describe, expect, it } from "vitest";
import {
  buildFetchCacheKey,
  buildFetchCachePayload,
  buildFetchRunWhere,
  clampErrorMessage,
  FETCH_RUNS_MAX_LIMIT,
  FETCH_RUN_WARNINGS_MAX,
  fetchCacheRequestUrl,
  fetchCacheTtlSeconds,
  paginationMeta,
  parseFetchRunQuery,
  sanitizeWarnings,
  serializeFetchRun,
  type FetchRunRow,
} from "../matchSourceFetchRuns";
import { sanitizeProviderErrorMessage } from "../matchSourcePreview";

function row(over: Partial<FetchRunRow> = {}): FetchRunRow {
  return {
    id: 1, source_id: 5, parent_run_id: null, run_type: "source_test",
    requested_by: "42", requested_at: "2026-06-08T10:00:00.000Z", requested_date: "2026-08-15",
    match_mode: "club", provider: "football_data", fetch_scope: "competition",
    success: 1, http_status: 200, duration_ms: 321,
    matches_received: 8, matches_normalized: 8, matches_accepted: 7, matches_rejected: 1, matches_deduped: 0,
    from_cache: 0, cache_key: "match-source-preview:v1:football_data:pl:2026-08-15",
    error_code: null, error_message: null, warnings_json: '["w1","w2"]', created_at: "2026-06-08T10:00:00.000Z",
    ...over,
  };
}

describe("serializeFetchRun", () => {
  it("normalizes integer booleans and parses warnings", () => {
    const dto = serializeFetchRun(row({ from_cache: 1, success: 0 }));
    expect(dto.from_cache).toBe(true);
    expect(dto.success).toBe(false);
    expect(dto.warnings).toEqual(["w1", "w2"]);
    expect(dto.matches_accepted).toBe(7);
  });

  it("tolerates malformed warnings_json", () => {
    expect(serializeFetchRun(row({ warnings_json: "not-json" })).warnings).toEqual([]);
    expect(serializeFetchRun(row({ warnings_json: null })).warnings).toEqual([]);
  });
});

describe("sanitizeWarnings", () => {
  it("caps count, truncates length and runs the sanitizer", () => {
    const many = Array.from({ length: 30 }, (_, i) => `warning ${i}`);
    const out = sanitizeWarnings(many, sanitizeProviderErrorMessage);
    expect(out.length).toBe(FETCH_RUN_WARNINGS_MAX);
  });

  it("strips token-like content from warnings", () => {
    const out = sanitizeWarnings(["x-rapidapi-key: abcdef0123456789abcdef0123456789"], sanitizeProviderErrorMessage);
    expect(out[0]).not.toContain("abcdef0123456789abcdef0123456789");
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeWarnings(null, sanitizeProviderErrorMessage)).toEqual([]);
    expect(sanitizeWarnings("oops", sanitizeProviderErrorMessage)).toEqual([]);
  });
});

describe("clampErrorMessage", () => {
  it("truncates and nulls empty", () => {
    expect(clampErrorMessage("")).toBeNull();
    expect(clampErrorMessage(null)).toBeNull();
    expect(clampErrorMessage("x".repeat(2000))!.length).toBe(800);
  });
});

describe("parseFetchRunQuery + buildFetchRunWhere", () => {
  const q = (obj: Record<string, string>) => parseFetchRunQuery((k) => obj[k] ?? null);

  it("defaults to page 1 / default limit / top-level only", () => {
    const { filters, page, limit } = q({});
    expect(page).toBe(1);
    expect(limit).toBeGreaterThan(0);
    expect(filters.topLevelOnly).toBe(true);
  });

  it("clamps limit to the max", () => {
    expect(q({ limit: "9999" }).limit).toBe(FETCH_RUNS_MAX_LIMIT);
    expect(q({ limit: "0" }).limit).toBe(1);
  });

  it("only accepts whitelisted filter values", () => {
    const { filters } = q({ provider: "rapidapi", run_type: "bogus", success: "maybe", requested_date: "nope", source_id: "x" });
    expect(filters.provider).toBeNull();
    expect(filters.run_type).toBeNull();
    expect(filters.success).toBeNull();
    expect(filters.requested_date).toBeNull();
    expect(filters.source_id).toBeNull();
  });

  it("builds a parameterised WHERE with binds (no interpolation)", () => {
    const { filters } = q({ provider: "allsports", success: "true", source_id: "7", requested_date: "2026-08-15", run_type: "source_test" });
    const { sql, binds } = buildFetchRunWhere(filters);
    expect(sql.startsWith("WHERE ")).toBe(true);
    expect(sql).toContain("parent_run_id IS NULL");
    expect(binds).toContain("allsports");
    expect(binds).toContain(7);
    expect(binds).toContain(1); // success → 1
    expect(binds).toContain("2026-08-15");
  });
});

describe("paginationMeta", () => {
  it("computes pages", () => {
    expect(paginationMeta(0, 1, 20)).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
    expect(paginationMeta(41, 2, 20)).toEqual({ page: 2, limit: 20, total: 41, pages: 3 });
  });
});

describe("cache key + payload", () => {
  it("same inputs → same key", () => {
    const a = buildFetchCacheKey({ provider: "football_data", competition: "PL", date: "2026-08-15" });
    const b = buildFetchCacheKey({ provider: "football_data", competition: "pl", date: "2026-08-15" });
    expect(a).toBe(b);
  });

  it("different date / provider / competition → different key", () => {
    const base = buildFetchCacheKey({ provider: "football_data", competition: "PL", date: "2026-08-15" });
    expect(base).not.toBe(buildFetchCacheKey({ provider: "football_data", competition: "PL", date: "2026-08-16" }));
    expect(base).not.toBe(buildFetchCacheKey({ provider: "football_data", competition: "SA", date: "2026-08-15" }));
    expect(base).not.toBe(buildFetchCacheKey({ provider: "allsports", competition: "PL", date: "2026-08-15" }));
  });

  it("AllSports collapses competition to a shared daily slot", () => {
    const a = buildFetchCacheKey({ provider: "allsports", competition: "302", date: "2026-08-15" });
    const b = buildFetchCacheKey({ provider: "allsports", competition: "999", date: "2026-08-15" });
    expect(a).toBe(b);
    expect(a).toContain(":daily:");
  });

  it("cache payload carries only events + httpStatus (no secrets)", () => {
    const payload = buildFetchCachePayload([{ id: 1, homeTeam: { name: "A" } }], 200);
    const json = JSON.stringify(payload);
    expect(Object.keys(payload).sort()).toEqual(["events", "httpStatus"]);
    expect(json.toLowerCase()).not.toContain("rapidapi");
    expect(json.toLowerCase()).not.toContain("auth-token");
    expect(json.toLowerCase()).not.toContain("token");
  });

  it("cache request url is deterministic and synthetic (never a provider URL)", () => {
    const url = fetchCacheRequestUrl("match-source-preview:v1:allsports:daily:2026-08-15");
    expect(url.startsWith("https://match-source-cache.internal/")).toBe(true);
    expect(url).not.toContain("football-data.org");
    expect(url).not.toContain("rapidapi");
  });

  it("TTLs are short and provider-specific", () => {
    expect(fetchCacheTtlSeconds("football_data")).toBe(600);
    expect(fetchCacheTtlSeconds("allsports")).toBe(780);
    expect(fetchCacheTtlSeconds("unknown")).toBe(600);
  });
});
