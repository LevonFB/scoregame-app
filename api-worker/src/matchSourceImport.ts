// Pure helpers for importing selected preview candidates into the day's candidate
// pool as ordinary (is_pick = 0) matches (M5). NO I/O, NO D1.
//
// The admin endpoint validates each payload here, resolves the source + catalog
// metadata, then persists via the existing safe `upsertMatches` (which defaults
// is_pick = 0 on insert and PRESERVES is_pick/pick_mode on conflict). Nothing here
// publishes, selects Top-3, touches top3_overrides, or sets is_pick = 1.

export const MAX_IMPORT_CANDIDATES = 3;

export type ImportProvider = "football_data" | "allsports";
export type ImportMode = "club" | "national";

// Statuses we accept from a preview candidate. Anything else is rejected so junk
// can't be written into the matches table.
const SAFE_IMPORT_STATUSES = new Set([
  "SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "POSTPONED", "SUSPENDED", "CANCELLED", "FINISHED", "AWARDED",
]);

export type NormalizedImportCandidate = {
  preview_id: string;
  provider: ImportProvider;
  provider_match_id: string;
  source_id: number;
  competition_name: string;
  match_mode: ImportMode;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  status: string;
  stage: string | null;
};

// Catalog/source metadata resolved server-side (never trusted from the client).
export type ImportSourceMeta = {
  competitionKey: string;
  competitionLabel: string;
  competitionType: "club" | "national_team";
  apiProvider: string;
};

// Row shape consumed by upsertMatches.
export type ImportMatchRow = {
  match_id: string;
  competition: string;
  competition_type: "club" | "national_team";
  match_type: "club" | "national_team";
  display_comp_label: string;
  home: string;
  away: string;
  home_crest: string;
  away_crest: string;
  start_time: string;
  status: string;
  api_provider: string;
};

/**
 * Validate + normalize a single raw candidate from the request body. Pure.
 * Throws Error(code) on the first invalid field. `is_pick` from the client is
 * intentionally never read here — publication is manual-only via Apply Selection.
 *
 * Codes: INVALID_PROVIDER, PROVIDER_MATCH_ID_REQUIRED, INVALID_SOURCE_ID,
 *        INVALID_MATCH_MODE, EMPTY_TEAMS, INVALID_KICKOFF, INVALID_STATUS
 */
export function normalizeImportCandidate(raw: any): NormalizedImportCandidate {
  const provider = String(raw?.provider ?? "");
  if (provider !== "football_data" && provider !== "allsports") throw new Error("INVALID_PROVIDER");

  const provider_match_id = String(raw?.provider_match_id ?? "").trim();
  if (!provider_match_id) throw new Error("PROVIDER_MATCH_ID_REQUIRED");

  const source_id = Number(raw?.source_id);
  if (!Number.isInteger(source_id) || source_id <= 0) throw new Error("INVALID_SOURCE_ID");

  const match_mode = String(raw?.match_mode ?? "");
  if (match_mode !== "club" && match_mode !== "national") throw new Error("INVALID_MATCH_MODE");

  const home_team = String(raw?.home_team ?? "").trim();
  const away_team = String(raw?.away_team ?? "").trim();
  if (!home_team || !away_team) throw new Error("EMPTY_TEAMS");

  const kickoff_utc = String(raw?.kickoff_utc ?? "").trim();
  if (!kickoff_utc || Number.isNaN(Date.parse(kickoff_utc))) throw new Error("INVALID_KICKOFF");

  let status = String(raw?.status ?? "SCHEDULED").trim().toUpperCase();
  if (!status) status = "SCHEDULED";
  if (!SAFE_IMPORT_STATUSES.has(status)) throw new Error("INVALID_STATUS");

  const stageRaw = raw?.stage;
  const stage = stageRaw === undefined || stageRaw === null || String(stageRaw).trim() === "" ? null : String(stageRaw).trim();

  return {
    preview_id: String(raw?.preview_id ?? "").trim(),
    provider,
    provider_match_id,
    source_id,
    competition_name: String(raw?.competition_name ?? "").trim(),
    match_mode,
    home_team,
    away_team,
    kickoff_utc,
    status,
    stage,
  };
}

const FINGERPRINT_BUCKET_MS = 30 * 60 * 1000;

function normalizeFp(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/['’`"]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function kickoffBucket(iso: string): string {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "na";
  return String(Math.floor(t / FINGERPRINT_BUCKET_MS));
}

/**
 * Fallback fingerprint for detecting an already-stored fixture that arrived under
 * a different provider id: day | competition | home | away | kickoff bucket.
 * Team order is preserved (reversed fixtures are distinct), matching production dedupe.
 */
export function importFingerprint(day: string, competition: unknown, home: unknown, away: unknown, kickoffIso: string): string {
  return [day, normalizeFp(competition), normalizeFp(home), normalizeFp(away), kickoffBucket(kickoffIso)].join("|");
}

// Build the upsertMatches row from a validated candidate + server-resolved meta. Pure.
export function buildImportMatchRow(c: NormalizedImportCandidate, meta: ImportSourceMeta): ImportMatchRow {
  return {
    match_id: c.provider_match_id,
    competition: meta.competitionKey,
    competition_type: meta.competitionType,
    match_type: meta.competitionType,
    display_comp_label: meta.competitionLabel,
    home: c.home_team,
    away: c.away_team,
    home_crest: "",
    away_crest: "",
    start_time: c.kickoff_utc,
    status: c.status,
    api_provider: meta.apiProvider,
  };
}

export function apiProviderForImport(provider: ImportProvider): string {
  return provider === "football_data" ? "Football-Data" : "AllSports API";
}
