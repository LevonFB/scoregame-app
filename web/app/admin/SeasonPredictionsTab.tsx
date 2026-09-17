"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { mskInputToMs, toMskInputValue } from "./mskTime";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminInput } from "./components/AdminInput";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import {
  AdminButton as UiButton,
  AdminInput as UiInput,
  AdminTextarea as UiTextarea,
  AdminBadge as UiBadge,
  AdminSelect as UiSelect,
  AdminSegmentedControl,
  AdminMetricCard,
  type AdminSegmentOption,
} from "./components/ui";
import { parseZonesObject, buildZonesObject, validateZones, type ZoneRow } from "./seasonPredictionZones";
import type {
  SeasonPredictionAwardOption,
  SeasonPredictionSeason,
  SeasonPredictionTeam,
  SeasonPredictionTournamentPlayer,
  SeasonPredictionTournament,
  SeasonPredictionTournamentCode,
} from "../season-predictions/types";
import WeeklyChallengeAdminSection from "./WeeklyChallengeAdminSection";
import { SeasonPredictionsStats } from "./SeasonPredictionsStats";
import { SeasonPredictionsOfficialResults } from "./SeasonPredictionsOfficialResults";
import { SeasonPredictionsEurocupOfficialResults } from "./SeasonPredictionsEurocupOfficialResults";
import { SeasonPredictionsEurocupKnockout } from "./SeasonPredictionsEurocupKnockout";
import { SeasonPredictionsRewardsTab } from "./SeasonPredictionsRewardsTab";
import { SeasonPredictionsTaskRewardsTab } from "./SeasonPredictionsTaskRewardsTab";
import { BallonDorOfficialTab } from "./BallonDorOfficialTab";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type AdminTournament = SeasonPredictionTournament & {
  teams: SeasonPredictionTeam[];
  award_options: SeasonPredictionAwardOption[];
};

type AdminConfigResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  tournaments: AdminTournament[];
};

type ImportedTeamPreview = {
  team_name: string;
  short_name?: string | null;
  crest_url?: string | null;
  team_id?: string | null;
  provider?: string | null;
  provider_team_id?: string | null;
  metadata_json?: Record<string, unknown>;
};

type ImportedAwardPreview = {
  award_type: SeasonPredictionAwardOption["award_type"];
  player_name: string;
  team_name?: string | null;
  player_id?: string | null;
  team_id?: string | null;
  metadata_json?: Record<string, unknown>;
};

type TeamsPreviewResponse = {
  ok: boolean;
  tournamentCode: SeasonPredictionTournamentCode;
  provider: string;
  expectedTeamCount: number;
  actualTeamCount: number;
  teams: ImportedTeamPreview[];
  warnings: string[];
};

type AwardsPreviewResponse = {
  ok: boolean;
  tournamentCode: SeasonPredictionTournamentCode;
  award_type: SeasonPredictionAwardOption["award_type"];
  provider: string;
  options: ImportedAwardPreview[];
  warnings: string[];
};

type PlayersResponse = {
  ok: boolean;
  tournamentCode: SeasonPredictionTournamentCode;
  players: SeasonPredictionTournamentPlayer[];
  counts: Record<string, number>;
  warnings?: string[];
  matched?: number;
  requested?: number;
};

type PlayersPreviewResponse = {
  ok: boolean;
  tournamentCode: SeasonPredictionTournamentCode;
  provider: string;
  players: SeasonPredictionTournamentPlayer[];
  teams_matched: number;
  counts?: Record<string, number>;
  unknown_samples?: string[];
  warnings: string[];
};

type SyncPlayersResponse = {
  ok: boolean;
  error?: string;
  teams_matched?: number;
  players: SeasonPredictionTournamentPlayer[];
  counts: Record<string, number>;
  warnings?: string[];
};

type SeasonPredictionResetCounts = {
  user_entries: number;
  user_scores: number;
  official_results: number;
  official_awards: number;
  weekly_challenges: number;
  weekly_entries: number;
  weekly_matches: number;
  weekly_questions: number;
  recalc_logs: number;
  europe_entries: number;
  top5_entries: number;
};

type SeasonPredictionResetKind =
  | "user-data"
  | "scoring"
  | "official-results"
  | "weekly-challenges"
  | "full-season-predictions-test-data";

type SeasonPredictionResetSummaryResponse = {
  ok: boolean;
  seasonCode: string;
  counts: SeasonPredictionResetCounts;
};

type SeasonPredictionResetResponse = SeasonPredictionResetSummaryResponse & {
  deleted: SeasonPredictionResetCounts;
};

type SeasonPredictionResetAction = {
  id: SeasonPredictionResetKind;
  title: string;
  description: string;
  confirm: string;
};

type Props = {
  fetchWithAuth: FetchWithAuth;
};

const RESET_ACTIONS: SeasonPredictionResetAction[] = [
  {
    id: "user-data",
    title: "Сбросить пользовательские прогнозы",
    description: "Удалит draft/submitted прогнозы пользователей в Прогнозах сезона. Команды, правила, official results и weekly configs останутся.",
    confirm: "RESET_SEASON_PREDICTIONS_USER_DATA",
  },
  {
    id: "scoring",
    title: "Сбросить scoring",
    description: "Удалит user_scores и recalc logs. Official results и прогнозы пользователей останутся.",
    confirm: "RESET_SEASON_PREDICTIONS_SCORING",
  },
  {
    id: "official-results",
    title: "Сбросить official results",
    description: "Удалит official results, official awards, scores и recalc logs. Пользовательские прогнозы останутся.",
    confirm: "RESET_SEASON_PREDICTIONS_OFFICIAL_RESULTS",
  },
  {
    id: "weekly-challenges",
    title: "Сбросить Вызов недели",
    description: "Удалит weekly challenges, вопросы, пул матчей и ответы пользователей.",
    confirm: "RESET_SEASON_PREDICTIONS_WEEKLY",
  },
  {
    id: "full-season-predictions-test-data",
    title: "Полный тестовый сброс режима",
    description: "Удалит пользовательские прогнозы, scores, official results и weekly challenges. Команды, правила зон и кандидаты останутся.",
    confirm: "RESET_ALL_SEASON_PREDICTIONS_TEST_DATA",
  },
];

const RESET_COUNT_LABELS: Array<{ key: keyof SeasonPredictionResetCounts; label: string }> = [
  { key: "user_entries", label: "user entries" },
  { key: "top5_entries", label: "top-5" },
  { key: "europe_entries", label: "europe" },
  { key: "user_scores", label: "scores" },
  { key: "recalc_logs", label: "recalc" },
  { key: "official_results", label: "official results" },
  { key: "official_awards", label: "official awards" },
  { key: "weekly_challenges", label: "weekly" },
  { key: "weekly_entries", label: "weekly entries" },
  { key: "weekly_matches", label: "weekly matches" },
  { key: "weekly_questions", label: "weekly questions" },
];

const inputLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 12,
  fontWeight: 900,
  color: "var(--tg-hint, #999)",
};

const textAreaStyle: CSSProperties = {
  width: "100%",
  minHeight: 150,
  border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
  borderRadius: 14,
  padding: 12,
  background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))",
  color: "var(--tg-text, #fff)",
  fontSize: 13,
  lineHeight: 1.45,
  outline: "none",
  resize: "vertical",
};

const selectStyle: CSSProperties = {
  width: "100%",
  minHeight: 44,
  border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
  borderRadius: 12,
  padding: "0 12px",
  background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))",
  color: "var(--tg-text, #fff)",
  fontSize: 14,
  fontWeight: 800,
  outline: "none",
};

const previewListStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  maxHeight: 260,
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  touchAction: "pan-y",
  padding: 6,
  borderRadius: 14,
  background: "rgba(128,128,128,0.08)",
};

const previewRowStyle: CSSProperties = {
  minHeight: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderRadius: 10,
  padding: "0 10px",
  background: "rgba(128,128,128,0.08)",
  color: "var(--tg-text, #fff)",
  fontSize: 13,
  fontWeight: 800,
};

// datetime-local inputs are MSK wall time; the backend stores unix seconds.
function formatDateInput(ts: number | null | undefined) {
  return toMskInputValue(ts);
}

function dateInputToUnixSeconds(input: string): number | null {
  const ms = mskInputToMs(input);
  return ms == null ? null : Math.floor(ms / 1000);
}

function parseJsonText(text: string, fallback: unknown) {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed) as unknown;
}

function sumResetCounts(counts: SeasonPredictionResetCounts | null | undefined) {
  if (!counts) return 0;
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
}

function teamsToText(teams: SeasonPredictionTeam[]) {
  return teams.map((team) => [team.team_name, team.short_name || "", team.crest_url || ""].join("|")).join("\n");
}

function awardOptionsToText(options: SeasonPredictionAwardOption[]) {
  return options.map((option) => [normalizeAwardTypeForDb(option.award_type), option.player_name, option.team_name || ""].join("|")).join("\n");
}

function normalizeAwardTypeForDb(type: string) {
  const value = type.trim();
  return value === "top_assistant" ? "top_assister" : value;
}

function parseTeamsText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [teamName = "", shortName = "", crestUrl = ""] = line.split("|").map((part) => part.trim());
      return {
        team_name: teamName,
        short_name: shortName || null,
        crest_url: crestUrl || null,
      };
    });
}

function parseAwardOptionsText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [awardType = "", playerName = "", teamName = ""] = line.split("|").map((part) => part.trim());
      return {
        award_type: normalizeAwardTypeForDb(awardType),
        player_name: playerName,
        team_name: teamName || null,
      };
    });
}

function playersToText(players: SeasonPredictionTournamentPlayer[]) {
  return players.map((player) => [
    player.player_name,
    player.team_name || "",
    player.position || player.position_group || "",
    player.provider_player_id || player.player_id || "",
    player.photo_url || "",
  ].join("|")).join("\n");
}

type TournamentGroup = "top_league" | "european" | "weekly_challenge" | "ballon_dor";

const TOURNAMENT_GROUPS: Array<{ id: TournamentGroup; label: string }> = [
  { id: "top_league", label: "Топ-5 лиг" },
  { id: "european", label: "Еврокубки" },
  { id: "weekly_challenge", label: "Вызов недели" },
  { id: "ballon_dor", label: "Золотой мяч" },
];

// Группы со своим телом вкладки вместо потурнирного редактора: список команд,
// зоны и индивидуальные награды к ним неприменимы.
const STANDALONE_GROUPS: TournamentGroup[] = ["weekly_challenge", "ballon_dor"];

// Подпись под названием группы (у потурнирных — счётчик турниров).
const GROUP_SUBLABEL: Partial<Record<TournamentGroup, string>> = {
  weekly_challenge: "MVP редактор",
  ballon_dor: "Предиктор 30 → 1",
};

// Tournament lifecycle statuses accepted by the backend
// (SEASON_PREDICTION_TOURNAMENT_STATUSES). Free-text input was error-prone.
const TOURNAMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", soon: "Скоро", open: "Открыт", locked: "Заблокирован",
  scoring: "Подсчёт", completed: "Завершён", archived: "Архив",
};
function tournamentStatusLabel(status: string): string { return TOURNAMENT_STATUS_LABEL[status] || status; }
const TOURNAMENT_STATUS_OPTIONS = [
  { value: "draft", label: "Черновик — скрыт от игроков" },
  { value: "soon", label: "Скоро — виден, но вход заблокирован" },
  { value: "open", label: "Открыт — принимаются прогнозы" },
  { value: "locked", label: "Заблокирован — дедлайн прошёл, ввод закрыт" },
  { value: "scoring", label: "Подсчёт — идёт подведение итогов" },
  { value: "completed", label: "Завершён" },
  { value: "archived", label: "Архив" },
];

// Per-tournament editor is a step wizard instead of one long scroll. Steps differ
// by tournament type: top-5 leagues have zones/players/awards, eurocups don't.
type EditorStep = "overview" | "settings" | "teams" | "zones" | "players" | "awards" | "results" | "advanced";

const EDITOR_STEPS_TOP_LEAGUE: Array<{ id: EditorStep; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "settings", label: "Настройки" },
  { id: "teams", label: "Команды" },
  { id: "zones", label: "Зоны" },
  { id: "players", label: "Игроки" },
  { id: "awards", label: "Награды" },
  { id: "results", label: "Результаты" },
  { id: "advanced", label: "JSON" },
];

const EDITOR_STEPS_EUROPEAN: Array<{ id: EditorStep; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "settings", label: "Настройки" },
  { id: "teams", label: "Команды" },
  { id: "results", label: "Результаты" },
  { id: "advanced", label: "JSON" },
];

export default function SeasonPredictionsTab({ fetchWithAuth }: Props) {
  const [season, setSeason] = useState<SeasonPredictionSeason | null>(null);
  const [tournaments, setTournaments] = useState<AdminTournament[]>([]);
  const [tournamentGroup, setTournamentGroup] = useState<TournamentGroup>("top_league");
  const [selectedCode, setSelectedCode] = useState<SeasonPredictionTournamentCode | null>(null);
  // Active wizard step for the selected tournament.
  const [step, setStep] = useState<EditorStep>("overview");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("draft");
  const [teamCount, setTeamCount] = useState("20");
  const [openAt, setOpenAt] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  // Independent window for individual awards (top-5 only). Empty → fall back to the
  // table deadline on the backend.
  const [awardsOpenAt, setAwardsOpenAt] = useState("");
  const [awardsDeadlineAt, setAwardsDeadlineAt] = useState("");
  const [settingsJson, setSettingsJson] = useState("{}");
  const [zonesJson, setZonesJson] = useState("{}");
  const [playoffRulesJson, setPlayoffRulesJson] = useState("{}");
  // Structured zone editor (source of truth for zones_json). `zonesExtra` keeps any
  // non-range / unknown entries so they round-trip without loss.
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [zonesExtra, setZonesExtra] = useState<Record<string, unknown>>({});
  const [zoneError, setZoneError] = useState("");
  const [jsonError, setJsonError] = useState<{ settings?: string; zones?: string; playoff?: string }>({});
  const [teamsText, setTeamsText] = useState("");
  const [awardOptionsText, setAwardOptionsText] = useState("");
  // Single shared provider/season for ALL imports (teams, players, awards) — they
  // used to be duplicated across three states that silently drifted apart.
  const [importProvider, setImportProvider] = useState<"football-data" | "allsports">("football-data");
  const [importSeason, setImportSeason] = useState("2026");
  const [importCompetitionId, setImportCompetitionId] = useState("");
  const [teamsPreview, setTeamsPreview] = useState<TeamsPreviewResponse | null>(null);
  const [awardImportType, setAwardImportType] = useState<"top_scorer" | "top_assistant" | "golden_glove">("top_scorer");
  const [awardImportLimit, setAwardImportLimit] = useState("30");
  const [awardPreview, setAwardPreview] = useState<AwardsPreviewResponse | null>(null);
  const [players, setPlayers] = useState<SeasonPredictionTournamentPlayer[]>([]);
  const [playersCounts, setPlayersCounts] = useState<Record<string, number>>({});
  const [playersText, setPlayersText] = useState("");
  const [playersPreview, setPlayersPreview] = useState<PlayersPreviewResponse | null>(null);
  const [playersSearch, setPlayersSearch] = useState("");
  const [playersPosition, setPlayersPosition] = useState("");
  const [playersFixText, setPlayersFixText] = useState("");
  const [resetSummary, setResetSummary] = useState<SeasonPredictionResetSummaryResponse | null>(null);
  const [resetModal, setResetModal] = useState<SeasonPredictionResetAction | null>(null);
  const [resetConfirm, setResetConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const didInitialLoadRef = useRef(false);
  const autoLoadedPlayersRef = useRef<string | null>(null);

  const selectedTournament = tournaments.find((item) => item.tournament_code === selectedCode) || null;
  const editorSteps = selectedTournament?.tournament_type === "european" ? EDITOR_STEPS_EUROPEAN : EDITOR_STEPS_TOP_LEAGUE;
  // Guard: when switching between top-5 / eurocup the active step may not exist for
  // the new type (e.g. "zones" is top-5 only) — fall back to overview so the panel
  // never renders blank.
  const activeStep: EditorStep = editorSteps.some((s) => s.id === step) ? step : "overview";

  const fillEditor = useCallback((tournament: AdminTournament) => {
    setSelectedCode(tournament.tournament_code);
    setTitle(tournament.title);
    setStatus(tournament.status);
    setTeamCount(String(tournament.team_count || 0));
    setOpenAt(formatDateInput(tournament.open_at));
    setDeadlineAt(formatDateInput(tournament.deadline_at));
    setAwardsOpenAt(formatDateInput(tournament.awards_open_at));
    setAwardsDeadlineAt(formatDateInput(tournament.awards_deadline_at));
    setSettingsJson(JSON.stringify(tournament.settings || {}, null, 2));
    setZonesJson(JSON.stringify(tournament.rules?.zones || {}, null, 2));
    setPlayoffRulesJson(JSON.stringify(tournament.rules?.playoff || {}, null, 2));
    const parsedZones = parseZonesObject(tournament.rules?.zones || {});
    setZones(parsedZones.zones);
    setZonesExtra(parsedZones.extra);
    setZoneError("");
    setJsonError({});
    setTeamsText(teamsToText(tournament.teams || []));
    setAwardOptionsText(awardOptionsToText(tournament.award_options || []));
    setPlayers([]);
    setPlayersCounts({});
    setPlayersText("");
    setPlayersPreview(null);
    setTeamsPreview(null);
    setAwardPreview(null);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<AdminConfigResponse>("/admin/season-predictions/config");
      if (!res) return;
      setSeason(res.season);
      setTournaments(res.tournaments || []);
      const next = res.tournaments.find((item) => item.tournament_code === selectedCode) || res.tournaments[0] || null;
      if (next) fillEditor(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, fillEditor, selectedCode]);

  const patchTournament = (updated: AdminTournament) => {
    setTournaments((prev) => prev.map((item) => item.tournament_code === updated.tournament_code ? updated : item));
    fillEditor(updated);
  };

  const reloadTournament = async (code: SeasonPredictionTournamentCode) => {
    const res = await fetchWithAuth<AdminConfigResponse>("/admin/season-predictions/config");
    if (!res) return;
    setSeason(res.season);
    setTournaments(res.tournaments || []);
    const next = res.tournaments.find((item) => item.tournament_code === code);
    if (next) fillEditor(next);
  };

  const loadResetSummary = useCallback(async () => {
    const res = await fetchWithAuth<SeasonPredictionResetSummaryResponse>("/admin/season-predictions/reset/summary");
    if (res) setResetSummary(res);
  }, [fetchWithAuth]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    void loadConfig();
    void loadResetSummary();
  }, [loadConfig, loadResetSummary]);

  // Auto-load the saved player catalog when the Players tab opens for a tournament,
  // so re-entering admin never shows an empty catalog (data is in D1, just unread).
  // Guarded per tournament code so it fetches once per selection, not every render.
  useEffect(() => {
    if (activeStep !== "players") return;
    const code = selectedTournament?.tournament_code;
    if (!code || autoLoadedPlayersRef.current === code) return;
    autoLoadedPlayersRef.current = code;
    void loadPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, selectedTournament?.tournament_code]);

  const saveSettings = async () => {
    if (!selectedTournament) return;
    setSaving("settings");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; tournament: SeasonPredictionTournament }>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title,
            status,
            team_count: Number(teamCount),
            open_at: dateInputToUnixSeconds(openAt),
            deadline_at: dateInputToUnixSeconds(deadlineAt),
            awards_open_at: dateInputToUnixSeconds(awardsOpenAt),
            awards_deadline_at: dateInputToUnixSeconds(awardsDeadlineAt),
            settings_json: parseJsonText(settingsJson, {}),
          }),
        }
      );
      if (!res) return;
      patchTournament({ ...selectedTournament, ...res.tournament });
      setNotice("Настройки турнира сохранены.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить настройки");
    } finally {
      setSaving("");
    }
  };

  const teamCountValue = Number(teamCount) || Number(selectedTournament?.team_count) || 0;
  const zoneValidation = validateZones(zones, teamCountValue);

  // Advanced JSON helpers — structured form stays the source of truth; the raw
  // textareas are validated explicitly and only applied on demand (no per-keystroke
  // two-way sync). settings_json round-trips fully via its raw string.
  const checkAdvancedJson = (): boolean => {
    const errs: { settings?: string; zones?: string; playoff?: string } = {};
    try { JSON.parse((settingsJson || "").trim() || "{}"); } catch { errs.settings = "Невалидный JSON"; }
    try { JSON.parse((zonesJson || "").trim() || "{}"); } catch { errs.zones = "Невалидный JSON"; }
    try { JSON.parse((playoffRulesJson || "").trim() || "{}"); } catch { errs.playoff = "Невалидный JSON"; }
    setJsonError(errs);
    if (Object.keys(errs).length === 0) { setNotice("JSON валиден."); setError(""); return true; }
    setError("JSON содержит ошибки — см. подсветку полей."); return false;
  };

  const applyJsonToForm = () => {
    if (!checkAdvancedJson()) return;
    const parsed = parseZonesObject(parseJsonText(zonesJson, {}));
    setZones(parsed.zones);
    setZonesExtra(parsed.extra);
    setZoneError("");
    setNotice("JSON применён к форме. Не забудьте сохранить.");
  };

  const resetJsonFromForm = () => {
    setZonesJson(JSON.stringify(buildZonesObject(zones, zonesExtra), null, 2));
    setJsonError({});
    setNotice("Raw JSON зон пересобран из формы.");
  };

  const saveRules = async () => {
    if (!selectedTournament) return;
    const validation = validateZones(zones, teamCountValue);
    if (!validation.ok) {
      setZoneError(validation.general.join(" · ") || "Проверьте диапазоны зон.");
      setError("Зоны не сохранены: исправьте ошибки диапазонов.");
      return;
    }
    setZoneError("");
    setSaving("rules");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; tournament: SeasonPredictionTournament }>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/rules`,
        {
          method: "PUT",
          body: JSON.stringify({
            zones_json: buildZonesObject(zones, zonesExtra),
            playoff_rules_json: parseJsonText(playoffRulesJson, {}),
          }),
        }
      );
      if (!res) return;
      patchTournament({ ...selectedTournament, ...res.tournament });
      setNotice("Правила зон сохранены.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setSaving("");
    }
  };

  const saveTeams = async () => {
    if (!selectedTournament) return;
    setSaving("teams");
    setError("");
    setNotice("");
    try {
      const teams = parseTeamsText(teamsText);
      await fetchWithAuth(`/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/teams`, {
        method: "PUT",
        body: JSON.stringify({ teams }),
      });
      await reloadTournament(selectedTournament.tournament_code);
      setNotice("Список команд сохранен.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить команды");
    } finally {
      setSaving("");
    }
  };

  const saveAwardOptions = async () => {
    if (!selectedTournament) return;
    setSaving("awards");
    setError("");
    setNotice("");
    try {
      const awardOptions = parseAwardOptionsText(awardOptionsText);
      await fetchWithAuth(`/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/award-options`, {
        method: "PUT",
        body: JSON.stringify({ award_options: awardOptions }),
      });
      await reloadTournament(selectedTournament.tournament_code);
      setNotice("Варианты индивидуальных наград сохранены.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить варианты наград");
    } finally {
      setSaving("");
    }
  };

  const previewImportTeams = async () => {
    if (!selectedTournament) return;
    setSaving("import-teams-preview");
    setError("");
    setNotice("");
    try {
      const trimmedCompetitionId = importCompetitionId.trim();
      const res = await fetchWithAuth<TeamsPreviewResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-teams/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: importProvider,
            season: importSeason,
            provider_competition_id: trimmedCompetitionId || null,
          }),
        }
      );
      if (!res) return;
      setTeamsPreview(res);
      setNotice(`Preview команд получен: ${res.actualTeamCount}/${res.expectedTeamCount}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось получить команды из API");
    } finally {
      setSaving("");
    }
  };

  const confirmImportTeams = async () => {
    if (!selectedTournament || !teamsPreview) return;
    setSaving("import-teams-confirm");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; warnings?: string[] }>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-teams/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: teamsPreview.provider,
            teams: teamsPreview.teams,
          }),
        }
      );
      if (!res) return;
      await reloadTournament(selectedTournament.tournament_code);
      setTeamsPreview(null);
      setNotice(["Команды из API сохранены.", ...(res.warnings || [])].join(" "));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить импортированные команды");
    } finally {
      setSaving("");
    }
  };

  const previewImportAwards = async () => {
    if (!selectedTournament) return;
    setSaving("import-awards-preview");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<AwardsPreviewResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-award-options/preview`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: importProvider,
            season: importSeason,
            award_type: awardImportType,
            limit: Number(awardImportLimit || 30),
          }),
        }
      );
      if (!res) return;
      setAwardPreview(res);
      setNotice(`Preview кандидатов получен: ${res.options.length}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось получить кандидатов из API");
    } finally {
      setSaving("");
    }
  };

  const confirmImportAwards = async () => {
    if (!selectedTournament || !awardPreview) return;
    setSaving("import-awards-confirm");
    setError("");
    setNotice("");
    try {
      await fetchWithAuth(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-award-options/confirm`,
        {
          method: "POST",
          body: JSON.stringify({
            award_type: awardPreview.award_type,
            options: awardPreview.options,
            clear: awardPreview.options.length === 0,
          }),
        }
      );
      await reloadTournament(selectedTournament.tournament_code);
      setAwardPreview(null);
      setNotice("Кандидаты индивидуальной награды сохранены.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить кандидатов");
    } finally {
      setSaving("");
    }
  };

  const loadPlayers = async () => {
    if (!selectedTournament) return;
    setSaving("players-load");
    setError("");
    try {
      const params = new URLSearchParams({ limit: "1000" });
      if (playersSearch.trim()) params.set("search", playersSearch.trim());
      if (playersPosition) params.set("position_group", playersPosition);
      const res = await fetchWithAuth<PlayersResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/players?${params.toString()}`,
      );
      if (!res) return;
      const isFiltered = Boolean(playersSearch.trim() || playersPosition);
      setPlayers(res.players || []);
      setPlayersCounts(res.counts || {});
      if (!isFiltered) setPlayersText(playersToText(res.players || []));
      if ((res.warnings || []).length > 0) {
        setNotice((res.warnings || []).join(" "));
      } else if ((res.players || []).length === 0) {
        setNotice("Игроки турнира ещё не загружены. Используйте API preview игроков или вставьте CSV и сохраните.");
      } else {
        setNotice(`Игроки турнира загружены: ${(res.players || []).length}.`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить игроков");
    } finally {
      setSaving("");
    }
  };

  const savePlayers = async () => {
    if (!selectedTournament) return;
    setSaving("players-save");
    setError("");
    setNotice("");
    try {
      const previewPlayers = playersPreview?.players || [];
      const hasText = playersText.trim().length > 0;
      if (!hasText && previewPlayers.length === 0) {
        setError("Добавьте игроков в CSV textarea или сначала получите API preview.");
        return;
      }
      const res = await fetchWithAuth<PlayersResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/players`,
        {
          method: "PUT",
          body: JSON.stringify(hasText
            ? { text: playersText, replace: true, force: true }
            : { players: previewPlayers, replace: true, force: true }),
        },
      );
      if (!res) return;
      setPlayers(res.players || []);
      setPlayersCounts(res.counts || {});
      setPlayersText(playersToText(res.players || []));
      if (!hasText) setPlayersPreview(null);
      setNotice(`Игроки турнира сохранены: ${(res.players || []).length}. ${(res.warnings || []).slice(0, 2).join(" ")}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить игроков");
    } finally {
      setSaving("");
    }
  };

  const previewImportPlayers = async () => {
    if (!selectedTournament) return;
    setSaving("players-preview");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<PlayersPreviewResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-players/preview`,
        { method: "POST", body: JSON.stringify({ provider: importProvider, season: importSeason }) },
      );
      if (!res) return;
      setPlayersPreview(res);
      setNotice(`Preview игроков: ${(res.players || []).length}, команд matched: ${res.teams_matched}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось получить игроков из API");
    } finally {
      setSaving("");
    }
  };

  const confirmImportPlayers = async () => {
    if (!selectedTournament || !playersPreview) return;
    setSaving("players-confirm");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<PlayersResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-players/confirm`,
        { method: "POST", body: JSON.stringify({ players: playersPreview.players, replace: true, force: true }) },
      );
      if (!res) return;
      setPlayers(res.players || []);
      setPlayersCounts(res.counts || {});
      setPlayersText(playersToText(res.players || []));
      setPlayersPreview(null);
      setNotice(`Игроки из API сохранены: ${(res.players || []).length}.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить игроков из API");
    } finally {
      setSaving("");
    }
  };

  // One-click: pull rosters for the already-saved teams and replace the catalog.
  const syncPlayersFromProvider = async () => {
    if (!selectedTournament) return;
    setSaving("players-sync");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<SyncPlayersResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/import-players/sync`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: importProvider,
            season: importSeason,
            provider_competition_id: importCompetitionId.trim() || null,
          }),
        },
      );
      if (!res) return;
      setPlayers(res.players || []);
      setPlayersCounts(res.counts || {});
      setPlayersText(playersToText(res.players || []));
      if (res.ok === false) {
        setError(`Провайдер не вернул игроков (команд matched: ${res.teams_matched ?? 0}). ${(res.warnings || []).slice(0, 2).join(" ")} Каталог не изменён — проверьте, что команды импортированы тем же провайдером.`.trim());
        return;
      }
      setPlayersPreview(null);
      setNotice(`Игроки синхронизированы из провайдера: ${(res.players || []).length} (команд matched: ${res.teams_matched ?? 0}). ${(res.warnings || []).slice(0, 2).join(" ")}`.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось синхронизировать игроков");
    } finally {
      setSaving("");
    }
  };

  const fixPlayerPositions = async () => {
    if (!selectedTournament || !playersFixText.trim()) return;
    setSaving("players-fix");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<PlayersResponse>(
        `/admin/season-predictions/tournaments/${selectedTournament.tournament_code}/players/positions`,
        { method: "PUT", body: JSON.stringify({ text: playersFixText }) },
      );
      if (!res) return;
      setPlayers(res.players || []);
      setPlayersCounts(res.counts || {});
      setPlayersText(playersToText(res.players || []));
      setPlayersFixText("");
      const warn = (res.warnings || []).slice(0, 3).join(" ");
      setNotice(`Позиции обновлены: ${res.matched ?? 0} из ${res.requested ?? 0}. ${warn}`.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось обновить позиции");
    } finally {
      setSaving("");
    }
  };

  const openResetModal = (action: SeasonPredictionResetAction) => {
    setResetModal(action);
    setResetConfirm("");
    setError("");
    setNotice("");
  };

  const closeResetModal = () => {
    if (saving.startsWith("reset-")) return;
    setResetModal(null);
    setResetConfirm("");
  };

  const executeReset = async () => {
    if (!resetModal || !resetSummary || resetConfirm.trim() !== resetModal.confirm) return;
    setSaving(`reset-${resetModal.id}`);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<SeasonPredictionResetResponse>(`/admin/season-predictions/reset/${resetModal.id}`, {
        method: "POST",
        body: JSON.stringify({
          seasonCode: resetSummary.seasonCode,
          confirm: resetConfirm.trim(),
        }),
      });
      if (!res) return;
      setResetSummary({ ok: true, seasonCode: res.seasonCode, counts: res.counts });
      setResetModal(null);
      setResetConfirm("");
      await loadConfig();
      setNotice(`Сброс выполнен: удалено ${sumResetCounts(res.deleted)} записей.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить тестовый сброс");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Прогнозы сезона</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              {season?.title || "Сезон 2026/27"} · {tournamentGroup === "top_league" ? "настройка топ-5 лиг" : "настройка еврокубков"}
            </div>
          </div>
          <AdminButton size="sm" variant="secondary" onClick={loadConfig} disabled={loading}>
            {loading ? "..." : "Обновить"}
          </AdminButton>
        </div>
        {error && <AdminBadge variant="danger" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{error}</AdminBadge>}
        {notice && <AdminBadge variant="success" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{notice}</AdminBadge>}
      </AdminCard>

      <SeasonPredictionsStats fetchWithAuth={fetchWithAuth} />

      {/* Group filter: top-5 leagues / european cups / weekly challenge / ballon d'or.
          Четыре чипа в один ряд на телефоне не помещаются — сетка 2×2. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        {TOURNAMENT_GROUPS.map((group) => {
          const active = group.id === tournamentGroup;
          const countLabel = GROUP_SUBLABEL[group.id]
            || `${tournaments.filter((t) => t.tournament_type === group.id).length} турниров`;
          return (
            <button
              key={group.id}
              type="button"
              data-testid={`season-predictions-group-${group.id}`}
              onClick={() => {
                if (group.id === tournamentGroup) return;
                setTournamentGroup(group.id);
                setStep("overview");
                if (!STANDALONE_GROUPS.includes(group.id)) {
                  const next = tournaments.find((item) => item.tournament_type === group.id);
                  if (next) fillEditor(next);
                  else setSelectedCode(null);
                }
              }}
              style={{
                minHeight: 38,
                border: "none",
                borderRadius: 12,
                background: active ? "var(--tg-button, #2481cc)" : "var(--tg-bg, rgba(255,255,255,0.08))",
                color: active ? "var(--tg-button-text, #fff)" : "var(--tg-text, #fff)",
                fontWeight: 900,
                fontSize: 13,
                letterSpacing: "-0.01em",
                cursor: "pointer",
              }}
            >
              {group.label}
              <span style={{ display: "block", marginTop: 1, fontSize: 11, opacity: 0.75, fontWeight: 700 }}>
                {countLabel}
              </span>
            </button>
          );
        })}
      </div>

      {tournamentGroup === "weekly_challenge" ? (
        <WeeklyChallengeAdminSection fetchWithAuth={fetchWithAuth} />
      ) : tournamentGroup === "ballon_dor" ? (
        <BallonDorOfficialTab fetchWithAuth={fetchWithAuth} />
      ) : (
        <>
          {(() => {
            const visible = tournaments.filter((t) => t.tournament_type === tournamentGroup);
            if (visible.length === 0) {
              return (
                <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">
                  В этой группе пока нет турниров.
                </AdminBadge>
              );
            }
            return (
              <div className="sg-hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}>
                {visible.map((tournament) => (
                  <button
                    key={tournament.tournament_code}
                    type="button"
                    onClick={() => { fillEditor(tournament); setStep("overview"); }}
                    style={{
                      flex: "0 0 auto",
                      border: "none",
                      borderRadius: 14,
                      padding: "10px 12px",
                      background: selectedCode === tournament.tournament_code ? "var(--tg-button, #2481cc)" : "var(--tg-bg, rgba(255,255,255,0.08))",
                      color: selectedCode === tournament.tournament_code ? "var(--tg-button-text, #fff)" : "var(--tg-text, #fff)",
                      fontWeight: 900,
                    }}
                  >
                    {tournament.title}
                    <span style={{ display: "block", marginTop: 2, fontSize: 11, opacity: 0.75 }}>
                      {(tournament.teams || []).length}/{tournament.team_count}
                    </span>
                  </button>
                ))}
              </div>
            );
          })()}
        </>
      )}

      {/* Пошаговый редактор турнира — только для потурнирных групп. Он живёт
          отдельным блоком и завязан на selectedTournament, а тот сохраняет
          последнюю выбранную лигу: без этой проверки под «Золотым мячом» снизу
          вылезала АПЛ с её командами и зонами. */}
      {!STANDALONE_GROUPS.includes(tournamentGroup) && selectedTournament && (
        <>
          {/* Wizard step navigation — one section at a time instead of a long scroll. */}
          <AdminSegmentedControl<EditorStep>
            ariaLabel="Шаги настройки турнира"
            value={activeStep}
            onChange={setStep}
            options={editorSteps.map((s): AdminSegmentOption<EditorStep> => ({ value: s.id, label: s.label }))}
          />

          {activeStep === "overview" && (() => {
            const teamsHave = (selectedTournament.teams || []).length;
            const teamsNeed = Number(selectedTournament.team_count || 0);
            const teamsReady = teamsNeed > 0 && teamsHave === teamsNeed;
            const zonesCount = Object.keys(selectedTournament.rules?.zones || {}).length;
            const awardsCount = (selectedTournament.award_options || []).length;
            const scheduleReady = Boolean(selectedTournament.open_at && selectedTournament.deadline_at);
            const isTop = selectedTournament.tournament_type === "top_league";
            const chip = (ok: boolean) => (
              <UiBadge variant={ok ? "success" : "warning"} size="sm">{ok ? "готово" : "нужно"}</UiBadge>
            );
            const jump = (target: EditorStep, label: string) => (
              <UiButton size="sm" variant="secondary" onClick={() => setStep(target)}>{label}</UiButton>
            );
            return (
              <AdminCard className="space-y-3">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 16, fontWeight: 950 }}>{selectedTournament.title}</div>
                  <UiBadge variant={selectedTournament.status === "open" ? "success" : "warning"} size="sm">{tournamentStatusLabel(selectedTournament.status)}</UiBadge>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <AdminMetricCard size="sm" label="Команды" value={`${teamsHave}/${teamsNeed}`} badge={chip(teamsReady)} />
                  {isTop && <AdminMetricCard size="sm" label="Зоны" value={zonesCount} badge={chip(zonesCount > 0)} />}
                  {isTop && <AdminMetricCard size="sm" label="Награды" value={awardsCount} badge={chip(awardsCount > 0)} />}
                  <AdminMetricCard size="sm" label="Расписание" value={scheduleReady ? "задано" : "нет"} badge={chip(scheduleReady)} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {jump("settings", "→ Настройки")}
                  {jump("teams", "→ Команды")}
                  {isTop && jump("zones", "→ Зоны")}
                  {isTop && jump("players", "→ Игроки")}
                  {isTop && jump("awards", "→ Награды")}
                  {jump("results", "→ Результаты")}
                </div>
                <div className="text-[11.5px] font-semibold leading-snug text-[var(--tg-hint,#999)]">
                  Пошаговая настройка турнира. Каждый шаг сохраняется отдельно — переключение вкладок не теряет несохранённые поля.
                </div>
              </AdminCard>
            );
          })()}

          {activeStep === "settings" && (
            <AdminCard>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <UiInput label="Название" value={title} onChange={(event) => setTitle(event.target.value)} />
                <UiSelect label="Статус" value={status} onChange={setStatus} options={TOURNAMENT_STATUS_OPTIONS} />
                <UiInput label="Команд" type="number" min={2} max={40} value={teamCount} onChange={(event) => setTeamCount(event.target.value)} />
                <UiInput label="Открытие (МСК)" type="datetime-local" value={openAt} onChange={(event) => setOpenAt(event.target.value)} />
                <UiInput label="Дедлайн (МСК)" type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} />
              </div>
              {selectedTournament.tournament_type === "top_league" && (
                <div className="mt-3 space-y-2 rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_14%,transparent)] p-3">
                  <div className="text-[12px] font-extrabold">Окно индивидуальных наград</div>
                  <div className="text-[11.5px] font-semibold leading-snug text-[var(--tg-hint,#999)]">
                    Независимо от дедлайна таблицы. Пусто → награды следуют за дедлайном таблицы. Если открытие в будущем — на секции наград у игрока показывается «Скоро».
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <UiInput label="Открытие наград (МСК)" type="datetime-local" value={awardsOpenAt} onChange={(event) => setAwardsOpenAt(event.target.value)} />
                    <UiInput label="Дедлайн наград (МСК)" type="datetime-local" value={awardsDeadlineAt} onChange={(event) => setAwardsDeadlineAt(event.target.value)} />
                  </div>
                </div>
              )}
              <div className="mt-3">
                <UiButton onClick={saveSettings} loading={saving === "settings"} fullWidth>Сохранить настройки</UiButton>
              </div>
            </AdminCard>
          )}

          {activeStep === "zones" && (
          <AdminCollapsibleSection title="Зоны таблицы" description={`${zones.length} зон · команд ${teamCountValue}`} defaultOpen keepMounted storageKey="admin:season-predictions:tournament-zones">
            <AdminCard className="space-y-3">
              <div className="text-[12px] leading-snug text-[var(--tg-hint,#999)]">
                Диапазоны итоговых мест: ключ зоны + места «с/по». Сохраняется в zones_json как {`{ ключ: [от, до] }`}.
              </div>
              {zoneError && (
                <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-2 text-[12px] font-semibold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text,#fff))]">{zoneError}</div>
              )}
              {zoneValidation.general.length > 0 && (
                <div className="rounded-2xl border border-[color-mix(in_srgb,#ffb340_40%,transparent)] bg-[color-mix(in_srgb,#ffb340_12%,transparent)] px-3 py-2 text-[12px] font-semibold text-[color-mix(in_srgb,#ffb340_90%,var(--tg-text,#fff))]">
                  {zoneValidation.general.join(" · ")}
                </div>
              )}
              <div className="space-y-2">
                {zones.map((zone, i) => (
                  <div key={i} className="space-y-2 rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-secondary-bg,#111827)_60%,var(--tg-bg,#0b0f19))] p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_92px_92px_auto] sm:items-end">
                      <UiInput label="Ключ зоны" value={zone.key} onChange={(event) => setZones((prev) => prev.map((z, idx) => idx === i ? { ...z, key: event.target.value } : z))} />
                      <UiInput label="С места" type="number" min={1} value={zone.from} onChange={(event) => setZones((prev) => prev.map((z, idx) => idx === i ? { ...z, from: event.target.value } : z))} />
                      <UiInput label="По место" type="number" min={1} value={zone.to} onChange={(event) => setZones((prev) => prev.map((z, idx) => idx === i ? { ...z, to: event.target.value } : z))} />
                      <UiButton variant="danger" size="sm" aria-label={`Удалить зону ${zone.key || i + 1}`} onClick={() => setZones((prev) => prev.filter((_, idx) => idx !== i))}>Удалить</UiButton>
                    </div>
                    {zoneValidation.fieldErrors[i] && (
                      <div className="text-[11.5px] font-bold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text,#fff))]">{zoneValidation.fieldErrors[i]}</div>
                    )}
                  </div>
                ))}
                {zones.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--tg-hint,#8a8a8a)_22%,transparent)] py-6 text-center text-[12px] text-[var(--tg-hint,#999)]">Зоны не заданы.</div>
                )}
              </div>
              <UiButton variant="secondary" size="sm" onClick={() => setZones((prev) => [...prev, { key: "", from: "1", to: "1" }])}>+ Добавить зону</UiButton>
              {Object.keys(zonesExtra).length > 0 && (
                <div className="text-[11px] text-[var(--tg-hint,#999)]">Доп. поля zones_json сохраняются без изменений: {Object.keys(zonesExtra).join(", ")}</div>
              )}
              <UiButton onClick={saveRules} loading={saving === "rules"} fullWidth>Сохранить правила зон</UiButton>
            </AdminCard>
          </AdminCollapsibleSection>
          )}

          {activeStep === "advanced" && (
          <AdminCollapsibleSection title="Расширенные настройки JSON" description="Прямое редактирование raw JSON" badge={<UiBadge variant="warning" size="sm">осторожно</UiBadge>} keepMounted storageKey="admin:season-predictions:tournament-json">
            <AdminCard className="space-y-3">
              <div className="rounded-2xl border border-[color-mix(in_srgb,#ffb340_36%,transparent)] bg-[color-mix(in_srgb,#ffb340_12%,transparent)] px-3 py-2 text-[12px] font-semibold leading-snug text-[color-mix(in_srgb,#ffb340_90%,var(--tg-text,#fff))]">
                ⚠️ Ручное редактирование может сломать конфигурацию. settings_json сохраняется кнопкой «Сохранить настройки», зоны — кнопкой «Сохранить правила зон».
              </div>
              <UiTextarea label="settings_json" value={settingsJson} onChange={(event) => setSettingsJson(event.target.value)} error={jsonError.settings} minRows={5} />
              <UiTextarea label="zones_json" value={zonesJson} onChange={(event) => setZonesJson(event.target.value)} error={jsonError.zones} minRows={6} />
              <UiTextarea label="playoff_rules_json" value={playoffRulesJson} onChange={(event) => setPlayoffRulesJson(event.target.value)} error={jsonError.playoff} minRows={4} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <UiButton variant="secondary" size="sm" onClick={checkAdvancedJson} className="sm:flex-1">Проверить JSON</UiButton>
                <UiButton variant="secondary" size="sm" onClick={applyJsonToForm} className="sm:flex-1">Применить к форме</UiButton>
                <UiButton variant="ghost" size="sm" onClick={resetJsonFromForm} className="sm:flex-1">Сбросить из формы</UiButton>
              </div>
              <div className="text-[11px] text-[var(--tg-hint,#999)]">«Применить к форме» переносит zones_json в визуальный редактор. playoff_rules_json сохраняется как есть вместе с зонами.</div>
            </AdminCard>
          </AdminCollapsibleSection>
          )}

          {activeStep === "teams" && (
          <>
          <AdminCard>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Команды</div>
            <div style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Формат: Team Name|Short Name|Crest URL. Нужно ровно {teamCount || selectedTournament.team_count} строк.
            </div>
            <textarea value={teamsText} onChange={(event) => setTeamsText(event.target.value)} style={textAreaStyle} placeholder={"Arsenal|ARS|\nChelsea|CHE|"} />
            <AdminButton onClick={saveTeams} disabled={saving === "teams"} className="w-full mt-3">
              {saving === "teams" ? "Сохраняю..." : "Сохранить команды"}
            </AdminButton>
          </AdminCard>

          <AdminCard>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Импорт команд из API</div>
            <div style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Preview не меняет БД. Сохранение заменит текущие команды только после подтверждения.
              {selectedTournament.tournament_type === "european" && (
                <span> Для еврокубков укажите Provider competition ID, если статический маппинг отсутствует.</span>
              )}
            </div>
            {selectedTournament.tournament_type === "top_league" && importProvider === "allsports" && (
              <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto mb-2">
                AllSports (footapi7) берёт команды из турнирной таблицы — в межсезонье, пока не сыгран тур, вернёт пусто/404, и требует активной подписки RapidAPI. Для топ-5 в начале сезона надёжнее Football-Data: у него отдельный список команд, работающий до старта.
              </AdminBadge>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={inputLabelStyle}>
                Provider
                <select value={importProvider} onChange={(event) => setImportProvider(event.target.value as "football-data" | "allsports")} style={selectStyle}>
                  <option value="football-data">Football-Data</option>
                  <option value="allsports">AllSports</option>
                </select>
              </label>
              <label style={inputLabelStyle}>
                Сезон
                <AdminInput value={importSeason} onChange={(event) => setImportSeason(event.target.value)} placeholder="2026" />
              </label>
            </div>
            <label style={{ ...inputLabelStyle, marginTop: 10 }}>
              Provider competition ID <span style={{ color: "var(--tg-hint, #999)", fontWeight: 700 }}>· опционально</span>
              <AdminInput
                value={importCompetitionId}
                onChange={(event) => setImportCompetitionId(event.target.value)}
                placeholder={importProvider === "football-data" ? "CL / EL / UECL" : "числовой unique_tournament_id"}
              />
            </label>
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, lineHeight: 1.45 }}>
              Перебивает статический маппинг и settings_json. Оставьте пустым, чтобы использовать сохранённые значения турнира.
            </div>
            <AdminButton onClick={previewImportTeams} disabled={saving === "import-teams-preview"} className="w-full mt-3">
              {saving === "import-teams-preview" ? "Загружаю..." : "Получить команды из API"}
            </AdminButton>
            {teamsPreview && (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <AdminBadge variant={teamsPreview.actualTeamCount === teamsPreview.expectedTeamCount ? "success" : "warning"} className="w-full justify-start p-3 whitespace-normal h-auto">
                  Preview: {teamsPreview.actualTeamCount}/{teamsPreview.expectedTeamCount} команд
                </AdminBadge>
                {teamsPreview.warnings.map((warning) => (
                  <AdminBadge key={warning} variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">{warning}</AdminBadge>
                ))}
                <div style={previewListStyle}>
                  {teamsPreview.teams.slice(0, 40).map((team, index) => (
                    <div key={`${team.provider_team_id || team.team_name}-${index}`} style={previewRowStyle}>
                      <span>{index + 1}. {team.team_name}</span>
                      <b>{team.short_name || team.provider_team_id || "-"}</b>
                    </div>
                  ))}
                </div>
                <AdminButton
                  onClick={confirmImportTeams}
                  disabled={saving === "import-teams-confirm" || teamsPreview.actualTeamCount !== teamsPreview.expectedTeamCount}
                  className="w-full"
                >
                  {saving === "import-teams-confirm" ? "Сохраняю..." : "Сохранить команды турнира"}
                </AdminButton>
              </div>
            )}
          </AdminCard>
          </>
          )}

          {activeStep === "players" && (
          <AdminCard>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Игроки турнира</div>
            <div style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Каталог для выбора индивидуальных наград. Формат: Player Name|Team Name|Position|Provider Player ID|Photo URL.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 150px auto", gap: 8, alignItems: "end" }}>
              <label style={inputLabelStyle}>
                Поиск
                <AdminInput value={playersSearch} onChange={(event) => setPlayersSearch(event.target.value)} placeholder="Haaland" />
              </label>
              <label style={inputLabelStyle}>
                Позиция
                <select value={playersPosition} onChange={(event) => setPlayersPosition(event.target.value)} style={selectStyle}>
                  <option value="">Все</option>
                  <option value="goalkeeper">Вратари</option>
                  <option value="defender">Защитники</option>
                  <option value="midfielder">Полузащитники</option>
                  <option value="forward">Нападающие</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <AdminButton size="sm" variant="secondary" onClick={loadPlayers} disabled={saving === "players-load"}>
                Обновить
              </AdminButton>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(95px, 1fr))", gap: 6, marginTop: 10 }}>
              <div style={{ borderRadius: 10, padding: "8px 10px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))" }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: "var(--tg-hint, #999)" }}>total</div>
                <div style={{ fontSize: 15, fontWeight: 950 }}>{Object.values(playersCounts).reduce((sum, count) => sum + Number(count || 0), 0)}</div>
              </div>
              {["goalkeeper", "defender", "midfielder", "forward", "unknown"].map((key) => (
                <div key={key} style={{ borderRadius: 10, padding: "8px 10px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))" }}>
                  <div style={{ fontSize: 10, fontWeight: 900, color: "var(--tg-hint, #999)" }}>{key}</div>
                  <div style={{ fontSize: 15, fontWeight: 950 }}>{playersCounts[key] || 0}</div>
                </div>
              ))}
            </div>
            {(playersCounts.unknown || 0) > 0 && (
              <>
                <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">
                  У {playersCounts.unknown} игроков неизвестная позиция — они не попадут в выбор индивидуальных наград. Система пытается определить позицию автоматически из Position/role/type/metadata; если данных нет, исправьте вручную ниже.
                </AdminBadge>
                <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))" }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>Быстрое исправление позиций</div>
                  <div style={{ margin: "4px 0 8px", fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, lineHeight: 1.45 }}>
                    Формат: <b>Имя игрока|Позиция</b> или <b>Provider Player ID|Позиция</b>. Позиция: Вратарь/Защитник/Полузащитник/Нападающий (или GK/DF/MF/FW). Одна строка на игрока.
                  </div>
                  <textarea
                    value={playersFixText}
                    onChange={(event) => setPlayersFixText(event.target.value)}
                    style={{ ...textAreaStyle, minHeight: 90 }}
                    placeholder={"Erling Haaland|Нападающий\nfd:123|Полузащитник\nAlisson|GK"}
                  />
                  <AdminButton onClick={fixPlayerPositions} disabled={saving === "players-fix" || !playersFixText.trim()} className="w-full mt-2">
                    {saving === "players-fix" ? "Обновляю..." : "Применить позиции"}
                  </AdminButton>
                </div>
              </>
            )}
            <textarea
              value={playersText}
              onChange={(event) => setPlayersText(event.target.value)}
              style={{ ...textAreaStyle, marginTop: 10 }}
              placeholder={"Erling Haaland|Manchester City|Forward|fd:123|\nBruno Fernandes|Manchester United|Midfielder|fd:456|\nAlisson|Liverpool|Goalkeeper|fd:789|"}
            />
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))" }}>
              <div style={{ fontSize: 13, fontWeight: 900 }}>Синхронизация из провайдера</div>
              <div style={{ margin: "4px 0 10px", fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, lineHeight: 1.45 }}>
                Резолвит команды лиги по провайдеру+сезону (как импорт команд), тянет их ростеры и заменяет каталог одним нажатием. Работает даже если команды заведены по именам без ID. Для AllSports укажите числовой competition ID (АПЛ = 17, Ла Лига = 8, Серия A = 23, Бундеслига = 35, Лига 1 = 34).
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={inputLabelStyle}>
                  Provider
                  <select value={importProvider} onChange={(event) => setImportProvider(event.target.value as "football-data" | "allsports")} style={selectStyle}>
                    <option value="football-data">Football-Data</option>
                    <option value="allsports">AllSports</option>
                  </select>
                </label>
                <label style={inputLabelStyle}>
                  Сезон
                  <AdminInput value={importSeason} onChange={(event) => setImportSeason(event.target.value)} placeholder="2026" />
                </label>
              </div>
              <label style={{ ...inputLabelStyle, marginTop: 10 }}>
                Provider competition ID <span style={{ color: "var(--tg-hint, #999)", fontWeight: 700 }}>· для AllSports</span>
                <AdminInput
                  value={importCompetitionId}
                  onChange={(event) => setImportCompetitionId(event.target.value)}
                  placeholder={importProvider === "football-data" ? "CL / EL / UECL" : "числовой unique_tournament_id (напр. 17)"}
                />
              </label>
              <AdminButton onClick={syncPlayersFromProvider} disabled={saving === "players-sync"} className="w-full mt-3">
                {saving === "players-sync" ? "Синхронизирую..." : "Синхронизировать игроков из провайдера"}
              </AdminButton>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <AdminButton variant="secondary" onClick={savePlayers} disabled={saving === "players-save"}>
                {saving === "players-save" ? "Сохраняю..." : "Сохранить из CSV"}
              </AdminButton>
              <AdminButton variant="secondary" onClick={previewImportPlayers} disabled={saving === "players-preview"}>
                {saving === "players-preview" ? "Загружаю..." : "API preview игроков"}
              </AdminButton>
            </div>
            {players.length === 0 && !playersText.trim() && (
              <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">
                В каталоге пока нет игроков. Кнопка “Обновить” читает сохранённых игроков; для загрузки из провайдера нажмите “API preview игроков”, затем сохраните preview.
              </AdminBadge>
            )}
            {playersPreview && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <AdminBadge variant={playersPreview.players.length ? "success" : "warning"} className="w-full justify-start p-3 whitespace-normal h-auto">
                  Preview: {playersPreview.players.length} игроков · teams matched {playersPreview.teams_matched}
                </AdminBadge>
                {playersPreview.counts && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(95px, 1fr))", gap: 6 }}>
                    {["goalkeeper", "defender", "midfielder", "forward", "unknown"].map((key) => (
                      <div key={key} style={{ borderRadius: 10, padding: "8px 10px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))" }}>
                        <div style={{ fontSize: 10, fontWeight: 900, color: "var(--tg-hint, #999)" }}>{key}</div>
                        <div style={{ fontSize: 15, fontWeight: 950 }}>{playersPreview.counts?.[key] || 0}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(playersPreview.unknown_samples || []).length > 0 && (
                  <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">
                    Unknown raw positions: {(playersPreview.unknown_samples || []).map((s) => `'${s}'`).join(", ")}
                  </AdminBadge>
                )}
                {playersPreview.warnings.map((warning) => (
                  <AdminBadge key={warning} variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">{warning}</AdminBadge>
                ))}
                <AdminButton onClick={confirmImportPlayers} disabled={saving === "players-confirm" || playersPreview.players.length === 0} className="w-full">
                  {saving === "players-confirm" ? "Сохраняю..." : "Сохранить preview игроков"}
                </AdminButton>
              </div>
            )}
            {players.length > 0 && (
              <div style={{ marginTop: 10, ...previewListStyle }}>
                {players.slice(0, 80).map((player) => (
                  <div key={player.id} style={previewRowStyle}>
                    <span>{player.player_name} · {player.team_name || "-"}</span>
                    <b>{player.position_group}</b>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
          )}

          {activeStep === "awards" && (
          <>
          {(() => {
            const catalogTotal = Object.values(playersCounts).reduce((sum, count) => sum + Number(count || 0), 0);
            return catalogTotal > 0 ? (
              <AdminBadge variant="success" className="w-full justify-start p-3 whitespace-normal h-auto mb-3">
                Каталог игроков заполнен ({catalogTotal}) — кандидаты на награды берутся из него автоматически, с фильтром по позиции (Золотая перчатка → вратари). Блоки ниже нужны только как запасной вариант при пустом каталоге или для еврокубков; их нулевой preview на топ-5 ни на что не влияет.
              </AdminBadge>
            ) : null;
          })()}
          <AdminCard>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Индивидуальные награды</div>
            <div style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Формат: award_type|player_name|team_name. Типы: top_scorer, top_assister/top_assistant, golden_glove.
            </div>
            <textarea value={awardOptionsText} onChange={(event) => setAwardOptionsText(event.target.value)} style={textAreaStyle} placeholder={"top_scorer|Erling Haaland|Manchester City\ntop_assister|Bukayo Saka|Arsenal\ngolden_glove|David Raya|Arsenal"} />
            <AdminButton onClick={saveAwardOptions} disabled={saving === "awards"} className="w-full mt-3">
              {saving === "awards" ? "Сохраняю..." : "Сохранить варианты"}
            </AdminButton>
          </AdminCard>

          <AdminCard>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Импорт кандидатов наград</div>
            <div style={{ margin: "4px 0 10px", fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Сохраняется только выбранный тип награды. Остальные списки не затрагиваются.
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={inputLabelStyle}>
                Тип награды
                <select value={awardImportType} onChange={(event) => setAwardImportType(event.target.value as "top_scorer" | "top_assistant" | "golden_glove")} style={selectStyle}>
                  <option value="top_scorer">Лучший бомбардир</option>
                  <option value="top_assistant">Лучший ассистент</option>
                  <option value="golden_glove">Золотая перчатка</option>
                </select>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px", gap: 10 }}>
                <label style={inputLabelStyle}>
                  Provider
                  <select value={importProvider} onChange={(event) => setImportProvider(event.target.value as "football-data" | "allsports")} style={selectStyle}>
                    <option value="football-data">Football-Data</option>
                    <option value="allsports">AllSports</option>
                  </select>
                </label>
                <label style={inputLabelStyle}>
                  Сезон
                  <AdminInput value={importSeason} onChange={(event) => setImportSeason(event.target.value)} placeholder="2026" />
                </label>
                <label style={inputLabelStyle}>
                  Лимит
                  <AdminInput type="number" min={1} max={100} value={awardImportLimit} onChange={(event) => setAwardImportLimit(event.target.value)} />
                </label>
              </div>
            </div>
            <AdminButton onClick={previewImportAwards} disabled={saving === "import-awards-preview"} className="w-full mt-3">
              {saving === "import-awards-preview" ? "Загружаю..." : "Получить кандидатов"}
            </AdminButton>
            {awardPreview && (
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <AdminBadge variant={awardPreview.options.length ? "success" : "warning"} className="w-full justify-start p-3 whitespace-normal h-auto">
                  Preview: {awardPreview.options.length} кандидатов
                </AdminBadge>
                {awardPreview.warnings.map((warning) => (
                  <AdminBadge key={warning} variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">{warning}</AdminBadge>
                ))}
                <div style={previewListStyle}>
                  {awardPreview.options.slice(0, 60).map((option, index) => (
                    <div key={`${option.player_id || option.player_name}-${index}`} style={previewRowStyle}>
                      <span>{index + 1}. {option.player_name}</span>
                      <b>{option.team_name || "-"}</b>
                    </div>
                  ))}
                </div>
                <AdminButton onClick={confirmImportAwards} disabled={saving === "import-awards-confirm" || awardPreview.options.length === 0} className="w-full">
                  {saving === "import-awards-confirm" ? "Сохраняю..." : "Сохранить кандидатов"}
                </AdminButton>
              </div>
            )}
          </AdminCard>
          </>
          )}

          {activeStep === "results" && (
          <>
          {/* Stage S1: official final results (top-5 leagues only, no scoring run). */}
          {selectedTournament.tournament_type === "top_league" && (
            <SeasonPredictionsOfficialResults
              fetchWithAuth={fetchWithAuth}
              tournamentCode={selectedTournament.tournament_code}
              teamCount={Number(teamCount) || Number(selectedTournament.team_count) || 0}
            />
          )}

          {/* Stage E1: eurocup league-stage official results foundation (no scoring). */}
          {selectedTournament.tournament_type === "european" && (
            <SeasonPredictionsEurocupOfficialResults
              fetchWithAuth={fetchWithAuth}
              tournamentCode={selectedTournament.tournament_code}
            />
          )}

          {/* Stage E6: eurocup playoff (knockout) foundation (no scoring). */}
          {selectedTournament.tournament_type === "european" && (
            <SeasonPredictionsEurocupKnockout
              fetchWithAuth={fetchWithAuth}
              tournamentCode={selectedTournament.tournament_code}
            />
          )}
          </>
          )}
        </>
      )}

      {/* Global mode-level settings (not tied to a tournament) — collapsed by default
          so they don't pad the per-tournament flow. */}
      <AdminCollapsibleSection
        title="Глобальные настройки режима"
        description="Награды рейтинга, награды заданий и тестовые сбросы — общие для всего режима"
        storageKey="admin:season-predictions:global"
      >
      {/* Stage R1: season rating rewards (global, not per-tournament). */}
      <SeasonPredictionsRewardsTab fetchWithAuth={fetchWithAuth} />

      {/* Stage E10.2: per-task reward config (visual editor, claim flow). */}
      <SeasonPredictionsTaskRewardsTab fetchWithAuth={fetchWithAuth} />

      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 950, color: "#ff3b30" }}>Тестовые сбросы</div>
            <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.4, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Danger zone только для данных режима Прогнозы сезона. Каталоги турниров, команды, правила зон и кандидаты сохраняются.
            </div>
          </div>
          <AdminButton size="sm" variant="secondary" onClick={loadResetSummary} disabled={saving === "reset-summary"}>
            Обновить summary
          </AdminButton>
        </div>

        {resetSummary ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: 10, borderRadius: 12, background: "rgba(255,59,48,0.08)" }}>
              <span style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-text, #fff)" }}>
                {resetSummary.seasonCode}
              </span>
              <span style={{ fontSize: 12, fontWeight: 950, color: "#ff3b30" }}>
                {sumResetCounts(resetSummary.counts)} записей
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
              {RESET_COUNT_LABELS.map((item) => (
                <div key={item.key} style={{ borderRadius: 10, padding: "8px 10px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--tg-hint, #999)" }}>{item.label}</div>
                  <div style={{ marginTop: 2, fontSize: 15, fontWeight: 950, color: "var(--tg-text, #fff)" }}>{resetSummary.counts[item.key]}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <AdminBadge variant="warning" className="w-full justify-start p-3 whitespace-normal h-auto">
            Summary ещё не загружен.
          </AdminBadge>
        )}

        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {RESET_ACTIONS.map((action) => (
            <div key={action.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, border: "1px solid rgba(255,59,48,0.18)", background: "rgba(255,59,48,0.055)" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 950, color: "var(--tg-text, #fff)" }}>{action.title}</div>
                <div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.35, color: "var(--tg-hint, #999)", fontWeight: 700 }}>{action.description}</div>
              </div>
              <AdminButton size="sm" variant="danger" onClick={() => openResetModal(action)} disabled={!resetSummary || saving.startsWith("reset-")}>
                Сброс
              </AdminButton>
            </div>
          ))}
        </div>
      </AdminCard>
      </AdminCollapsibleSection>

      {resetModal && resetSummary && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="season-reset-title"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 16,
            background: "rgba(0,0,0,0.55)",
          }}
        >
          <div style={{ width: "min(520px, 100%)", borderRadius: 18, padding: 16, background: "var(--tg-bg, #111)", color: "var(--tg-text, #fff)", boxShadow: "0 24px 70px rgba(0,0,0,0.45)" }}>
            <div id="season-reset-title" style={{ fontSize: 17, fontWeight: 950, color: "#ff3b30" }}>
              {resetModal.title}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              {resetModal.description}
            </div>
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "rgba(255,59,48,0.09)", border: "1px solid rgba(255,59,48,0.22)" }}>
              <div style={{ fontSize: 12, fontWeight: 850, color: "var(--tg-text, #fff)" }}>Чтобы подтвердить, введи:</div>
              <code style={{ display: "block", marginTop: 6, fontSize: 12, fontWeight: 950, color: "#ff3b30", wordBreak: "break-all" }}>{resetModal.confirm}</code>
            </div>
            <label style={{ ...inputLabelStyle, marginTop: 12 }} htmlFor="season-reset-confirm">
              Confirm phrase
              <AdminInput
                id="season-reset-confirm"
                value={resetConfirm}
                onChange={(event) => setResetConfirm(event.target.value)}
                autoFocus
                autoComplete="off"
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
              <AdminButton variant="secondary" onClick={closeResetModal} disabled={saving.startsWith("reset-")}>
                Отмена
              </AdminButton>
              <AdminButton
                variant="danger"
                onClick={executeReset}
                disabled={saving === `reset-${resetModal.id}` || resetConfirm.trim() !== resetModal.confirm}
              >
                {saving === `reset-${resetModal.id}` ? "Сбрасываю..." : "Подтвердить сброс"}
              </AdminButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
