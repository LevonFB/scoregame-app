// Pure helpers + types for the manual tournament-source catalog (M2). No I/O.
//
// These rules are an admin-managed list only. They are NOT consumed by the import
// flow (refreshToday / refreshAdminCandidatesFast / candidates / top3 / pickTop3 /
// AUTO) in M2 and perform no provider calls. Wiring is deferred to M3+.

export type MatchSourceProvider = "football_data" | "allsports";
export type MatchSourceMode = "club" | "national";
export type MatchSourceStatus = "enabled" | "disabled" | "test_only";

export const MATCH_SOURCE_PROVIDERS: MatchSourceProvider[] = ["football_data", "allsports"];
export const MATCH_SOURCE_MODES: MatchSourceMode[] = ["club", "national"];
export const MATCH_SOURCE_STATUSES: MatchSourceStatus[] = ["enabled", "disabled", "test_only"];

// Reasonable guardrails for the manual date window (in days). Provider validation
// itself is out of scope for M2 — this is only sanity bounds for the stored value.
export const MATCH_SOURCE_DATE_WINDOW_MIN = 0;
export const MATCH_SOURCE_DATE_WINDOW_MAX = 14;

// Shape stored in D1 (integer booleans). created_at/updated_at are ISO strings.
export type MatchSourceRuleRow = {
  id: number;
  title: string;
  provider: MatchSourceProvider;
  provider_competition_id: string | null;
  provider_competition_code: string | null;
  match_mode: MatchSourceMode;
  status: MatchSourceStatus;
  sort_order: number;
  season: string | null;
  country: string | null;
  include_friendlies: number;
  date_window_before: number;
  date_window_after: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Shape returned to the admin UI (booleans normalized, no secrets/tokens).
export type MatchSourceRuleDto = {
  id: number;
  title: string;
  provider: MatchSourceProvider;
  provider_competition_id: string | null;
  provider_competition_code: string | null;
  match_mode: MatchSourceMode;
  status: MatchSourceStatus;
  sort_order: number;
  season: string | null;
  country: string | null;
  include_friendlies: boolean;
  date_window_before: number;
  date_window_after: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Normalized, validated payload ready to persist (without timestamps/id).
export type NormalizedMatchSourceInput = {
  title: string;
  provider: MatchSourceProvider;
  provider_competition_id: string | null;
  provider_competition_code: string | null;
  match_mode: MatchSourceMode;
  status: MatchSourceStatus;
  sort_order: number;
  season: string | null;
  country: string | null;
  include_friendlies: number;
  date_window_before: number;
  date_window_after: number;
  notes: string | null;
};

export function isValidMatchSourceProvider(v: unknown): v is MatchSourceProvider {
  return typeof v === "string" && (MATCH_SOURCE_PROVIDERS as string[]).includes(v);
}

export function isValidMatchSourceMode(v: unknown): v is MatchSourceMode {
  return typeof v === "string" && (MATCH_SOURCE_MODES as string[]).includes(v);
}

export function isValidMatchSourceStatus(v: unknown): v is MatchSourceStatus {
  return typeof v === "string" && (MATCH_SOURCE_STATUSES as string[]).includes(v);
}

// Accepts true/false, 1/0, "1"/"0" → integer 0/1. Anything else → error.
function normalizeIntBool(v: unknown, errorCode: string): number {
  if (v === true || v === 1 || v === "1") return 1;
  if (v === false || v === 0 || v === "0" || v === undefined || v === null) return 0;
  throw new Error(errorCode);
}

function normalizeOptionalText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const text = String(v).trim();
  return text === "" ? null : text;
}

function normalizeDateWindow(v: unknown, errorCode: string): number {
  const n = v === undefined || v === null || v === "" ? 0 : Number(v);
  if (!Number.isInteger(n) || n < MATCH_SOURCE_DATE_WINDOW_MIN || n > MATCH_SOURCE_DATE_WINDOW_MAX) {
    throw new Error(errorCode);
  }
  return n;
}

/**
 * Validate + normalize a raw admin payload into a persistable record.
 * Throws Error(code) on the first invalid field. Pure (no I/O, no provider calls).
 *
 * Error codes (stable for the admin UI):
 *  - TITLE_REQUIRED, INVALID_PROVIDER, INVALID_MATCH_MODE, INVALID_STATUS,
 *    INVALID_SORT_ORDER, INVALID_DATE_WINDOW_BEFORE, INVALID_DATE_WINDOW_AFTER,
 *    INVALID_INCLUDE_FRIENDLIES, PROVIDER_COMPETITION_REQUIRED
 */
export function normalizeMatchSourceInput(body: any): NormalizedMatchSourceInput {
  const title = String(body?.title ?? "").trim();
  if (!title) throw new Error("TITLE_REQUIRED");

  if (!isValidMatchSourceProvider(body?.provider)) throw new Error("INVALID_PROVIDER");
  const provider = body.provider as MatchSourceProvider;

  if (!isValidMatchSourceMode(body?.match_mode)) throw new Error("INVALID_MATCH_MODE");
  const match_mode = body.match_mode as MatchSourceMode;

  if (!isValidMatchSourceStatus(body?.status)) throw new Error("INVALID_STATUS");
  const status = body.status as MatchSourceStatus;

  const sortRaw = body?.sort_order;
  const sort_order = sortRaw === undefined || sortRaw === null || sortRaw === "" ? 100 : Number(sortRaw);
  if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > 1_000_000) {
    throw new Error("INVALID_SORT_ORDER");
  }

  const provider_competition_id = normalizeOptionalText(body?.provider_competition_id);
  const provider_competition_code = normalizeOptionalText(body?.provider_competition_code);

  // Provider identity requirements (no real provider validation in M2):
  //  - football_data identifies competitions by code (e.g. "PL") or numeric id.
  //  - allsports identifies leagues strictly by numeric league_id.
  if (provider === "football_data" && !provider_competition_code && !provider_competition_id) {
    throw new Error("PROVIDER_COMPETITION_REQUIRED");
  }
  if (provider === "allsports" && !provider_competition_id) {
    throw new Error("PROVIDER_COMPETITION_REQUIRED");
  }

  const include_friendlies = normalizeIntBool(body?.include_friendlies, "INVALID_INCLUDE_FRIENDLIES");
  const date_window_before = normalizeDateWindow(body?.date_window_before, "INVALID_DATE_WINDOW_BEFORE");
  const date_window_after = normalizeDateWindow(body?.date_window_after, "INVALID_DATE_WINDOW_AFTER");

  return {
    title,
    provider,
    provider_competition_id,
    provider_competition_code,
    match_mode,
    status,
    sort_order,
    season: normalizeOptionalText(body?.season),
    country: normalizeOptionalText(body?.country),
    include_friendlies,
    date_window_before,
    date_window_after,
    notes: normalizeOptionalText(body?.notes),
  };
}

// Convert a D1 row (integer booleans) → JSON DTO (real booleans, no secrets).
export function serializeMatchSourceRule(row: MatchSourceRuleRow): MatchSourceRuleDto {
  return {
    id: Number(row.id),
    title: String(row.title),
    provider: row.provider,
    provider_competition_id: row.provider_competition_id ?? null,
    provider_competition_code: row.provider_competition_code ?? null,
    match_mode: row.match_mode,
    status: row.status,
    sort_order: Number(row.sort_order ?? 0),
    season: row.season ?? null,
    country: row.country ?? null,
    include_friendlies: Number(row.include_friendlies) === 1,
    date_window_before: Number(row.date_window_before ?? 0),
    date_window_after: Number(row.date_window_after ?? 0),
    notes: row.notes ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
