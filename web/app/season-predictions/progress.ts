import { TOP_LEAGUE_ACCENTS } from "./constants";
import type { SeasonPredictionAwardsJson, SeasonPredictionTournament } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function tableCount(table: unknown): number {
  if (!isRecord(table)) return 0;
  if (Array.isArray(table.ordered_team_ids)) return table.ordered_team_ids.length;
  if (Array.isArray(table.teams)) return table.teams.length;
  return 0;
}

export function awardsCount(awards: unknown): number {
  if (!isRecord(awards)) return 0;
  const a = awards as SeasonPredictionAwardsJson;
  return [
    a.top_scorer,
    a.top_assister ?? a.top_assistant,
    a.golden_glove,
  ].filter((item) => item?.player_name || item?.player_id || item?.award_option_id).length;
}

export type LeagueSegmentState = "done" | "progress" | "empty";

export type LeagueDerived = {
  entryStatus: string | null;
  expectedCount: number;
  configuredCount: number;
  filledTeams: number;
  filledAwards: number;
  locked: boolean;
  isSubmitted: boolean;
  awardsSubmitted: boolean;
  isDraft: boolean;
  isActive: boolean;
  teamsReady: boolean;
  tableComplete: boolean;
  awardsComplete: boolean;
  allComplete: boolean;
  ctaLabel: string;
  nextAction: string;
  nextActionTone: "accent" | "done" | "muted";
  segment: LeagueSegmentState;
};

export function deriveLeague(t: SeasonPredictionTournament): LeagueDerived {
  const entryStatus = t.entry?.status || null;
  const expectedCount = Number(t.team_count || 0);
  const configuredCount = Number(t.configured_team_count || 0);
  const filledTeams = tableCount(t.entry?.table);
  const filledAwards = awardsCount(t.entry?.awards);

  const locked =
    ["locked", "scoring", "completed"].includes(entryStatus || "") ||
    ["locked", "scoring", "completed", "archived"].includes(t.status);
  const isSubmitted = entryStatus === "submitted";
  // Awards are confirmed separately from the table and carry their own status.
  const awardsSubmitted = ["submitted", "locked", "scoring", "completed"]
    .includes(String(t.entry?.awards_status || ""));
  const isDraft = entryStatus === "draft";
  const isActive = !locked && !isSubmitted;
  const teamsReady = configuredCount > 0;
  const tableComplete = expectedCount > 0 && filledTeams === expectedCount;
  const awardsComplete = filledAwards === 3;
  const allComplete = tableComplete && awardsComplete;

  const ctaLabel = locked
    ? "Просмотр"
    : isSubmitted
      ? "Открыть"
      : isDraft
        ? "Продолжить"
        : "Начать";

  let nextAction: string;
  let nextActionTone: LeagueDerived["nextActionTone"];
  if (!teamsReady) {
    nextAction = "Команды ещё не настроены";
    nextActionTone = "muted";
  } else if (locked) {
    nextAction = "Прогноз закрыт";
    nextActionTone = "muted";
  } else if (isSubmitted && awardsSubmitted && allComplete) {
    nextAction = "Прогноз подтверждён";
    nextActionTone = "done";
  } else if (!tableComplete) {
    nextAction = "Собрать таблицу";
    nextActionTone = "accent";
  } else if (!isSubmitted) {
    nextAction = "Подтвердить таблицу";
    nextActionTone = "accent";
  } else if (!awardsComplete) {
    nextAction = "Выбрать награды";
    nextActionTone = "accent";
  } else {
    nextAction = "Подтвердить награды";
    nextActionTone = "accent";
  }

  let segment: LeagueSegmentState;
  if (isSubmitted || ["scoring", "completed"].includes(t.status)) {
    segment = "done";
  } else if (filledTeams > 0 || filledAwards > 0 || isDraft) {
    segment = "progress";
  } else {
    segment = "empty";
  }

  return {
    entryStatus,
    expectedCount,
    configuredCount,
    filledTeams,
    filledAwards,
    locked,
    isSubmitted,
    awardsSubmitted,
    isDraft,
    isActive,
    teamsReady,
    tableComplete,
    awardsComplete,
    allComplete,
    ctaLabel,
    nextAction,
    nextActionTone,
    segment,
  };
}

export type OverallProgress = {
  totalLeagues: number;
  submittedLeagues: number;
  filledTeams: number;
  totalTeams: number;
  filledAwards: number;
  totalAwards: number;
  segments: LeagueSegmentState[];
  nextActionText: string;
  nextActionDone: boolean;
};

function shortName(t: SeasonPredictionTournament): string {
  return TOP_LEAGUE_ACCENTS[t.tournament_code]?.short || t.tournament_code;
}

export function deriveOverall(tournaments: SeasonPredictionTournament[]): OverallProgress {
  const totalLeagues = tournaments.length;
  let submittedLeagues = 0;
  let filledTeams = 0;
  let totalTeams = 0;
  let filledAwards = 0;
  const segments: LeagueSegmentState[] = [];

  // Tournaments arrive pre-sorted by sort_order; first actionable one wins.
  const sorted = [...tournaments].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const derived = sorted.map((t) => ({ t, d: deriveLeague(t) }));

  for (const { t, d } of derived) {
    const status = d.entryStatus || "";
    const submittedLike =
      ["submitted", "locked", "scoring", "completed"].includes(status) ||
      ["locked", "scoring", "completed"].includes(t.status);
    if (submittedLike) submittedLeagues += 1;

    filledTeams += Math.min(d.filledTeams, d.expectedCount);
    totalTeams += d.expectedCount;
    filledAwards += d.filledAwards;
    segments.push(d.segment);
  }

  const totalAwards = totalLeagues * 3;
  const allSubmitted = totalLeagues > 0 && submittedLeagues === totalLeagues;

  // Next action priority (per spec).
  let nextActionText = "начать с любой лиги";
  let nextActionDone = false;

  const awardsGap = derived.find(({ d }) => d.isSubmitted && d.teamsReady && d.filledAwards < 3);
  const tableGap = derived.find(
    ({ d }) => !d.locked && d.teamsReady && d.filledTeams > 0 && !d.tableComplete,
  );
  const draftGap = derived.find(({ d }) => d.isDraft && !d.isSubmitted && d.teamsReady && d.tableComplete);

  if (awardsGap) {
    nextActionText = `заполнить награды ${shortName(awardsGap.t)}`;
  } else if (tableGap) {
    nextActionText = `собрать таблицу ${shortName(tableGap.t)}`;
  } else if (draftGap) {
    nextActionText = `подтвердить прогноз ${shortName(draftGap.t)}`;
  } else if (allSubmitted) {
    nextActionText = "все прогнозы подтверждены";
    nextActionDone = true;
  }

  return {
    totalLeagues,
    submittedLeagues,
    filledTeams,
    totalTeams,
    filledAwards,
    totalAwards,
    segments,
    nextActionText,
    nextActionDone,
  };
}
