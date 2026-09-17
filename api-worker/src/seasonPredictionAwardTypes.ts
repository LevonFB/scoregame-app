export type SeasonPredictionAwardType = "top_scorer" | "top_assister" | "golden_glove";
export type SeasonPredictionOfficialAwardType = "top_scorer" | "top_assistant" | "golden_glove";

export function normalizeSeasonPredictionAwardType(input: unknown): SeasonPredictionAwardType {
  const value = String(input || "").trim();
  if (value === "top_scorer") return "top_scorer";
  if (value === "top_assister" || value === "top_assistant") return "top_assister";
  if (value === "golden_glove") return "golden_glove";
  throw new Error("INVALID_AWARD_TYPE");
}

export function normalizeSeasonPredictionOfficialAwardType(input: unknown): SeasonPredictionOfficialAwardType {
  const value = normalizeSeasonPredictionAwardType(input);
  return value === "top_assister" ? "top_assistant" : value;
}

export function normalizeSeasonPredictionAwardTypeForClient(input: unknown): SeasonPredictionOfficialAwardType {
  const value = normalizeSeasonPredictionAwardType(input);
  return value === "top_assister" ? "top_assistant" : value;
}

export function getSeasonPredictionAwardTypeLabel(input: unknown): string {
  try {
    const value = normalizeSeasonPredictionAwardType(input);
    if (value === "top_scorer") return "Лучший бомбардир";
    if (value === "top_assister") return "Лучший ассистент";
    if (value === "golden_glove") return "Золотая перчатка";
  } catch {
    // Preserve unknown input for diagnostics and admin-facing validation errors.
  }
  return String(input || "");
}
