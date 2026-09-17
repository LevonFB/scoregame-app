// Pure helpers for the aggregate candidate preview across all enabled sources (M4).
// NO I/O, NO D1. The admin endpoint performs the (read-only) per-source provider
// fetches (reusing the M3 scoped fetchers + pure builders) and feeds the results
// here for merging, deduplication and diagnostics. Nothing here touches game data.

import type { MatchSourcePreviewMatch, PreviewMode } from "./matchSourcePreview";

export type CandidateProvider = "football_data" | "allsports";

export type CandidateProviderRef = {
  provider: string;
  provider_match_id: string;
  source_id: number;
  source_title: string;
};

// Unified candidate shown in the aggregate preview (accepted matches only).
export type CandidatePreviewMatch = {
  preview_id: string;
  provider: CandidateProvider;
  provider_match_id: string;
  source_id: number;
  source_title: string;

  competition_name: string;
  match_mode: PreviewMode;
  home_team: string;
  away_team: string;
  kickoff_utc: string;
  status: string | null;
  stage: string | null;

  accepted: true;
  duplicate_of?: string | null;
  provider_refs?: CandidateProviderRef[];
};

// Per-source diagnostics returned to the admin (no secrets, no raw payload).
export type SourceFetchResult = {
  source_id: number;
  title: string;
  provider: CandidateProvider;
  fetch_scope: string;
  http_status: number;
  duration_ms: number;
  received: number;
  normalized: number;
  accepted: number;
  rejected: number;
  error: string | null;
  warnings: string[];
  from_cache: boolean;
  // M7 diagnostics (not shown directly in the candidate UI; used for fetch-run logs).
  cache_key?: string | null;
  error_code?: string | null;
};

export type AggregateCandidateDiagnostics = {
  total_received: number;
  total_normalized: number;
  total_accepted: number;
  total_rejected: number;
  total_deduped: number;
  duration_ms: number;
};

export type AggregateCandidateResult = {
  source_results: SourceFetchResult[];
  matches: CandidatePreviewMatch[];
  diagnostics: AggregateCandidateDiagnostics;
  warnings: string[];
};

// One source's contribution: its diagnostics row + the accepted candidates mapped
// from it. The endpoint builds these; the aggregator merges them. Pure input.
export type SourceContribution = {
  result: SourceFetchResult;
  candidates: CandidatePreviewMatch[];
};

const KICKOFF_BUCKET_MS = 30 * 60 * 1000; // 30-minute bucket tolerates provider time drift

function normalizeForFingerprint(value: unknown): string {
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
  return String(Math.floor(t / KICKOFF_BUCKET_MS));
}

// Fingerprint: mode | competition | home | away | kickoff bucket.
// Team order is preserved on purpose — reversed fixtures are NOT treated as dupes.
export function candidateFingerprint(m: CandidatePreviewMatch): string {
  return [
    m.match_mode,
    normalizeForFingerprint(m.competition_name),
    normalizeForFingerprint(m.home_team),
    normalizeForFingerprint(m.away_team),
    kickoffBucket(m.kickoff_utc),
  ].join("|");
}

function refOf(m: CandidatePreviewMatch): CandidateProviderRef {
  return { provider: m.provider, provider_match_id: m.provider_match_id, source_id: m.source_id, source_title: m.source_title };
}

// Map an accepted M3 preview match into an aggregate candidate. Pure.
export function toCandidatePreview(
  m: MatchSourcePreviewMatch,
  source: { id: number; title: string },
): CandidatePreviewMatch {
  return {
    preview_id: `${source.id}:${m.provider}:${m.provider_match_id}`,
    provider: m.provider,
    provider_match_id: m.provider_match_id,
    source_id: source.id,
    source_title: source.title,
    competition_name: m.competition_name,
    match_mode: m.match_mode,
    home_team: m.home_team,
    away_team: m.away_team,
    kickoff_utc: m.kickoff_utc,
    status: m.status,
    stage: m.stage,
    accepted: true,
  };
}

/**
 * Deduplicate accepted candidates after merging all sources.
 * Keeps the first occurrence as canonical; folds later duplicates into
 * `provider_refs`. Returns the canonical list and the number of folded dupes.
 */
export function dedupeCandidates(matches: CandidatePreviewMatch[]): { canonical: CandidatePreviewMatch[]; deduped: number } {
  const byFingerprint = new Map<string, CandidatePreviewMatch>();
  let deduped = 0;

  for (const m of matches) {
    const fp = candidateFingerprint(m);
    const existing = byFingerprint.get(fp);
    if (!existing) {
      byFingerprint.set(fp, { ...m, duplicate_of: null, provider_refs: [refOf(m)] });
    } else {
      deduped++;
      existing.provider_refs = [...(existing.provider_refs || []), refOf(m)];
    }
  }

  return { canonical: [...byFingerprint.values()], deduped };
}

/**
 * Merge per-source contributions into the aggregate preview.
 * Pure: dedupes, totals diagnostics, and builds top-level warnings.
 * A failed source (result.error set) does not break the aggregate — its accepted
 * candidates are simply empty and it is surfaced in source_results/warnings.
 */
export function aggregateCandidatePreview(
  contributions: SourceContribution[],
  totalDurationMs: number,
): AggregateCandidateResult {
  const source_results = contributions.map((c) => c.result);
  const merged = contributions.flatMap((c) => c.candidates);
  const { canonical, deduped } = dedupeCandidates(merged);

  const diagnostics: AggregateCandidateDiagnostics = {
    total_received: source_results.reduce((a, r) => a + (r.received || 0), 0),
    total_normalized: source_results.reduce((a, r) => a + (r.normalized || 0), 0),
    total_accepted: source_results.reduce((a, r) => a + (r.accepted || 0), 0),
    total_rejected: source_results.reduce((a, r) => a + (r.rejected || 0), 0),
    total_deduped: deduped,
    duration_ms: totalDurationMs,
  };

  const warnings: string[] = [];
  const failed = source_results.filter((r) => r.error);
  if (failed.length > 0) {
    warnings.push(`Часть источников вернула ошибку: ${failed.length} из ${source_results.length}.`);
  }
  if (source_results.some((r) => r.provider === "allsports")) {
    warnings.push("AllSports использует daily scope (фильтр по league_id).");
  }
  if (diagnostics.total_rejected > 0) {
    warnings.push(`Отклонено матчей: ${diagnostics.total_rejected} (mismatch / friendlies / мусорные турниры).`);
  }
  if (deduped > 0) {
    warnings.push(`Объединено дубликатов: ${deduped}.`);
  }
  if (canonical.length === 0) {
    warnings.push("Найдено 0 подходящих матчей для выбранного режима и даты.");
  }

  return { source_results, matches: canonical, diagnostics, warnings };
}
