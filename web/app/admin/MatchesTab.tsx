"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { AdminCard } from "./components/AdminCard";
import { AdminToggle } from "./components/AdminToggle";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminBadge, AdminButton, AdminCheckbox, AdminDataRow, AdminInput, AdminMetricCard, AdminSegmentedControl, AdminSelect, AdminTextarea } from "./components/ui";
import { formatAdminDate } from "@/lib/adminUtils";

// Types
type MatchCandidate = {
    id: string;
    competition_code?: string;
    competition_label?: string;
    competition_type?: "club" | "national_team";
    match_type?: "club" | "national_team";
    competition?: string;
    home_name?: string;
    home?: string;
    away_name?: string;
    away?: string;
    start_time_utc?: string; // API field
    start_time?: string; // DB field
    status?: string;
    score?: number;
    api_provider?: string;
    is_pick?: boolean;
    advancesQuestionEnabled?: boolean;
    advancesPointsAward?: number;
    advancesCorrectAnswer?: "home" | "away" | null;
    advancesResolved?: boolean;
    goalscorerEnabled?: boolean;
    goalscorerResolved?: boolean;
    goalscorers?: string[] | null;
    utcDate?: string;
    bonusQuestions?: unknown;
    // Allow any other props from DB
    [key: string]: unknown;
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type BonusQuestionType = "advances_team" | "first_goal_team" | "player_scores" | "player_assists" | "extra_time_or_penalty" | "extra_time" | "penalty_shootout" | "total_goals" | "total_corners" | "total_yellow_cards" | "red_card" | "user_goalscorer" | "both_teams_score" | "first_goal_minute" | "clean_sheet" | "team_total_goals" | "penalty_awarded" | "stat_leader";
type BonusAnswerOption = { key: string; label: string; reward_enabled: boolean; reward_stars: number; sort_order: number };
type BonusQuestion = {
    questionType: BonusQuestionType;
    enabled: boolean;
    title: string;
    pointsAward: number;
    correctAnswer?: string | null;
    resolved?: boolean;
    targetPlayerId?: string | null;
    targetPlayerName?: string | null;
    answerOptions?: BonusAnswerOption[] | null;
    ruleJson?: BonusRule | null;
    playerConfig?: { reward_enabled: boolean; reward_stars: number; player_pool: string; player_source: string } | null;
    status?: string | null;
};
type SquadPlayer = { id: string; name: string; _source?: string };
type SquadState = {
    loading?: boolean;
    error?: string;
    homeSquad: SquadPlayer[];
    awaySquad: SquadPlayer[];
};

type BonusRule = { metric: string; operator: string; threshold: number; side?: "total" | "home" | "away" };

// Три формы для конструкции «N+ X»: «1 гол», «2 гола», «5 голов». Зеркало
// BONUS_METRIC_FORMS на бэкенде — заголовок, который пишется в question_text, обязан
// совпадать с дефолтом api-worker, иначе один и тот же вопрос звучал бы по-разному.
const BONUS_METRIC_FORMS: Record<string, { one: string; few: string; many: string }> = {
    goals: { one: "гол", few: "гола", many: "голов" },
    corners: { one: "угловой", few: "угловых", many: "угловых" },
    yellow_cards: { one: "жёлтая карточка", few: "жёлтые карточки", many: "жёлтых карточек" },
    red_cards: { one: "удаление", few: "удаления", many: "удалений" },
    shots: { one: "удар", few: "удара", many: "ударов" },
    shots_on_target: { one: "удар в створ", few: "удара в створ", many: "ударов в створ" },
    fouls: { one: "фол", few: "фола", many: "фолов" },
};

function pluralizeBonusMetric(metric: string, count: number): string {
    const forms = BONUS_METRIC_FORMS[metric];
    if (!forms) return BONUS_RULE_METRIC_LABELS[metric] || metric;
    const abs = Math.abs(count) % 100;
    const last = abs % 10;
    if (abs >= 11 && abs <= 19) return forms.many;
    if (last === 1) return forms.one;
    if (last >= 2 && last <= 4) return forms.few;
    return forms.many;
}

const BONUS_RULE_METRIC_LABELS: Record<string, string> = {
    goals: "голов",
    corners: "угловых",
    yellow_cards: "жёлтых карточек",
    red_cards: "удалений",
    shots: "ударов",
    shots_on_target: "ударов в створ",
    possession: "владения мячом",
    fouls: "фолов",
};

// Лейблы вариантов ответа. У «минуты первого гола» свой набор: общий ключ "none" там значит
// «гола не будет», а не «никто не пройдёт дальше», поэтому мапы разведены по типу вопроса.
function bonusAnswerLabelMap(type: BonusQuestionType, homeName: string, awayName: string): Record<string, string> {
    if (type === "first_goal_minute") {
        return { "1_30": "1–30", "31_60": "31–60", "61_90": "61–90", none: "Гола не будет" };
    }
    // «На ноль» переопределяет both/none: общий «Никто» здесь читался бы как «никто не
    // сыграл на ноль», а нужен ответ «ни одна команда» — и отдельный вариант для 0:0.
    if (type === "clean_sheet") {
        return {
            home: homeName || "Хозяева",
            away: awayName || "Гости",
            both: "Обе (0:0)",
            none: "Ни одна",
        };
    }
    // У «кого больше» ничья по показателю — это «Поровну», а не «Никто».
    if (type === "stat_leader") {
        return { home: homeName || "Хозяева", away: awayName || "Гости", none: "Поровну" };
    }
    return { yes: "Да", no: "Нет", home: homeName || "Хозяева", away: awayName || "Гости", none: "Никто" };
}

// Метрики вопроса «у кого больше» — зеркало STAT_LEADER_METRICS на бэкенде.
const STAT_LEADER_METRIC_CHOICES = [
    { value: "corners", label: "Угловые" },
    { value: "shots", label: "Удары" },
    { value: "shots_on_target", label: "Удары в створ" },
    { value: "possession", label: "Владение мячом" },
    { value: "fouls", label: "Фолы" },
];

const EXTRA_BONUS_QUESTION_CONFIGS: Array<{ type: BonusQuestionType; title: string; defaultPoints: number; needsPlayer?: boolean; answers: string[]; isStarReward?: boolean; needsRule?: boolean; manualResolveOnly?: boolean; playerTitle?: string; ruleMetric?: string; needsSide?: boolean; metricChoices?: { value: string; label: string }[] }> = [
    { type: "first_goal_team", title: "Кто откроет счет", playerTitle: "Кто откроет счёт?", defaultPoints: 0, answers: ["home", "away", "none"], isStarReward: true },
    { type: "player_scores", title: "Определенный игрок забьет", playerTitle: "Выбранный игрок забьёт?", defaultPoints: 0, needsPlayer: true, answers: ["yes", "no"], isStarReward: true },
    { type: "player_assists", title: "Определенный игрок сделает ассист", playerTitle: "Выбранный игрок сделает ассист?", defaultPoints: 0, needsPlayer: true, answers: ["yes", "no"], isStarReward: true },
    { type: "extra_time_or_penalty", title: "Будет доп. время или серия пенальти?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, manualResolveOnly: true },
    // Star-reward types (points_award=0, rewards via stars_ledger)
    { type: "extra_time", title: "Будет доп. время?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, manualResolveOnly: true },
    { type: "penalty_shootout", title: "Будет серия пенальти?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, manualResolveOnly: true },
    { type: "total_goals", title: "Тотал голов", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, needsRule: true, ruleMetric: "goals" },
    { type: "total_corners", title: "Тотал угловых", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, needsRule: true, ruleMetric: "corners", manualResolveOnly: true },
    { type: "total_yellow_cards", title: "Тотал жёлтых карточек", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, needsRule: true, ruleMetric: "yellow_cards", manualResolveOnly: true },
    { type: "red_card", title: "Будет ли удаление?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true },
    { type: "user_goalscorer", title: "Кто забьёт в матче?", defaultPoints: 0, answers: [], isStarReward: true },
    { type: "both_teams_score", title: "Обе забьют", playerTitle: "Обе команды забьют в основное время?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true },
    { type: "first_goal_minute", title: "Минута первого гола", playerTitle: "На какой минуте будет первый гол?", defaultPoints: 0, answers: ["1_30", "31_60", "61_90", "none"], isStarReward: true },
    { type: "clean_sheet", title: "Кто сыграет на ноль", playerTitle: "Кто сыграет на ноль?", defaultPoints: 0, answers: ["home", "away", "both", "none"], isStarReward: true },
    { type: "team_total_goals", title: "Индивидуальный тотал", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true, needsRule: true, ruleMetric: "goals", needsSide: true },
    { type: "penalty_awarded", title: "Будет ли назначен пенальти?", defaultPoints: 0, answers: ["yes", "no"], isStarReward: true },
    { type: "stat_leader", title: "У кого больше", defaultPoints: 0, answers: ["home", "away", "none"], isStarReward: true, needsRule: true, ruleMetric: "corners", metricChoices: STAT_LEADER_METRIC_CHOICES },
];

type ExtraBonusQuestionConfig = (typeof EXTRA_BONUS_QUESTION_CONFIGS)[number];

// Заголовок вопроса с правилом. Формулировка зависит не только от порога: у
// индивидуального тотала подлежащее — команда, а у «кого больше» порога нет вовсе,
// поэтому одна фраза «В матче будет N+ …» на все три случая не годится.
function buildRuleQuestionTitle(
    config: ExtraBonusQuestionConfig,
    rule: BonusRule,
    match: { home_name?: string; home?: string; away_name?: string; away?: string },
): string {
    const genitive = BONUS_RULE_METRIC_LABELS[rule.metric] || rule.metric;
    const threshold = Number(rule.threshold) || 0;
    const counted = pluralizeBonusMetric(rule.metric, threshold);
    // Двоеточие превращало вопрос в ярлык («Манчестер Юнайтед: 2+ голов?»), поэтому у
    // обоих типов теперь полноценное сказуемое, а число согласовано с метрикой.
    if (config.type === "stat_leader") {
        return `У кого будет больше ${genitive}?`;
    }
    if (config.needsSide) {
        const subject = rule.side === "away"
            ? (match.away_name || match.away || "Гости")
            : (match.home_name || match.home || "Хозяева");
        if (rule.operator === "lte") return `${subject} забьёт ${threshold} или меньше ${genitive}?`;
        if (rule.operator === "eq") return `${subject} забьёт ровно ${threshold} ${counted}?`;
        return `${subject} забьёт ${threshold}+ ${counted}?`;
    }
    if (rule.operator === "lte") return `В матче будет ${threshold} или меньше ${genitive}?`;
    if (rule.operator === "eq") return `В матче будет ровно ${threshold} ${counted}?`;
    return `В матче будет ${threshold}+ ${counted}?`;
}

// Inline styles for the tournament/source pickers: this part of the admin does not
// pick up Tailwind utilities, so the surrounding cards are inline-styled too.
const pickerBoxStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    borderRadius: 16,
    border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
    background: "color-mix(in srgb, var(--tg-secondary-bg) 30%, transparent)",
};

const pickerHeaderStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };

const pickerGridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))",
    gap: 8,
};

const pickerHintStyle: CSSProperties = {
    fontSize: 11.5,
    fontWeight: 600,
    lineHeight: 1.45,
    color: "var(--tg-hint)",
};

function pickerChipStyle(checked: boolean, disabled: boolean): CSSProperties {
    return {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minHeight: 38,
        padding: "8px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        color: checked ? "var(--tg-text)" : "var(--tg-hint)",
        border: checked
            ? "1px solid color-mix(in srgb, var(--tg-link, #2ea6ff) 55%, transparent)"
            : "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
        background: checked
            ? "color-mix(in srgb, var(--tg-link, #2ea6ff) 12%, transparent)"
            : "color-mix(in srgb, var(--tg-secondary-bg) 45%, transparent)",
    };
}

const pickerCheckboxStyle: CSSProperties = {
    width: 16,
    height: 16,
    flexShrink: 0,
    accentColor: "var(--tg-link, #2ea6ff)",
    margin: 0,
};

const pickerChipLabelStyle: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

// One competition the day's refresh sweep can query (footapi = 1 request each).
// `queried: false` means the backend would skip it anyway — no id, or out of its
// active months — so it is shown greyed out rather than as a checkbox.
type ImportTournament = {
    key: string;
    display_name: string;
    queried: boolean;
    reason: "NO_FOOTAPI_ID" | "OUT_OF_ACTIVE_MONTHS" | null;
};

type MatchSourceRule = {
    id: number;
    title: string;
    provider: "football_data" | "allsports";
    provider_competition_id: string | null;
    provider_competition_code: string | null;
    match_mode: "club" | "national";
    status: "enabled" | "disabled" | "test_only";
    sort_order: number;
    season: string | null;
    country: string | null;
    include_friendlies: boolean;
    date_window_before: number;
    date_window_after: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

// M3: result of the manual "test source" probe (diagnostics + preview only).
type MatchSourcePreviewMatch = {
    provider: "football_data" | "allsports";
    provider_match_id: string;
    provider_competition_id: string | null;
    provider_competition_code: string | null;
    competition_name: string;
    competition_type: string | null;
    match_mode: "club" | "national";
    home_team: string;
    away_team: string;
    home_team_id: string | null;
    away_team_id: string | null;
    kickoff_utc: string;
    status: string | null;
    stage: string | null;
    accepted: boolean;
    rejection_reasons: string[];
};

type MatchSourceTestDiagnostics = {
    http_status: number;
    duration_ms: number;
    received?: number;
    normalized?: number;
    accepted?: number;
    rejected?: number;
    from_cache?: boolean;
    tested_at?: string;
    daily_events_total?: number;
};

type MatchSourceTestResponse = {
    ok: boolean;
    source?: { id: number; title: string; provider: string; match_mode: string };
    request?: { date: string; fetch_scope: string };
    diagnostics?: MatchSourceTestDiagnostics;
    matches?: MatchSourcePreviewMatch[];
    warnings?: string[];
    error?: string;
    provider_error?: { code: string; http_status: number; message: string };
};

// M4: aggregate candidate preview across all enabled sources of a mode.
type CandidateProviderRef = {
    provider: string;
    provider_match_id: string;
    source_id: number;
    source_title: string;
};

type CandidatePreviewMatch = {
    preview_id: string;
    provider: "football_data" | "allsports";
    provider_match_id: string;
    source_id: number;
    source_title: string;
    competition_name: string;
    match_mode: "club" | "national";
    home_team: string;
    away_team: string;
    kickoff_utc: string;
    status: string | null;
    stage: string | null;
    accepted: true;
    duplicate_of?: string | null;
    provider_refs?: CandidateProviderRef[];
};

type SourceFetchResult = {
    source_id: number;
    title: string;
    provider: "football_data" | "allsports";
    fetch_scope: string;
    http_status: number;
    duration_ms: number;
    received: number;
    normalized: number;
    accepted: number;
    rejected: number;
    error: string | null;
    warnings: string[];
    from_cache?: boolean;
};

type MatchSourcesFetchResponse = {
    ok: boolean;
    date?: string;
    match_mode?: "club" | "national";
    sources_count?: number;
    diagnostics?: {
        total_received: number;
        total_normalized: number;
        total_accepted: number;
        total_rejected: number;
        total_deduped: number;
        duration_ms: number;
        from_cache_count?: number;
        provider_calls?: number;
    };
    source_results?: SourceFetchResult[];
    matches?: CandidatePreviewMatch[];
    warnings?: string[];
    error?: string;
};

// M7: source-fetch run history.
type FetchRunDto = {
    id: number;
    source_id: number | null;
    parent_run_id: number | null;
    run_type: "source_test" | "aggregate_preview";
    requested_by: string | null;
    requested_at: string;
    requested_date: string;
    match_mode: string | null;
    provider: string;
    fetch_scope: string | null;
    success: boolean;
    http_status: number | null;
    duration_ms: number | null;
    matches_received: number;
    matches_normalized: number;
    matches_accepted: number;
    matches_rejected: number;
    matches_deduped: number;
    from_cache: boolean;
    cache_key: string | null;
    error_code: string | null;
    error_message: string | null;
    warnings: string[];
    created_at: string;
};

type FetchRunsListResponse = {
    ok: boolean;
    runs: FetchRunDto[];
    pagination: { page: number; limit: number; total: number; pages: number };
};

type FetchRunDetailResponse = { ok: boolean; run: FetchRunDto; children: FetchRunDto[] };

type FetchRunFilters = { run_type: string; provider: string; success: string; requested_date: string };

// Draft used by the create/edit form. All fields are strings for controlled inputs.
type MatchSourceFormState = {
    title: string;
    provider: "football_data" | "allsports";
    provider_competition_code: string;
    provider_competition_id: string;
    match_mode: "club" | "national";
    status: "enabled" | "disabled" | "test_only";
    sort_order: string;
    season: string;
    country: string;
    include_friendlies: boolean;
    date_window_before: string;
    date_window_after: string;
    notes: string;
};

const EMPTY_MATCH_SOURCE_FORM: MatchSourceFormState = {
    title: "",
    provider: "football_data",
    provider_competition_code: "",
    provider_competition_id: "",
    match_mode: "club",
    status: "enabled",
    sort_order: "100",
    season: "",
    country: "",
    include_friendlies: false,
    date_window_before: "0",
    date_window_after: "0",
    notes: "",
};

type MatchModeValue = "club" | "national_teams";

type OverrideData = {
    mode: "AUTO" | "MANUAL" | "REST";
    manualMatchIds: string[];
    matches: MatchCandidate[]; // The selected ones
};


const getMatchModeUiLabel = (mode: MatchModeValue) => mode === "national_teams" ? "National Teams" : "Club";
const getMatchTypeUiLabel = (type?: string) => type === "national_team" ? "National Teams" : "Club";
const formatMatchMetaLabel = (value: unknown, fallback = "—") => {
    const text = String(value || "").trim();
    if (!text) return fallback;
    return text
        .replace(/([a-zа-яё])([A-ZА-ЯЁ])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

type BonusBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";
type BonusSummaryItem = { label: string; variant: BonusBadgeVariant };
type BonusQuestionUiSummary = {
  items: BonusSummaryItem[];
  needsAttention: boolean;
};

// Russian plural for "вариант" (1 вариант / 2 варианта / 5 вариантов).
function pluralVariants(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} вариант`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} варианта`;
  return `${n} вариантов`;
}

// Pure summary used by the collapsed per-question header (UI only — derives a list of
// status / reward / detail badges + "needs attention" from existing question state;
// does not change any save/resolve/grant behavior).
function bonusQuestionSummary(
  config: (typeof EXTRA_BONUS_QUESTION_CONFIGS)[number],
  q: BonusQuestion | null,
  squadError: boolean,
  defaultRewardStars: number,
): BonusQuestionUiSummary {
  const enabled = q?.enabled === true;
  const granted = q?.status === "rewards_granted";
  const resolved = q?.resolved === true || granted;
  const isStar = config.isStarReward === true;
  const needsPlayerMissing = Boolean(config.needsPlayer) && enabled && !q?.targetPlayerId;
  const needsManual = Boolean(config.manualResolveOnly) && enabled && !q?.resolved;
  const needsAttention = enabled && !resolved && (needsPlayerMissing || squadError || needsManual);

  const items: BonusSummaryItem[] = [];

  // Status badge.
  if (!enabled) items.push({ label: "Выключен", variant: "neutral" });
  else if (granted) items.push({ label: "Награды выданы", variant: "success" });
  else if (q?.resolved) items.push({ label: "Решён", variant: "success" });
  else if (needsAttention) items.push({ label: "Требует настройки", variant: "warning" });
  else items.push({ label: "Включён", variant: "success" });

  // Reward badge.
  items.push(isStar
    ? { label: config.answers.length > 1 ? "по вариантам" : `${q?.playerConfig?.reward_stars ?? defaultRewardStars} ⭐`, variant: "warning" }
    : { label: `+${q?.pointsAward ?? config.defaultPoints} оч.`, variant: "neutral" });

  // Detail badge.
  if (config.needsPlayer) {
    items.push(q?.targetPlayerName
      ? { label: `Игрок: ${q.targetPlayerName}`, variant: "info" }
      : { label: "Игрок не выбран", variant: "warning" });
  } else if (resolved) {
    items.push({ label: "Ответ решён", variant: "info" });
  } else if (config.answers.length > 0) {
    items.push({ label: pluralVariants(config.answers.length), variant: "neutral" });
  }

  return { items, needsAttention };
}

const BONUS_RULE_OPERATOR_SIGNS: Record<string, string> = { gte: "≥", lte: "≤", eq: "=" };

type EnabledBonusChip = { label: string; variant: BonusBadgeVariant };

// Короткая подпись включённого вопроса для шапки секции. Игрок и порог тотала входят в
// подпись намеренно: без них «Тотал голов» и «Игрок забьёт» неразличимы между матчами,
// и чтобы вспомнить, что именно выбрано, пришлось бы разворачивать список всех типов.
function bonusQuestionShortLabel(q: BonusQuestion): string {
  const config = EXTRA_BONUS_QUESTION_CONFIGS.find(c => c.type === q.questionType);
  const base = config?.title || q.title || q.questionType;
  if (config?.needsPlayer) {
    const name = String(q.targetPlayerName || "").trim();
    if (!name) return `${base}: игрок не выбран`;
    return q.questionType === "player_assists" ? `Ассист: ${name}` : `Забьёт: ${name}`;
  }
  if (config?.needsRule && q.ruleJson) {
    const metricLabel = BONUS_RULE_METRIC_LABELS[String(q.ruleJson.metric)] || String(q.ruleJson.metric);
    // У «кого больше» порога нет — различать такие вопросы между матчами позволяет
    // только показатель, поэтому в подпись идёт он, а не оператор со значением.
    if (q.questionType === "stat_leader") return `${base}: ${metricLabel}`;
    const sign = BONUS_RULE_OPERATOR_SIGNS[String(q.ruleJson.operator)] || String(q.ruleJson.operator);
    if (config.needsSide) {
      const subject = q.ruleJson.side === "away" ? "гости" : "хозяева";
      return `${base} (${subject}) ${sign} ${q.ruleJson.threshold}`;
    }
    return `${base} ${sign} ${q.ruleJson.threshold}`;
  }
  return base;
}

// Включённые вопросы матча в том же порядке, в каком они идут в форме ниже. Legacy-вопросы
// («кто пройдёт дальше», старые бомбардиры) живут не в bonusQuestions, а отдельными флагами
// матча, поэтому добавляются руками — иначе они попадали бы в счётчик, но не в список, и
// число в бейдже разошлось бы с числом подписей.
function enabledBonusQuestionChips(m: MatchCandidate): EnabledBonusChip[] {
  const chips: EnabledBonusChip[] = [];
  if (m.advancesQuestionEnabled) {
    chips.push({ label: "Кто пройдёт дальше", variant: m.advancesResolved ? "success" : "neutral" });
  }
  if (m.goalscorerEnabled) {
    chips.push({ label: "Бомбардиры (legacy)", variant: m.goalscorerResolved ? "success" : "neutral" });
  }
  const questions = Array.isArray(m.bonusQuestions) ? (m.bonusQuestions as BonusQuestion[]) : [];
  const enabledByType = new Map(questions.filter(q => q?.enabled).map(q => [q.questionType, q]));
  for (const config of EXTRA_BONUS_QUESTION_CONFIGS) {
    const q = enabledByType.get(config.type);
    if (!q) continue;
    const resolved = q.resolved === true || q.status === "rewards_granted";
    const playerMissing = Boolean(config.needsPlayer) && !q.targetPlayerId;
    chips.push({
      label: bonusQuestionShortLabel(q),
      variant: resolved ? "success" : playerMissing ? "warning" : "neutral",
    });
  }
  return chips;
}

// Шапка секции доп-вопросов: перечисляет сами вопросы, а не только их количество.
function BonusEnabledQuestionList({ chips, note }: { chips: EnabledBonusChip[]; note?: string | null }) {
  if (chips.length === 0) return <>Доп. вопросы: не настроены</>;
  const resolvedCount = chips.filter(chip => chip.variant === "success").length;
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {chips.map((chip, idx) => (
          <AdminBadge
            key={`${chip.label}-${idx}`}
            variant={chip.variant}
            className="!text-[10px] !px-2 !py-0.5 !font-bold"
          >
            {chip.variant === "success" ? `✓ ${chip.label}` : chip.label}
          </AdminBadge>
        ))}
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
          решено {resolvedCount} из {chips.length}
        </span>
      </span>
      {note && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>{note}</span>}
    </span>
  );
}

type AdminFetchWithAuth = <T = unknown>(path: string, init?: RequestInit) => Promise<T | null>;

// Matches / Import admin tab — extracted verbatim from page.tsx (P3.2). Owns all
// matches state + handlers; receives the shared fetchWithAuth + global loading /
// success / error setters as props (1:1 behavior). selectedDate lives in the page
// toolbar (above the tab nav) and is passed in read-only.
export default function MatchesTab({
  fetchWithAuth,
  loading,
  setLoading,
  onSuccess,
  onError,
  selectedDate,
}: {
  fetchWithAuth: AdminFetchWithAuth;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  selectedDate: string;
}) {
  const setSuccess = onSuccess;
  const setError = onError;

      const selectedDateRef = useRef(selectedDate);
    const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
    const [override, setOverride] = useState<OverrideData | null>(null);
    const [manualIds, setManualIds] = useState<string[]>([]);
    const [isLockedOnServer, setIsLockedOnServer] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isResolvingBonus, setIsResolvingBonus] = useState(false);
    const [matchMode, setMatchMode] = useState<MatchModeValue>("club");
    const [effectiveMatchMode, setEffectiveMatchMode] = useState<MatchModeValue>("club");
    const [matchModeSource, setMatchModeSource] = useState<"global" | "published_day">("global");
    const [isSavingMatchMode, setIsSavingMatchMode] = useState(false);
    const [savingBonusMatchId, setSavingBonusMatchId] = useState<string | null>(null);
    const [squadByMatch, setSquadByMatch] = useState<Record<string, SquadState>>({});
    // Star-reward bonus question: local draft state for total rules + per-answer rewards
    // key = `${matchId}:${questionType}`
    const [bonusTotalDraft, setBonusTotalDraft] = useState<Record<string, { metric: string; operator: string; threshold: string; side?: string }>>({});
    const [bonusRewardDraft, setBonusRewardDraft] = useState<Record<string, Record<string, { enabled: boolean; stars: string }>>>({});
    const [bonusGranting, setBonusGranting] = useState<string | null>(null); // `${matchId}:${questionType}`
    const [warmingSquads, setWarmingSquads] = useState(false);
    const [bonusUserGoalscorerDraft, setBonusUserGoalscorerDraft] = useState<Record<string, { pool: string; rewardStars: string }>>({});
    const [ugResolveScorers, setUgResolveScorers] = useState<Record<string, string[]>>({});
    // Per-question collapse state (UI only). Key: `${matchId}:${questionType}`.
    // Accordion within one match: opening a question closes the others of that match.
    const [openQuestion, setOpenQuestion] = useState<Record<string, boolean>>({});
    const toggleQuestion = (matchId: string, type: BonusQuestionType, currentlyOpen: boolean) => {
        setOpenQuestion(prev => {
            const next = { ...prev };
            for (const cfg of EXTRA_BONUS_QUESTION_CONFIGS) next[`${matchId}:${cfg.type}`] = false;
            next[`${matchId}:${type}`] = !currentlyOpen;
            return next;
        });
    };
    // Per-match collapse state (UI only). Accordion within the day: opening one
    // selected match closes the others. No localStorage (avoids unbounded keys).
    const [openMatchIds, setOpenMatchIds] = useState<Record<string, boolean>>({});
    const toggleMatch = (matchId: string, currentlyOpen: boolean) => {
        setOpenMatchIds(() => {
            const next: Record<string, boolean> = {};
            for (const mm of (override?.matches || [])) next[mm.id] = false;
            next[matchId] = !currentlyOpen;
            return next;
        });
    };

    // ─── Tournament source catalog (M2) ──────────────────────────────────────
    // Isolated CRUD: this list is NOT wired into candidates / manualIds / top3 /
    // AUTO / refresh. Editing a source never re-runs match import.
    const [sources, setSources] = useState<MatchSourceRule[]>([]);
    const [sourcesLoaded, setSourcesLoaded] = useState(false);
    const [isLoadingSources, setIsLoadingSources] = useState(false);
    const [sourceForm, setSourceForm] = useState<MatchSourceFormState>(EMPTY_MATCH_SOURCE_FORM);
    const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isSavingSource, setIsSavingSource] = useState(false);
    const [sourceFormError, setSourceFormError] = useState("");

    const loadSources = useCallback(async () => {
        setIsLoadingSources(true);
        try {
            const res = await fetchWithAuth<{ ok: boolean; sources: MatchSourceRule[] }>(
                `/admin/match-sources?_ts=${Date.now()}`,
            );
            if (res?.ok) {
                setSources(Array.isArray(res.sources) ? res.sources : []);
                setSourcesLoaded(true);
            }
        } finally {
            setIsLoadingSources(false);
        }
    }, [fetchWithAuth]);

    // Lazy-load the catalog once on mount. Independent from match data loading.
    useEffect(() => { loadSources(); }, [loadSources]);

    // ─── Bonus question default reward (admin-editable, app_config) ──────────
    // Prefill for new questions; the server also applies it to legacy questions
    // that have no per-answer config. Per-question overrides stay untouched.
    const [bonusDefaultStars, setBonusDefaultStars] = useState<number>(1);
    const [bonusDefaultDraft, setBonusDefaultDraft] = useState<string>("1");
    const [isSavingBonusDefault, setIsSavingBonusDefault] = useState(false);
    useEffect(() => {
        (async () => {
            const res = await fetchWithAuth<{ ok: boolean; default_reward_stars?: number }>(`/admin/bonus-question-config`);
            if (res?.ok && Number.isFinite(Number(res.default_reward_stars))) {
                setBonusDefaultStars(Number(res.default_reward_stars));
                setBonusDefaultDraft(String(res.default_reward_stars));
            }
        })();
    }, [fetchWithAuth]);
    const saveBonusDefault = async () => {
        const v = Math.max(0, Math.min(20, Math.round(Number(bonusDefaultDraft) || 0)));
        setIsSavingBonusDefault(true);
        try {
            const res = await fetchWithAuth<{ ok: boolean; default_reward_stars?: number; error?: string }>(`/admin/bonus-question-config`, {
                method: "PUT",
                body: JSON.stringify({ default_reward_stars: v }),
            });
            if (res?.ok) {
                setBonusDefaultStars(v);
                setBonusDefaultDraft(String(v));
                setSuccess(`Награда доп-вопроса по умолчанию: ${v} ⭐`);
            } else {
                setError(res?.error || "Не удалось сохранить награду по умолчанию");
            }
        } finally {
            setIsSavingBonusDefault(false);
        }
    };

    const openCreateSourceForm = () => {
        setEditingSourceId(null);
        setSourceForm(EMPTY_MATCH_SOURCE_FORM);
        setSourceFormError("");
        setIsFormOpen(true);
    };

    const openEditSourceForm = (s: MatchSourceRule) => {
        // Editing must not reuse a stale preview as a source of truth.
        setTestSourceId(null);
        setTestResult(null);
        setTestError("");
        setEditingSourceId(s.id);
        setSourceForm({
            title: s.title,
            provider: s.provider,
            provider_competition_code: s.provider_competition_code || "",
            provider_competition_id: s.provider_competition_id || "",
            match_mode: s.match_mode,
            status: s.status,
            sort_order: String(s.sort_order),
            season: s.season || "",
            country: s.country || "",
            include_friendlies: s.include_friendlies,
            date_window_before: String(s.date_window_before),
            date_window_after: String(s.date_window_after),
            notes: s.notes || "",
        });
        setSourceFormError("");
        setIsFormOpen(true);
    };

    const closeSourceForm = () => {
        setIsFormOpen(false);
        setEditingSourceId(null);
        setSourceForm(EMPTY_MATCH_SOURCE_FORM);
        setSourceFormError("");
    };

    const setSourceField = <K extends keyof MatchSourceFormState>(key: K, value: MatchSourceFormState[K]) => {
        setSourceForm(prev => ({ ...prev, [key]: value }));
    };

    // Client-side mirror of backend validation so the admin gets instant feedback.
    const validateSourceForm = (f: MatchSourceFormState): string | null => {
        if (!f.title.trim()) return "Название обязательно.";
        const code = f.provider_competition_code.trim();
        const id = f.provider_competition_id.trim();
        if (f.provider === "football_data" && !code && !id) {
            return "Для Football-Data укажите competition code или competition id.";
        }
        if (f.provider === "allsports" && !id) {
            return "Для AllSports укажите competition id (league_id).";
        }
        const sort = Number(f.sort_order);
        if (!Number.isInteger(sort) || sort < 0) return "Sort order должен быть неотрицательным целым.";
        for (const [label, raw] of [["before", f.date_window_before], ["after", f.date_window_after]] as const) {
            const n = Number(raw);
            if (!Number.isInteger(n) || n < 0 || n > 14) return `Окно дат (${label}) должно быть числом 0–14.`;
        }
        return null;
    };

    const submitSourceForm = async () => {
        const validationError = validateSourceForm(sourceForm);
        if (validationError) { setSourceFormError(validationError); return; }
        setSourceFormError("");
        setIsSavingSource(true);
        try {
            const payload = {
                title: sourceForm.title.trim(),
                provider: sourceForm.provider,
                provider_competition_code: sourceForm.provider_competition_code.trim() || null,
                provider_competition_id: sourceForm.provider_competition_id.trim() || null,
                match_mode: sourceForm.match_mode,
                status: sourceForm.status,
                sort_order: Number(sourceForm.sort_order),
                season: sourceForm.season.trim() || null,
                country: sourceForm.country.trim() || null,
                include_friendlies: sourceForm.include_friendlies ? 1 : 0,
                date_window_before: Number(sourceForm.date_window_before),
                date_window_after: Number(sourceForm.date_window_after),
                notes: sourceForm.notes.trim() || null,
            };
            const isEdit = editingSourceId !== null;
            const res = await fetchWithAuth<{ ok: boolean; source?: MatchSourceRule; error?: string }>(
                isEdit ? `/admin/match-sources/${editingSourceId}` : `/admin/match-sources`,
                { method: isEdit ? "PUT" : "POST", body: JSON.stringify(payload) },
            );
            if (res?.ok) {
                setSuccess(isEdit ? "Источник обновлён." : "Источник добавлен.");
                closeSourceForm();
                await loadSources();
                setTimeout(() => setSuccess(""), 3000);
            } else if (res && !res.ok) {
                setSourceFormError(res.error || "Не удалось сохранить источник.");
            }
        } catch (e) {
            setSourceFormError(getErrorMessage(e));
        } finally {
            setIsSavingSource(false);
        }
    };

    const disableSource = async (s: MatchSourceRule) => {
        if (typeof window !== "undefined" && !window.confirm(`Выключить источник «${s.title}»?`)) return;
        setIsSavingSource(true);
        try {
            const res = await fetchWithAuth<{ ok: boolean }>(`/admin/match-sources/${s.id}`, { method: "DELETE" });
            if (res?.ok) {
                setSuccess("Источник выключен.");
                if (editingSourceId === s.id) closeSourceForm();
                await loadSources();
                setTimeout(() => setSuccess(""), 3000);
            }
        } finally {
            setIsSavingSource(false);
        }
    };

    // ─── M3: manual "test source" preview (read-only, diagnostics only) ────────
    // A provider call happens ONLY on explicit click. Changing the date or editing
    // a source never triggers a fetch. The preview is local and never merges into
    // candidates / manualIds / top3.
    const [testSourceId, setTestSourceId] = useState<number | null>(null);
    const [testDate, setTestDate] = useState<string>(selectedDate);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [testResult, setTestResult] = useState<MatchSourceTestResponse | null>(null);
    const [testError, setTestError] = useState("");

    const openSourceTest = (s: MatchSourceRule) => {
        setTestSourceId(s.id);
        setTestDate(selectedDate); // default only — does NOT fetch
        setTestResult(null);
        setTestError("");
    };

    const closeSourceTest = () => {
        setTestSourceId(null);
        setTestResult(null);
        setTestError("");
    };

    const runSourceTest = async (sourceId: number, forceRefresh = false) => {
        if (testingId !== null) return; // block re-entry while a probe is in flight
        if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate)) { setTestError("Укажите корректную дату."); return; }
        // Force refresh skips the cache and performs a brand-new provider request.
        if (forceRefresh && typeof window !== "undefined" && !window.confirm(
            "Принудительная проверка обойдёт кэш и выполнит новый запрос к провайдеру. Продолжить?"
        )) return;
        setTestingId(sourceId);
        setTestError("");
        setTestResult(null);
        try {
            const res = await fetchWithAuth<MatchSourceTestResponse>(`/admin/match-sources/${sourceId}/test`, {
                method: "POST",
                body: JSON.stringify({ date: testDate, force_refresh: forceRefresh }),
            });
            if (res) setTestResult(res);
            else setTestError("Не удалось выполнить тест источника.");
        } catch (e) {
            setTestError(getErrorMessage(e));
        } finally {
            setTestingId(null);
        }
    };

    // ─── M4: aggregate candidate preview from all enabled sources of a mode ────
    // Diagnostics-only. Runs ONLY on explicit click, separate from the day's
    // candidates / manualIds / Apply Selection. Does not publish anything.
    const [aggLoading, setAggLoading] = useState(false);
    const [aggResult, setAggResult] = useState<MatchSourcesFetchResponse | null>(null);
    const [aggError, setAggError] = useState("");
    // M5: local selection of preview candidates (max 3) + import-into-candidates.
    const [selectedPreviewIds, setSelectedPreviewIds] = useState<string[]>([]);
    const [isImportingPreview, setIsImportingPreview] = useState(false);

    const mapModeToApi = (m: MatchModeValue): "club" | "national" => (m === "national_teams" ? "national" : "club");

    // M8: per-tournament filter for the aggregate preview. Only the checked
    // sources are queried, so a run does not burn provider quota on leagues the
    // admin does not need today. Empty / all-checked === previous behaviour.
    const apiMatchMode = mapModeToApi(effectiveMatchMode);
    const enabledSources = useMemo(
        () => sources.filter((s) => s.status === "enabled" && s.match_mode === apiMatchMode),
        [sources, apiMatchMode],
    );
    const enabledSourceIdsKey = enabledSources.map((s) => s.id).join(",");
    const sourceFilterStorageKey = `admin:matches:source-filter:${apiMatchMode}`;
    const [selectedSourceIds, setSelectedSourceIds] = useState<number[]>([]);
    const [sourceFilterReady, setSourceFilterReady] = useState(false);
    const [sourceFilterOpen, setSourceFilterOpen] = useState(true);

    // Restore the saved subset when the source list or mode changes. Ids that no
    // longer exist are dropped; a first visit checks everything.
    useEffect(() => {
        if (!sourcesLoaded) return;
        const ids = enabledSourceIdsKey ? enabledSourceIdsKey.split(",").map(Number) : [];
        let stored: number[] | null = null;
        try {
            const raw = window.localStorage.getItem(sourceFilterStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) stored = parsed.map(Number).filter((n) => Number.isInteger(n));
            }
        } catch {
            stored = null;
        }
        setSelectedSourceIds(stored ? ids.filter((id) => stored!.includes(id)) : ids);
        setSourceFilterReady(true);
    }, [sourcesLoaded, enabledSourceIdsKey, sourceFilterStorageKey]);

    useEffect(() => {
        if (!sourceFilterReady) return;
        try {
            window.localStorage.setItem(sourceFilterStorageKey, JSON.stringify(selectedSourceIds));
        } catch {
            // Storage unavailable (private mode / quota) — the filter still works in-memory.
        }
    }, [sourceFilterReady, sourceFilterStorageKey, selectedSourceIds]);

    const toggleSourceFilter = (id: number) => {
        setSelectedSourceIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
    };
    const allSourcesSelected = enabledSources.length > 0 && selectedSourceIds.length === enabledSources.length;

    const togglePreviewSelection = (previewId: string) => {
        setSelectedPreviewIds((prev) => {
            if (prev.includes(previewId)) return prev.filter((id) => id !== previewId);
            if (prev.length >= 3) return prev; // hard cap at 3
            return [...prev, previewId];
        });
    };

    const importSelectedPreviewCandidates = async () => {
        if (isImportingPreview || selectedPreviewIds.length === 0) return;
        const all = aggResult?.matches || [];
        const chosen = all.filter((m) => selectedPreviewIds.includes(m.preview_id));
        if (chosen.length === 0) return;
        setIsImportingPreview(true);
        setError("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; imported?: Array<{ match_id: string; preview_id: string; existing: boolean }>; skipped?: Array<{ preview_id: string; reason: string }>; warnings?: string[]; error?: string }>(
                `/admin/match-sources/import-preview-candidates`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        date: selectedDate,
                        match_mode: mapModeToApi(effectiveMatchMode),
                        candidates: chosen.map((m) => ({
                            preview_id: m.preview_id,
                            provider: m.provider,
                            provider_match_id: m.provider_match_id,
                            source_id: m.source_id,
                            source_title: m.source_title,
                            competition_name: m.competition_name,
                            match_mode: m.match_mode,
                            home_team: m.home_team,
                            away_team: m.away_team,
                            kickoff_utc: m.kickoff_utc,
                            status: m.status,
                            stage: m.stage,
                        })),
                    }),
                },
            );
            if (res?.ok) {
                const importedCount = res.imported?.length ?? 0;
                const skippedCount = res.skipped?.length ?? 0;
                let msg = `Добавлено в кандидаты: ${importedCount}.`;
                if (skippedCount > 0) msg += ` Пропущено: ${skippedCount}.`;
                msg += " Теперь выберите их в обычном списке и нажмите Apply Selection.";
                setSuccess(msg);
                setSelectedPreviewIds([]);
                // Reload the day's candidates WITHOUT a provider refresh, preserving
                // the admin's current manual selection (see loadMatchesData).
                await loadMatchesData(false, manualIds);
                setTimeout(() => setSuccess(""), 6000);
            } else if (res && !res.ok) {
                setError(res.error || "Не удалось добавить кандидатов.");
            }
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setIsImportingPreview(false);
        }
    };

    const fetchSourceCandidates = async (forceRefresh = false) => {
        if (aggLoading) return; // block re-entry
        if (enabledSources.length > 0 && selectedSourceIds.length === 0) {
            setAggError("Отметьте хотя бы один турнир.");
            return;
        }
        if (forceRefresh && typeof window !== "undefined" && !window.confirm(
            `Принудительное обновление обойдёт кэш и выполнит новые запросы к выбранным источникам (${selectedSourceIds.length}). Продолжить?`
        )) return;
        setAggLoading(true);
        setAggError("");
        setAggResult(null);
        try {
            const res = await fetchWithAuth<MatchSourcesFetchResponse>(`/admin/match-sources/fetch-candidates`, {
                method: "POST",
                body: JSON.stringify({
                    date: selectedDate,
                    match_mode: apiMatchMode,
                    force_refresh: forceRefresh,
                    // Omitted when everything is checked, so a source added meanwhile is not silently skipped.
                    ...(allSourcesSelected ? {} : { source_ids: selectedSourceIds }),
                }),
            });
            if (res) setAggResult(res);
            else setAggError("Не удалось получить кандидатов из источников.");
        } catch (e) {
            setAggError(getErrorMessage(e));
        } finally {
            setAggLoading(false);
        }
    };

    // ─── M7: source-fetch run history (read-only diagnostics) ────────────────
    const [historyRuns, setHistoryRuns] = useState<FetchRunDto[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyPages, setHistoryPages] = useState(0);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyFilters, setHistoryFilters] = useState<FetchRunFilters>({ run_type: "", provider: "", success: "", requested_date: "" });
    const [historyDetail, setHistoryDetail] = useState<FetchRunDetailResponse | null>(null);
    const [historyDetailLoading, setHistoryDetailLoading] = useState(false);

    const loadFetchRuns = useCallback(async (page: number, filters: FetchRunFilters) => {
        setHistoryLoading(true);
        try {
            const qs = new URLSearchParams();
            qs.set("page", String(page));
            qs.set("limit", "20");
            if (filters.run_type) qs.set("run_type", filters.run_type);
            if (filters.provider) qs.set("provider", filters.provider);
            if (filters.success) qs.set("success", filters.success);
            if (filters.requested_date) qs.set("requested_date", filters.requested_date);
            const res = await fetchWithAuth<FetchRunsListResponse>(`/admin/match-sources/fetch-runs?${qs.toString()}&_ts=${Date.now()}`);
            if (res?.ok) {
                setHistoryRuns(Array.isArray(res.runs) ? res.runs : []);
                setHistoryPage(res.pagination?.page ?? 1);
                setHistoryPages(res.pagination?.pages ?? 0);
                setHistoryTotal(res.pagination?.total ?? 0);
                setHistoryLoaded(true);
            }
        } finally {
            setHistoryLoading(false);
        }
    }, [fetchWithAuth]);

    const openRunDetail = async (id: number) => {
        setHistoryDetailLoading(true);
        setHistoryDetail(null);
        try {
            const res = await fetchWithAuth<FetchRunDetailResponse>(`/admin/match-sources/fetch-runs/${id}?_ts=${Date.now()}`);
            if (res?.ok) setHistoryDetail(res);
        } finally {
            setHistoryDetailLoading(false);
        }
    };

    const closeRunDetail = () => setHistoryDetail(null);

    // Inline preview panel for a single source. Diagnostics-only (M3): no selection,
    // no Apply, no publish, never written to the candidate pool.
    const renderSourceTestPanel = (s: MatchSourceRule) => {
        const busy = testingId === s.id;
        const d = testResult?.diagnostics;
        const providerError = testResult && testResult.ok === false ? testResult.provider_error : null;
        const kickoffTime = (iso: string) => {
            if (!iso) return "—";
            const dt = new Date(iso);
            return Number.isNaN(dt.getTime()) ? iso : dt.toISOString().slice(11, 16) + " UTC";
        };
        return (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tg-button)_28%,transparent)] bg-[color-mix(in_srgb,var(--tg-secondary-bg)_55%,transparent)] p-3 sm:p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[160px]">
                        <AdminInput
                            label="Дата теста"
                            type="date"
                            value={testDate}
                            onChange={(e) => setTestDate(e.target.value)}
                        />
                    </div>
                    <AdminButton variant="primary" onClick={() => runSourceTest(s.id)} loading={busy} disabled={busy}>
                        Запустить тест
                    </AdminButton>
                    <AdminButton variant="warning" onClick={() => runSourceTest(s.id, true)} disabled={busy} title="Обойти кэш и выполнить новый запрос к провайдеру">
                        Проверить принудительно
                    </AdminButton>
                    <AdminButton variant="secondary" onClick={closeSourceTest} disabled={busy}>
                        Скрыть
                    </AdminButton>
                </div>

                <div className="text-[11.5px] font-semibold text-[var(--tg-hint)]">
                    Запрашивается только этот источник из сохранённой конфигурации. Игровые данные не изменяются.
                </div>

                {testError && (
                    <div role="alert" className="text-[12px] font-bold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text))]">
                        {testError}
                    </div>
                )}

                {providerError && (
                    <div role="alert" className="rounded-xl border border-[color-mix(in_srgb,#ff5a52_28%,transparent)] bg-[color-mix(in_srgb,#ff5a52_10%,transparent)] p-3 text-[12px] font-bold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text))]">
                        Ошибка провайдера: {providerError.code} (HTTP {providerError.http_status}) · {providerError.message}
                    </div>
                )}

                {testResult?.ok && d && (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                            <AdminMetricCard size="sm" label="Получено" value={d.received ?? 0} />
                            <AdminMetricCard size="sm" label="Нормализовано" value={d.normalized ?? 0} />
                            <AdminMetricCard size="sm" label="Принято" value={d.accepted ?? 0} />
                            <AdminMetricCard size="sm" label="Отклонено" value={d.rejected ?? 0} />
                            <AdminMetricCard size="sm" label="Время, мс" value={d.duration_ms} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <AdminDataRow stackedOnMobile={false} label="Провайдер" value={s.provider === "football_data" ? "Football-Data" : "AllSports"} />
                            <AdminDataRow stackedOnMobile={false} label="Scope запроса" value={testResult.request?.fetch_scope || "—"} />
                            <AdminDataRow stackedOnMobile={false} label="HTTP статус" value={d.http_status} />
                            <AdminDataRow stackedOnMobile={false} label="Из кэша" value={d.from_cache ? "да" : "нет"} />
                            {d.daily_events_total !== undefined && (
                                <AdminDataRow stackedOnMobile={false} label="Событий за день (всего)" value={d.daily_events_total} />
                            )}
                            <AdminDataRow stackedOnMobile={false} label="Дата теста" value={d.tested_at ? formatAdminDate(d.tested_at) : "—"} />
                        </div>

                        {Array.isArray(testResult.warnings) && testResult.warnings.length > 0 && (
                            <div className="flex flex-col gap-1">
                                {testResult.warnings.map((w, i) => (
                                    <div key={i} className="text-[11.5px] font-bold text-[color-mix(in_srgb,#ffb340_88%,var(--tg-text))]">⚠ {w}</div>
                                ))}
                            </div>
                        )}

                        <div className="flex flex-col gap-2">
                            {(testResult.matches || []).length === 0 && (
                                <div className="text-[12px] font-semibold text-[var(--tg-hint)] py-4 text-center">Матчи для этого источника на выбранную дату не найдены.</div>
                            )}
                            {(testResult.matches || []).map((m) => (
                                <div
                                    key={m.provider_match_id}
                                    className="rounded-xl border p-3 flex flex-col gap-1.5"
                                    style={{
                                        borderColor: m.accepted
                                            ? "color-mix(in srgb, #34c759 30%, transparent)"
                                            : "color-mix(in srgb, #ff5a52 28%, transparent)",
                                        background: "color-mix(in srgb, var(--tg-secondary-bg) 40%, transparent)",
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[14px] font-black text-[var(--tg-text)] min-w-0 truncate">
                                            {m.home_team} — {m.away_team}
                                        </span>
                                        {m.accepted
                                            ? <AdminBadge variant="success">Принят</AdminBadge>
                                            : <AdminBadge variant="danger">Отклонён</AdminBadge>}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <AdminBadge variant="info">{m.competition_name}</AdminBadge>
                                        {m.competition_type && <AdminBadge variant="neutral">{m.competition_type === "national_team" ? "Сборные" : "Клубы"}</AdminBadge>}
                                        <AdminBadge variant="neutral">{kickoffTime(m.kickoff_utc)}</AdminBadge>
                                        {m.status && <AdminBadge variant="neutral">{m.status}</AdminBadge>}
                                        {m.stage && <AdminBadge variant="neutral">{m.stage}</AdminBadge>}
                                        <AdminBadge variant="neutral">id: {m.provider_match_id}</AdminBadge>
                                    </div>
                                    {!m.accepted && m.rejection_reasons.length > 0 && (
                                        <div className="text-[11.5px] font-semibold text-[color-mix(in_srgb,#ff5a52_84%,var(--tg-text))]">
                                            {m.rejection_reasons.join(" · ")}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        );
    };

    useEffect(() => {
        selectedDateRef.current = selectedDate;
    }, [selectedDate]);

    // Tournaments the refresh sweep would query for this day, and the admin's
    // chosen subset. Kept in a ref so loadMatchesData keeps its identity (the
    // mount/date effect depends on it).
    const selectedTournamentKeysRef = useRef<string[]>([]);
    const allTournamentsSelectedRef = useRef<boolean>(true);

    const loadMatchesData = useCallback(async (force = false, preserveManualIds?: string[]) => {
        const requestDay = selectedDate;
        const cacheBust = Date.now();
        setLoading(true);
        setError("");
        setCandidates([]);
        setOverride(null);
        setManualIds([]);
        setIsLockedOnServer(false);

        try {
            // Load Candidates
            // On a refresh, narrow the provider sweep to the checked tournaments —
            // each one costs a separate footapi request. Omitted when all are checked
            // so the backend keeps its default full sweep.
            const tournamentsParam = force && !allTournamentsSelectedRef.current && selectedTournamentKeysRef.current.length > 0
                ? `&tournaments=${encodeURIComponent(selectedTournamentKeysRef.current.join(","))}`
                : "";
            const url = `/admin/day/candidates?day=${requestDay}${force ? "&refresh=true" : ""}${tournamentsParam}&_ts=${cacheBust}`;
            const cRes = await fetchWithAuth<{
                matches: MatchCandidate[];
                matchMode?: MatchModeValue;
                effectiveMatchMode?: MatchModeValue;
                modeSource?: "global" | "published_day";
            }>(url);
            if (selectedDateRef.current !== requestDay) return;
            if (cRes) {
                setCandidates(cRes.matches || []);
                setMatchMode(cRes.matchMode || "club");
                setEffectiveMatchMode(cRes.effectiveMatchMode || cRes.matchMode || "club");
                setMatchModeSource(cRes.modeSource || "global");
            }

            // Load Current Top3/Override
            const tRes = await fetchWithAuth<OverrideData & {
                isLocked: boolean;
                matchMode?: MatchModeValue;
                effectiveMatchMode?: MatchModeValue;
                modeSource?: "global" | "published_day";
            }>(`/admin/day/top3?day=${requestDay}&_ts=${cacheBust}`);
            if (selectedDateRef.current !== requestDay) return;
            if (tRes) {
                setOverride(tRes);
                const serverManual = tRes.manualMatchIds || [];
                // M5: when reloading after a preview import, do NOT silently clear the
                // admin's current manual selection — keep any still-existing ids.
                if (preserveManualIds && preserveManualIds.length > 0) {
                    const candidateIds = new Set((cRes?.matches || []).map((c) => String(c.id)));
                    const merged = Array.from(new Set([
                        ...serverManual.map((id) => String(id)),
                        ...preserveManualIds.filter((id) => candidateIds.has(String(id))),
                    ]));
                    setManualIds(merged);
                } else {
                    setManualIds(serverManual);
                }
                // Backend allows admins to override published matches at any time.
                setIsLockedOnServer(false);
                setMatchMode(tRes.matchMode || cRes?.matchMode || "club");
                setEffectiveMatchMode(tRes.effectiveMatchMode || cRes?.effectiveMatchMode || tRes.matchMode || "club");
                setMatchModeSource(tRes.modeSource || cRes?.modeSource || "global");
            }
        } finally {
            if (selectedDateRef.current === requestDay) setLoading(false);
        }
    // setLoading/setError are stable setters passed from page.tsx → identity only
    // changes with fetchWithAuth/selectedDate, so the reload-on-date behavior is 1:1.
    }, [fetchWithAuth, selectedDate, setLoading, setError]);

  // Lazy load on mount + on date change (loadMatchesData identity tracks
  // selectedDate), matching the previous activeTab effect in page.tsx.
  useEffect(() => { loadMatchesData(); }, [loadMatchesData]);

    // Actions
    const saveOverride = async (mode: "AUTO" | "MANUAL" | "REST") => {
        if (mode === "MANUAL" && manualIds.length > 3) {
            setError("⚠️ Maximum 3 matches for MANUAL mode");
            return;
        }
        setLoading(true);
        setSuccess("");
        setError("");

        const res = await fetchWithAuth<{ ok?: boolean }>(`/admin/day/top3?day=${selectedDate}`, {
            method: "PUT",
            body: JSON.stringify({ mode, matchIds: mode === "MANUAL" ? manualIds : [] }),
        });

        setLoading(false);
        if (res?.ok) {
            let msg = "Reset to AUTO mode!";
            if (mode === "MANUAL") msg = "Saved MANUAL override!";
            if (mode === "REST") msg = "Set as REST DAY!";
            setSuccess(msg);
            loadMatchesData();
            setTimeout(() => setSuccess(""), 3000);
        }
    };

    const saveMatchBonusQuestion = async (
        matchId: string,
        payload: {
            enabled: boolean;
            questionType?: BonusQuestionType;
            correctAnswer?: string | null;
            pointsAward?: number;
            questionText?: string;
            targetPlayerId?: string | null;
            targetPlayerName?: string | null;
            answerOptionsJson?: BonusAnswerOption[] | null;
            ruleJson?: object | null;
            playerConfigJson?: object | null;
        }
    ) => {
        setSavingBonusMatchId(matchId);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; bonusQuestion?: object; error?: string }>(`/admin/match-bonus-question`, {
                method: "POST",
                body: JSON.stringify({
                    day: selectedDate,
                    matchId,
                    enabled: payload.enabled,
                    questionType: payload.questionType || "advances_team",
                    correctAnswer: payload.correctAnswer ?? null,
                    pointsAward: payload.pointsAward,
                    questionText: payload.questionText,
                    targetPlayerId: payload.targetPlayerId,
                    targetPlayerName: payload.targetPlayerName,
                    answerOptionsJson: payload.answerOptionsJson ?? undefined,
                    ruleJson: payload.ruleJson ?? undefined,
                    playerConfigJson: payload.playerConfigJson ?? undefined,
                }),
            });

            if (res?.ok) {
                setSuccess(payload.enabled ? "Доп. вопрос обновлён." : "Доп. вопрос выключен.");
                await loadMatchesData();
                setTimeout(() => setSuccess(""), 2500);
            } else {
                setError(res?.error || "Не удалось сохранить доп. вопрос");
            }
        } finally {
            setSavingBonusMatchId(null);
        }
    };

    const grantBonusQuestionRewards = async (matchId: string, questionType: BonusQuestionType) => {
        const key = `${matchId}:${questionType}`;
        setBonusGranting(key);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; processed?: number; granted?: number; starsTotal?: number; errors?: string[]; error?: string }>(`/admin/bonus-question/grant-rewards`, {
                method: "POST",
                body: JSON.stringify({ day: selectedDate, matchId, questionType }),
            });
            if (res?.ok) {
                setSuccess(`Начислено: ${res.granted ?? 0} игроков получили звёзды (всего ${res.starsTotal ?? 0} ⭐). Обработано: ${res.processed ?? 0}.`);
                await loadMatchesData();
                setTimeout(() => setSuccess(""), 4000);
            } else {
                setError(res?.error || "Ошибка начисления наград");
            }
        } finally {
            setBonusGranting(null);
        }
    };

    const warmSquadsForDay = async () => {
        setWarmingSquads(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; warmed?: number; complete?: number; error?: string }>(`/admin/bonus-question/warm-squads-day`, {
                method: "POST",
                body: JSON.stringify({ day: selectedDate }),
            });
            if (res?.ok) {
                setSuccess(`Составы загружены в кэш: ${res.complete ?? 0} из ${res.warmed ?? 0} матчей с полным составом. Пользователи теперь читают из кэша.`);
                setTimeout(() => setSuccess(""), 5000);
            } else {
                setError(res?.error || "Не удалось загрузить составы");
            }
        } finally {
            setWarmingSquads(false);
        }
    };

    const saveGoalscorerSetting = async (matchId: string, enabled: boolean) => {
        setSavingBonusMatchId(matchId);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/admin/match-goalscorer`, {
                method: "POST",
                body: JSON.stringify({
                    day: selectedDate,
                    matchId,
                    enabled,
                }),
            });

            if (res?.ok) {
                setSuccess(enabled ? "Вопрос на автора гола включён." : "Вопрос на автора гола выключен.");
                await loadMatchesData();
                setTimeout(() => setSuccess(""), 2500);
            } else {
                setError(res?.error || "Не удалось сохранить настройку автора гола");
            }
        } finally {
            setSavingBonusMatchId(null);
        }
    };

    const saveManualGoalscorers = async (m: MatchCandidate, scorerIds: string[]) => {
        setSavingBonusMatchId(m.id);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/admin/match-goalscorer`, {
                method: "POST",
                body: JSON.stringify({
                    day: selectedDate,
                    matchId: m.id,
                    enabled: true,
                    manualScorers: scorerIds,
                }),
            });

            if (res?.ok) {
                setSuccess(scorerIds.length > 0 ? "Авторы гола сохранены и день пересчитан." : "Сохранено: голов не было. День пересчитан.");
                await loadMatchesData();
                setTimeout(() => setSuccess(""), 2500);
            } else {
                setError(res?.error || "Не удалось сохранить авторов гола");
            }
        } finally {
            setSavingBonusMatchId(null);
        }
    };

    const loadSquadForMatch = async (matchId: string, force = false) => {
        const current = squadByMatch[matchId];
        if (!force && current && !current.loading && !current.error && (current.homeSquad.length > 0 || current.awaySquad.length > 0)) {
            return current;
        }

        setSquadByMatch(prev => ({
            ...prev,
            [matchId]: {
                homeSquad: prev[matchId]?.homeSquad || [],
                awaySquad: prev[matchId]?.awaySquad || [],
                loading: true,
            },
        }));

        try {
            const res = await fetchWithAuth<{ ok: boolean; homeSquad?: SquadPlayer[]; awaySquad?: SquadPlayer[]; error?: string }>(`/matches/${encodeURIComponent(matchId)}/squad`);
            const next: SquadState = {
                homeSquad: res?.homeSquad || [],
                awaySquad: res?.awaySquad || [],
                error: res?.ok === false ? (res.error || "Не удалось загрузить заявку") : undefined,
            };
            setSquadByMatch(prev => ({ ...prev, [matchId]: next }));
            return next;
        } catch (e: unknown) {
            const next: SquadState = {
                homeSquad: [],
                awaySquad: [],
                error: getErrorMessage(e) || "Не удалось загрузить заявку",
            };
            setSquadByMatch(prev => ({ ...prev, [matchId]: next }));
            return next;
        }
    };

    const getBonusQuestionConfig = (m: MatchCandidate, type: BonusQuestionType): BonusQuestion | null => {
        return ((m.bonusQuestions || []) as BonusQuestion[]).find(q => q.questionType === type) || null;
    };

    const getBonusAnswerLabel = (m: MatchCandidate, answer: string) => {
        if (answer === "home") return m.home_name || m.home || "Команда 1";
        if (answer === "away") return m.away_name || m.away || "Команда 2";
        if (answer === "none") return "Никто";
        if (answer === "yes") return "Да";
        if (answer === "no") return "Нет";
        return answer;
    };

    const configureExtraBonusQuestion = async (m: MatchCandidate, config: typeof EXTRA_BONUS_QUESTION_CONFIGS[number], enabled: boolean) => {
        const existing = getBonusQuestionConfig(m, config.type);
        let targetPlayerId = existing?.targetPlayerId || null;
        let targetPlayerName = existing?.targetPlayerName || null;

        if (enabled && config.needsPlayer && (!targetPlayerId || !targetPlayerName)) {
            await loadSquadForMatch(m.id);
            setError("Сначала выберите игрока из заявки матча, потом включите вопрос.");
            return;
        }

        if (enabled && config.needsPlayer && (!targetPlayerId || !targetPlayerName)) {
            const raw = window.prompt("Введите игрока в формате ID | Имя. ID можно взять из заявки/состава.", "");
            if (!raw) return;
            const [idPart, ...nameParts] = raw.split("|");
            targetPlayerId = String(idPart || "").trim();
            targetPlayerName = nameParts.join("|").trim();
            if (!targetPlayerId || !targetPlayerName) {
                setError("Для вопроса по игроку нужен формат: ID | Имя");
                return;
            }
        }

        // Build answerOptions for star-reward types
        let answerOptionsJson: BonusAnswerOption[] | null = null;
        let ruleJson: object | null = null;
        let playerConfigJson: object | null = null;

        if (config.isStarReward) {
            const draftKey = `${m.id}:${config.type}`;
            const rewardDraft = bonusRewardDraft[draftKey] || {};

            if (config.answers.length > 0) {
                answerOptionsJson = config.answers.map((key, idx) => {
                    const draft = rewardDraft[key];
                    const existingOpt = existing?.answerOptions?.find(o => o.key === key);
                    const reward_enabled = draft ? draft.enabled : (existingOpt?.reward_enabled ?? true);
                    const reward_stars = draft ? Number(draft.stars || 0) : (existingOpt?.reward_stars ?? bonusDefaultStars);
                    const labelMap = bonusAnswerLabelMap(config.type, m.home_name || m.home || "", m.away_name || m.away || "");
                    return { key, label: labelMap[key] || key, reward_enabled, reward_stars, sort_order: idx + 1 };
                });
            }

            if (config.needsRule) {
                const totalDraft = bonusTotalDraft[draftKey];
                const fallbackMetric = config.ruleMetric || "goals";
                if (totalDraft) {
                    ruleJson = {
                        metric: totalDraft.metric || existing?.ruleJson?.metric || fallbackMetric,
                        operator: totalDraft.operator || "gte",
                        threshold: Number(totalDraft.threshold) || 3,
                        ...(config.needsSide ? { side: totalDraft.side || existing?.ruleJson?.side || "home" } : {}),
                    };
                } else if (existing?.ruleJson) {
                    ruleJson = existing.ruleJson;
                } else {
                    ruleJson = {
                        metric: fallbackMetric,
                        operator: "gte",
                        threshold: 3,
                        ...(config.needsSide ? { side: "home" } : {}),
                    };
                }
            }

            if (config.type === "user_goalscorer") {
                const draft = bonusUserGoalscorerDraft[`${m.id}:${config.type}`];
                const existingCfg = existing?.playerConfig;
                playerConfigJson = {
                    player_pool: draft?.pool || existingCfg?.player_pool || "both_teams",
                    reward_enabled: true,
                    reward_stars: Number(draft?.rewardStars ?? (existingCfg?.reward_stars ?? bonusDefaultStars)),
                    player_source: "auto_fallback",
                };
            }
        }

        // Build question title
        // config.title — короткая подпись типа для админского списка; игроку нужен
        // полноценный вопрос, поэтому в question_text идёт playerTitle. Без него в БД
        // попадали ярлыки вроде «Обе забьют» и «Минута первого гола» — ровно их
        // мини-апп и показывал вместо вопроса.
        let questionText = config.needsPlayer && targetPlayerName
            ? (config.type === "player_scores" ? `Забьёт ли ${targetPlayerName}?` : `Сделает ли ${targetPlayerName} ассист?`)
            : (existing?.title || config.playerTitle || config.title);

        if (config.needsRule && ruleJson) {
            questionText = buildRuleQuestionTitle(config, ruleJson as BonusRule, m);
        }

        await saveMatchBonusQuestion(m.id, {
            enabled,
            questionType: config.type,
            correctAnswer: enabled ? (existing?.correctAnswer || null) : null,
            pointsAward: config.isStarReward ? 0 : (existing?.pointsAward || config.defaultPoints),
            questionText,
            targetPlayerId,
            targetPlayerName,
            answerOptionsJson,
            ruleJson,
            playerConfigJson,
        });
    };

    // ─── Tournament picker for the refresh sweep ─────────────────────────────
    // One footapi request per tournament, so unchecking a league is quota saved.
    const [importTournaments, setImportTournaments] = useState<ImportTournament[]>([]);
    const [importTournamentsLoaded, setImportTournamentsLoaded] = useState(false);
    const [importPickerOpen, setImportPickerOpen] = useState(false);
    const [selectedTournamentKeys, setSelectedTournamentKeys] = useState<string[]>([]);
    const [tournamentPickerReady, setTournamentPickerReady] = useState(false);

    // Only tournaments the backend would actually query are selectable; the rest
    // (no footapi id / out of their active months) are shown as skipped.
    const queriableTournaments = useMemo(() => importTournaments.filter((t) => t.queried), [importTournaments]);
    const skippedTournaments = useMemo(() => importTournaments.filter((t) => !t.queried), [importTournaments]);
    const queriableKeysKey = queriableTournaments.map((t) => t.key).join(",");
    const tournamentStorageKey = `admin:matches:import-tournaments:${effectiveMatchMode}`;

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await fetchWithAuth<{ ok: boolean; tournaments?: ImportTournament[] }>(
                `/admin/day/import-tournaments?day=${selectedDate}&_ts=${Date.now()}`,
            );
            if (cancelled) return;
            setImportTournaments(res?.ok && Array.isArray(res.tournaments) ? res.tournaments : []);
            setImportTournamentsLoaded(true);
        })().catch(() => {
            if (!cancelled) setImportTournamentsLoaded(true);
        });
        return () => { cancelled = true; };
    }, [fetchWithAuth, selectedDate]);

    // Restore the saved subset; unknown/stale keys drop out, a first visit checks all.
    useEffect(() => {
        if (!importTournamentsLoaded) return;
        const keys = queriableKeysKey ? queriableKeysKey.split(",") : [];
        let stored: string[] | null = null;
        try {
            const raw = window.localStorage.getItem(tournamentStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) stored = parsed.map(String);
            }
        } catch {
            stored = null;
        }
        setSelectedTournamentKeys(stored ? keys.filter((k) => stored!.includes(k)) : keys);
        setTournamentPickerReady(true);
    }, [importTournamentsLoaded, queriableKeysKey, tournamentStorageKey]);

    useEffect(() => {
        if (!tournamentPickerReady) return;
        try {
            window.localStorage.setItem(tournamentStorageKey, JSON.stringify(selectedTournamentKeys));
        } catch {
            // Storage unavailable — the picker still works for this session.
        }
    }, [tournamentPickerReady, tournamentStorageKey, selectedTournamentKeys]);

    const allTournamentsSelected = queriableTournaments.length > 0 && selectedTournamentKeys.length === queriableTournaments.length;

    // Mirror into refs so loadMatchesData can read them without re-creating itself.
    useEffect(() => {
        selectedTournamentKeysRef.current = selectedTournamentKeys;
        allTournamentsSelectedRef.current = allTournamentsSelected;
    }, [selectedTournamentKeys, allTournamentsSelected]);

    const toggleTournamentKey = (key: string) => {
        setSelectedTournamentKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
    };

    const handleRefreshMatches = async () => {
        if (queriableTournaments.length > 0 && selectedTournamentKeys.length === 0) {
            setError("Отметьте хотя бы один турнир для импорта.");
            return;
        }
        setIsRefreshing(true);
        setError("");
        setSuccess("");
        try {
            // SAFE refresh (M6): refresh=true now maps to the safe path on the backend.
            // Preserve the admin's current manual selection across the reload.
            await loadMatchesData(true, manualIds);
            const scope = allTournamentsSelected
                ? `все турниры (${queriableTournaments.length})`
                : `выбранные турниры (${selectedTournamentKeys.length} из ${queriableTournaments.length})`;
            setSuccess(`Кандидаты обновлены: ${scope}. Матчи не опубликованы, AUTO не запускался.`);
        } catch (e: unknown) {
            setError("Ошибка обновления матчей: " + getErrorMessage(e));
        } finally {
            setIsRefreshing(false);
        }
    };


    const handleResolveBonusQuestions = async () => {
        if (!confirm(`Пересчитать доп-вопросы за ${selectedDate}? Это подтянет ответы по завершённым матчам.`)) return;
        setIsResolvingBonus(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{
                ok: boolean;
                unresolvedBefore?: number;
                unresolvedAfter?: number;
                error?: string;
            }>(`/admin/day/resolve-bonus-questions?day=${selectedDate}`, {
                method: "POST",
            });
            if (res?.ok) {
                setSuccess(`Доп-вопросы пересчитаны. Было пустых: ${res.unresolvedBefore ?? 0}, осталось: ${res.unresolvedAfter ?? 0}.`);
                await loadMatchesData();
                setTimeout(() => setSuccess(""), 5000);
            } else {
                setError(res?.error || "Не удалось пересчитать доп-вопросы");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setIsResolvingBonus(false);
        }
    };

    const handleSetMatchMode = async (nextMode: MatchModeValue) => {
        if (nextMode === matchMode) return;
        const confirmed = window.confirm(
            nextMode === "national_teams"
                ? "Switch to National Teams mode? New match pools will include only adult men's national team competitions."
                : "Switch back to Club mode? New match pools will include only club competitions."
        );
        if (!confirmed) return;

        setIsSavingMatchMode(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<{ ok: boolean; mode?: MatchModeValue; error?: string }>(`/admin/match-mode`, {
                method: "PUT",
                body: JSON.stringify({ mode: nextMode }),
            });
            if (res?.ok) {
                setMatchMode(res.mode || nextMode);
                setSuccess(`Match mode switched to ${getMatchModeUiLabel(res.mode || nextMode)}.`);
                await loadMatchesData(true);
                setTimeout(() => setSuccess(""), 3000);
            } else {
                setError(res?.error || "Failed to update match mode");
            }
        } finally {
            setIsSavingMatchMode(false);
        }
    };

    const toggleManualId = (id: string) => {
        setManualIds(prev => {
            if (prev.includes(id)) return prev.filter(x => x !== id);
            if (prev.length >= 3) return prev; // Limit to 3
            return [...prev, id];
        });
    };

    const handleRecalcDay = async () => {
        if (!confirm(`Пересчитать очки за ${selectedDate}? Это обновит баллы всех пользователей за этот день.`)) return;
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const res = await fetchWithAuth<{ ok: boolean, error?: string }>(`/admin/finalize-day`, {
                method: "POST",
                body: JSON.stringify({ day: selectedDate, force: true })
            });
            if (res?.ok) {
                setSuccess(`Очки за ${selectedDate} пересчитаны!`);
                setTimeout(() => setSuccess(""), 4000);
            } else {
                setError(res?.error || "Ошибка пересчёта");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    const handleResendSummaries = async () => {
        if (!confirm("Are you sure you want to resend all summaries for this day? This will trigger bot to edit/delete existing messages and post updated versions.")) return;
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const res = await fetchWithAuth<{ ok: boolean, sent?: number, edited?: number, skipped?: number, noMatches?: boolean, error?: string }>(`/admin/day/resend-summaries?day=${selectedDate}`, {
                method: "POST"
            });
            if (res?.ok) {
                if (res.noMatches) {
                    setError(`Нет матчей для дня ${selectedDate} — итоги не отправлены`);
                } else {
                    setSuccess(`Ресенд: отправлено ${res.sent ?? 0}, отредактировано ${res.edited ?? 0}, пропущено ${res.skipped ?? 0}`);
                    setTimeout(() => setSuccess(""), 5000);
                }
            } else {
                setError(res?.error || "Failed to trigger resend");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    const handleBackfillCases = async () => {
        if (!confirm("Вы уверены, что хотите восстановить потерянные ежедневные кейсы за последние 7 дней? Эта операция найдет всех, кто выполнил условия, но не получил кейс.")) return;
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const res = await fetchWithAuth<{ ok: boolean, restored: number, error?: string }>(`/admin/cases/backfill-daily`, {
                method: "POST"
            });
            if (res) {
                if (res.ok) {
                    setSuccess(`Успешно восстановлено ${res.restored} кейсов!`);
                    setTimeout(() => setSuccess(""), 5000);
                } else {
                    setError(res.error || "Ошибка при восстановлении кейсов");
                }
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

  // P3.3: collapsible section meta (computed from current matches state, no logic change).
  const selectedCount = override?.matches?.length ?? 0;
  // M6.1: human-friendly publication status (manual-only). AUTO is no longer a normal
  // mode — a day with picks under legacy AUTO is shown as historical "Legacy AUTO".
  const dayIsRest = override?.mode === "REST";
  const dayIsManualPublished = override?.mode === "MANUAL" && selectedCount > 0;
  const dayIsLegacyAuto = override?.mode === "AUTO" && selectedCount > 0;
  const dayIsUnpublished = !dayIsRest && selectedCount === 0;
  const dayStatusLabel = dayIsRest ? "День отдыха"
    : dayIsManualPublished ? "Опубликовано вручную"
    : dayIsLegacyAuto ? "Legacy AUTO"
    : override === null ? "Загрузка…"
    : "Матчи дня не опубликованы";
  const statusSubtitle = `режим ${getMatchModeUiLabel(matchMode)} · ${dayStatusLabel}${selectedCount ? ` · ${selectedCount} матча` : ""}`;
  const importSubtitle = `найдено ${candidates.length} · выбрано ${manualIds.length}/3`;
  const importDefaultOpen = candidates.length > 0 || selectedCount < 3;

  return (
                    <div className="space-y-6">
                        {/* Current State Card */}
                        <AdminCollapsibleSection
                            title="Статус дня и матчи"
                            description={statusSubtitle}
                            badge={isLockedOnServer ? <AdminBadge variant="danger" className="text-[9px] px-1.5 py-0.5 rounded-md">LOCKED</AdminBadge> : undefined}
                            defaultOpen
                            keepMounted
                            storageKey="admin:matches:status"
                        >
                            <AdminCard className="p-0 overflow-hidden border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] shadow-xl shadow-black/20">
                                <div className="p-5 flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-10 h-10 rounded-2xl bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.05))] flex items-center justify-center border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                                                {dayIsManualPublished && <span className="text-orange-500 text-lg">⚙️</span>}
                                                {dayIsRest && <span className="text-purple-500 text-lg">😴</span>}
                                                {dayIsLegacyAuto && <span className="text-blue-500 text-lg">🤖</span>}
                                                {dayIsUnpublished && <span className="text-[var(--tg-theme-hint-color,#999)] text-lg">📝</span>}
                                            </div>
                                            <div>
                                                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-0.5">Статус дня</div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[15px] font-black ${dayIsManualPublished ? "text-orange-400" : dayIsRest ? "text-purple-400" : dayIsLegacyAuto ? "text-blue-400" : "text-[var(--tg-theme-hint-color,#999)]"}`}>
                                                        {dayStatusLabel}
                                                    </span>
                                                    {isLockedOnServer && <AdminBadge variant="danger" className="text-[9px] px-1.5 py-0.5 rounded-md">LOCKED</AdminBadge>}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex flex-wrap items-center gap-2">
                                            <AdminButton
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleRecalcDay}
                                                disabled={loading}
                                            >
                                                🔢 Пересчитать день
                                            </AdminButton>
                                            <AdminButton
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleResendSummaries}
                                                disabled={loading}
                                            >
                                                🔄 Ресенд итогов
                                            </AdminButton>
                                            <AdminButton
                                                variant="warning"
                                                size="sm"
                                                onClick={handleBackfillCases}
                                                disabled={loading}
                                            >
                                                🧰 Восстановить кейсы (7 дн)
                                            </AdminButton>
                                        </div>
                                    </div>

                                    {dayIsUnpublished && override !== null && (
                                        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint)_18%,transparent)] bg-[color-mix(in_srgb,var(--tg-secondary-bg)_45%,transparent)] p-3 sm:p-4">
                                            <div className="text-[13px] font-black text-[var(--tg-text)] mb-1">Матчи дня не опубликованы</div>
                                            <div className="text-[12px] font-semibold text-[var(--tg-hint)] leading-relaxed">
                                                Выберите до 3 матчей в разделе кандидатов ниже и нажмите «Apply Selection». Автоматический подбор отключён — матчи публикует только администратор.
                                            </div>
                                        </div>
                                    )}

                                    <div className="pt-4 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                                        <div className="flex flex-col gap-3">
                                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                                <div>
                                                    <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Match Pool Mode</div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <AdminBadge variant={matchMode === "club" ? "info" : "neutral"}>{getMatchModeUiLabel(matchMode)}</AdminBadge>
                                                        {matchModeSource === "published_day" && (
                                                            <AdminBadge variant="warning">Published day locked to {getMatchModeUiLabel(effectiveMatchMode)}</AdminBadge>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="w-full sm:w-auto sm:min-w-[220px]">
                                                    <AdminSegmentedControl<MatchModeValue>
                                                        ariaLabel="Режим пула матчей: клубы или сборные"
                                                        value={matchMode}
                                                        onChange={handleSetMatchMode}
                                                        options={[
                                                            { value: "club", label: "Клубы", disabled: isSavingMatchMode },
                                                            { value: "national_teams", label: "Сборные", disabled: isSavingMatchMode },
                                                        ]}
                                                    />
                                                </div>
                                            </div>
                                            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] leading-relaxed">
                                                {effectiveMatchMode === "national_teams"
                                                    ? "Only adult men's national-team competitions are available for new selections. Club matches are excluded before candidate generation."
                                                    : "Only club competitions are available for new selections. National-team tournaments are excluded from the new candidate pool."}
                                            </div>
                                            {matchModeSource === "published_day" && (
                                                <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] leading-relaxed">
                                                    This day already has published picks, so it keeps its original mode until you explicitly rebuild that day.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Selected Matches List */}
                                    <div className="pt-4 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                                        <div className="flex items-center justify-between gap-2 mb-3">
                                            <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)] font-bold uppercase tracking-wider">Selected Matches</div>
                                            <div className="flex items-center gap-2">
                                                <AdminButton
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={warmSquadsForDay}
                                                    disabled={warmingSquads}
                                                    className="!py-1 !px-2.5 !text-[11px] !rounded-lg flex items-center gap-1.5"
                                                    title="Загрузить составы команд в кэш, чтобы пользователи не расходовали квоту провайдера"
                                                >
                                                    {warmingSquads ? "Загружаю..." : "Загрузить составы"}
                                                </AdminButton>
                                                <AdminButton
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={handleResolveBonusQuestions}
                                                    disabled={isResolvingBonus}
                                                    className="!py-1 !px-2.5 !text-[11px] !rounded-lg flex items-center gap-1.5"
                                                >
                                                    {isResolvingBonus ? "Считаю..." : "Пересчитать доп-вопросы"}
                                                </AdminButton>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 mb-3 rounded-xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/10 px-3 py-2">
                                            <span className="text-[12px] font-semibold text-[var(--tg-theme-text-color,#fff)]" title="Подставляется в новые доп-вопросы и в старые вопросы без настроенных наград; награду конкретного вопроса можно менять как обычно">
                                                ⭐ Награда доп-вопроса по умолчанию
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    aria-label="Награда доп-вопроса по умолчанию, звёзд"
                                                    value={bonusDefaultDraft}
                                                    onChange={e => setBonusDefaultDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                                                    style={{ width: 52, textAlign: "center", background: "transparent", color: "inherit", border: "1px solid color-mix(in srgb, var(--tg-hint) 25%, transparent)", borderRadius: 8, padding: "4px 6px", fontSize: 13, fontWeight: 700 }}
                                                />
                                                <AdminButton
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={saveBonusDefault}
                                                    disabled={isSavingBonusDefault || Number(bonusDefaultDraft || "-1") === bonusDefaultStars}
                                                    className="!py-1 !px-2.5 !text-[11px] !rounded-lg"
                                                >
                                                    {isSavingBonusDefault ? "Сохраняю..." : "Сохранить"}
                                                </AdminButton>
                                            </div>
                                        </div>

                                        {override?.matches && override.matches.length > 0 ? (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                                {override.matches.map((m) => {
                                                    const bonusQuestions = Array.isArray(m.bonusQuestions) ? (m.bonusQuestions as BonusQuestion[]) : [];
                                                    const enabledExtraCount = bonusQuestions.filter(q => q.enabled).length;
                                                    const resolvedExtraCount = bonusQuestions.filter(q => q.enabled && q.resolved).length;
                                                    const legacyEnabledCount = (m.advancesQuestionEnabled ? 1 : 0) + (m.goalscorerEnabled ? 1 : 0);
                                                    const legacyResolvedCount = (m.advancesResolved ? 1 : 0) + (m.goalscorerResolved ? 1 : 0);
                                                    const enabledBonusCount = enabledExtraCount + legacyEnabledCount;
                                                    const resolvedBonusCount = resolvedExtraCount + legacyResolvedCount;
                                                    const enabledBonusChips = enabledBonusQuestionChips(m);
                                                    const matchSquadState = squadByMatch[m.id];
                                                    const hasSquadPlayers = Boolean((matchSquadState?.homeSquad?.length || 0) + (matchSquadState?.awaySquad?.length || 0));
                                                    const hasPlayerQuestion = m.goalscorerEnabled || bonusQuestions.some(q => q.enabled && ["player_scores", "player_assists", "user_goalscorer"].includes(q.questionType));
                                                    const hasRewardReady = bonusQuestions.some(q => q.enabled && q.resolved && q.status !== "rewards_granted");
                                                    const rewardsGrantedCount = bonusQuestions.filter(q => q.enabled && q.status === "rewards_granted").length;
                                                    const bonusSummary = enabledBonusCount > 0
                                                        ? `Доп. вопросы: ${enabledBonusCount} включено · ${resolvedBonusCount} решено`
                                                        : "Доп. вопросы: не настроены";
                                                    const squadSummary = hasPlayerQuestion
                                                        ? hasSquadPlayers
                                                            ? "Заявки загружены"
                                                            : matchSquadState?.error
                                                                ? "Есть ошибка загрузки заявки"
                                                                : "Нужна заявка или ручной ввод"
                                                        : "Нет активных вопросов по игрокам";
                                                    const rewardsSummary = hasRewardReady
                                                        ? "Есть готовые к наградам вопросы"
                                                        : rewardsGrantedCount > 0
                                                            ? `Награды выданы: ${rewardsGrantedCount}`
                                                            : "Результаты появятся после resolve";
                                                    // Default-open one question per match: the first needing attention, else
                                                    // (only on a fresh match with nothing enabled) the first question. Otherwise none.
                                                    const questionOpenDefault: BonusQuestionType | null = (() => {
                                                        for (const cfg of EXTRA_BONUS_QUESTION_CONFIGS) {
                                                            if (bonusQuestionSummary(cfg, getBonusQuestionConfig(m, cfg.type), !!matchSquadState?.error, bonusDefaultStars).needsAttention) return cfg.type;
                                                        }
                                                        const anyEnabled = EXTRA_BONUS_QUESTION_CONFIGS.some(cfg => getBonusQuestionConfig(m, cfg.type)?.enabled === true);
                                                        return anyEnabled ? null : (EXTRA_BONUS_QUESTION_CONFIGS[0]?.type ?? null);
                                                    })();
                                                    // Включённые вопросы показываем в «Дополнительных вопросах» рядом с legacy-карточкой
                                                    // «кто пройдёт дальше», выключенные — ниже, в «Добавить вопрос». Разметка карточки одна
                                                    // на оба места: рендерер замыкает состояние матча, поэтому дублировать JSX не нужно.
                                                    const enabledQuestionConfigs = EXTRA_BONUS_QUESTION_CONFIGS.filter(cfg => getBonusQuestionConfig(m, cfg.type)?.enabled === true);
                                                    const disabledQuestionConfigs = EXTRA_BONUS_QUESTION_CONFIGS.filter(cfg => getBonusQuestionConfig(m, cfg.type)?.enabled !== true);
                                                    const renderBonusQuestionCard = (config: (typeof EXTRA_BONUS_QUESTION_CONFIGS)[number]) => {
                                                        const q = getBonusQuestionConfig(m, config.type);
                                                        const enabled = q?.enabled === true;
                                                        const squadState = squadByMatch[m.id];
                                                        const playerOptions = [
                                                            ...(squadState?.homeSquad || []).map(p => ({ ...p, team: m.home_name || m.home || "Home" })),
                                                            ...(squadState?.awaySquad || []).map(p => ({ ...p, team: m.away_name || m.away || "Away" })),
                                                        ];
                                                        const draftKey = `${m.id}:${config.type}`;
                                                        const isStarType = config.isStarReward === true;
                                                        const isGranting = bonusGranting === draftKey;
                                                        const needsManualResolve = config.manualResolveOnly && enabled && !q?.resolved;
                                                        const questionSummary = bonusQuestionSummary(config, q, !!squadState?.error, bonusDefaultStars);
                                                        const questionOpen = openQuestion[draftKey] ?? (questionOpenDefault === config.type);
                                                        return (
                                                            <div key={config.type} style={{ padding: 12, borderRadius: 14, background: isStarType ? "rgba(255,214,0,0.04)" : "rgba(255,255,255,0.03)", border: isStarType ? "1px solid rgba(255,214,0,0.15)" : "1px solid var(--tg-separator, rgba(128,128,128,0.08))", display: "flex", flexDirection: "column", gap: 10 }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleQuestion(m.id, config.type, questionOpen)}
                                                                    aria-expanded={questionOpen}
                                                                    className="block w-full appearance-none border-0 bg-transparent p-0 text-left outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--tg-theme-button-color,#2481cc)]"
                                                                >
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-tight text-[var(--tg-text)] line-clamp-2">{isStarType ? "⭐ " : ""}{q?.title || config.title}</span>
                                                                        <span aria-hidden className={`mt-0.5 shrink-0 text-[var(--tg-hint)] transition-transform ${questionOpen ? "rotate-180" : ""}`}>˅</span>
                                                                    </div>
                                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                                        {questionSummary.items.map((item, itemIdx) => (
                                                                            <AdminBadge key={itemIdx} variant={item.variant} size="sm">{item.label}</AdminBadge>
                                                                        ))}
                                                                    </div>
                                                                </button>
                                                                <div style={{ display: questionOpen ? "flex" : "none", flexDirection: "column", gap: 10 }}>
                                                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                                                    <div>
                                                                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tg-text)", display: "flex", alignItems: "center", gap: 6 }}>
                                                                            {isStarType ? "⭐ " : ""}{q?.title || config.title}
                                                                            {isStarType
                                                                                ? <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,214,0,0.8)", background: "rgba(255,214,0,0.1)", borderRadius: 6, padding: "1px 5px" }}>⭐ награды</span>
                                                                                : <span style={{ fontSize: 10, fontWeight: 600, color: "var(--tg-hint)", background: "rgba(128,128,128,0.1)", borderRadius: 6, padding: "1px 5px" }}>legacy · очки</span>
                                                                            }
                                                                        </div>
                                                                        <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                                                                            {isStarType ? "Награда игровыми звёздами · points_award=0" : `Legacy: влияет на очки доп. вопросов · +${q?.pointsAward || config.defaultPoints} оч.`}
                                                                            {q?.targetPlayerName ? ` · Игрок: ${q.targetPlayerName}` : ""}
                                                                            {q?.status ? ` · ${q.status}` : ""}
                                                                        </div>
                                                                    </div>
                                                                    <AdminButton variant={enabled ? "secondary" : "primary"} size="sm" disabled={savingBonusMatchId === m.id} onClick={() => configureExtraBonusQuestion(m, config, !enabled)} className="!rounded-xl !py-2 !px-3">
                                                                        {enabled ? "Выключить" : "Включить"}
                                                                    </AdminButton>
                                                                </div>

                                                                {/* Rule config: metric / side / operator / threshold */}
                                                                {config.needsRule && (() => {
                                                                    const ruleDraft = bonusTotalDraft[draftKey];
                                                                    const currentMetric = ruleDraft?.metric || q?.ruleJson?.metric || config.ruleMetric || "goals";
                                                                    const currentSide = ruleDraft?.side || q?.ruleJson?.side || "home";
                                                                    const currentOperator = ruleDraft?.operator || q?.ruleJson?.operator || "gte";
                                                                    const currentThreshold = ruleDraft?.threshold ?? String(q?.ruleJson?.threshold ?? 3);
                                                                    // Каждый селектор пишет весь черновик целиком: сохранение читает только
                                                                    // bonusTotalDraft, и частичное обновление уронило бы метрику или сторону
                                                                    // в undefined, а с ней и правило вопроса.
                                                                    const patchDraft = (patch: Partial<{ metric: string; side: string; operator: string; threshold: string }>) =>
                                                                        setBonusTotalDraft(prev => ({
                                                                            ...prev,
                                                                            [draftKey]: {
                                                                                metric: currentMetric,
                                                                                side: currentSide,
                                                                                operator: currentOperator,
                                                                                threshold: currentThreshold,
                                                                                ...patch,
                                                                            },
                                                                        }));
                                                                    return (
                                                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                                        <span style={{ fontSize: 12, color: "var(--tg-hint)", fontWeight: 700 }}>
                                                                            {config.type === "stat_leader" ? "Показатель:" : "Тотал:"}
                                                                        </span>
                                                                        {config.metricChoices && (
                                                                            <AdminSelect
                                                                                fullWidth={false}
                                                                                value={currentMetric}
                                                                                onChange={value => patchDraft({ metric: value })}
                                                                                options={config.metricChoices.map(choice => ({ value: choice.value, label: choice.label }))}
                                                                            />
                                                                        )}
                                                                        {config.needsSide && (
                                                                            <AdminSelect
                                                                                fullWidth={false}
                                                                                value={currentSide}
                                                                                onChange={value => patchDraft({ side: value })}
                                                                                options={[
                                                                                    { value: "home", label: m.home_name || m.home || "Хозяева" },
                                                                                    { value: "away", label: m.away_name || m.away || "Гости" },
                                                                                ]}
                                                                            />
                                                                        )}
                                                                        {config.type !== "stat_leader" && (
                                                                            <>
                                                                                <AdminSelect
                                                                                    fullWidth={false}
                                                                                    value={currentOperator}
                                                                                    onChange={value => patchDraft({ operator: value })}
                                                                                    options={[
                                                                                        { value: "gte", label: "Больше или равно (≥)" },
                                                                                        { value: "lte", label: "Меньше или равно (≤)" },
                                                                                        { value: "eq", label: "Ровно (=)" },
                                                                                    ]}
                                                                                />
                                                                                <input
                                                                                    type="number" min={0} max={99}
                                                                                    value={currentThreshold}
                                                                                    onChange={e => patchDraft({ threshold: e.target.value })}
                                                                                    style={{ width: 64, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 800 }}
                                                                                />
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                    );
                                                                })()}

                                                                {/* user_goalscorer config */}
                                                                {config.type === "user_goalscorer" && (
                                                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                                        <span style={{ fontSize: 12, color: "var(--tg-hint)", fontWeight: 700 }}>Пул игроков:</span>
                                                                        <AdminSelect
                                                                            fullWidth={false}
                                                                            value={bonusUserGoalscorerDraft[draftKey]?.pool || q?.playerConfig?.player_pool || "both_teams"}
                                                                            onChange={value => setBonusUserGoalscorerDraft(prev => ({ ...prev, [draftKey]: { ...prev[draftKey], pool: value, rewardStars: prev[draftKey]?.rewardStars || String(q?.playerConfig?.reward_stars ?? bonusDefaultStars) } }))}
                                                                            options={[
                                                                                { value: "both_teams", label: "Обе команды" },
                                                                                { value: "home_team", label: "Только хозяева" },
                                                                                { value: "away_team", label: "Только гости" },
                                                                            ]}
                                                                        />
                                                                        <span style={{ fontSize: 12, color: "var(--tg-hint)", fontWeight: 700 }}>Награда:</span>
                                                                        <input
                                                                            type="number" min={1} max={100}
                                                                            value={bonusUserGoalscorerDraft[draftKey]?.rewardStars ?? String(q?.playerConfig?.reward_stars ?? bonusDefaultStars)}
                                                                            onChange={e => setBonusUserGoalscorerDraft(prev => ({ ...prev, [draftKey]: { ...prev[draftKey], rewardStars: e.target.value, pool: prev[draftKey]?.pool || q?.playerConfig?.player_pool || "both_teams" } }))}
                                                                            style={{ width: 64, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 800 }}
                                                                        />
                                                                        <span style={{ fontSize: 12, color: "var(--tg-hint)" }}>⭐</span>
                                                                    </div>
                                                                )}

                                                                {/* user_goalscorer: resolve section — mark actual goalscorers */}
                                                                {config.type === "user_goalscorer" && enabled && (
                                                                    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "rgba(255,214,0,0.04)", border: "1px solid rgba(255,214,0,0.12)" }}>
                                                                        <div style={{ fontSize: 12, color: "var(--tg-hint)", fontWeight: 700 }}>Кто забил в матче (resolve):</div>
                                                                        {q?.resolved && (
                                                                            <div style={{ fontSize: 11, color: "#34c759" }}>
                                                                                ✓ Зафиксировано: {(() => {
                                                                                    try { const ids: string[] = JSON.parse(q.correctAnswer || "[]"); return ids.length > 0 ? ids.join(", ") : "никто"; } catch { return q.correctAnswer; }
                                                                                })()}
                                                                            </div>
                                                                        )}
                                                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                                                            <button
                                                                                type="button"
                                                                                disabled={squadState?.loading || savingBonusMatchId === m.id}
                                                                                onClick={() => loadSquadForMatch(m.id, true)}
                                                                                style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "rgba(255,255,255,0.04)", color: "var(--tg-text)", fontSize: 12, fontWeight: 700 }}
                                                                            >
                                                                                {squadState?.loading ? "Загрузка..." : "Загрузить заявку"}
                                                                            </button>
                                                                            <AdminButton
                                                                                variant="secondary" size="sm"
                                                                                disabled={savingBonusMatchId === m.id}
                                                                                onClick={() => {
                                                                                    const value = window.prompt("ID авторов голов через запятую (пусто = никто не забил):", (ugResolveScorers[draftKey] || []).join(", "));
                                                                                    if (value === null) return;
                                                                                    const ids = value.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
                                                                                    setUgResolveScorers(prev => ({ ...prev, [draftKey]: ids }));
                                                                                }}
                                                                                className="!rounded-xl !py-2 !px-3"
                                                                            >
                                                                                Ввести ID вручную
                                                                            </AdminButton>
                                                                        </div>
                                                                        {playerOptions.length > 0 && (
                                                                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                                                                {playerOptions.map((player) => {
                                                                                    const isSelected = (ugResolveScorers[draftKey] || []).includes(player.id);
                                                                                    return (
                                                                                        <button
                                                                                            key={`${player.team}:${player.id}:ug-resolve`}
                                                                                            type="button"
                                                                                            disabled={savingBonusMatchId === m.id}
                                                                                            onClick={() => setUgResolveScorers(prev => {
                                                                                                const ids = prev[draftKey] || [];
                                                                                                return { ...prev, [draftKey]: isSelected ? ids.filter(id => id !== player.id) : [...ids, player.id] };
                                                                                            })}
                                                                                            style={{
                                                                                                padding: "8px 10px", borderRadius: 12,
                                                                                                border: isSelected ? "1px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.12))",
                                                                                                background: isSelected ? "rgba(36,129,204,0.16)" : "transparent",
                                                                                                color: isSelected ? "var(--tg-button, #2481cc)" : "var(--tg-text)",
                                                                                                fontSize: 12, fontWeight: 700,
                                                                                            }}
                                                                                        >
                                                                                            {player.name} · {player.team}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                                            <AdminButton
                                                                                variant="primary" size="sm"
                                                                                disabled={savingBonusMatchId === m.id}
                                                                                onClick={() => {
                                                                                    const ids = ugResolveScorers[draftKey] || [];
                                                                                    saveMatchBonusQuestion(m.id, {
                                                                                        enabled: true,
                                                                                        questionType: "user_goalscorer",
                                                                                        correctAnswer: JSON.stringify(ids),
                                                                                        pointsAward: 0,
                                                                                        questionText: q?.title || config.title,
                                                                                        playerConfigJson: q?.playerConfig || null,
                                                                                    });
                                                                                }}
                                                                                className="!rounded-xl !py-2 !px-3"
                                                                            >
                                                                                Зафиксировать результат
                                                                            </AdminButton>
                                                                            <span style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                                                                                {(ugResolveScorers[draftKey] || []).length === 0 ? "никто не забил" : `${(ugResolveScorers[draftKey] || []).length} автор(ов)`}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                <div style={{ display: "grid", gridTemplateColumns: config.needsPlayer ? "1fr 92px" : "1fr", gap: 8 }}>
                                                                    {config.needsPlayer && (
                                                                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                                            <div style={{ display: "flex", gap: 8 }}>
                                                                                <button
                                                                                    type="button"
                                                                                    disabled={squadState?.loading || savingBonusMatchId === m.id}
                                                                                    onClick={() => loadSquadForMatch(m.id, true)}
                                                                                    style={{ padding: "9px 10px", borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "rgba(255,255,255,0.04)", color: "var(--tg-text)", fontSize: 12, fontWeight: 700 }}
                                                                                >
                                                                                    {squadState?.loading ? "Загрузка..." : "Загрузить заявку"}
                                                                                </button>
                                                                                <div className="min-w-0 flex-1">
                                                                                    <AdminSelect
                                                                                        placeholder="Выберите игрока"
                                                                                        value={q?.targetPlayerId || ""}
                                                                                        disabled={squadState?.loading || playerOptions.length === 0 || savingBonusMatchId === m.id}
                                                                                        onChange={(value) => {
                                                                                            const selected = playerOptions.find(p => p.id === value);
                                                                                            if (!selected) return;
                                                                                            saveMatchBonusQuestion(m.id, {
                                                                                                enabled,
                                                                                                questionType: config.type,
                                                                                                correctAnswer: enabled ? (q?.correctAnswer || null) : null,
                                                                                                pointsAward: q?.pointsAward || config.defaultPoints,
                                                                                                questionText: config.type === "player_scores" ? `Забьет ли ${selected.name}?` : `Сделает ли ${selected.name} ассист?`,
                                                                                                targetPlayerId: selected.id,
                                                                                                targetPlayerName: selected.name,
                                                                                            });
                                                                                        }}
                                                                                        options={playerOptions.map(p => ({ value: p.id, label: `${p.name} · ${p.team}` }))}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            {squadState?.error && <div style={{ fontSize: 11, color: "var(--tg-destructive, #ff3b30)" }}>{squadState.error}</div>}
                                                                            {!squadState?.loading && squadState && playerOptions.length === 0 && <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>Провайдер пока не отдал заявку. Можно попробовать позже.</div>}
                                                                        </div>
                                                                    )}
                                                                    {/* Points input (only for non-star types) */}
                                                                    {!isStarType && (
                                                                        <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                                                            <span style={{ fontSize: 11, color: "var(--tg-hint)", fontWeight: 700 }}>Очки</span>
                                                                            <input
                                                                                type="number"
                                                                                min={1}
                                                                                max={20}
                                                                                defaultValue={q?.pointsAward || config.defaultPoints}
                                                                                disabled={savingBonusMatchId === m.id}
                                                                                onBlur={(event) => {
                                                                                    const nextPoints = Math.max(1, Math.min(20, Number(event.target.value || config.defaultPoints)));
                                                                                    saveMatchBonusQuestion(m.id, {
                                                                                        enabled,
                                                                                        questionType: config.type,
                                                                                        correctAnswer: enabled ? (q?.correctAnswer || null) : null,
                                                                                        pointsAward: nextPoints,
                                                                                        questionText: q?.title || config.title,
                                                                                        targetPlayerId: q?.targetPlayerId || null,
                                                                                        targetPlayerName: q?.targetPlayerName || null,
                                                                                    });
                                                                                }}
                                                                                style={{ width: "100%", padding: "9px 10px", borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 800 }}
                                                                            />
                                                                        </label>
                                                                    )}
                                                                </div>

                                                                {/* Per-answer reward config for star types */}
                                                                {isStarType && config.answers.length > 0 && (
                                                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                                                        <div style={{ fontSize: 11, color: "var(--tg-hint)", fontWeight: 700 }}>Звёзды, если вариант окажется правильным:</div>
                                                                        {config.answers.map(ansKey => {
                                                                            const labelMap = bonusAnswerLabelMap(config.type, m.home_name || m.home || "", m.away_name || m.away || "");
                                                                            const existingOpt = q?.answerOptions?.find(o => o.key === ansKey);
                                                                            const draft = bonusRewardDraft[draftKey]?.[ansKey];
                                                                            const isEnabled = draft ? draft.enabled : (existingOpt?.reward_enabled ?? true);
                                                                            const stars = draft ? draft.stars : String(existingOpt?.reward_stars ?? bonusDefaultStars);
                                                                            return (
                                                                                <div key={ansKey} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                                                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tg-text)", minWidth: 40 }}>{labelMap[ansKey] || ansKey}</span>
                                                                                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--tg-hint)" }}>
                                                                                        <input type="checkbox" checked={isEnabled} onChange={e => setBonusRewardDraft(prev => ({ ...prev, [draftKey]: { ...prev[draftKey], [ansKey]: { enabled: e.target.checked, stars: stars } } }))} />
                                                                                        выдать
                                                                                    </label>
                                                                                    <input
                                                                                        type="number" min={0} max={100}
                                                                                        value={stars}
                                                                                        disabled={!isEnabled}
                                                                                        onChange={e => setBonusRewardDraft(prev => ({ ...prev, [draftKey]: { ...prev[draftKey], [ansKey]: { enabled: isEnabled, stars: e.target.value } } }))}
                                                                                        style={{ width: 64, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 800, opacity: isEnabled ? 1 : 0.4 }}
                                                                                    />
                                                                                    <span style={{ fontSize: 12, color: "var(--tg-hint)" }}>⭐</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}

                                                                {enabled && config.answers.length > 0 && (
                                                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                                                        {config.answers.map((answer) => {
                                                                            const active = q?.correctAnswer === answer;
                                                                            return (
                                                                                <button key={answer} disabled={savingBonusMatchId === m.id} onClick={() => saveMatchBonusQuestion(m.id, {
                                                                                    enabled: true,
                                                                                    questionType: config.type,
                                                                                    correctAnswer: answer,
                                                                                    pointsAward: isStarType ? 0 : (q?.pointsAward || config.defaultPoints),
                                                                                    questionText: q?.title || config.title,
                                                                                    targetPlayerId: q?.targetPlayerId || null,
                                                                                    targetPlayerName: q?.targetPlayerName || null,
                                                                                    answerOptionsJson: q?.answerOptions || null,
                                                                                    ruleJson: q?.ruleJson || null,
                                                                                })} style={{ flex: 1, minWidth: 96, padding: "9px 10px", borderRadius: 12, border: active ? "1px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: active ? "rgba(36,129,204,0.16)" : "transparent", color: active ? "var(--tg-button, #2481cc)" : "var(--tg-text)", fontSize: 12, fontWeight: 700 }}>
                                                                                    {getBonusAnswerLabel(m, answer)}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}

                                                                {/* Manual resolve required hint */}
                                                                {needsManualResolve && (
                                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: "rgba(255,165,0,0.08)", border: "1px solid rgba(255,165,0,0.2)" }}>
                                                                        <span style={{ fontSize: 13 }}>⚠️</span>
                                                                        <span style={{ fontSize: 11, color: "rgba(255,165,0,0.9)", fontWeight: 600 }}>Авто-результат недоступен — требуется ручное подтверждение</span>
                                                                    </div>
                                                                )}

                                                                {/* Grant rewards button for resolved star-reward questions */}
                                                                {isStarType && enabled && q?.resolved && (
                                                                    <div style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 4, borderTop: "1px solid var(--tg-separator, rgba(128,128,128,0.08))" }}>
                                                                        <AdminButton
                                                                            variant="primary" size="sm"
                                                                            disabled={isGranting || savingBonusMatchId === m.id}
                                                                            onClick={() => grantBonusQuestionRewards(m.id, config.type)}
                                                                            className="!rounded-xl !py-2 !px-3"
                                                                        >
                                                                            {isGranting ? "Начисление..." : "Начислить ⭐ награды"}
                                                                        </AdminButton>
                                                                        <span style={{ fontSize: 11, color: "var(--tg-hint)" }}>
                                                                            {q?.status === "rewards_granted" ? "✓ Награды выданы" : "Правильный ответ: " + (q?.correctAnswer || "—")}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                </div>
                                                            </div>
                                                        );
                                                    };
                                                    const matchOpen = openMatchIds[m.id] ?? false;
                                                    const kickoff = formatAdminDate(m.start_time_utc || m.utcDate).split(', ')[1] || formatAdminDate(m.start_time_utc || m.utcDate);
                                                    const homeTeam = m.home_name || m.home || "Home";
                                                    const awayTeam = m.away_name || m.away || "Away";
                                                    const competitionLabel = formatMatchMetaLabel(m.competition_label || m.competition_code || m.competition, "Competition");
                                                    const providerLabel = formatMatchMetaLabel(m.api_provider, kickoff || "—");
                                                    return (
                                                    <div key={m.id} style={{
                                                        background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
                                                        borderRadius: 20,
                                                        padding: 14,
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: matchOpen ? 12 : 0,
                                                        border: "1px solid color-mix(in srgb, var(--tg-hint) 7%, transparent)",
                                                        boxShadow: "0 1px 0 color-mix(in srgb, var(--tg-hint) 6%, transparent), 0 8px 18px rgba(0,0,0,0.04)",
                                                    }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleMatch(m.id, matchOpen)}
                                                            aria-expanded={matchOpen}
                                                            style={{
                                                                WebkitAppearance: "none",
                                                                appearance: "none",
                                                                WebkitTapHighlightColor: "transparent",
                                                                background: "transparent",
                                                                border: 0,
                                                                outline: "none",
                                                                color: "inherit",
                                                                cursor: "pointer",
                                                                display: "block",
                                                                padding: 0,
                                                                textAlign: "left",
                                                                width: "100%",
                                                            }}
                                                        >
                                                            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                                                                <div
                                                                    style={{
                                                                        alignItems: "flex-start",
                                                                        columnGap: 10,
                                                                        display: "grid",
                                                                        gridTemplateColumns: "minmax(0,1fr) minmax(64px,0.72fr) minmax(72px,0.78fr) 18px",
                                                                        minWidth: 0,
                                                                        textAlign: "left",
                                                                    }}
                                                                >
                                                                    <div style={{ alignItems: "flex-start", color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "flex", fontSize: 13, fontWeight: 650, gap: 6, lineHeight: 1.2, minWidth: 0 }}>
                                                                        <span aria-hidden style={{ flexShrink: 0, fontSize: 13, lineHeight: 1.2 }}>🏆</span>
                                                                        <span style={{ display: "-webkit-box", minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{competitionLabel}</span>
                                                                    </div>
                                                                    <span style={{ color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "-webkit-box", fontSize: 13, fontWeight: 650, lineHeight: 1.2, minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{getMatchTypeUiLabel(m.match_type)}</span>
                                                                    <span style={{ color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "-webkit-box", fontSize: 13, fontWeight: 650, lineHeight: 1.2, minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{m.api_provider ? `⚡ ${providerLabel}` : providerLabel}</span>
                                                                    <span
                                                                        aria-hidden
                                                                        style={{
                                                                            color: "color-mix(in srgb, var(--tg-hint) 72%, transparent)",
                                                                            display: "flex",
                                                                            fontSize: 18,
                                                                            fontWeight: 650,
                                                                            justifyContent: "flex-end",
                                                                            lineHeight: 1,
                                                                            transform: matchOpen ? "rotate(180deg)" : undefined,
                                                                            transition: "transform 160ms ease",
                                                                            width: 18,
                                                                        }}
                                                                    >
                                                                        {matchOpen ? "⌃" : "—"}
                                                                    </span>
                                                                </div>
                                                                <div style={{ alignItems: "flex-start", display: "flex", flexDirection: "column", gap: 8 }}>
                                                                    <span style={{
                                                                        background: "color-mix(in srgb, var(--tg-bg) 56%, var(--tg-secondary-bg))",
                                                                        borderRadius: 999,
                                                                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--tg-bg) 38%, transparent)",
                                                                        color: "color-mix(in srgb, var(--tg-hint) 84%, var(--tg-text))",
                                                                        display: "inline-flex",
                                                                        fontSize: 12,
                                                                        fontWeight: 900,
                                                                        lineHeight: 1,
                                                                        maxWidth: "100%",
                                                                        padding: "6px 10px",
                                                                    }}>
                                                                        {bonusSummary}
                                                                    </span>
                                                                    <span style={{
                                                                        background: hasRewardReady ? "color-mix(in srgb, #ffb340 10%, var(--tg-secondary-bg))" : "color-mix(in srgb, var(--tg-bg) 56%, var(--tg-secondary-bg))",
                                                                        borderRadius: 999,
                                                                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--tg-bg) 38%, transparent)",
                                                                        color: hasRewardReady ? "color-mix(in srgb, #ffb340 82%, var(--tg-text))" : "color-mix(in srgb, var(--tg-hint) 84%, var(--tg-text))",
                                                                        display: "inline-flex",
                                                                        fontSize: 12,
                                                                        fontWeight: 900,
                                                                        lineHeight: 1,
                                                                        maxWidth: "100%",
                                                                        padding: "6px 10px",
                                                                    }}>
                                                                        {rewardsSummary}
                                                                    </span>
                                                                </div>
                                                                <div style={{ color: "var(--tg-text)", display: "flex", flexDirection: "column", fontSize: 18, fontWeight: 900, gap: 8, lineHeight: 1.12, minWidth: 0, paddingTop: 2 }}>
                                                                    {[homeTeam, awayTeam].map((team, index) => (
                                                                        <div key={`${m.id}-${index}`} style={{ alignItems: "center", display: "flex", gap: 10, minWidth: 0 }}>
                                                                            <span style={{ background: "color-mix(in srgb, var(--tg-hint) 12%, var(--tg-bg))", borderRadius: "50%", flexShrink: 0, height: 28, width: 28 }} aria-hidden />
                                                                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </button>
                                                        <div style={{
                                                            display: matchOpen ? "flex" : "none",
                                                            flexDirection: "column",
                                                            gap: 12,
                                                            paddingTop: 12,
                                                            borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
                                                        }}>

                                                        <AdminCollapsibleSection
                                                            title="Дополнительные вопросы"
                                                            description={<BonusEnabledQuestionList chips={enabledBonusChips} note={enabledBonusCount > 0 ? rewardsSummary : null} />}
                                                            badge={enabledBonusCount > 0 ? `${enabledBonusCount}` : "0"}
                                                            defaultOpen={enabledBonusCount === 0}
                                                            keepMounted
                                                        >
                                                        <div style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 12,
                                                        }}>
                                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                                                <div>
                                                                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tg-text)", display: "flex", alignItems: "center", gap: 6 }}>
                                                                        ⭐ Кто пройдет дальше?
                                                                        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,214,0,0.8)", background: "rgba(255,214,0,0.1)", borderRadius: 6, padding: "1px 5px" }}>⭐ награды</span>
                                                                    </div>
                                                                    <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                                                                        За правильный ответ игрок получает игровые звёзды
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                                    <AdminBadge variant={m.advancesQuestionEnabled ? "success" : "neutral"} className="text-[10px] px-2 py-1 rounded-full">
                                                                        {m.advancesQuestionEnabled ? "Включено" : "Выключено"}
                                                                    </AdminBadge>
                                                                    <AdminToggle
                                                                        checked={m.advancesQuestionEnabled === true}
                                                                        disabled={savingBonusMatchId === m.id}
                                                                        onChange={() => saveMatchBonusQuestion(m.id, {
                                                                            enabled: !(m.advancesQuestionEnabled === true),
                                                                            correctAnswer: !(m.advancesQuestionEnabled === true) ? (m.advancesCorrectAnswer || null) : null,
                                                                            answerOptionsJson: getBonusQuestionConfig(m, "advances_team")?.answerOptions || null,
                                                                            pointsAward: 0,
                                                                        })}
                                                                    />
                                                                    <AdminButton
                                                                        variant={m.advancesQuestionEnabled ? "secondary" : "primary"}
                                                                        size="sm"
                                                                        disabled={savingBonusMatchId === m.id}
                                                                        onClick={() => saveMatchBonusQuestion(m.id, {
                                                                            enabled: !(m.advancesQuestionEnabled === true),
                                                                            correctAnswer: !(m.advancesQuestionEnabled === true) ? (m.advancesCorrectAnswer || null) : null,
                                                                            answerOptionsJson: getBonusQuestionConfig(m, "advances_team")?.answerOptions || null,
                                                                            pointsAward: 0,
                                                                        })}
                                                                        className="!rounded-xl !py-2 !px-3 min-w-[150px]"
                                                                    >
                                                                        {m.advancesQuestionEnabled ? "Выключить вопрос" : "Включить вопрос"}
                                                                    </AdminButton>
                                                                </div>
                                                            </div>

                                                            {m.advancesQuestionEnabled && (() => {
                                                                const advDraftKey = `${m.id}:advances_team`;
                                                                const advQ = getBonusQuestionConfig(m, "advances_team");
                                                                const buildAdvOpts = (): BonusAnswerOption[] => (["home", "away"] as const).map((key, idx) => {
                                                                    const draft = bonusRewardDraft[advDraftKey]?.[key];
                                                                    const existing = advQ?.answerOptions?.find(o => o.key === key);
                                                                    return { key, label: key === "home" ? (m.home_name || m.home || "Хозяева") : (m.away_name || m.away || "Гости"), reward_enabled: draft ? draft.enabled : (existing?.reward_enabled ?? true), reward_stars: draft ? Number(draft.stars || bonusDefaultStars) : (existing?.reward_stars ?? bonusDefaultStars), sort_order: idx + 1 };
                                                                });
                                                                return (
                                                                    <>
                                                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                                                            {([
                                                                                { key: "home", label: m.home_name || m.home },
                                                                                { key: "away", label: m.away_name || m.away },
                                                                            ] as const).map((option) => {
                                                                                const active = m.advancesCorrectAnswer === option.key;
                                                                                return (
                                                                                    <button
                                                                                        key={option.key}
                                                                                        onClick={() => saveMatchBonusQuestion(m.id, {
                                                                                            enabled: true,
                                                                                            correctAnswer: option.key,
                                                                                            answerOptionsJson: buildAdvOpts(),
                                                                                            pointsAward: 0,
                                                                                        })}
                                                                                        disabled={savingBonusMatchId === m.id}
                                                                                        style={{
                                                                                            flex: 1,
                                                                                            minWidth: 120,
                                                                                            padding: "10px 12px",
                                                                                            borderRadius: 12,
                                                                                            border: active ? "1px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.12))",
                                                                                            background: active ? "rgba(36,129,204,0.16)" : "transparent",
                                                                                            color: active ? "var(--tg-button, #2481cc)" : "var(--tg-text)",
                                                                                            fontSize: 13,
                                                                                            fontWeight: 700,
                                                                                            cursor: savingBonusMatchId === m.id ? "default" : "pointer",
                                                                                        }}
                                                                                    >
                                                                                        Пройдет {option.label}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>

                                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                                                            <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                                                                                {m.advancesResolved && m.advancesCorrectAnswer
                                                                                    ? <>Сейчас правильный ответ: <span style={{ color: "var(--tg-text)", fontWeight: 700 }}>{m.advancesCorrectAnswer === "home" ? (m.home_name || m.home) : (m.away_name || m.away)}</span></>
                                                                                    : "Правильный ответ можно задать позже, когда матч завершится."}
                                                                            </div>
                                                                            <AdminButton
                                                                                variant="secondary"
                                                                                size="sm"
                                                                                disabled={savingBonusMatchId === m.id}
                                                                                onClick={() => saveMatchBonusQuestion(m.id, {
                                                                                    enabled: true,
                                                                                    correctAnswer: null,
                                                                                    answerOptionsJson: buildAdvOpts(),
                                                                                    pointsAward: 0,
                                                                                })}
                                                                                className="!rounded-xl !py-2 !px-3"
                                                                            >
                                                                                Сбросить ответ
                                                                            </AdminButton>
                                                                        </div>

                                                                        {/* Per-team reward stars config */}
                                                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--tg-separator, rgba(128,128,128,0.06))" }}>
                                                                            <div style={{ fontSize: 11, color: "var(--tg-hint)", fontWeight: 700 }}>Звёзды, если вариант окажется правильным:</div>
                                                                            {(["home", "away"] as const).map(key => {
                                                                                const existing = advQ?.answerOptions?.find(o => o.key === key);
                                                                                const draft = bonusRewardDraft[advDraftKey]?.[key];
                                                                                const isEnabled = draft ? draft.enabled : (existing?.reward_enabled ?? true);
                                                                                const stars = draft ? draft.stars : String(existing?.reward_stars ?? bonusDefaultStars);
                                                                                const teamLabel = key === "home" ? (m.home_name || m.home || "Хозяева") : (m.away_name || m.away || "Гости");
                                                                                return (
                                                                                    <div key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                                                                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tg-text)", minWidth: 100 }}>{teamLabel}</span>
                                                                                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--tg-hint)" }}>
                                                                                            <input type="checkbox" checked={isEnabled} onChange={e => setBonusRewardDraft(prev => ({ ...prev, [advDraftKey]: { ...prev[advDraftKey], [key]: { enabled: e.target.checked, stars } } }))} />
                                                                                            выдать
                                                                                        </label>
                                                                                        <input type="number" min={0} max={100} value={stars} disabled={!isEnabled}
                                                                                            onChange={e => setBonusRewardDraft(prev => ({ ...prev, [advDraftKey]: { ...prev[advDraftKey], [key]: { enabled: isEnabled, stars: e.target.value } } }))}
                                                                                            style={{ width: 64, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "var(--tg-bg)", color: "var(--tg-text)", fontSize: 12, fontWeight: 800, opacity: isEnabled ? 1 : 0.4 }}
                                                                                        />
                                                                                        <span style={{ fontSize: 12, color: "var(--tg-hint)" }}>⭐</span>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                            <AdminButton variant="secondary" size="sm" disabled={savingBonusMatchId === m.id}
                                                                                onClick={() => saveMatchBonusQuestion(m.id, { enabled: true, correctAnswer: m.advancesCorrectAnswer || null, answerOptionsJson: buildAdvOpts(), pointsAward: 0 })}
                                                                                className="!rounded-xl !py-2 !px-3 self-start"
                                                                            >Сохранить награды</AdminButton>
                                                                        </div>
                                                                    </>
                                                                );
                                                            })()}

                                                            {enabledQuestionConfigs.length > 0 && (
                                                                <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10, borderTop: "1px solid var(--tg-separator, rgba(128,128,128,0.12))" }}>
                                                                    {enabledQuestionConfigs.map(renderBonusQuestionCard)}
                                                                </div>
                                                            )}
                                                        </div>
                                                        </AdminCollapsibleSection>

                                                        <AdminCollapsibleSection
                                                            title="Заявки и авторы голов"
                                                            description={squadSummary}
                                                            badge={hasPlayerQuestion ? "игроки" : "off"}
                                                            defaultOpen={Boolean(m.goalscorerEnabled || matchSquadState?.error || (hasPlayerQuestion && !hasSquadPlayers))}
                                                            keepMounted
                                                        >
                                                        <div style={{
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: 12,
                                                        }}>
                                                            {m.goalscorerEnabled ? (
                                                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                                                        <div>
                                                                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tg-text)" }}>
                                                                                Автор гола (legacy)
                                                                            </div>
                                                                            <div style={{ fontSize: 12, color: "#ff9500" }}>
                                                                                ⚠️ Legacy включён. Новые матчи — используйте тип «Кто забьёт?» из блока ниже.
                                                                            </div>
                                                                        </div>
                                                                        <AdminButton
                                                                            variant="secondary"
                                                                            size="sm"
                                                                            disabled={savingBonusMatchId === m.id}
                                                                            onClick={() => saveGoalscorerSetting(m.id, false)}
                                                                            className="!rounded-xl !py-2 !px-3"
                                                                        >
                                                                            Выключить legacy
                                                                        </AdminButton>
                                                                    </div>
                                                                    {(() => {
                                                                        const squadState = squadByMatch[m.id];
                                                                        const playerOptions = [
                                                                            ...(squadState?.homeSquad || []).map(p => ({ ...p, team: m.home_name || m.home || "Home" })),
                                                                            ...(squadState?.awaySquad || []).map(p => ({ ...p, team: m.away_name || m.away || "Away" })),
                                                                        ];
                                                                        const selectedScorers = new Set((Array.isArray(m.goalscorers) ? m.goalscorers : []).map(String));
                                                                        const toggleScorer = (playerId: string) => {
                                                                            const next = new Set(selectedScorers);
                                                                            if (next.has(playerId)) next.delete(playerId);
                                                                            else next.add(playerId);
                                                                            saveManualGoalscorers(m, Array.from(next));
                                                                        };
                                                                        const enterManualScorers = () => {
                                                                            const value = window.prompt("ID авторов через запятую. Для 0:0 оставь пусто.", Array.from(selectedScorers).join(", "));
                                                                            if (value === null) return;
                                                                            const ids = value.split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
                                                                            saveManualGoalscorers(m, Array.from(new Set(ids)));
                                                                        };
                                                                        return (
                                                                            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--tg-separator, rgba(128,128,128,0.08))" }}>
                                                                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                                                                    <button
                                                                                        type="button"
                                                                                        disabled={squadState?.loading || savingBonusMatchId === m.id}
                                                                                        onClick={() => loadSquadForMatch(m.id, true)}
                                                                                        style={{ padding: "8px 10px", borderRadius: 12, border: "1px solid var(--tg-separator, rgba(128,128,128,0.12))", background: "rgba(255,255,255,0.04)", color: "var(--tg-text)", fontSize: 12, fontWeight: 700 }}
                                                                                    >
                                                                                        {squadState?.loading ? "Загрузка..." : "Загрузить заявку"}
                                                                                    </button>
                                                                                    <AdminButton
                                                                                        variant="secondary"
                                                                                        size="sm"
                                                                                        disabled={savingBonusMatchId === m.id}
                                                                                        onClick={enterManualScorers}
                                                                                        className="!rounded-xl !py-2 !px-3"
                                                                                    >
                                                                                        Ввести ID вручную
                                                                                    </AdminButton>
                                                                                    <AdminButton
                                                                                        variant={selectedScorers.size === 0 && m.goalscorerResolved ? "primary" : "secondary"}
                                                                                        size="sm"
                                                                                        disabled={savingBonusMatchId === m.id}
                                                                                        onClick={() => saveManualGoalscorers(m, [])}
                                                                                        className="!rounded-xl !py-2 !px-3"
                                                                                    >
                                                                                        Никто не забил
                                                                                    </AdminButton>
                                                                                </div>
                                                                                {squadState?.error && <div style={{ fontSize: 11, color: "var(--tg-destructive, #ff3b30)" }}>{squadState.error}</div>}
                                                                                {!squadState?.loading && squadState && playerOptions.length === 0 && <div style={{ fontSize: 11, color: "var(--tg-hint)" }}>Заявка не загрузилась от провайдера. Можно попробовать позже или ввести ID автора вручную.</div>}
                                                                                {playerOptions.length > 0 && (
                                                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                                                                        {playerOptions.map((player) => {
                                                                                            const active = selectedScorers.has(String(player.id));
                                                                                            return (
                                                                                                <button
                                                                                                    key={`${player.team}:${player.id}:goalscorer`}
                                                                                                    type="button"
                                                                                                    disabled={savingBonusMatchId === m.id}
                                                                                                    onClick={() => toggleScorer(String(player.id))}
                                                                                                    style={{
                                                                                                        padding: "8px 10px",
                                                                                                        borderRadius: 12,
                                                                                                        border: active ? "1px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.12))",
                                                                                                        background: active ? "rgba(36,129,204,0.16)" : "transparent",
                                                                                                        color: active ? "var(--tg-button, #2481cc)" : "var(--tg-text)",
                                                                                                        fontSize: 12,
                                                                                                        fontWeight: 700,
                                                                                                    }}
                                                                                                >
                                                                                                    {player.name} · {player.team}
                                                                                                </button>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            ) : (
                                                                <div style={{ fontSize: 12, color: "var(--tg-hint)", padding: "4px 0" }}>
                                                                    Автор гола (legacy) отключён. Для нового матча используйте тип <strong>«Кто забьёт?»</strong> (user_goalscorer) из блока «Дополнительные типы вопросов» ниже.
                                                                </div>
                                                            )}
                                                        </div>
                                                        </AdminCollapsibleSection>

                                                        <AdminCollapsibleSection
                                                            title="Добавить вопрос"
                                                            description={`Типы, которые ещё не включены на этот матч: ${disabledQuestionConfigs.length}`}
                                                            badge={`${disabledQuestionConfigs.length}`}
                                                            defaultOpen={enabledBonusCount === 0}
                                                            keepMounted
                                                        >
                                                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                                            <div>
                                                                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)" }}>Ещё не включённые типы</div>
                                                                <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>Включённые вопросы живут выше, в блоке «Дополнительные вопросы».</div>
                                                            </div>
                                                            {disabledQuestionConfigs.map(renderBonusQuestionCard)}
                                                        </div>
                                                        </AdminCollapsibleSection>
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="text-[var(--tg-theme-hint-color,#999)] text-[13px] font-medium py-6 text-center bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.02))] rounded-2xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))]">
                                                No matches selected for this day.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </AdminCard>
                        </AdminCollapsibleSection>

                        {/* Candidates Card */}
                        <AdminCollapsibleSection
                            title="Импорт и синхронизация"
                            description={importSubtitle}
                            defaultOpen={importDefaultOpen}
                            keepMounted
                            storageKey="admin:matches:import"
                        >
                        <div className="animate-in fade-in slide-in-from-bottom-6 duration-500 delay-100">
                            <div className="flex items-center justify-between mb-1 px-1">
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-4 bg-orange-500 rounded-full"></div>
                                    <h2 className="text-[var(--tg-theme-text-color,#fff)] text-[15px] font-bold tracking-tight">Manual Selection</h2>
                                    <div className="px-2.5 py-0.5 rounded-full bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.1))] text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)]">
                                        {candidates.length} Available in {getMatchModeUiLabel(effectiveMatchMode)}
                                    </div>
                                </div>
                                <AdminButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleRefreshMatches}
                                    disabled={isRefreshing}
                                    loading={isRefreshing}
                                    title="Безопасно: не публикует матчи и не запускает AUTO"
                                    aria-label="Обновить кандидатов"
                                    iconLeft={!isRefreshing ? (
                                        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                    ) : undefined}
                                    className="shrink-0 !min-h-8 !h-8 !w-8 sm:!w-auto !px-0 sm:!px-2.5 !py-0 !text-[11px] !rounded-lg shadow-inner"
                                >
                                    <span className="hidden sm:inline">{isRefreshing ? "Обновление" : "Обновить"}</span>
                                </AdminButton>
                            </div>
                            <div className="mb-3 px-1 text-[11px] font-semibold text-[var(--tg-theme-hint-color,#999)]">
                                Не публикует матчи и не запускает AUTO. Публикация — только через Apply Selection.
                            </div>

                            {/* Tournament picker: each checked tournament = one provider request */}
                            <div style={{ ...pickerBoxStyle, marginBottom: 12 }}>
                                <div style={pickerHeaderStyle}>
                                    <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>Турниры для импорта</span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 800,
                                            padding: "3px 9px",
                                            borderRadius: 999,
                                            color: "var(--tg-text)",
                                            background: selectedTournamentKeys.length === 0
                                                ? "color-mix(in srgb, #ff5a52 22%, transparent)"
                                                : "color-mix(in srgb, var(--tg-link, #2ea6ff) 18%, transparent)",
                                        }}
                                    >
                                        {selectedTournamentKeys.length} из {queriableTournaments.length}
                                    </span>
                                    <span style={{ flex: 1 }} />
                                    <AdminButton
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => setSelectedTournamentKeys(queriableTournaments.map((t) => t.key))}
                                        disabled={isRefreshing || allTournamentsSelected}
                                    >
                                        Все
                                    </AdminButton>
                                    <AdminButton
                                        size="sm"
                                        variant="secondary"
                                        onClick={() => setSelectedTournamentKeys([])}
                                        disabled={isRefreshing || selectedTournamentKeys.length === 0}
                                    >
                                        Ничего
                                    </AdminButton>
                                    <AdminButton size="sm" variant="secondary" onClick={() => setImportPickerOpen((v) => !v)}>
                                        {importPickerOpen ? "Свернуть" : "Выбрать"}
                                    </AdminButton>
                                </div>

                                {importTournamentsLoaded && queriableTournaments.length === 0 && (
                                    <div style={pickerHintStyle}>
                                        Для этого режима и даты нет турниров, которые запрашиваются у провайдера.
                                    </div>
                                )}

                                {importPickerOpen && queriableTournaments.length > 0 && (
                                    <div style={pickerGridStyle}>
                                        {queriableTournaments.map((t) => {
                                            const checked = selectedTournamentKeys.includes(t.key);
                                            return (
                                                <label key={t.key} style={pickerChipStyle(checked, isRefreshing)} title={t.display_name}>
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        disabled={isRefreshing}
                                                        onChange={() => toggleTournamentKey(t.key)}
                                                        style={pickerCheckboxStyle}
                                                    />
                                                    <span style={pickerChipLabelStyle}>{t.display_name}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}

                                {importPickerOpen && skippedTournaments.length > 0 && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        <div style={{ ...pickerHintStyle, fontWeight: 800 }}>
                                            Сегодня не запрашиваются ({skippedTournaments.length}) — галочки нет, запросов они не тратят:
                                        </div>
                                        <div style={pickerGridStyle}>
                                            {skippedTournaments.map((t) => (
                                                <span
                                                    key={t.key}
                                                    title={t.reason === "OUT_OF_ACTIVE_MONTHS"
                                                        ? "Турнир вне своего сезонного окна в этом месяце"
                                                        : "У турнира нет id для этого провайдера"}
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        gap: 6,
                                                        minHeight: 34,
                                                        padding: "6px 10px",
                                                        borderRadius: 12,
                                                        fontSize: 11.5,
                                                        fontWeight: 700,
                                                        color: "var(--tg-hint)",
                                                        border: "1px dashed color-mix(in srgb, var(--tg-hint) 22%, transparent)",
                                                        opacity: 0.75,
                                                    }}
                                                >
                                                    <span style={pickerChipLabelStyle}>{t.display_name}</span>
                                                    <span style={{ fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" }}>
                                                        {t.reason === "OUT_OF_ACTIVE_MONTHS" ? "не в сезоне" : "нет id"}
                                                    </span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div style={pickerHintStyle}>
                                    «Обновить» опрашивает только отмеченные турниры — по одному запросу к провайдеру на каждый,
                                    поэтому снятая галочка экономит квоту. Состав списка зависит от даты и режима.
                                </div>
                            </div>

                            <AdminCard className="p-0 overflow-hidden border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] shadow-xl shadow-black/20">
                                <div className="p-3 sm:p-4 space-y-3">
                                    {candidates.map(m => {
                                        const isSelected = manualIds.includes(m.id);
                                        const bonusQuestions = Array.isArray(m.bonusQuestions) ? (m.bonusQuestions as BonusQuestion[]) : [];
                                        const enabledExtraCount = bonusQuestions.filter(q => q.enabled).length;
                                        const resolvedExtraCount = bonusQuestions.filter(q => q.enabled && q.resolved).length;
                                        const legacyEnabledCount = (m.advancesQuestionEnabled ? 1 : 0) + (m.goalscorerEnabled ? 1 : 0);
                                        const legacyResolvedCount = (m.advancesResolved ? 1 : 0) + (m.goalscorerResolved ? 1 : 0);
                                        const enabledBonusCount = enabledExtraCount + legacyEnabledCount;
                                        const resolvedBonusCount = resolvedExtraCount + legacyResolvedCount;
                                        const hasRewardReady = bonusQuestions.some(q => q.enabled && q.resolved && q.status !== "rewards_granted");
                                        const rewardsGrantedCount = bonusQuestions.filter(q => q.enabled && q.status === "rewards_granted").length;
                                        const bonusSummary = enabledBonusCount > 0
                                            ? `Доп. вопросы: ${enabledBonusCount} включено · ${resolvedBonusCount} решено`
                                            : "Доп. вопросы: не настроены";
                                        const rewardsSummary = hasRewardReady
                                            ? "Есть готовые к наградам вопросы"
                                            : rewardsGrantedCount > 0
                                                ? `Награды выданы: ${rewardsGrantedCount}`
                                                : "Результаты появятся после resolve";
                                        const kickoff = formatAdminDate(m.start_time_utc || m.utcDate).split(', ')[1] || formatAdminDate(m.start_time_utc || m.utcDate).split(' ')[1] || "—";
                                        const homeTeam = m.home_name || m.home || "Home";
                                        const awayTeam = m.away_name || m.away || "Away";
                                        const competitionLabel = formatMatchMetaLabel(m.competition_label || m.competition_code || m.competition, "Competition");
                                        const providerLabel = formatMatchMetaLabel(m.api_provider, kickoff);
                                        return (
                                            <div
                                                key={m.id}
                                                onClick={() => toggleManualId(m.id)}
                                                style={{
                                                    background: isSelected
                                                        ? "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))"
                                                        : "color-mix(in srgb, var(--tg-secondary-bg) 38%, transparent)",
                                                    borderRadius: 20,
                                                    padding: 14,
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    gap: 10,
                                                    border: isSelected
                                                        ? "1px solid color-mix(in srgb, var(--tg-hint) 7%, transparent)"
                                                        : "1px solid color-mix(in srgb, var(--tg-hint) 5%, transparent)",
                                                    boxShadow: isSelected
                                                        ? "0 1px 0 color-mix(in srgb, var(--tg-hint) 6%, transparent), 0 8px 18px rgba(0,0,0,0.04)"
                                                        : "none",
                                                    cursor: "pointer",
                                                    opacity: 1
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        alignItems: "flex-start",
                                                        columnGap: 10,
                                                        display: "grid",
                                                        gridTemplateColumns: "minmax(0,1fr) minmax(64px,0.72fr) minmax(72px,0.78fr) 18px",
                                                        minWidth: 0,
                                                        textAlign: "left",
                                                    }}
                                                >
                                                    <div style={{ alignItems: "flex-start", color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "flex", fontSize: 13, fontWeight: 650, gap: 6, lineHeight: 1.2, minWidth: 0 }}>
                                                        <span aria-hidden style={{ flexShrink: 0, fontSize: 13, lineHeight: 1.2 }}>🏆</span>
                                                        <span style={{ display: "-webkit-box", minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{competitionLabel}</span>
                                                    </div>
                                                    <span style={{ color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "-webkit-box", fontSize: 13, fontWeight: 650, lineHeight: 1.2, minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{getMatchTypeUiLabel(m.match_type)}</span>
                                                    <span style={{ color: "color-mix(in srgb, var(--tg-hint) 82%, var(--tg-text))", display: "-webkit-box", fontSize: 13, fontWeight: 650, lineHeight: 1.2, minWidth: 0, overflow: "hidden", overflowWrap: "normal", textOverflow: "ellipsis", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, wordBreak: "normal" }}>{m.api_provider ? `⚡ ${providerLabel}` : providerLabel}</span>
                                                    <span
                                                        aria-hidden
                                                        style={{
                                                            color: "color-mix(in srgb, var(--tg-hint) 72%, transparent)",
                                                            display: "flex",
                                                            fontSize: 18,
                                                            fontWeight: 650,
                                                            justifyContent: "flex-end",
                                                            lineHeight: 1,
                                                            width: 18,
                                                        }}
                                                    >
                                                        {isSelected ? "—" : "+"}
                                                    </span>
                                                </div>
                                                <div style={{ alignItems: "flex-start", display: "flex", flexDirection: "column", gap: 8 }}>
                                                    <span style={{
                                                        background: "color-mix(in srgb, var(--tg-bg) 56%, var(--tg-secondary-bg))",
                                                        borderRadius: 999,
                                                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--tg-bg) 38%, transparent)",
                                                        color: "color-mix(in srgb, var(--tg-hint) 84%, var(--tg-text))",
                                                        display: "inline-flex",
                                                        fontSize: 12,
                                                        fontWeight: 900,
                                                        lineHeight: 1,
                                                        maxWidth: "100%",
                                                        padding: "6px 10px",
                                                    }}>
                                                        {bonusSummary}
                                                    </span>
                                                    <span style={{
                                                        background: hasRewardReady ? "color-mix(in srgb, #ffb340 10%, var(--tg-secondary-bg))" : "color-mix(in srgb, var(--tg-bg) 56%, var(--tg-secondary-bg))",
                                                        borderRadius: 999,
                                                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--tg-bg) 38%, transparent)",
                                                        color: hasRewardReady ? "color-mix(in srgb, #ffb340 82%, var(--tg-text))" : "color-mix(in srgb, var(--tg-hint) 84%, var(--tg-text))",
                                                        display: "inline-flex",
                                                        fontSize: 12,
                                                        fontWeight: 900,
                                                        lineHeight: 1,
                                                        maxWidth: "100%",
                                                        padding: "6px 10px",
                                                    }}>
                                                        {rewardsSummary}
                                                    </span>
                                                </div>
                                                <div style={{ color: "var(--tg-text)", display: "flex", flexDirection: "column", fontSize: 18, fontWeight: 900, gap: 8, lineHeight: 1.12, minWidth: 0, paddingTop: 2 }}>
                                                    {[homeTeam, awayTeam].map((team, index) => (
                                                        <div key={`${m.id}-candidate-${index}`} style={{ alignItems: "center", display: "flex", gap: 10, minWidth: 0 }}>
                                                            <span style={{ background: "color-mix(in srgb, var(--tg-hint) 12%, var(--tg-bg))", borderRadius: "50%", flexShrink: 0, height: 28, width: 28 }} aria-hidden />
                                                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {candidates.length === 0 && <div className="text-[var(--tg-theme-hint-color,#999)] text-[13px] font-medium py-8 text-center bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.02))] rounded-2xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))]">No matches found for this date.</div>}
                                </div>

                                <div className="p-4 bg-[var(--tg-theme-secondary-bg-color,#121212)] flex flex-col gap-3 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))]">
                                    <div className="flex items-center justify-between px-1 mb-1">
                                        <span className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider">
                                            Selection: <span className={manualIds.length > 3 ? "text-red-400" : "text-[var(--tg-theme-text-color,#fff)]"}>{manualIds.length}</span> / 3
                                        </span>
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-3">
                                        <AdminButton
                                            variant="secondary"
                                            disabled={loading}
                                            onClick={() => saveOverride("REST")}
                                            className="w-full sm:w-1/3 !rounded-xl !py-4 font-bold tracking-wide"
                                        >
                                            Rest Day
                                        </AdminButton>
                                        <AdminButton
                                            variant="primary"
                                            disabled={loading || manualIds.length === 0 || manualIds.length > 3}
                                            onClick={() => saveOverride("MANUAL")}
                                            className="w-full sm:flex-1 !rounded-xl !py-4 font-bold tracking-wide shadow-lg shadow-blue-500/20"
                                        >
                                            {loading ? "Saving..." : isLockedOnServer ? "🔒 LOCKED" : `Apply Selection`}
                                        </AdminButton>
                                    </div>
                                </div>
                            </AdminCard>
                        </div>
                        </AdminCollapsibleSection>

                        {/* Tournament source catalog (M2): isolated CRUD, not wired to import */}
                        <AdminCollapsibleSection
                            title="Источники турниров"
                            description="Каталог источников матчей. Только хранение и редактирование — не влияет на подбор кандидатов и импорт."
                            keepMounted
                            storageKey="admin:matches:sources"
                            badge={<AdminBadge variant="neutral">{sources.length}</AdminBadge>}
                        >
                            <div className="flex flex-col gap-3">
                                {/* Header summary */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminBadge variant="neutral">Всего: {sources.length}</AdminBadge>
                                    <AdminBadge variant="success">Включено: {sources.filter(s => s.status === "enabled").length}</AdminBadge>
                                    <AdminBadge variant="warning">Тест: {sources.filter(s => s.status === "test_only").length}</AdminBadge>
                                    <AdminBadge variant="danger">Выключено: {sources.filter(s => s.status === "disabled").length}</AdminBadge>
                                    <AdminBadge variant="info">Клубы: {sources.filter(s => s.match_mode === "club").length}</AdminBadge>
                                    <AdminBadge variant="info">Сборные: {sources.filter(s => s.match_mode === "national").length}</AdminBadge>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminButton size="sm" variant="primary" onClick={openCreateSourceForm} disabled={isSavingSource}>
                                        + Добавить источник
                                    </AdminButton>
                                    <AdminButton size="sm" variant="secondary" onClick={loadSources} loading={isLoadingSources}>
                                        Обновить список
                                    </AdminButton>
                                </div>

                                {/* Create / edit form */}
                                {isFormOpen && (
                                    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint)_16%,transparent)] bg-[color-mix(in_srgb,var(--tg-secondary-bg)_50%,transparent)] p-3 sm:p-4 flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[14px] font-black text-[var(--tg-text)]">
                                                {editingSourceId !== null ? "Изменить источник" : "Новый источник"}
                                            </span>
                                            {editingSourceId !== null && <AdminBadge variant="neutral">ID {editingSourceId}</AdminBadge>}
                                        </div>

                                        <AdminInput
                                            label="Название"
                                            value={sourceForm.title}
                                            onChange={(e) => setSourceField("title", e.target.value)}
                                            placeholder="Premier League"
                                            maxLength={120}
                                        />

                                        <AdminSelect
                                            label="Провайдер"
                                            value={sourceForm.provider}
                                            onChange={(v) => setSourceField("provider", v as MatchSourceFormState["provider"])}
                                            options={[
                                                { value: "football_data", label: "Football-Data" },
                                                { value: "allsports", label: "AllSports" },
                                            ]}
                                        />

                                        <AdminInput
                                            label="Competition code"
                                            description={sourceForm.provider === "football_data" ? "Например, PL, SA, CL (нужен code или id)" : "Не используется для AllSports"}
                                            value={sourceForm.provider_competition_code}
                                            onChange={(e) => setSourceField("provider_competition_code", e.target.value)}
                                            placeholder="PL"
                                            maxLength={40}
                                        />

                                        <AdminInput
                                            label="Competition id"
                                            description={sourceForm.provider === "allsports" ? "league_id из AllSports (обязательно)" : "Числовой id Football-Data (можно вместо code)"}
                                            value={sourceForm.provider_competition_id}
                                            onChange={(e) => setSourceField("provider_competition_id", e.target.value)}
                                            placeholder="302"
                                            maxLength={40}
                                        />

                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[12px] font-extrabold text-[var(--tg-text)]">Режим матчей</span>
                                            <AdminSegmentedControl
                                                ariaLabel="Режим матчей"
                                                value={sourceForm.match_mode}
                                                onChange={(v) => setSourceField("match_mode", v)}
                                                options={[
                                                    { value: "club", label: "Клубы" },
                                                    { value: "national", label: "Сборные" },
                                                ]}
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-[12px] font-extrabold text-[var(--tg-text)]">Статус</span>
                                            <AdminSegmentedControl
                                                ariaLabel="Статус источника"
                                                value={sourceForm.status}
                                                onChange={(v) => setSourceField("status", v)}
                                                options={[
                                                    { value: "enabled", label: "Включён" },
                                                    { value: "test_only", label: "Тест" },
                                                    { value: "disabled", label: "Выключен" },
                                                ]}
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <AdminInput
                                                label="Sort order"
                                                type="number"
                                                value={sourceForm.sort_order}
                                                onChange={(e) => setSourceField("sort_order", e.target.value)}
                                            />
                                            <AdminInput
                                                label="Окно дат (до)"
                                                type="number"
                                                value={sourceForm.date_window_before}
                                                onChange={(e) => setSourceField("date_window_before", e.target.value)}
                                            />
                                            <AdminInput
                                                label="Окно дат (после)"
                                                type="number"
                                                value={sourceForm.date_window_after}
                                                onChange={(e) => setSourceField("date_window_after", e.target.value)}
                                            />
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <AdminInput
                                                label="Сезон"
                                                value={sourceForm.season}
                                                onChange={(e) => setSourceField("season", e.target.value)}
                                                placeholder="2025/26"
                                                maxLength={40}
                                            />
                                            <AdminInput
                                                label="Страна"
                                                value={sourceForm.country}
                                                onChange={(e) => setSourceField("country", e.target.value)}
                                                placeholder="England"
                                                maxLength={80}
                                            />
                                        </div>

                                        <AdminCheckbox
                                            checked={sourceForm.include_friendlies}
                                            onChange={(v) => setSourceField("include_friendlies", v)}
                                            label="Включать товарищеские матчи"
                                        />

                                        <AdminTextarea
                                            label="Заметки"
                                            value={sourceForm.notes}
                                            onChange={(e) => setSourceField("notes", e.target.value)}
                                            rows={2}
                                            maxLength={500}
                                        />

                                        {sourceFormError && (
                                            <div role="alert" className="text-[12px] font-bold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text))]">
                                                {sourceFormError}
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            <AdminButton variant="primary" onClick={submitSourceForm} loading={isSavingSource}>
                                                Сохранить
                                            </AdminButton>
                                            <AdminButton variant="secondary" onClick={closeSourceForm} disabled={isSavingSource}>
                                                Отменить
                                            </AdminButton>
                                            {editingSourceId !== null && sourceForm.status !== "disabled" && (
                                                <AdminButton
                                                    variant="danger"
                                                    onClick={() => {
                                                        const target = sources.find(s => s.id === editingSourceId);
                                                        if (target) disableSource(target);
                                                    }}
                                                    disabled={isSavingSource}
                                                >
                                                    Выключить
                                                </AdminButton>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Source list */}
                                <div className="flex flex-col gap-2">
                                    {!sourcesLoaded && isLoadingSources && (
                                        <div className="text-[13px] font-semibold text-[var(--tg-hint)] py-6 text-center">Загрузка источников…</div>
                                    )}
                                    {sourcesLoaded && sources.length === 0 && (
                                        <div className="text-[13px] font-semibold text-[var(--tg-hint)] py-6 text-center rounded-2xl border border-dashed border-[color-mix(in_srgb,var(--tg-hint)_18%,transparent)]">
                                            Источники ещё не добавлены.
                                        </div>
                                    )}
                                    {sources.map((s) => {
                                        const providerLabel = s.provider === "football_data" ? "Football-Data" : "AllSports";
                                        const competition = s.provider_competition_code || s.provider_competition_id || "—";
                                        const statusBadge = s.status === "enabled"
                                            ? <AdminBadge variant="success">Включён</AdminBadge>
                                            : s.status === "test_only"
                                                ? <AdminBadge variant="warning">Тест</AdminBadge>
                                                : <AdminBadge variant="danger">Выключен</AdminBadge>;
                                        const isTestOpen = testSourceId === s.id;
                                        return (
                                            <div key={s.id} className="flex flex-col gap-2">
                                                <AdminDataRow
                                                    stackedOnMobile
                                                    label={s.title}
                                                    description={
                                                        <span className="flex flex-wrap items-center gap-1.5">
                                                            <AdminBadge variant="info">{providerLabel} · {competition}</AdminBadge>
                                                            <AdminBadge variant="neutral">{s.match_mode === "club" ? "Клубы" : "Сборные"}</AdminBadge>
                                                            {statusBadge}
                                                            <AdminBadge variant="neutral">sort: {s.sort_order}</AdminBadge>
                                                        </span>
                                                    }
                                                    value={
                                                        <span className="flex flex-wrap gap-2 justify-end">
                                                            <AdminButton size="sm" variant="primary" onClick={() => (isTestOpen ? closeSourceTest() : openSourceTest(s))}>
                                                                {isTestOpen ? "Скрыть тест" : "Проверить"}
                                                            </AdminButton>
                                                            <AdminButton size="sm" variant="secondary" onClick={() => openEditSourceForm(s)}>
                                                                Изменить
                                                            </AdminButton>
                                                            {s.status !== "disabled" && (
                                                                <AdminButton size="sm" variant="danger" onClick={() => disableSource(s)} disabled={isSavingSource}>
                                                                    Выключить
                                                                </AdminButton>
                                                            )}
                                                        </span>
                                                    }
                                                />
                                                {isTestOpen && renderSourceTestPanel(s)}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </AdminCollapsibleSection>

                        {/* M4: aggregate candidate preview — diagnostics only, does NOT publish */}
                        <AdminCollapsibleSection
                            title="Preview из источников — не публикует матчи"
                            description="Ручной preview кандидатов из выбранных турниров текущего режима. Диагностика, без публикации."
                            keepMounted
                            storageKey="admin:matches:source-candidates"
                            badge={<AdminBadge variant="warning">preview</AdminBadge>}
                        >
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminBadge variant="neutral">Дата: {selectedDate}</AdminBadge>
                                    <AdminBadge variant="info">Режим: {effectiveMatchMode === "national_teams" ? "Сборные" : "Клубы"}</AdminBadge>
                                </div>

                                {/* M8: pick the sources to query before spending provider quota */}
                                <div style={pickerBoxStyle}>
                                    <div style={pickerHeaderStyle}>
                                        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>Источники для запроса</span>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 800,
                                                padding: "3px 9px",
                                                borderRadius: 999,
                                                color: "var(--tg-text)",
                                                background: selectedSourceIds.length === 0
                                                    ? "color-mix(in srgb, #ff5a52 22%, transparent)"
                                                    : "color-mix(in srgb, var(--tg-link, #2ea6ff) 18%, transparent)",
                                            }}
                                        >
                                            {selectedSourceIds.length} из {enabledSources.length}
                                        </span>
                                        <span style={{ flex: 1 }} />
                                        <AdminButton
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setSelectedSourceIds(enabledSources.map((s) => s.id))}
                                            disabled={aggLoading || allSourcesSelected}
                                        >
                                            Все
                                        </AdminButton>
                                        <AdminButton
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setSelectedSourceIds([])}
                                            disabled={aggLoading || selectedSourceIds.length === 0}
                                        >
                                            Ничего
                                        </AdminButton>
                                        <AdminButton size="sm" variant="secondary" onClick={() => setSourceFilterOpen((v) => !v)}>
                                            {sourceFilterOpen ? "Свернуть" : "Выбрать"}
                                        </AdminButton>
                                    </div>

                                    {sourcesLoaded && enabledSources.length === 0 && (
                                        <div style={pickerHintStyle}>Нет включённых источников для этого режима.</div>
                                    )}

                                    {sourceFilterOpen && enabledSources.length > 0 && (
                                        <div style={pickerGridStyle}>
                                            {enabledSources.map((s) => {
                                                const checked = selectedSourceIds.includes(s.id);
                                                return (
                                                    <label key={s.id} style={pickerChipStyle(checked, aggLoading)} title={s.title}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            disabled={aggLoading}
                                                            onChange={() => toggleSourceFilter(s.id)}
                                                            style={pickerCheckboxStyle}
                                                        />
                                                        <span style={pickerChipLabelStyle}>{s.title}</span>
                                                        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 900, opacity: 0.7 }}>
                                                            {s.provider === "football_data" ? "FD" : "AS"}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div style={pickerHintStyle}>
                                        Запрашиваются только отмеченные источники. FD (football-data) тратит по одному запросу на турнир — снятая
                                        галочка экономит квоту. AS (allsports) берёт весь день одним общим запросом, там выбор только сужает выдачу.
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminButton
                                        variant="primary"
                                        onClick={() => fetchSourceCandidates(false)}
                                        loading={aggLoading}
                                        disabled={aggLoading || selectedSourceIds.length === 0}
                                    >
                                        Получить кандидатов ({selectedSourceIds.length})
                                    </AdminButton>
                                    <AdminButton
                                        variant="warning"
                                        onClick={() => fetchSourceCandidates(true)}
                                        disabled={aggLoading || selectedSourceIds.length === 0}
                                        title="Обойти кэш и выполнить новые запросы к провайдерам"
                                    >
                                        Принудительно обновить
                                    </AdminButton>
                                    {aggResult && (
                                        <AdminButton variant="secondary" onClick={() => { setAggResult(null); setAggError(""); setSelectedPreviewIds([]); }} disabled={aggLoading}>
                                            Очистить
                                        </AdminButton>
                                    )}
                                </div>
                                <div className="text-[11.5px] font-semibold text-[var(--tg-hint)]">
                                    Обычная кнопка использует безопасный кэш. «Принудительно обновить» выполняет новые запросы к провайдерам.
                                </div>

                                <div className="text-[11.5px] font-semibold text-[var(--tg-hint)]">
                                    Доступны только источники со статусом «Включён» для выбранного режима. Этот список не влияет на кандидатов дня, manualIds и Apply Selection.
                                </div>

                                {aggError && (
                                    <div role="alert" className="text-[12px] font-bold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-text))]">{aggError}</div>
                                )}

                                {aggResult?.ok && (
                                    <>
                                        {aggResult.diagnostics && (
                                            <>
                                                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                                                    <AdminMetricCard size="sm" label="Источников" value={aggResult.sources_count ?? 0} />
                                                    <AdminMetricCard size="sm" label="Получено" value={aggResult.diagnostics.total_received} />
                                                    <AdminMetricCard size="sm" label="Принято" value={aggResult.diagnostics.total_accepted} />
                                                    <AdminMetricCard size="sm" label="Отклонено" value={aggResult.diagnostics.total_rejected} />
                                                    <AdminMetricCard size="sm" label="Дублей" value={aggResult.diagnostics.total_deduped} />
                                                    <AdminMetricCard size="sm" label="Время, мс" value={aggResult.diagnostics.duration_ms} />
                                                </div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <AdminBadge variant="info">Из кэша: {aggResult.diagnostics.from_cache_count ?? 0}</AdminBadge>
                                                    <AdminBadge variant="warning">Запросов к провайдерам: {aggResult.diagnostics.provider_calls ?? 0}</AdminBadge>
                                                </div>
                                            </>
                                        )}

                                        {Array.isArray(aggResult.warnings) && aggResult.warnings.length > 0 && (
                                            <div className="flex flex-col gap-1">
                                                {aggResult.warnings.map((w, i) => (
                                                    <div key={i} className="text-[11.5px] font-bold text-[color-mix(in_srgb,#ffb340_88%,var(--tg-text))]">⚠ {w}</div>
                                                ))}
                                            </div>
                                        )}

                                        {Array.isArray(aggResult.source_results) && aggResult.source_results.length > 0 && (
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[12px] font-black text-[var(--tg-text)]">По источникам</span>
                                                {aggResult.source_results.map((r) => (
                                                    <AdminDataRow
                                                        key={r.source_id}
                                                        stackedOnMobile
                                                        label={r.title}
                                                        description={
                                                            <span className="flex flex-wrap items-center gap-1.5">
                                                                <AdminBadge variant="info">{r.provider === "football_data" ? "Football-Data" : "AllSports"}</AdminBadge>
                                                                <AdminBadge variant="neutral">{r.fetch_scope}</AdminBadge>
                                                                <AdminBadge variant="neutral">HTTP {r.http_status}</AdminBadge>
                                                                <AdminBadge variant={r.from_cache ? "info" : "neutral"}>{r.from_cache ? "из кэша" : "новый запрос"}</AdminBadge>
                                                                {r.error
                                                                    ? <AdminBadge variant="danger">ошибка: {r.error}</AdminBadge>
                                                                    : <AdminBadge variant="success">принято {r.accepted}/{r.received}</AdminBadge>}
                                                            </span>
                                                        }
                                                        value={<span className="text-[12px] text-[var(--tg-hint)]">{r.duration_ms} мс</span>}
                                                    />
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[12px] font-black text-[var(--tg-text)]">Кандидаты ({(aggResult.matches || []).length})</span>
                                                {(aggResult.matches || []).length > 0 && (
                                                    <span className={`text-[11px] font-bold ${selectedPreviewIds.length > 3 ? "text-red-400" : "text-[var(--tg-hint)]"}`}>
                                                        Выбрано {selectedPreviewIds.length}/3
                                                    </span>
                                                )}
                                            </div>
                                            {(aggResult.matches || []).length === 0 && (
                                                <div className="text-[12px] font-semibold text-[var(--tg-hint)] py-4 text-center">Подходящих матчей не найдено.</div>
                                            )}
                                            {(aggResult.matches || []).map((m) => {
                                                const refs = m.provider_refs || [];
                                                const kickoff = (() => {
                                                    const dt = new Date(m.kickoff_utc);
                                                    return Number.isNaN(dt.getTime()) ? (m.kickoff_utc || "—") : dt.toISOString().slice(11, 16) + " UTC";
                                                })();
                                                const isSelected = selectedPreviewIds.includes(m.preview_id);
                                                const capReached = !isSelected && selectedPreviewIds.length >= 3;
                                                return (
                                                    <div
                                                        key={m.preview_id}
                                                        onClick={() => { if (!capReached) togglePreviewSelection(m.preview_id); }}
                                                        className="rounded-xl border p-3 flex flex-col gap-1.5"
                                                        style={{
                                                            borderColor: isSelected
                                                                ? "color-mix(in srgb, var(--tg-button) 45%, transparent)"
                                                                : "color-mix(in srgb, var(--tg-hint) 14%, transparent)",
                                                            background: isSelected
                                                                ? "color-mix(in srgb, var(--tg-button) 12%, var(--tg-secondary-bg))"
                                                                : "color-mix(in srgb, var(--tg-secondary-bg) 40%, transparent)",
                                                            cursor: capReached ? "not-allowed" : "pointer",
                                                            opacity: capReached ? 0.55 : 1,
                                                        }}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-[14px] font-black text-[var(--tg-text)] min-w-0 truncate">{m.home_team} — {m.away_team}</span>
                                                            <span className="flex items-center gap-1.5 shrink-0">
                                                                {refs.length > 1 && <AdminBadge variant="warning">×{refs.length} источников</AdminBadge>}
                                                                <AdminBadge variant={isSelected ? "success" : "neutral"}>{isSelected ? "✓ выбран" : "выбрать"}</AdminBadge>
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <AdminBadge variant="info">{m.competition_name}</AdminBadge>
                                                            <AdminBadge variant="neutral">{m.provider === "football_data" ? "Football-Data" : "AllSports"}</AdminBadge>
                                                            <AdminBadge variant="neutral">{m.source_title}</AdminBadge>
                                                            <AdminBadge variant="neutral">{kickoff}</AdminBadge>
                                                            {m.status && <AdminBadge variant="neutral">{m.status}</AdminBadge>}
                                                            {m.stage && <AdminBadge variant="neutral">{m.stage}</AdminBadge>}
                                                        </div>
                                                        {refs.length > 1 && (
                                                            <div className="text-[11px] font-semibold text-[var(--tg-hint)]">
                                                                Совпадения: {refs.map((r) => `${r.source_title} (${r.provider})`).join(" · ")}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {(aggResult.matches || []).length > 0 && (
                                            <div className="flex flex-col gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--tg-hint)_16%,transparent)] bg-[color-mix(in_srgb,var(--tg-secondary-bg)_45%,transparent)] p-3">
                                                <div className="text-[11.5px] font-bold text-[var(--tg-hint)]">
                                                    Это не публикует матчи. После добавления выберите их в обычном списке «Импорт и синхронизация» и нажмите Apply Selection.
                                                </div>
                                                <AdminButton
                                                    variant="primary"
                                                    onClick={importSelectedPreviewCandidates}
                                                    loading={isImportingPreview}
                                                    disabled={isImportingPreview || selectedPreviewIds.length === 0}
                                                >
                                                    Добавить выбранных в кандидаты
                                                </AdminButton>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </AdminCollapsibleSection>

                        {/* M7: source-fetch run history — read-only diagnostics */}
                        <AdminCollapsibleSection
                            title="История запросов источников"
                            description="Журнал запросов к провайдерам (тест источника и общий preview). Только диагностика — не влияет на публикацию."
                            storageKey="admin:matches:fetch-runs"
                            badge={<AdminBadge variant="neutral">{historyTotal}</AdminBadge>}
                        >
                            <div className="flex flex-col gap-3">
                                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                    <AdminSelect
                                        label="Тип"
                                        value={historyFilters.run_type}
                                        onChange={(v) => setHistoryFilters((p) => ({ ...p, run_type: v }))}
                                        options={[
                                            { value: "", label: "Все" },
                                            { value: "source_test", label: "Тест источника" },
                                            { value: "aggregate_preview", label: "Общий preview" },
                                        ]}
                                    />
                                    <AdminSelect
                                        label="Провайдер"
                                        value={historyFilters.provider}
                                        onChange={(v) => setHistoryFilters((p) => ({ ...p, provider: v }))}
                                        options={[
                                            { value: "", label: "Все" },
                                            { value: "football_data", label: "Football-Data" },
                                            { value: "allsports", label: "AllSports" },
                                        ]}
                                    />
                                    <AdminSelect
                                        label="Результат"
                                        value={historyFilters.success}
                                        onChange={(v) => setHistoryFilters((p) => ({ ...p, success: v }))}
                                        options={[
                                            { value: "", label: "Все" },
                                            { value: "true", label: "Успех" },
                                            { value: "false", label: "Ошибка" },
                                        ]}
                                    />
                                    <AdminInput
                                        label="Дата матчей"
                                        type="date"
                                        value={historyFilters.requested_date}
                                        onChange={(e) => setHistoryFilters((p) => ({ ...p, requested_date: e.target.value }))}
                                    />
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <AdminButton variant="primary" size="sm" onClick={() => loadFetchRuns(1, historyFilters)} loading={historyLoading}>
                                        {historyLoaded ? "Применить / обновить" : "Загрузить историю"}
                                    </AdminButton>
                                    {historyLoaded && (
                                        <span className="text-[11.5px] font-semibold text-[var(--tg-hint)]">
                                            Всего: {historyTotal} · стр. {historyPage}/{Math.max(1, historyPages)}
                                        </span>
                                    )}
                                </div>

                                {historyLoaded && historyRuns.length === 0 && (
                                    <div className="text-[12px] font-semibold text-[var(--tg-hint)] py-4 text-center">Записи не найдены.</div>
                                )}

                                <div className="flex flex-col gap-1.5">
                                    {historyRuns.map((run) => (
                                        <AdminDataRow
                                            key={run.id}
                                            stackedOnMobile
                                            label={`${formatAdminDate(run.requested_at)} · ${run.run_type === "aggregate_preview" ? "Общий preview" : "Тест источника"}`}
                                            description={
                                                <span className="flex flex-wrap items-center gap-1.5">
                                                    <AdminBadge variant="info">{run.provider === "football_data" ? "Football-Data" : run.provider === "allsports" ? "AllSports" : run.provider}</AdminBadge>
                                                    <AdminBadge variant="neutral">{run.requested_date}</AdminBadge>
                                                    {run.match_mode && <AdminBadge variant="neutral">{run.match_mode === "club" ? "Клубы" : "Сборные"}</AdminBadge>}
                                                    {run.success ? <AdminBadge variant="success">успех</AdminBadge> : <AdminBadge variant="danger">ошибка</AdminBadge>}
                                                    <AdminBadge variant={run.from_cache ? "info" : "neutral"}>{run.from_cache ? "из кэша" : "новый запрос"}</AdminBadge>
                                                    <AdminBadge variant="neutral">{run.matches_accepted}/{run.matches_received} · дубли {run.matches_deduped}</AdminBadge>
                                                    {run.http_status !== null && <AdminBadge variant="neutral">HTTP {run.http_status}</AdminBadge>}
                                                    {run.duration_ms !== null && <AdminBadge variant="neutral">{run.duration_ms} мс</AdminBadge>}
                                                </span>
                                            }
                                            value={
                                                <AdminButton size="sm" variant="secondary" onClick={() => openRunDetail(run.id)}>
                                                    Подробнее
                                                </AdminButton>
                                            }
                                        />
                                    ))}
                                </div>

                                {historyLoaded && historyPages > 1 && (
                                    <div className="flex items-center justify-center gap-2">
                                        <AdminButton size="sm" variant="secondary" disabled={historyLoading || historyPage <= 1} onClick={() => loadFetchRuns(historyPage - 1, historyFilters)}>
                                            ← Назад
                                        </AdminButton>
                                        <span className="text-[12px] font-bold text-[var(--tg-hint)]">{historyPage} / {historyPages}</span>
                                        <AdminButton size="sm" variant="secondary" disabled={historyLoading || historyPage >= historyPages} onClick={() => loadFetchRuns(historyPage + 1, historyFilters)}>
                                            Вперёд →
                                        </AdminButton>
                                    </div>
                                )}
                            </div>
                        </AdminCollapsibleSection>

                        {/* M7: run detail modal */}
                        {(historyDetail || historyDetailLoading) && (
                            <div
                                onClick={closeRunDetail}
                                style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
                            >
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ background: "var(--tg-bg)", borderRadius: 18, border: "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)", maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 18 }}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[15px] font-black text-[var(--tg-text)]">Детали запроса</span>
                                        <AdminButton size="sm" variant="ghost" onClick={closeRunDetail}>✕</AdminButton>
                                    </div>
                                    {historyDetailLoading && <div className="text-[13px] text-[var(--tg-hint)] py-6 text-center">Загрузка…</div>}
                                    {historyDetail && (
                                        <div className="flex flex-col gap-1.5">
                                            <AdminDataRow stackedOnMobile={false} label="ID" value={historyDetail.run.id} />
                                            <AdminDataRow stackedOnMobile={false} label="Тип" value={historyDetail.run.run_type === "aggregate_preview" ? "Общий preview" : "Тест источника"} />
                                            <AdminDataRow stackedOnMobile={false} label="Провайдер" value={historyDetail.run.provider} />
                                            <AdminDataRow stackedOnMobile={false} label="Scope" value={historyDetail.run.fetch_scope || "—"} />
                                            <AdminDataRow stackedOnMobile={false} label="Дата матчей" value={historyDetail.run.requested_date} />
                                            <AdminDataRow stackedOnMobile={false} label="Режим" value={historyDetail.run.match_mode || "—"} />
                                            <AdminDataRow stackedOnMobile={false} label="Запущен" value={formatAdminDate(historyDetail.run.requested_at)} />
                                            <AdminDataRow stackedOnMobile={false} label="Результат" value={historyDetail.run.success ? "успех" : "ошибка"} />
                                            <AdminDataRow stackedOnMobile={false} label="Из кэша" value={historyDetail.run.from_cache ? "да" : "нет"} />
                                            <AdminDataRow stackedOnMobile={false} label="HTTP" value={historyDetail.run.http_status ?? "—"} />
                                            <AdminDataRow stackedOnMobile={false} label="Длительность" value={`${historyDetail.run.duration_ms ?? 0} мс`} />
                                            <AdminDataRow stackedOnMobile={false} label="Получено/норм." value={`${historyDetail.run.matches_received}/${historyDetail.run.matches_normalized}`} />
                                            <AdminDataRow stackedOnMobile={false} label="Принято/откл." value={`${historyDetail.run.matches_accepted}/${historyDetail.run.matches_rejected}`} />
                                            <AdminDataRow stackedOnMobile={false} label="Дублей" value={historyDetail.run.matches_deduped} />
                                            {historyDetail.run.error_code && (
                                                <AdminDataRow stackedOnMobile={false} label="Код ошибки" value={historyDetail.run.error_code} />
                                            )}
                                            {historyDetail.run.error_message && (
                                                <div className="text-[12px] font-semibold text-[color-mix(in_srgb,#ff5a52_84%,var(--tg-text))] break-words">{historyDetail.run.error_message}</div>
                                            )}
                                            {historyDetail.run.warnings.length > 0 && (
                                                <div className="rounded-xl border border-[color-mix(in_srgb,var(--tg-hint)_16%,transparent)] p-2 max-h-40 overflow-y-auto flex flex-col gap-1">
                                                    {historyDetail.run.warnings.map((w, i) => (
                                                        <div key={i} className="text-[11.5px] font-semibold text-[color-mix(in_srgb,#ffb340_88%,var(--tg-text))]">⚠ {w}</div>
                                                    ))}
                                                </div>
                                            )}
                                            {historyDetail.children.length > 0 && (
                                                <div className="mt-2 flex flex-col gap-1.5">
                                                    <span className="text-[12px] font-black text-[var(--tg-text)]">Источники запроса ({historyDetail.children.length})</span>
                                                    {historyDetail.children.map((c) => (
                                                        <AdminDataRow
                                                            key={c.id}
                                                            stackedOnMobile
                                                            label={`#${c.source_id ?? "—"} · ${c.provider === "football_data" ? "Football-Data" : "AllSports"}`}
                                                            description={
                                                                <span className="flex flex-wrap items-center gap-1.5">
                                                                    {c.success ? <AdminBadge variant="success">успех</AdminBadge> : <AdminBadge variant="danger">{c.error_code || "ошибка"}</AdminBadge>}
                                                                    <AdminBadge variant={c.from_cache ? "info" : "neutral"}>{c.from_cache ? "из кэша" : "новый"}</AdminBadge>
                                                                    <AdminBadge variant="neutral">{c.matches_accepted}/{c.matches_received}</AdminBadge>
                                                                    {c.http_status !== null && <AdminBadge variant="neutral">HTTP {c.http_status}</AdminBadge>}
                                                                </span>
                                                            }
                                                            value={<span className="text-[12px] text-[var(--tg-hint)]">{c.duration_ms ?? 0} мс</span>}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
  );
}
