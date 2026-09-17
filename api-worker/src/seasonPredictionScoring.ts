// seasonPredictionScoring.ts
// Pure scoring engine for "Топ-5 лиг" (Stage S2). No I/O, no DB, no side effects.
// Formula version: top5_v1. Awards do NOT contribute points yet (awards_points = 0),
// but awards_correct is computed for future tasks/tiebreakers.

export const TOP5_FORMULA_VERSION = "top5_v1";

// Zones that earn per-team points. `champion` is intentionally excluded — it only
// drives the separate champion bonus.
const SCORED_ZONE_KEYS = ["champions_league", "europa_league", "conference_league", "relegation", "playoff"] as const;
type ScoredZoneKey = (typeof SCORED_ZONE_KEYS)[number];

export type Top5FormulaConfig = {
  version: string;
  positionPoints: { exact: number; off1: number; off2: number };
  zonePoints: Record<ScoredZoneKey, number>;
  championBonus: number;
  uclFullBonus: number;            // all 4/4 in ЛЧ zone
  uclAlmostBonus: number;          // 3/4 in ЛЧ zone
  relegationFullBonus: number;     // whole relegation zone
  relegationPartialBonus: number;  // 2/3 or 1/2
  consistencyThreshold: number;    // teams within consistencyMaxError
  consistencyMaxError: number;
  consistencyBonus: number;
};

export const TOP5_V1_CONFIG: Top5FormulaConfig = {
  version: TOP5_FORMULA_VERSION,
  positionPoints: { exact: 5, off1: 3, off2: 1 },
  zonePoints: {
    champions_league: 3,
    europa_league: 2,
    conference_league: 2,
    relegation: 3,
    playoff: 2,
  },
  championBonus: 10,
  uclFullBonus: 10,
  uclAlmostBonus: 5,
  relegationFullBonus: 8,
  relegationPartialBonus: 4,
  consistencyThreshold: 10,
  consistencyMaxError: 2,
  consistencyBonus: 10,
};

export type ScoreEntryInput = {
  userTable: unknown;
  officialTable: unknown;
  zonesSnapshot: Record<string, unknown> | null | undefined;
  teamIdsSnapshot?: string[] | null;
  teamCount: number;
  config?: Top5FormulaConfig;
  userAwards?: unknown;
  officialAwards?: Array<{
    award_type: string;
    award_option_id?: number | null;
    player_id?: string | null;
    player_name?: string | null;
    team_name?: string | null;
  }> | null;
};

// One row of the per-award user-vs-official comparison shown in ScoreBreakdown.
// Purely informational — awards never contribute points in top5_v1.
export type AwardBreakdownItem = {
  award_type: string;
  label: string;
  user_player_id: string | null;
  user_player_name: string | null;
  user_team_name: string | null;
  official_player_id: string | null;
  official_player_name: string | null;
  official_team_name: string | null;
  official_confirmed: boolean;
  correct: boolean;
};

export type ScoreBreakdown = {
  table_points: number;
  zone_points: number;
  champion_points: number;
  bonus_points: number;
  awards_points: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  exact_positions: number;
  errors_le_1: number;
  errors_le_2: number;
  champion_correct: number;
  ucl_zone_correct: number;
  ucl_zone_full: number;
  europa_zone_correct: number;
  europa_zone_full: number;
  conference_zone_correct: number;
  conference_zone_full: number;
  relegation_zone_correct: number;
  relegation_zone_full: number;
  awards_correct: number;
  breakdown: Record<string, unknown>;
  warnings: string[];
};

type ZoneRange = [number, number];

function isRange(value: unknown): value is ZoneRange {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

// Mirrors web getLeagueZoneForPosition: non-champion zones first, champion last.
function zoneForPosition(position: number, zones: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(zones || {})) {
    if (key === "champion") continue;
    if (!isRange(value)) continue;
    if (position >= Number(value[0]) && position <= Number(value[1])) return key;
  }
  if (isRange(zones?.champion)) {
    const [from, to] = zones.champion as ZoneRange;
    if (position >= Number(from) && position <= Number(to)) return "champion";
  }
  return null;
}

// Pure re-implementation of table-id extraction (kept dependency-free).
export function extractOrderedTeamIds(tableValue: unknown): string[] {
  const t = tableValue as Record<string, unknown> | null;
  const source: unknown[] = Array.isArray(tableValue)
    ? tableValue
    : Array.isArray(t?.ordered_team_ids)
      ? (t!.ordered_team_ids as unknown[])
      : Array.isArray(t?.ordered_teams)
        ? (t!.ordered_teams as unknown[])
        : Array.isArray(t?.teams)
          ? (t!.teams as unknown[])
          : Array.isArray(t?.order)
            ? (t!.order as unknown[])
            : [];
  return source
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      const obj = item as Record<string, unknown> | null;
      return String(obj?.team_ref ?? obj?.team_id ?? obj?.teamId ?? obj?.id ?? "").trim();
    })
    .filter(Boolean);
}

function countZoneTeams(zones: Record<string, unknown>, teamCount: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let pos = 1; pos <= teamCount; pos += 1) {
    const zone = zoneForPosition(pos, zones);
    if (zone) counts[zone] = (counts[zone] || 0) + 1;
  }
  return counts;
}

export function computeMaxPossiblePoints(
  zonesSnapshot: Record<string, unknown>,
  teamCount: number,
  config: Top5FormulaConfig = TOP5_V1_CONFIG,
): number {
  const tableMax = teamCount * config.positionPoints.exact;
  const zoneCounts = countZoneTeams(zonesSnapshot, teamCount);
  let zoneMax = 0;
  for (const key of SCORED_ZONE_KEYS) {
    zoneMax += (zoneCounts[key] || 0) * config.zonePoints[key];
  }
  const championMax = config.championBonus;
  const bonusMax = config.uclFullBonus + config.relegationFullBonus + config.consistencyBonus;
  return tableMax + zoneMax + championMax + bonusMax;
}

function positionPoints(absError: number, config: Top5FormulaConfig): number {
  if (absError === 0) return config.positionPoints.exact;
  if (absError === 1) return config.positionPoints.off1;
  if (absError === 2) return config.positionPoints.off2;
  return 0;
}

function awardOptionId(value: unknown): number | null {
  const obj = value as Record<string, unknown> | null;
  const raw = obj?.award_option_id;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function awardPlayerId(value: unknown): string | null {
  const obj = value as Record<string, unknown> | null;
  const raw = obj?.player_id;
  return raw == null || raw === "" ? null : String(raw);
}

function normalizedAwardName(value: unknown): string | null {
  const obj = value as Record<string, unknown> | null;
  const player = obj?.player_name == null ? "" : String(obj.player_name);
  const team = obj?.team_name == null ? "" : String(obj.team_name);
  const normalized = `${player}|${team}`
    .trim()
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9|]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized && normalized !== "|" ? normalized : null;
}

function awardStr(value: unknown, field: string): string | null {
  const obj = value as Record<string, unknown> | null;
  const raw = obj?.[field];
  return raw == null || raw === "" ? null : String(raw);
}

// Whether a user pick matches the official award. Match chain (any hit wins):
// award_option_id → player_id → normalized "player|team" name.
function awardMatches(
  userPick: unknown,
  official: { award_option_id?: number | null; player_id?: string | null; player_name?: string | null; team_name?: string | null },
): boolean {
  if (!userPick) return false;
  const oOpt = official.award_option_id == null ? null : Number(official.award_option_id);
  const uOpt = awardOptionId(userPick);
  if (oOpt != null && uOpt != null && oOpt === uOpt) return true;
  const oPlayer = official.player_id == null ? null : String(official.player_id);
  const uPlayer = awardPlayerId(userPick);
  if (oPlayer != null && uPlayer != null && oPlayer === uPlayer) return true;
  const oName = normalizedAwardName(official);
  const uName = normalizedAwardName(userPick);
  if (oName != null && uName != null && oName === uName) return true;
  return false;
}

// User pick lookup tolerates both `top_assistant` (canonical) and legacy `top_assister`.
function userAwardPick(ua: Record<string, unknown>, canonicalKey: string): unknown {
  if (canonicalKey === "top_assistant") return ua.top_assistant ?? ua.top_assister;
  return ua[canonicalKey];
}

function computeAwardsCorrect(
  userAwards: unknown,
  officialAwards: ScoreEntryInput["officialAwards"],
): number {
  if (!officialAwards || officialAwards.length === 0) return 0;
  const ua = (userAwards && typeof userAwards === "object" && !Array.isArray(userAwards))
    ? userAwards as Record<string, unknown>
    : {};
  let correct = 0;
  for (const official of officialAwards) {
    const key = official.award_type === "top_assister" ? "top_assistant" : official.award_type;
    const userPick = userAwardPick(ua, key);
    if (awardMatches(userPick, official)) correct += 1;
  }
  return correct;
}

// Canonical award types + RU labels. Awards are informational in top5_v1.
const AWARD_DEFS: Array<{ key: string; label: string }> = [
  { key: "top_scorer", label: "Лучший бомбардир" },
  { key: "top_assistant", label: "Лучший ассистент" },
  { key: "golden_glove", label: "Золотая перчатка" },
];

// Build the per-award user-vs-official comparison for breakdown_json. Adds NO
// points. Includes a row when the user picked OR an official award exists, so the
// UI can show "Угадано / Мимо / Не выбрано / Итог не подтверждён".
export function buildAwardsBreakdown(
  userAwards: unknown,
  officialAwards: ScoreEntryInput["officialAwards"],
): AwardBreakdownItem[] {
  const ua = (userAwards && typeof userAwards === "object" && !Array.isArray(userAwards))
    ? userAwards as Record<string, unknown>
    : {};
  const officialByCanon = new Map<string, NonNullable<ScoreEntryInput["officialAwards"]>[number]>();
  for (const o of officialAwards || []) {
    const canon = o.award_type === "top_assister" ? "top_assistant" : o.award_type;
    if (!officialByCanon.has(canon)) officialByCanon.set(canon, o);
  }

  const items: AwardBreakdownItem[] = [];
  for (const def of AWARD_DEFS) {
    const userPick = userAwardPick(ua, def.key);
    const official = officialByCanon.get(def.key) || null;
    if (!userPick && !official) continue;
    items.push({
      award_type: def.key,
      label: def.label,
      user_player_id: userPick ? awardStr(userPick, "player_id") : null,
      user_player_name: userPick ? awardStr(userPick, "player_name") : null,
      user_team_name: userPick ? awardStr(userPick, "team_name") : null,
      official_player_id: official ? (official.player_id == null ? null : String(official.player_id)) : null,
      official_player_name: official ? (official.player_name ?? null) : null,
      official_team_name: official ? (official.team_name ?? null) : null,
      official_confirmed: !!official,
      correct: userPick && official ? awardMatches(userPick, official) : false,
    });
  }
  return items;
}

/**
 * Score a single top-league entry. Throws only on critical official-side problems
 * (empty official table); user-side problems (missing/duplicate teams) degrade
 * gracefully with warnings so a recalc never crashes on one bad entry.
 */
export function scoreSeasonPredictionTopLeagueEntry(input: ScoreEntryInput): ScoreBreakdown {
  const config = input.config || TOP5_V1_CONFIG;
  const zones = (input.zonesSnapshot && typeof input.zonesSnapshot === "object") ? input.zonesSnapshot : {};
  const warnings: string[] = [];

  const officialIds = extractOrderedTeamIds(input.officialTable);
  if (officialIds.length === 0) {
    throw new Error("OFFICIAL_TABLE_EMPTY");
  }
  const teamCount = input.teamCount > 0 ? input.teamCount : officialIds.length;
  if (officialIds.length !== teamCount) {
    warnings.push(`OFFICIAL_TABLE_INCOMPLETE: ${officialIds.length}/${teamCount}`);
  }

  // Snapshot mismatch is non-fatal — we still score against the official table.
  if (input.teamIdsSnapshot && input.teamIdsSnapshot.length > 0) {
    const snapSet = new Set(input.teamIdsSnapshot.map(String));
    const offSet = new Set(officialIds);
    const mismatch = officialIds.some((id) => !snapSet.has(id)) || input.teamIdsSnapshot.some((id) => !offSet.has(String(id)));
    if (mismatch) warnings.push("TEAM_IDS_SNAPSHOT_MISMATCH");
  }

  const officialPos = new Map<string, number>();
  officialIds.forEach((id, idx) => { if (!officialPos.has(id)) officialPos.set(id, idx + 1); });

  // User positions — dedupe (keep first), warn on duplicates / unknown teams.
  const rawUserIds = extractOrderedTeamIds(input.userTable);
  const userPos = new Map<string, number>();
  let duplicateCount = 0;
  rawUserIds.forEach((id, idx) => {
    if (userPos.has(id)) { duplicateCount += 1; return; }
    userPos.set(id, idx + 1);
  });
  if (duplicateCount > 0) warnings.push(`USER_TABLE_DUPLICATES: ${duplicateCount}`);
  if (rawUserIds.length === 0) warnings.push("USER_TABLE_EMPTY");
  const unknownUserTeams = [...userPos.keys()].filter((id) => !officialPos.has(id)).length;
  if (unknownUserTeams > 0) warnings.push(`USER_TEAMS_NOT_IN_OFFICIAL: ${unknownUserTeams}`);

  // Official champion: team in champion range, else official position 1.
  let championTeamId: string | null = null;
  for (const [id, pos] of officialPos.entries()) {
    const z = isRange(zones.champion) && pos >= Number((zones.champion as ZoneRange)[0]) && pos <= Number((zones.champion as ZoneRange)[1]);
    if (z) { championTeamId = id; break; }
  }
  if (!championTeamId) {
    for (const [id, pos] of officialPos.entries()) { if (pos === 1) { championTeamId = id; break; } }
  }

  let tablePoints = 0;
  let zonePoints = 0;
  let exactPositions = 0;
  let errorsLe1 = 0;
  let errorsLe2 = 0;
  let uclCorrect = 0;
  let relegationCorrect = 0;
  let uclTotal = 0;
  let relegationTotal = 0;
  let europaCorrect = 0;
  let europaTotal = 0;
  let conferenceCorrect = 0;
  let conferenceTotal = 0;

  const teamBreakdown: Array<Record<string, unknown>> = [];

  for (const [teamId, oPos] of officialPos.entries()) {
    const officialZone = zoneForPosition(oPos, zones);
    if (officialZone === "champions_league") uclTotal += 1;
    if (officialZone === "europa_league") europaTotal += 1;
    if (officialZone === "conference_league") conferenceTotal += 1;
    if (officialZone === "relegation") relegationTotal += 1;

    const uPos = userPos.get(teamId);
    if (uPos === undefined) {
      teamBreakdown.push({ team_id: teamId, pos_official: oPos, pos_user: null, error: null, position_points: 0, zone_official: officialZone, zone_match: false, zone_points: 0, missing: true });
      continue;
    }
    const absError = Math.abs(uPos - oPos);
    const pPoints = positionPoints(absError, config);
    tablePoints += pPoints;
    if (absError === 0) exactPositions += 1;
    if (absError <= 1) errorsLe1 += 1;
    if (absError <= 2) errorsLe2 += 1;

    // Zone credit: official zone is a scored zone AND user placed team in same zone.
    let zPoints = 0;
    let zoneMatch = false;
    if (officialZone && (SCORED_ZONE_KEYS as readonly string[]).includes(officialZone)) {
      const userZone = zoneForPosition(uPos, zones);
      if (userZone === officialZone) {
        zoneMatch = true;
        zPoints = config.zonePoints[officialZone as ScoredZoneKey];
        zonePoints += zPoints;
        if (officialZone === "champions_league") uclCorrect += 1;
        if (officialZone === "europa_league") europaCorrect += 1;
        if (officialZone === "conference_league") conferenceCorrect += 1;
        if (officialZone === "relegation") relegationCorrect += 1;
      }
    }

    teamBreakdown.push({
      team_id: teamId, pos_official: oPos, pos_user: uPos, error: absError,
      position_points: pPoints, zone_official: officialZone, zone_match: zoneMatch, zone_points: zPoints,
    });
  }

  // Champion bonus.
  let championPoints = 0;
  let championCorrect = 0;
  if (championTeamId && userPos.get(championTeamId) === 1) {
    championPoints = config.championBonus;
    championCorrect = 1;
  }

  // Zone bonuses.
  const bonuses: Array<Record<string, unknown>> = [];
  let bonusPoints = 0;
  let uclZoneFull = 0;
  let relegationZoneFull = 0;

  if (uclTotal > 0) {
    if (uclCorrect === uclTotal) {
      bonusPoints += config.uclFullBonus; uclZoneFull = 1;
      bonuses.push({ key: "ucl_zone_full", matched: uclCorrect, total: uclTotal, points: config.uclFullBonus });
    } else if (uclTotal - uclCorrect === 1 && uclCorrect >= 3) {
      bonusPoints += config.uclAlmostBonus;
      bonuses.push({ key: "ucl_zone_almost", matched: uclCorrect, total: uclTotal, points: config.uclAlmostBonus });
    }
  }

  if (relegationTotal > 0) {
    if (relegationCorrect === relegationTotal) {
      bonusPoints += config.relegationFullBonus; relegationZoneFull = 1;
      bonuses.push({ key: "relegation_zone_full", matched: relegationCorrect, total: relegationTotal, points: config.relegationFullBonus });
    } else if ((relegationTotal === 3 && relegationCorrect === 2) || (relegationTotal === 2 && relegationCorrect === 1)) {
      bonusPoints += config.relegationPartialBonus;
      bonuses.push({ key: "relegation_zone_partial", matched: relegationCorrect, total: relegationTotal, points: config.relegationPartialBonus });
    }
  }

  if (errorsLe2 >= config.consistencyThreshold) {
    bonusPoints += config.consistencyBonus;
    bonuses.push({ key: "consistency_le2", matched: errorsLe2, points: config.consistencyBonus });
  }

  const awardsCorrect = computeAwardsCorrect(input.userAwards, input.officialAwards);
  const awardsPoints = 0; // top5_v1: awards never contribute points.
  const awardsDetail = buildAwardsBreakdown(input.userAwards, input.officialAwards);

  const totalPoints = tablePoints + zonePoints + championPoints + bonusPoints + awardsPoints;
  const maxPossible = computeMaxPossiblePoints(zones, teamCount, config);
  const pointsPct = maxPossible > 0 ? totalPoints / maxPossible : 0;

  return {
    table_points: tablePoints,
    zone_points: zonePoints,
    champion_points: championPoints,
    bonus_points: bonusPoints,
    awards_points: awardsPoints,
    total_points: totalPoints,
    max_possible_points: maxPossible,
    points_pct: Math.round(pointsPct * 10000) / 10000,
    exact_positions: exactPositions,
    errors_le_1: errorsLe1,
    errors_le_2: errorsLe2,
    champion_correct: championCorrect,
    ucl_zone_correct: uclCorrect,
    ucl_zone_full: uclZoneFull,
    europa_zone_correct: europaCorrect,
    europa_zone_full: europaTotal > 0 && europaCorrect === europaTotal ? 1 : 0,
    conference_zone_correct: conferenceCorrect,
    conference_zone_full: conferenceTotal > 0 && conferenceCorrect === conferenceTotal ? 1 : 0,
    relegation_zone_correct: relegationCorrect,
    relegation_zone_full: relegationZoneFull,
    awards_correct: awardsCorrect,
    breakdown: {
      formula_version: config.version,
      teams: teamBreakdown,
      bonuses,
      awards: awardsDetail,
      champion: { team_id: championTeamId, correct: championCorrect === 1, points: championPoints },
      totals: {
        table_points: tablePoints, zone_points: zonePoints, champion_points: championPoints,
        bonus_points: bonusPoints, awards_points: awardsPoints, total_points: totalPoints,
        max_possible_points: maxPossible, points_pct: maxPossible > 0 ? totalPoints / maxPossible : 0,
      },
    },
    warnings,
  };
}
