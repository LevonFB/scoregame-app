import {
  EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT,
  EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT,
} from "./constants";
import type {
  SeasonPredictionEuropeanStage,
  SeasonPredictionLeagueStageJson,
  SeasonPredictionTournament,
} from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (item === null || item === undefined) continue;
    const s = String(item).trim();
    if (s) out.push(s);
  }
  return Array.from(new Set(out));
}

export const EMPTY_LEAGUE_STAGE: SeasonPredictionLeagueStageJson = {
  stage: "league_stage",
  league_stage: {
    top8_team_ids: [],
    zone_9_24_team_ids: [],
    winner_team_id: null,
  },
};

export function readLeagueStage(value: unknown): SeasonPredictionLeagueStageJson {
  if (!isRecord(value)) return { ...EMPTY_LEAGUE_STAGE, league_stage: { ...EMPTY_LEAGUE_STAGE.league_stage } };
  const leagueRaw = isRecord(value.league_stage) ? value.league_stage : value;
  const top8 = safeStringArray((leagueRaw as Record<string, unknown>).top8_team_ids).slice(0, EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT);
  const zone = safeStringArray((leagueRaw as Record<string, unknown>).zone_9_24_team_ids)
    .filter((id) => !top8.includes(id))
    .slice(0, EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT);
  const winnerRaw = (leagueRaw as Record<string, unknown>).winner_team_id;
  const winner_team_id = winnerRaw === null || winnerRaw === undefined || winnerRaw === ""
    ? null
    : String(winnerRaw).trim() || null;
  return {
    stage: "league_stage",
    league_stage: { top8_team_ids: top8, zone_9_24_team_ids: zone, winner_team_id },
  };
}

export function leagueStageEqualsSig(a: SeasonPredictionLeagueStageJson, b: SeasonPredictionLeagueStageJson): boolean {
  return (
    a.league_stage.top8_team_ids.join("|") === b.league_stage.top8_team_ids.join("|") &&
    a.league_stage.zone_9_24_team_ids.join("|") === b.league_stage.zone_9_24_team_ids.join("|") &&
    (a.league_stage.winner_team_id || "") === (b.league_stage.winner_team_id || "")
  );
}

export type EuropeanDerived = {
  entryStatus: string | null;
  teamCount: number;
  configuredCount: number;
  top8Count: number;
  zoneCount: number;
  hasWinner: boolean;
  teamsReady: boolean;
  locked: boolean;
  isSubmitted: boolean;
  isDraft: boolean;
  isActive: boolean;
  top8Complete: boolean;
  zoneComplete: boolean;
  leagueStageComplete: boolean;
  activeStage: SeasonPredictionEuropeanStage;
  stages: SeasonPredictionEuropeanStage[];
  ctaLabel: string;
  nextAction: string;
  nextActionTone: "accent" | "done" | "muted";
};

const DEFAULT_STAGES: SeasonPredictionEuropeanStage[] = [
  "league_stage",
  "playoff_knockout",
  "round_of_16",
  "quarter_final",
  "semi_final",
  "final",
];

function readActiveStage(settings: Record<string, unknown> | undefined): SeasonPredictionEuropeanStage {
  const raw = settings?.active_stage;
  const value = typeof raw === "string" ? raw : "league_stage";
  return DEFAULT_STAGES.includes(value as SeasonPredictionEuropeanStage) ? value as SeasonPredictionEuropeanStage : "league_stage";
}

function readStages(settings: Record<string, unknown> | undefined): SeasonPredictionEuropeanStage[] {
  const raw = settings?.stages;
  if (!Array.isArray(raw)) return DEFAULT_STAGES;
  const filtered = raw
    .map((s) => String(s))
    .filter((s): s is SeasonPredictionEuropeanStage => DEFAULT_STAGES.includes(s as SeasonPredictionEuropeanStage));
  return filtered.length > 0 ? filtered : DEFAULT_STAGES;
}

export function deriveEuropean(t: SeasonPredictionTournament): EuropeanDerived {
  const entryStatus = t.entry?.status || null;
  const teamCount = Number(t.team_count || 0);
  const configuredCount = Number(t.configured_team_count || 0);
  const teamsReady = configuredCount > 0;
  const locked = ["locked", "scoring", "completed"].includes(entryStatus || "") || ["locked", "scoring", "completed", "archived"].includes(t.status);
  const isSubmitted = entryStatus === "submitted";
  const isDraft = entryStatus === "draft";
  const isActive = !locked && !isSubmitted;
  const stage = readLeagueStage(t.entry?.table);
  const top8Count = stage.league_stage.top8_team_ids.length;
  const zoneCount = stage.league_stage.zone_9_24_team_ids.length;
  const hasWinner = !!stage.league_stage.winner_team_id;
  const top8Complete = top8Count === EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT;
  const zoneComplete = zoneCount === EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT;
  const leagueStageComplete = top8Complete && zoneComplete;
  const activeStage = readActiveStage(t.settings);
  const stages = readStages(t.settings);

  let ctaLabel: string;
  if (!teamsReady || t.status === "archived") ctaLabel = "Скоро";
  else if (locked) ctaLabel = "Просмотр";
  else if (isSubmitted) ctaLabel = "Открыть";
  else if (isDraft) ctaLabel = "Продолжить";
  else ctaLabel = "Начать";

  let nextAction: string;
  let nextActionTone: EuropeanDerived["nextActionTone"];
  if (!teamsReady) {
    nextAction = "Команды ещё не настроены";
    nextActionTone = "muted";
  } else if (locked) {
    nextAction = "Прогноз закрыт";
    nextActionTone = "muted";
  } else if (isSubmitted && leagueStageComplete) {
    nextAction = "Прогноз подтверждён";
    nextActionTone = "done";
  } else if (!top8Complete) {
    nextAction = "Следующее: выбрать топ-8";
    nextActionTone = "accent";
  } else if (!zoneComplete) {
    nextAction = "Следующее: выбрать 9–24";
    nextActionTone = "accent";
  } else {
    nextAction = "Следующее: подтвердить прогноз";
    nextActionTone = "accent";
  }

  return {
    entryStatus,
    teamCount,
    configuredCount,
    top8Count,
    zoneCount,
    hasWinner,
    teamsReady,
    locked,
    isSubmitted,
    isDraft,
    isActive,
    top8Complete,
    zoneComplete,
    leagueStageComplete,
    activeStage,
    stages,
    ctaLabel,
    nextAction,
    nextActionTone,
  };
}
