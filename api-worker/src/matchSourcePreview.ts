// Pure helpers for the manual "test source" preview (M3). NO I/O, NO D1.
//
// The admin endpoint performs the (read-only) provider fetch and hands the raw
// provider payload to these pure functions. They normalize, classify against the
// stored source rule (club/national + friendlies) and produce a diagnostics-only
// preview. They never touch the matches table, candidate pool, top3, AUTO, or any
// other game data — they only transform in-memory data.

export type PreviewProvider = "football_data" | "allsports";
export type PreviewMode = "club" | "national";

// Unified preview shape returned to the admin UI.
export type MatchSourcePreviewMatch = {
  provider: PreviewProvider;
  provider_match_id: string;
  provider_competition_id: string | null;
  provider_competition_code: string | null;

  competition_name: string;
  competition_type: string | null; // "club" | "national_team" | null (unknown)
  match_mode: PreviewMode; // mode the source rule is configured for

  home_team: string;
  away_team: string;
  home_team_id: string | null;
  away_team_id: string | null;

  kickoff_utc: string;
  status: string | null;
  stage: string | null;

  accepted: boolean;
  rejection_reasons: string[];
};

// Catalog metadata a classifier can resolve (or null when unknown).
export type PreviewCompetitionMeta = {
  key: string;
  displayName: string;
  competitionType: "club" | "national_team";
} | null;

// Production catalog logic is injected so this module stays pure and avoids a
// circular import with index.ts. The endpoint passes thin wrappers around the
// existing resolveCompetitionCatalogFor* / containsAllSportsGarbageLabel helpers.
export type PreviewClassifiers = {
  classifyFootballData: (rawCode: string, rawName: string) => PreviewCompetitionMeta;
  classifyAllSports: (leagueName: string, countryName: string) => PreviewCompetitionMeta;
  isGarbageLabel: (...values: string[]) => boolean;
};

// Minimal slice of a source rule needed for the preview.
export type SourceRuleForPreview = {
  provider: PreviewProvider;
  provider_competition_id: string | null;
  provider_competition_code: string | null;
  match_mode: PreviewMode;
  include_friendlies: boolean;
};

export type PreviewBuildResult = {
  matches: MatchSourcePreviewMatch[];
  received: number;
  normalized: number;
  accepted: number;
  rejected: number;
  warnings: string[];
  // AllSports only: total daily events before the league_id filter (honesty).
  daily_events_total?: number;
};

const FRIENDLY_NAME_RE = /friendl/i;

function expectedCompetitionType(mode: PreviewMode): "club" | "national_team" {
  return mode === "national" ? "national_team" : "club";
}

function modeMismatchReason(mode: PreviewMode): string {
  return mode === "national"
    ? "Источник настроен как «Сборные», но событие классифицировано как клубное"
    : "Источник настроен как «Клубы», но событие классифицировано как сборные";
}

function isFriendlyCompetition(meta: PreviewCompetitionMeta, leagueName: string): boolean {
  return meta?.key === "FI" || FRIENDLY_NAME_RE.test(leagueName || "");
}

// Evaluate a single normalized candidate against the source rule. Pure.
function evaluateAgainstRule(params: {
  competitionType: "club" | "national_team" | null;
  leagueName: string;
  rule: SourceRuleForPreview;
  isGarbage: boolean;
  meta: PreviewCompetitionMeta;
}): string[] {
  const reasons: string[] = [];
  const expected = expectedCompetitionType(params.rule.match_mode);

  if (params.isGarbage) {
    reasons.push("Молодёжный / женский / резервный турнир отклонён фильтром");
  }
  // Only flag a mismatch when the type is known; unknown stays accepted with no claim.
  if (params.competitionType && params.competitionType !== expected) {
    reasons.push(modeMismatchReason(params.rule.match_mode));
  }
  if (isFriendlyCompetition(params.meta, params.leagueName) && !params.rule.include_friendlies) {
    reasons.push("Товарищеский матч отклонён (include_friendlies = false)");
  }
  return reasons;
}

function countAndWarn(matches: MatchSourcePreviewMatch[]): { accepted: number; rejected: number; warnings: string[] } {
  let accepted = 0;
  let rejected = 0;
  let mismatches = 0;
  for (const m of matches) {
    if (m.accepted) accepted++;
    else rejected++;
    if (m.rejection_reasons.some((r) => r.includes("классифицировано"))) mismatches++;
  }
  const warnings: string[] = [];
  if (mismatches > 0) {
    warnings.push(`Обнаружено несоответствие club/national: ${mismatches}. Источник не изменён автоматически.`);
  }
  return { accepted, rejected, warnings };
}

// ── Football-Data ───────────────────────────────────────────────────────────
// rawMatches = items from /v4/competitions/{id|code}/matches (already scoped to
// the requested competition by the endpoint).
export function buildFootballDataPreview(
  rawMatches: any[],
  rule: SourceRuleForPreview,
  deps: PreviewClassifiers,
): PreviewBuildResult {
  const list = Array.isArray(rawMatches) ? rawMatches : [];
  const matches: MatchSourcePreviewMatch[] = list.map((m) => {
    const rawCode = String(m?.competition?.code || "");
    const rawName = String(m?.competition?.name || "");
    const meta = deps.classifyFootballData(rawCode, rawName);
    const competitionType = meta?.competitionType ?? null;
    const leagueName = meta?.displayName || rawName || rawCode || "Unknown competition";
    const homeName = String(m?.homeTeam?.name ?? "");
    const awayName = String(m?.awayTeam?.name ?? "");
    const isGarbage = deps.isGarbageLabel(rawName, homeName, awayName);

    const rejection_reasons = evaluateAgainstRule({ competitionType, leagueName, rule, isGarbage, meta });

    return {
      provider: "football_data",
      provider_match_id: String(m?.id ?? ""),
      provider_competition_id: m?.competition?.id != null ? String(m.competition.id) : (rule.provider_competition_id ?? null),
      provider_competition_code: rawCode || rule.provider_competition_code || null,
      competition_name: leagueName,
      competition_type: competitionType,
      match_mode: rule.match_mode,
      home_team: homeName || "Home",
      away_team: awayName || "Away",
      home_team_id: m?.homeTeam?.id != null ? String(m.homeTeam.id) : null,
      away_team_id: m?.awayTeam?.id != null ? String(m.awayTeam.id) : null,
      kickoff_utc: String(m?.utcDate ?? ""),
      status: m?.status != null ? String(m.status) : null,
      stage: m?.stage != null ? String(m.stage) : null,
      accepted: rejection_reasons.length === 0,
      rejection_reasons,
    };
  });

  const { accepted, rejected, warnings } = countAndWarn(matches);
  return { matches, received: list.length, normalized: matches.length, accepted, rejected, warnings };
}

// ── AllSports ───────────────────────────────────────────────────────────────
// rawEvents = items from the daily endpoint. The integration only exposes a daily
// endpoint, so we filter in memory by league_id and report the honest scope.
export function allSportsEventLeagueId(e: any): string {
  return String(e?.tournament?.uniqueTournament?.id ?? e?.tournament?.id ?? "");
}

export function buildAllSportsPreview(
  rawEvents: any[],
  rule: SourceRuleForPreview,
  day: string,
  deps: PreviewClassifiers,
): PreviewBuildResult {
  const all = Array.isArray(rawEvents) ? rawEvents : [];
  const leagueId = String(rule.provider_competition_id || "").trim();
  const filtered = leagueId ? all.filter((e) => allSportsEventLeagueId(e) === leagueId) : [];

  const matches: MatchSourcePreviewMatch[] = filtered.map((e) => {
    const leagueName = String(e?.tournament?.uniqueTournament?.name || e?.tournament?.name || "");
    const countryRaw = String(e?.tournament?.category?.name || "");
    const roundName = String(e?.roundInfo?.round || e?.roundInfo?.name || "");
    const homeName = String(e?.homeTeam?.name || "");
    const awayName = String(e?.awayTeam?.name || "");
    const meta = deps.classifyAllSports(leagueName, countryRaw);
    const competitionType = meta?.competitionType ?? null;
    const isGarbage = deps.isGarbageLabel(leagueName, countryRaw, roundName, homeName, awayName);

    const reasons = evaluateAgainstRule({ competitionType, leagueName, rule, isGarbage, meta });

    // Date sanity (UTC). The daily endpoint can include events that roll into the
    // adjacent day; surface that as a rejection rather than silently dropping it.
    const ts = Number(e?.startTimestamp);
    let kickoff = "";
    if (Number.isFinite(ts) && ts > 0) {
      const dObj = new Date(ts * 1000);
      kickoff = dObj.toISOString();
      const isoDate = `${dObj.getUTCFullYear()}-${String(dObj.getUTCMonth() + 1).padStart(2, "0")}-${String(dObj.getUTCDate()).padStart(2, "0")}`;
      if (isoDate !== day) reasons.push("Матч не входит в выбранную дату (UTC)");
    }

    const stType = String(e?.status?.type || "");
    const stDesc = String(e?.status?.description || "");
    const status = stType ? (stDesc ? `${stType} (${stDesc})` : stType) : (stDesc || null);

    return {
      provider: "allsports",
      provider_match_id: String(e?.id ?? ""),
      provider_competition_id: leagueId || null,
      provider_competition_code: rule.provider_competition_code || null,
      competition_name: meta?.displayName || leagueName || "Unknown competition",
      competition_type: competitionType,
      match_mode: rule.match_mode,
      home_team: homeName || "Home",
      away_team: awayName || "Away",
      home_team_id: e?.homeTeam?.id != null ? String(e.homeTeam.id) : null,
      away_team_id: e?.awayTeam?.id != null ? String(e.awayTeam.id) : null,
      kickoff_utc: kickoff,
      status,
      stage: roundName || null,
      accepted: reasons.length === 0,
      rejection_reasons: reasons,
    };
  });

  const { accepted, rejected, warnings } = countAndWarn(matches);
  warnings.push("Запрошен весь день и отфильтрован по league_id (daily_filtered_by_league_id).");
  return {
    matches,
    received: filtered.length,
    normalized: matches.length,
    accepted,
    rejected,
    warnings,
    daily_events_total: all.length,
  };
}

// Strip any provider token / API key / raw HTML from an error string and keep it
// short. Used so admin-facing provider errors never leak secrets.
export function sanitizeProviderErrorMessage(input: unknown): string {
  let text = String((input as any)?.message ?? input ?? "").trim();
  if (!text) return "Provider error";
  // Drop anything that looks like a header/token assignment.
  text = text.replace(/(x-rapidapi-key|x-auth-token|authorization|api[_-]?key|token)\s*[:=]\s*\S+/gi, "$1: [redacted]");
  // Drop long hex/base64-ish secrets.
  text = text.replace(/\b[A-Fa-f0-9]{24,}\b/g, "[redacted]");
  // Strip HTML tags (provider error pages).
  text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 200);
}
