// seasonPredictionEurocupScoring.ts
// Pure scoring engine for the European cups league stage (Stage E2).
// Formula version: eurocups_v2. No I/O, no DB, no side effects, no rewards.
// Winner/champion does NOT earn points yet (handled in a later knockout stage).
//
// v2 (2026-08-28): every value halved from v1 (8/4/2 → 4/2/1, bonuses 20 → 12)
// so the league stage stops out-weighing the whole play-off run. All v1 ratios
// are preserved exactly — top-8 is still worth 2× a 9–24 hit and 4× a wrong-zone
// hit, and both zones still carry the same total weight (32 = 32) — so no pick
// strategy changes, only the scale. Max lands on a round 100.

export const EUROCUPS_FORMULA_VERSION = "eurocups_v2";

export const EUROCUP_TOP8_COUNT = 8;
export const EUROCUP_ZONE_9_24_COUNT = 16;
export const EUROCUP_TOP24_COUNT = 24;

export type EurocupsFormulaConfig = {
  version: string;
  top8ExactPoints: number;      // per team correctly placed in official top-8
  zone9_24ExactPoints: number;  // per team correctly placed in official 9–24
  qualifiedTop24Points: number; // per team in official top-24 but wrong subzone
  allTop8Bonus: number;
  all9_24Bonus: number;
  allTop24Bonus: number;
};

// Not named after a formula version on purpose: the version moves, this constant
// stays the single place the live coefficients live.
export const EUROCUPS_SCORING_CONFIG: EurocupsFormulaConfig = {
  version: EUROCUPS_FORMULA_VERSION,
  top8ExactPoints: 4,
  zone9_24ExactPoints: 2,
  qualifiedTop24Points: 1,
  allTop8Bonus: 12,
  all9_24Bonus: 12,
  allTop24Bonus: 12,
};

// 8×4 + 16×2 + 3×12 = 32 + 32 + 36 = 100. Winner is excluded on E2.
export const EUROCUPS_LEAGUE_STAGE_MAX_POINTS = 100;

export type EurocupScoreInput = {
  userTable: unknown;
  officialOrderedIds: string[]; // 36 official ids in final order (position = index + 1)
  teamName?: (id: string) => string | null;
  config?: EurocupsFormulaConfig;
};

type EurocupZone = "top8" | "playoff_9_24" | "eliminated" | "not_in_table";

export type EurocupTeamBreakdown = {
  team_id: string;
  team_name: string | null;
  user_zone: "top8" | "playoff_9_24";
  official_zone: EurocupZone;
  points: number;
  status: "exact_top8" | "exact_9_24" | "qualified_wrong_zone" | "eliminated" | "unknown_team";
};

export type EurocupScoreBreakdown = {
  formula_version: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  top8_points: number;
  playoff_9_24_points: number;
  qualified_top24_points: number;
  bonus_points: number;
  winner_points: number;
  top8_correct: number;
  playoff_9_24_correct: number;
  top24_correct: number;
  predicted_winner_team_id: string | null;
  champion_correct: null;
  breakdown: Record<string, unknown>;
  warnings: string[];
};

function toIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item).trim();
      const obj = item as Record<string, unknown> | null;
      return String(obj?.team_id ?? obj?.team_ref ?? obj?.teamId ?? obj?.id ?? "").trim();
    })
    .filter(Boolean);
}

function extractUserLeagueStage(userTable: unknown): { top8: string[]; zone: string[]; winner: string | null } {
  const t = userTable && typeof userTable === "object" && !Array.isArray(userTable) ? (userTable as Record<string, unknown>) : {};
  const ls = (t.league_stage && typeof t.league_stage === "object" && !Array.isArray(t.league_stage))
    ? (t.league_stage as Record<string, unknown>)
    : t;
  const top8 = toIdList(ls.top8_team_ids ?? ls.top8 ?? ls.topEight);
  const zone = toIdList(ls.zone_9_24_team_ids ?? ls.zone_9_24 ?? ls.playoff_zone ?? ls.zonePlayoff);
  const winnerRaw = ls.winner_team_id ?? ls.winner ?? null;
  const winner = winnerRaw == null || winnerRaw === "" ? null : String(winnerRaw).trim();
  return { top8, zone, winner };
}

/**
 * Score one eurocup league-stage entry against the confirmed official ordering.
 * Throws only on critical official-side problems (official table not 36) or on
 * structurally invalid user input (wrong count / duplicate / zone overlap) so a
 * recalc marks that single entry as failed without crashing the whole run.
 * Unknown user teams (not in the official 36) degrade to 0 points + a warning.
 */
export function scoreSeasonPredictionEurocupLeagueStageEntry(input: EurocupScoreInput): EurocupScoreBreakdown {
  const config = input.config || EUROCUPS_SCORING_CONFIG;
  const nameOf = (id: string) => (input.teamName ? input.teamName(id) : null);
  const warnings: string[] = [];

  const official = input.officialOrderedIds.map(String);
  if (official.length !== 36) throw new Error("EUROCUP_OFFICIAL_TABLE_NOT_36");

  const officialTop8 = new Set(official.slice(0, 8));
  const official9_24 = new Set(official.slice(8, 24));
  const officialTop24 = new Set(official.slice(0, 24));
  const officialAll = new Set(official);

  const { top8: userTop8, zone: userZone, winner } = extractUserLeagueStage(input.userTable);

  if (userTop8.length !== EUROCUP_TOP8_COUNT) throw new Error("EUROCUP_USER_TOP8_INVALID");
  if (userZone.length !== EUROCUP_ZONE_9_24_COUNT) throw new Error("EUROCUP_USER_ZONE_9_24_INVALID");
  if (new Set(userTop8).size !== userTop8.length) throw new Error("EUROCUP_USER_TOP8_DUPLICATE");
  if (new Set(userZone).size !== userZone.length) throw new Error("EUROCUP_USER_ZONE_9_24_DUPLICATE");
  const top8Set = new Set(userTop8);
  for (const id of userZone) {
    if (top8Set.has(id)) throw new Error("EUROCUP_USER_ZONE_OVERLAP");
  }

  const officialZoneOf = (id: string): EurocupZone => {
    if (officialTop8.has(id)) return "top8";
    if (official9_24.has(id)) return "playoff_9_24";
    if (officialAll.has(id)) return "eliminated";
    return "not_in_table";
  };

  let top8Points = 0;
  let zonePoints = 0;
  let qualifiedPoints = 0;
  let top8Correct = 0;
  let zoneCorrect = 0;
  const teams: EurocupTeamBreakdown[] = [];
  const top8CorrectIds: string[] = [];
  const zoneCorrectIds: string[] = [];
  const qualifiedIds: string[] = [];
  let top24Correct = 0;

  const addTeam = (id: string, userZoneKind: "top8" | "playoff_9_24") => {
    const oz = officialZoneOf(id);
    if (oz === "not_in_table") {
      warnings.push(`EUROCUP_USER_TEAM_NOT_IN_OFFICIAL: ${id}`);
      teams.push({ team_id: id, team_name: nameOf(id), user_zone: userZoneKind, official_zone: oz, points: 0, status: "unknown_team" });
      return;
    }
    const inTop24 = officialTop24.has(id);
    if (inTop24) top24Correct += 1;

    // Exact zone hit.
    if (userZoneKind === "top8" && oz === "top8") {
      top8Points += config.top8ExactPoints;
      top8Correct += 1;
      top8CorrectIds.push(id);
      teams.push({ team_id: id, team_name: nameOf(id), user_zone: userZoneKind, official_zone: oz, points: config.top8ExactPoints, status: "exact_top8" });
      return;
    }
    if (userZoneKind === "playoff_9_24" && oz === "playoff_9_24") {
      zonePoints += config.zone9_24ExactPoints;
      zoneCorrect += 1;
      zoneCorrectIds.push(id);
      teams.push({ team_id: id, team_name: nameOf(id), user_zone: userZoneKind, official_zone: oz, points: config.zone9_24ExactPoints, status: "exact_9_24" });
      return;
    }
    // In official top-24 but wrong subzone → qualified credit (never stacks with exact).
    if (inTop24) {
      qualifiedPoints += config.qualifiedTop24Points;
      qualifiedIds.push(id);
      teams.push({ team_id: id, team_name: nameOf(id), user_zone: userZoneKind, official_zone: oz, points: config.qualifiedTop24Points, status: "qualified_wrong_zone" });
      return;
    }
    // Official eliminated (positions 25–36) → 0.
    teams.push({ team_id: id, team_name: nameOf(id), user_zone: userZoneKind, official_zone: oz, points: 0, status: "eliminated" });
  };

  for (const id of userTop8) addTeam(id, "top8");
  for (const id of userZone) addTeam(id, "playoff_9_24");

  const allTop8 = top8Correct === EUROCUP_TOP8_COUNT;
  const all9_24 = zoneCorrect === EUROCUP_ZONE_9_24_COUNT;
  const allTop24 = top24Correct === EUROCUP_TOP24_COUNT;
  const bonuses = [
    { key: "all_top8_correct", label: "Все топ-8 угаданы", earned: allTop8, points: allTop8 ? config.allTop8Bonus : 0 },
    { key: "all_9_24_correct", label: "Все 9–24 угаданы", earned: all9_24, points: all9_24 ? config.all9_24Bonus : 0 },
    { key: "all_top24_correct", label: "Все топ-24 угаданы", earned: allTop24, points: allTop24 ? config.allTop24Bonus : 0 },
  ];
  const bonusPoints = bonuses.reduce((acc, b) => acc + b.points, 0);

  const winnerPoints = 0; // E2: no official champion yet.
  const totalPoints = top8Points + zonePoints + qualifiedPoints + bonusPoints + winnerPoints;
  const maxPossible = EUROCUPS_LEAGUE_STAGE_MAX_POINTS;
  const pointsPct = maxPossible > 0 ? Math.round((totalPoints / maxPossible) * 10000) / 10000 : 0;

  return {
    formula_version: config.version,
    total_points: totalPoints,
    max_possible_points: maxPossible,
    points_pct: pointsPct,
    top8_points: top8Points,
    playoff_9_24_points: zonePoints,
    qualified_top24_points: qualifiedPoints,
    bonus_points: bonusPoints,
    winner_points: winnerPoints,
    top8_correct: top8Correct,
    playoff_9_24_correct: zoneCorrect,
    top24_correct: top24Correct,
    predicted_winner_team_id: winner,
    champion_correct: null,
    breakdown: {
      stage: "league_stage",
      formula_version: config.version,
      summary: {
        top8_correct: top8Correct,
        playoff_9_24_correct: zoneCorrect,
        top24_correct: top24Correct,
        total_points: totalPoints,
        max_possible_points: maxPossible,
      },
      zones: {
        top8: {
          user_team_ids: userTop8,
          official_team_ids: official.slice(0, 8),
          correct_team_ids: top8CorrectIds,
          points: top8Points,
          max_points: EUROCUP_TOP8_COUNT * config.top8ExactPoints,
        },
        playoff_9_24: {
          user_team_ids: userZone,
          official_team_ids: official.slice(8, 24),
          correct_team_ids: zoneCorrectIds,
          points: zonePoints,
          max_points: EUROCUP_ZONE_9_24_COUNT * config.zone9_24ExactPoints,
        },
        top24: {
          user_team_ids: [...userTop8, ...userZone],
          official_team_ids: official.slice(0, 24),
          correct_team_ids: [...top8CorrectIds, ...zoneCorrectIds],
          qualified_credit_team_ids: qualifiedIds,
          points: qualifiedPoints,
        },
      },
      bonuses,
      winner: {
        user_team_id: winner,
        user_team_name: winner ? nameOf(winner) : null,
        status: "pending_official_champion",
        points: 0,
      },
      teams,
    },
    warnings,
  };
}
