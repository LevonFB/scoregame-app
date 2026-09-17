// Pure helpers for source-fetch run history + preview cache policy (M7). NO I/O.
//
// Used by the admin source tooling to record diagnostics of provider fetches and to
// derive a deterministic, secret-free cache key. Nothing here publishes matches.

export type FetchRunType = "source_test" | "aggregate_preview";

export const FETCH_RUN_TYPES: FetchRunType[] = ["source_test", "aggregate_preview"];

// Safety caps so a noisy provider can never bloat a log row.
export const FETCH_RUN_WARNINGS_MAX = 20;
export const FETCH_RUN_WARNING_MAX_LEN = 400;
export const FETCH_RUN_ERROR_MAX_LEN = 800;

export const FETCH_RUNS_DEFAULT_LIMIT = 20;
export const FETCH_RUNS_MAX_LIMIT = 100;

// Preview cache TTLs (seconds). Kept short so schedule changes near kick-off surface.
export const FETCH_CACHE_TTL_SECONDS: Record<string, number> = {
  football_data: 600, // 10 min
  allsports: 780,     // 13 min (matches the existing AllSports daily cache window)
};

export function fetchCacheTtlSeconds(provider: string): number {
  return FETCH_CACHE_TTL_SECONDS[provider] ?? 600;
}

// Row as stored in D1 (integer booleans, warnings as JSON text).
export type FetchRunRow = {
  id: number;
  source_id: number | null;
  parent_run_id: number | null;
  run_type: FetchRunType;
  requested_by: string | null;
  requested_at: string;
  requested_date: string;
  match_mode: string | null;
  provider: string;
  fetch_scope: string | null;
  success: number;
  http_status: number | null;
  duration_ms: number | null;
  matches_received: number;
  matches_normalized: number;
  matches_accepted: number;
  matches_rejected: number;
  matches_deduped: number;
  from_cache: number;
  cache_key: string | null;
  error_code: string | null;
  error_message: string | null;
  warnings_json: string | null;
  created_at: string;
};

// JSON shape returned to the admin UI (booleans normalized, warnings parsed).
export type FetchRunDto = {
  id: number;
  source_id: number | null;
  parent_run_id: number | null;
  run_type: FetchRunType;
  requested_by: string | null;
  requested_at: string;
  requested_date: string;
  match_mode: string | null;
  provider: string;
  fetch_scope: string | null;
  success: boolean;
  http_status: number | null;
  duration_ms: number | null;
  matches_received: number;
  matches_normalized: number;
  matches_accepted: number;
  matches_rejected: number;
  matches_deduped: number;
  from_cache: boolean;
  cache_key: string | null;
  error_code: string | null;
  error_message: string | null;
  warnings: string[];
  created_at: string;
};

// Validated payload ready to persist (warnings already capped/sanitized upstream).
export type FetchRunInsert = {
  source_id: number | null;
  parent_run_id: number | null;
  run_type: FetchRunType;
  requested_by: string | null;
  requested_at: string;
  requested_date: string;
  match_mode: string | null;
  provider: string;
  fetch_scope: string | null;
  success: boolean;
  http_status: number | null;
  duration_ms: number | null;
  matches_received: number;
  matches_normalized: number;
  matches_accepted: number;
  matches_rejected: number;
  matches_deduped: number;
  from_cache: boolean;
  cache_key: string | null;
  error_code: string | null;
  error_message: string | null;
  warnings: string[];
};

// Cap + truncate warnings to a small, safe array. `sanitize` runs each entry through
// the provider-error sanitizer so no token/HTML can leak into a stored warning.
export function sanitizeWarnings(
  warnings: unknown,
  sanitize: (input: unknown) => string,
): string[] {
  if (!Array.isArray(warnings)) return [];
  return warnings
    .slice(0, FETCH_RUN_WARNINGS_MAX)
    .map((w) => sanitize(w).slice(0, FETCH_RUN_WARNING_MAX_LEN))
    .filter((w) => w.length > 0);
}

export function clampErrorMessage(msg: unknown): string | null {
  if (msg === null || msg === undefined) return null;
  const text = String(msg).trim();
  if (!text) return null;
  return text.slice(0, FETCH_RUN_ERROR_MAX_LEN);
}

export function serializeFetchRun(row: FetchRunRow): FetchRunDto {
  let warnings: string[] = [];
  if (row.warnings_json) {
    try {
      const parsed = JSON.parse(row.warnings_json);
      if (Array.isArray(parsed)) warnings = parsed.map((w) => String(w));
    } catch {
      warnings = [];
    }
  }
  return {
    id: Number(row.id),
    source_id: row.source_id ?? null,
    parent_run_id: row.parent_run_id ?? null,
    run_type: row.run_type,
    requested_by: row.requested_by ?? null,
    requested_at: String(row.requested_at),
    requested_date: String(row.requested_date),
    match_mode: row.match_mode ?? null,
    provider: String(row.provider),
    fetch_scope: row.fetch_scope ?? null,
    success: Number(row.success) === 1,
    http_status: row.http_status ?? null,
    duration_ms: row.duration_ms ?? null,
    matches_received: Number(row.matches_received ?? 0),
    matches_normalized: Number(row.matches_normalized ?? 0),
    matches_accepted: Number(row.matches_accepted ?? 0),
    matches_rejected: Number(row.matches_rejected ?? 0),
    matches_deduped: Number(row.matches_deduped ?? 0),
    from_cache: Number(row.from_cache) === 1,
    cache_key: row.cache_key ?? null,
    error_code: row.error_code ?? null,
    error_message: row.error_message ?? null,
    warnings,
    created_at: String(row.created_at),
  };
}

// ── List filters + pagination ────────────────────────────────────────────────

export type FetchRunFilters = {
  source_id: number | null;
  run_type: FetchRunType | null;
  provider: string | null;
  success: boolean | null;
  requested_date: string | null;
  // Only top-level runs (summaries + single tests) by default; children are nested.
  topLevelOnly: boolean;
};

export type ParsedFetchRunQuery = {
  filters: FetchRunFilters;
  page: number;
  limit: number;
};

export function parseFetchRunQuery(get: (key: string) => string | null): ParsedFetchRunQuery {
  const sourceIdRaw = get("source_id");
  const sourceId = sourceIdRaw && /^\d+$/.test(sourceIdRaw) ? Number(sourceIdRaw) : null;

  const runTypeRaw = get("run_type");
  const runType = runTypeRaw && (FETCH_RUN_TYPES as string[]).includes(runTypeRaw) ? (runTypeRaw as FetchRunType) : null;

  const providerRaw = (get("provider") || "").trim();
  const provider = providerRaw === "football_data" || providerRaw === "allsports" ? providerRaw : null;

  const successRaw = get("success");
  const success = successRaw === "true" || successRaw === "1" ? true
    : successRaw === "false" || successRaw === "0" ? false
    : null;

  const dateRaw = (get("requested_date") || "").trim();
  const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;

  const pageRaw = get("page");
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Number(pageRaw)) : 1;

  const limitRaw = get("limit");
  let limit = limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : FETCH_RUNS_DEFAULT_LIMIT;
  limit = Math.min(FETCH_RUNS_MAX_LIMIT, Math.max(1, limit));

  return {
    filters: { source_id: sourceId, run_type: runType, provider, success, requested_date: requestedDate, topLevelOnly: true },
    page,
    limit,
  };
}

// Build a parameterised WHERE clause (bind params only — no string interpolation).
export function buildFetchRunWhere(filters: FetchRunFilters): { sql: string; binds: any[] } {
  const clauses: string[] = [];
  const binds: any[] = [];
  if (filters.topLevelOnly) clauses.push("parent_run_id IS NULL");
  if (filters.source_id !== null) { clauses.push("source_id = ?"); binds.push(filters.source_id); }
  if (filters.run_type !== null) { clauses.push("run_type = ?"); binds.push(filters.run_type); }
  if (filters.provider !== null) { clauses.push("provider = ?"); binds.push(filters.provider); }
  if (filters.success !== null) { clauses.push("success = ?"); binds.push(filters.success ? 1 : 0); }
  if (filters.requested_date !== null) { clauses.push("requested_date = ?"); binds.push(filters.requested_date); }
  const sql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { sql, binds };
}

export function paginationMeta(total: number, page: number, limit: number) {
  return { page, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 0 };
}

// ── Preview cache key (deterministic, secret-free) ───────────────────────────

// The cache identity is purely the provider FETCH identity. include_friendlies /
// match_mode are applied AFTER fetch (in the normalizer), so they are intentionally
// not part of the key — an AllSports daily fetch is shared across modes/sources.
// AllSports always fetches the whole day → competition slot is the literal "daily".
export function buildFetchCacheKey(params: { provider: string; competition: string; date: string }): string {
  const competition = params.provider === "allsports" ? "daily" : params.competition;
  return [
    "match-source-preview",
    "v1",
    params.provider,
    competition.toLowerCase(),
    params.date,
  ].join(":");
}

// Synthetic URL used as the Cloudflare Cache API key. Never hits the network.
export function fetchCacheRequestUrl(cacheKey: string): string {
  return `https://match-source-cache.internal/${encodeURIComponent(cacheKey)}`;
}

// The only thing we ever cache: normalized provider events + the http status.
// Contains NO tokens, NO auth headers, NO raw URL — just match event objects.
export function buildFetchCachePayload(events: any[], httpStatus: number): { events: any[]; httpStatus: number } {
  return { events: Array.isArray(events) ? events : [], httpStatus };
}
