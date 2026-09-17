import { describe, expect, it } from "vitest";
import {
  normalizeSeasonPredictionAwardType,
  normalizeSeasonPredictionAwardTypeForClient,
  normalizeSeasonPredictionOfficialAwardType,
} from "../seasonPredictionAwardTypes";

describe("season prediction award type compatibility", () => {
  it("uses top_assister as the award-options DB value", () => {
    expect(normalizeSeasonPredictionAwardType("top_scorer")).toBe("top_scorer");
    expect(normalizeSeasonPredictionAwardType("top_assister")).toBe("top_assister");
    expect(normalizeSeasonPredictionAwardType("top_assistant")).toBe("top_assister");
    expect(normalizeSeasonPredictionAwardType("golden_glove")).toBe("golden_glove");
  });

  it("uses top_assistant for client and official-awards compatibility", () => {
    expect(normalizeSeasonPredictionAwardTypeForClient("top_assister")).toBe("top_assistant");
    expect(normalizeSeasonPredictionOfficialAwardType("top_assister")).toBe("top_assistant");
    expect(normalizeSeasonPredictionOfficialAwardType("top_assistant")).toBe("top_assistant");
  });

  it("rejects unknown award types before D1 constraints are hit", () => {
    expect(() => normalizeSeasonPredictionAwardType("best_player")).toThrow("INVALID_AWARD_TYPE");
  });
});
