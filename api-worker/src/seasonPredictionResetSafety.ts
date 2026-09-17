export type SeasonPredictionResetKind =
  | "user-data"
  | "scoring"
  | "official-results"
  | "weekly-challenges"
  | "full-season-predictions-test-data";

export const SEASON_PREDICTION_RESET_CONFIRM: Record<SeasonPredictionResetKind, string> = {
  "user-data": "RESET_SEASON_PREDICTIONS_USER_DATA",
  scoring: "RESET_SEASON_PREDICTIONS_SCORING",
  "official-results": "RESET_SEASON_PREDICTIONS_OFFICIAL_RESULTS",
  "weekly-challenges": "RESET_SEASON_PREDICTIONS_WEEKLY",
  "full-season-predictions-test-data": "RESET_ALL_SEASON_PREDICTIONS_TEST_DATA",
};

export const SEASON_PREDICTION_RESET_AUDIT_ACTION: Record<SeasonPredictionResetKind, string> = {
  "user-data": "SEASON_PREDICTIONS_RESET_USER_DATA",
  scoring: "SEASON_PREDICTIONS_RESET_SCORING",
  "official-results": "SEASON_PREDICTIONS_RESET_OFFICIAL_RESULTS",
  "weekly-challenges": "SEASON_PREDICTIONS_RESET_WEEKLY",
  "full-season-predictions-test-data": "SEASON_PREDICTIONS_RESET_ALL_TEST_DATA",
};

export function isSeasonPredictionResetConfirmValid(kind: SeasonPredictionResetKind, confirm: unknown): boolean {
  return String(confirm || "").trim() === SEASON_PREDICTION_RESET_CONFIRM[kind];
}
