import type {
  EuropeanCupCode,
  SeasonPredictionEuropeanStage,
  SeasonPredictionTournamentCode,
  TopLeagueCode,
} from "./types";

export const SEASON_PREDICTION_TITLE = "Прогнозы сезона";

export const TOP_LEAGUE_ORDER: TopLeagueCode[] = ["PL", "PD", "SA", "BL1", "FL1"];

// Partial<Record<SeasonPredictionTournamentCode, …>> — keeps the existing safe
// `accent?.tone` lookups working for both top-leagues and european codes.
export const TOP_LEAGUE_ACCENTS: Partial<Record<SeasonPredictionTournamentCode, { short: string; tone: string; logo: string }>> = {
  PL:  { short: "АПЛ", tone: "#59d2ff", logo: "https://crests.football-data.org/PL.png" },
  PD:  { short: "ЛЛ",  tone: "#ffb24a", logo: "https://crests.football-data.org/PD.png" },
  SA:  { short: "СА",  tone: "#7ee787", logo: "https://crests.football-data.org/SA.png" },
  BL1: { short: "БЛ",  tone: "#ff6b6b", logo: "https://crests.football-data.org/BL1.png" },
  FL1: { short: "Л1",  tone: "#b49cff", logo: "https://crests.football-data.org/FL1.png" },
};

// Readable sub-labels for the league selector so short codes are unambiguous.
// All entries are league names (not countries) so the selector chips are consistent.
export const TOP_LEAGUE_SUBLABELS: Partial<Record<SeasonPredictionTournamentCode, string>> = {
  PL:  "Премьер-лига",
  PD:  "Ла Лига",
  SA:  "Серия А",
  BL1: "Бундес.",
  FL1: "Лига 1",
};

// Russian country names for the league hero — the DB `country` field stores English
// ("England", "Spain", …) inconsistently, so the UI uses this map instead.
export const TOP_LEAGUE_COUNTRIES: Partial<Record<SeasonPredictionTournamentCode, string>> = {
  PL:  "Англия",
  PD:  "Испания",
  SA:  "Италия",
  BL1: "Германия",
  FL1: "Франция",
};

export const EUROPEAN_CUP_ORDER: EuropeanCupCode[] = ["UCL", "UEL", "UECL"];

// European cups intentionally have no logos — single-density external crest
// PNGs render muddy at small sizes and don't add premium identity. Tone +
// short code is the brand mark.
export const EUROPEAN_CUP_ACCENTS: Record<EuropeanCupCode, { short: string; tone: string }> = {
  UCL:  { short: "ЛЧ", tone: "#3aa1ff" },
  UEL:  { short: "ЛЕ", tone: "#ff8a3c" },
  UECL: { short: "ЛК", tone: "#3ddc6f" },
};

// Full tournament names for the tournament-hub selector tiles.
export const EUROPEAN_CUP_FULL_LABELS: Record<EuropeanCupCode, string> = {
  UCL: "Лига чемпионов",
  UEL: "Лига Европы",
  UECL: "Лига конференций",
};

export const EUROPEAN_STAGE_LABELS: Record<SeasonPredictionEuropeanStage, string> = {
  league_stage: "Стадия лиги",
  playoff_knockout: "Стыки плей-офф",
  round_of_16: "1/8 финала",
  quarter_final: "1/4 финала",
  semi_final: "1/2 финала",
  final: "Финал",
};

export const EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT = 8;
export const EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT = 16;

export const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  soon: "Скоро",
  active: "Активно",
  submitted: "Подтверждено",
  locked: "Закрыто",
  scoring: "Подсчёт",
  completed: "Завершено",
  open: "Открыто",
  archived: "Архив",
};
