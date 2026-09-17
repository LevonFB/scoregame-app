import { describe, expect, it } from "vitest";
import {
  isSeasonPredictionResetConfirmValid,
  SEASON_PREDICTION_RESET_AUDIT_ACTION,
  SEASON_PREDICTION_RESET_CONFIRM,
  type SeasonPredictionResetKind,
} from "../seasonPredictionResetSafety";

const RESET_KINDS: SeasonPredictionResetKind[] = [
  "user-data",
  "scoring",
  "official-results",
  "weekly-challenges",
  "full-season-predictions-test-data",
];

describe("season prediction reset safety", () => {
  it("requires exact confirmation phrases for every reset kind", () => {
    for (const kind of RESET_KINDS) {
      expect(isSeasonPredictionResetConfirmValid(kind, SEASON_PREDICTION_RESET_CONFIRM[kind])).toBe(true);
      expect(isSeasonPredictionResetConfirmValid(kind, "")).toBe(false);
      expect(isSeasonPredictionResetConfirmValid(kind, `${SEASON_PREDICTION_RESET_CONFIRM[kind]}_TYPO`)).toBe(false);
    }
  });

  it("uses season-predictions-only audit actions", () => {
    expect(Object.keys(SEASON_PREDICTION_RESET_AUDIT_ACTION).sort()).toEqual([...RESET_KINDS].sort());
    for (const action of Object.values(SEASON_PREDICTION_RESET_AUDIT_ACTION)) {
      expect(action).toMatch(/^SEASON_PREDICTIONS_RESET_/);
    }
  });
});
