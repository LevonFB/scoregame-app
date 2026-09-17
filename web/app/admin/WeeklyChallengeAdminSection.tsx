"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatMsk } from "./mskTime";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminInput } from "./components/AdminInput";
import { WeeklyChallengeOfficialAnswers } from "./WeeklyChallengeOfficialAnswers";
import { WeeklyChallengeRewardsEditor } from "./WeeklyChallengeRewardsEditor";
import {
  WEEKLY_COMPETITION_MODE_LABEL,
  getWeeklyTemplate,
  listWeeklyTemplatesForMode,
  weeklyQuestionDisplayCategory,
  type WeeklyTemplateInput,
  type WeeklyResolvedMode,
  type WeeklyQuestionTemplate,
} from "../season-predictions/weeklyTemplates";
import { isGenericGroupTitle } from "../season-predictions/weeklyGroups";
import type {
  WeeklyChallenge,
  WeeklyChallengeMatch,
  WeeklyChallengeOption,
  WeeklyChallengeQuestion,
  WeeklyChallengeQuestionKey,
  WeeklyChallengeQuestionStatus,
  WeeklyChallengeStatus,
} from "../season-predictions/types";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type AdminListResponse = { ok: boolean; challenges: WeeklyChallenge[] };

type WeeklyQuestionEditState = {
  state: "unused" | "has_drafts" | "has_submissions" | "has_scores";
  drafts: number;
  submitted: number;
  scores: number;
  entries: number;
  structural_locked: boolean;
};

type WeeklyDeletionInfo = {
  deletable: boolean;
  error: string | null;
  counts: { entries: number; claims: number; rewards: number; scores: number };
};

type AdminGetResponse = {
  ok: boolean;
  challenge: WeeklyChallenge;
  match_pool: WeeklyChallengeMatch[];
  questions: WeeklyChallengeQuestion[];
  question_edit_state?: WeeklyQuestionEditState;
  deletion?: WeeklyDeletionInfo;
};

const WEEKLY_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", active: "Активен", locked: "Заблокирован", scoring: "Подсчёт", completed: "Завершён", archived: "Архив",
};
const WEEKLY_MODE_LABEL_SHORT: Record<string, string> = { club: "Клубы", national_team: "Сборные", unspecified: "Не задан" };

const WEEKLY_DELETE_REASON: Record<string, string> = {
  WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS: "Завершённые вызовы с историей нельзя удалить. Они сохраняются для рейтинга, заданий и архива игроков.",
  WEEKLY_CHALLENGE_DELETE_HAS_ENTRIES: "В этом вызове уже есть ответы игроков.",
  WEEKLY_CHALLENGE_DELETE_HAS_CLAIMS: "По этому вызову уже забирали награды.",
  WEEKLY_CHALLENGE_DELETE_HAS_REWARDS: "По этому вызову уже выдавались награды.",
  WEEKLY_CHALLENGE_DELETE_HAS_DEPENDENCIES: "У вызова есть посчитанные результаты — удаление недоступно.",
};

function weeklyStatusLabel(status: string): string { return WEEKLY_STATUS_LABEL[status] || status; }

function formatCreatedAt(unix: number | null | undefined): string {
  if (unix == null) return "";
  const formatted = formatMsk(Number(unix), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return formatted === "—" ? "" : formatted;
}

// Auto-selection: newest draft → newest active → newest overall. The admin list is
// already status-priority + newest-first, so the first matching item is the newest.
function pickDefaultChallenge(challenges: WeeklyChallenge[]): number | null {
  if (challenges.length === 0) return null;
  const byCreated = [...challenges].sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0) || Number(b.id) - Number(a.id));
  return (byCreated.find((c) => c.status === "draft")
    || byCreated.find((c) => c.status === "active")
    || byCreated[0]).id;
}

type AdminSampleResponse = AdminGetResponse & { existing?: boolean; replaced?: boolean; message?: string };

type MatchDraft = {
  local_id: string;
  match_id: string;
  provider: string;
  provider_match_id: string;
  tournament_code: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: string;
  status: string;
  competition_type: "club" | "national_team" | "";
  metadata: Record<string, unknown>;
};

type GroupDraft = { local_id: string; id: string; title: string; matchRefs: string[] };
type UpsetCandidateDraft = { local_id: string; team_name: string; opponent_name: string; match_ref: string; label: string };
type UpsetCountMatchDraft = { local_id: string; match_ref: string; favorite_side: "home" | "away" };

type QuestionDraft = {
  key: WeeklyChallengeQuestionKey;
  templateKey: string; // "" = legacy/custom (rendered read-only via advanced JSON)
  title: string;
  titleDirty: boolean;
  description: string;
  status: WeeklyChallengeQuestionStatus;
  // match templates
  matchRef: string;
  // league / Расклад templates
  groups: GroupDraft[];
  // duel templates
  duelAKind: "player" | "team";
  duelAName: string;
  duelATeam: string;
  duelAMatchRef: string;
  duelBKind: "player" | "team";
  duelBName: string;
  duelBTeam: string;
  duelBMatchRef: string;
  duelVoidIfNoMinutes: boolean;
  // upset templates
  upsetCandidates: UpsetCandidateDraft[];
  upsetCountMatches: UpsetCountMatchDraft[];
  // event templates + pool-aggregate scope (families P/O)
  scopeType: "all_pool" | "selected";
  scopeRefs: string[];
  // pool-aggregate / max / outcome / league families (all league_of_week)
  goalsBuckets: number[]; // pool_total_goals_bucket
  countMax: number; // pool_*_count
  includeDraws: boolean; // pool_outcome_balance
  leagueCodes: string[]; // league_top_scoring / league_most_home_wins
  // legacy passthrough (preserved verbatim when templateKey === "")
  legacy: boolean;
  legacyOptions: WeeklyChallengeOption[];
  legacyConfig: Record<string, unknown>;
};

type CandidateMatch = {
  id?: string;
  competition_code?: string;
  competition_label?: string;
  competition_type?: string;
  home_name?: string;
  away_name?: string;
  start_time_utc?: string;
  api_provider?: string;
};

type AdminCandidatesResponse = {
  ok: boolean;
  matches: CandidateMatch[];
  matchMode?: string;
  effectiveMatchMode?: string;
};

const STATUSES: WeeklyChallengeStatus[] = ["draft", "active", "locked", "scoring", "completed", "archived"];
const QUESTION_KEYS: WeeklyChallengeQuestionKey[] = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"];

const DEFAULT_TEMPLATE_FOR_KEY: Record<WeeklyChallengeQuestionKey, string> = {
  match_of_week: "match_result",
  league_of_week: "group_highest_average_goals",
  duel_of_week: "player_goals_duel",
  upset_of_week: "underdog_not_lose",
  event_of_week: "any_five_plus_goals",
};

const BONUS_KEY_TO_QUESTION: Record<"match" | "league" | "duel" | "upset" | "event", WeeklyChallengeQuestionKey> = {
  match: "match_of_week",
  league: "league_of_week",
  duel: "duel_of_week",
  upset: "upset_of_week",
  event: "event_of_week",
};

const BONUS_REWARD_LABEL: Record<"match" | "league" | "duel" | "upset" | "event", string> = {
  match: "2⭐",
  league: "2⭐",
  duel: "2⭐",
  upset: "2⭐",
  event: "2⭐",
};

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const MSK_UTC_OFFSET_SECONDS = 3 * 3600;

function formatDateInput(unix: number | null | undefined): string {
  if (unix === null || unix === undefined) return "";
  const n = Number(unix);
  if (!Number.isFinite(n)) return "";
  const d = new Date((n + MSK_UTC_OFFSET_SECONDS) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function parseDateInput(value: string): number | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
  if (Number.isNaN(utcMs)) return null;
  return Math.floor(utcMs / 1000) - MSK_UTC_OFFSET_SECONDS;
}

function parseJsonText<T>(text: string, fallback: T): T {
  if (!text || !text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Невалидный JSON");
  }
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function dayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function compactString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeMatchRef(match: MatchDraft, index: number): string {
  return match.match_id.trim() || `pool_${index + 1}`;
}

function matchShort(match: MatchDraft): string {
  return `${match.home_team_name || "Команда 1"} — ${match.away_team_name || "Команда 2"}`;
}

function matchLabel(match: MatchDraft, index: number): string {
  return `${index + 1}. ${match.tournament_code ? `${match.tournament_code} · ` : ""}${matchShort(match)}`;
}

function formatImportedDate(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateInput(Math.floor(date.getTime() / 1000));
}

function candidateToDraft(match: CandidateMatch): MatchDraft {
  const type = String(match.competition_type || "").toLowerCase();
  return {
    local_id: uid("match"),
    match_id: compactString(match.id),
    provider: compactString(match.api_provider),
    provider_match_id: compactString(match.id),
    tournament_code: compactString(match.competition_code),
    home_team_name: compactString(match.home_name),
    away_team_name: compactString(match.away_name),
    kickoff_at: formatImportedDate(match.start_time_utc),
    status: "",
    competition_type: type === "national_team" ? "national_team" : type === "club" ? "club" : "",
    metadata: { source: "admin_day_candidates", competition_label: match.competition_label || null, competition_type: type || null },
  };
}

function createEmptyMatch(mode: WeeklyResolvedMode): MatchDraft {
  return {
    local_id: uid("match"),
    match_id: "",
    provider: "",
    provider_match_id: "",
    tournament_code: "",
    home_team_name: "",
    away_team_name: "",
    kickoff_at: "",
    status: "",
    competition_type: mode === "national_team" ? "national_team" : mode === "club" ? "club" : "",
    metadata: {},
  };
}

function draftFromMatch(match: WeeklyChallengeMatch): MatchDraft {
  const meta = (match.metadata || {}) as Record<string, unknown>;
  const type = String(meta.competition_type || "").toLowerCase();
  return {
    local_id: uid("match"),
    match_id: match.match_id || "",
    provider: match.provider || "",
    provider_match_id: match.provider_match_id || "",
    tournament_code: match.tournament_code || "",
    home_team_name: match.home_team_name || "",
    away_team_name: match.away_team_name || "",
    kickoff_at: formatDateInput(match.kickoff_at),
    status: match.status || "",
    competition_type: type === "national_team" ? "national_team" : type === "club" ? "club" : "",
    metadata: meta,
  };
}

function matchPayload(matches: MatchDraft[]) {
  return matches.map((match, index) => ({
    match_id: match.match_id.trim() || null,
    provider: match.provider.trim() || null,
    provider_match_id: match.provider_match_id.trim() || null,
    tournament_code: match.tournament_code.trim() || null,
    home_team_name: match.home_team_name.trim(),
    away_team_name: match.away_team_name.trim(),
    kickoff_at: parseDateInput(match.kickoff_at),
    status: match.status.trim() || null,
    metadata: { ...(match.metadata || {}), competition_type: match.competition_type || (match.metadata as Record<string, unknown>)?.competition_type || null },
    sort_order: index + 1,
  }));
}

// ── Question draft factories ─────────────────────────────────────────────────
function blankQuestionFields() {
  return {
    matchRef: "",
    groups: [createGroup("Группа 1"), createGroup("Группа 2")] as GroupDraft[],
    duelAKind: "player" as "player" | "team",
    duelAName: "",
    duelATeam: "",
    duelAMatchRef: "",
    duelBKind: "player" as "player" | "team",
    duelBName: "",
    duelBTeam: "",
    duelBMatchRef: "",
    duelVoidIfNoMinutes: true,
    upsetCandidates: [createUpsetCandidate(), createUpsetCandidate()] as UpsetCandidateDraft[],
    upsetCountMatches: [] as UpsetCountMatchDraft[],
    scopeType: "all_pool" as "all_pool" | "selected",
    scopeRefs: [] as string[],
    goalsBuckets: [10, 16] as number[],
    countMax: 3,
    includeDraws: false,
    leagueCodes: [] as string[],
    legacy: false,
    legacyOptions: [] as WeeklyChallengeOption[],
    legacyConfig: {} as Record<string, unknown>,
  };
}

function createGroup(title: string): GroupDraft {
  return { local_id: uid("grp"), id: "", title, matchRefs: [] };
}
function createUpsetCandidate(): UpsetCandidateDraft {
  return { local_id: uid("upst"), team_name: "", opponent_name: "", match_ref: "", label: "" };
}

function defaultTitleFor(templateKey: string): string {
  return getWeeklyTemplate(templateKey)?.title || "";
}

function createDefaultQuestion(key: WeeklyChallengeQuestionKey): QuestionDraft {
  const templateKey = DEFAULT_TEMPLATE_FOR_KEY[key];
  return {
    key,
    templateKey,
    title: defaultTitleFor(templateKey),
    titleDirty: false,
    description: "",
    status: "active",
    ...blankQuestionFields(),
  };
}

function draftFromQuestion(question: WeeklyChallengeQuestion): QuestionDraft {
  const config = (question.config || {}) as Record<string, unknown>;
  const templateKey = String(question.template_key || config.template_key || "").trim();
  const known = !!getWeeklyTemplate(templateKey);
  const base = createDefaultQuestion(question.question_key);
  base.title = question.title || base.title;
  base.titleDirty = true; // a saved title is treated as explicit
  base.description = question.description || "";
  base.status = question.status || "active";

  if (!known) {
    // Legacy / custom — preserve verbatim, edit only via advanced JSON.
    base.templateKey = "";
    base.legacy = true;
    base.legacyOptions = question.options || [];
    base.legacyConfig = config;
    return base;
  }
  base.templateKey = templateKey;
  base.legacy = false;

  if (question.question_key === "match_of_week") {
    base.matchRef = compactString(config.match_ref);
  }
  if (question.question_key === "league_of_week") {
    if (templateKey.startsWith("group_")) {
      const groups = Array.isArray(config.groups) ? (config.groups as Array<Record<string, unknown>>) : [];
      base.groups = groups.length > 0
        ? groups.map((g) => ({ local_id: uid("grp"), id: compactString(g?.id), title: compactString(g?.title), matchRefs: (Array.isArray(g?.match_ids) ? (g.match_ids as unknown[]) : []).map((r) => compactString(r)).filter(Boolean) }))
        : [createGroup("Группа 1"), createGroup("Группа 2")];
    } else if (templateKey === "pool_top_scoring_match") {
      const cands = Array.isArray(config.candidates) ? (config.candidates as Array<Record<string, unknown>>) : [];
      base.scopeType = "selected";
      base.scopeRefs = cands.map((c) => compactString(c?.match_ref)).filter(Boolean);
    } else if (templateKey === "league_top_scoring" || templateKey === "league_most_home_wins") {
      const leagues = Array.isArray(config.leagues) ? (config.leagues as Array<Record<string, unknown>>) : [];
      base.leagueCodes = leagues.map((l) => compactString(l?.code)).filter(Boolean);
    } else {
      // pool_total_goals_bucket / pool_*_count / pool_outcome_balance
      const scope = (config.scope || {}) as Record<string, unknown>;
      base.scopeType = scope.type === "selected" ? "selected" : "all_pool";
      base.scopeRefs = (Array.isArray(scope.match_refs) ? (scope.match_refs as unknown[]) : []).map((r) => compactString(r)).filter(Boolean);
      if (Array.isArray(config.buckets)) {
        const nums = (config.buckets as unknown[]).map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0);
        if (nums.length > 0) base.goalsBuckets = nums;
      }
      if (config.count_max != null) base.countMax = Math.floor(Number(config.count_max)) || base.countMax;
      if (config.include_draws != null) base.includeDraws = config.include_draws === true;
    }
  }
  if (question.question_key === "duel_of_week") {
    const a = ((config.side_a || config.player_a || {}) as Record<string, unknown>);
    const b = ((config.side_b || config.player_b || {}) as Record<string, unknown>);
    base.duelAKind = a.kind === "team" ? "team" : "player";
    base.duelAName = compactString(a.name);
    base.duelATeam = compactString(a.team_name);
    base.duelAMatchRef = compactString(a.match_ref);
    base.duelBKind = b.kind === "team" ? "team" : "player";
    base.duelBName = compactString(b.name);
    base.duelBTeam = compactString(b.team_name);
    base.duelBMatchRef = compactString(b.match_ref);
    base.duelVoidIfNoMinutes = config.void_if_player_did_not_play !== false;
  }
  if (question.question_key === "upset_of_week") {
    if (templateKey === "upset_count") {
      const matches = Array.isArray(config.matches) ? (config.matches as Array<Record<string, unknown>>) : [];
      base.upsetCountMatches = matches.map((m) => ({ local_id: uid("upc"), match_ref: compactString(m?.match_ref), favorite_side: m?.favorite_side === "away" ? "away" : "home" }));
    } else {
      const opts = (question.options || []).filter((o) => String(o.id) !== "no_upset");
      base.upsetCandidates = opts.length > 0
        ? opts.map((o) => {
            const oo = o as Record<string, unknown>;
            return { local_id: uid("upst"), team_name: compactString(oo.team_name || oo.underdog_team_name), opponent_name: compactString(oo.opponent_name || oo.opponent_team_name), match_ref: compactString(oo.match_ref), label: compactString(o.label) };
          })
        : [createUpsetCandidate(), createUpsetCandidate()];
    }
  }
  if (question.question_key === "event_of_week") {
    const scope = (config.scope || {}) as Record<string, unknown>;
    base.scopeType = scope.type === "selected" ? "selected" : "all_pool";
    base.scopeRefs = (Array.isArray(scope.match_refs) ? (scope.match_refs as unknown[]) : []).map((r) => compactString(r)).filter(Boolean);
  }
  return base;
}

function templateInputFor(question: QuestionDraft, matches: MatchDraft[]): WeeklyTemplateInput {
  const matchByRef = new Map(matches.map((m, i) => [normalizeMatchRef(m, i), m]));
  const tk = question.templateKey;
  if (question.key === "match_of_week") {
    const m = question.matchRef ? matchByRef.get(question.matchRef) : null;
    return { templateKey: tk, matchRef: question.matchRef || null, homeTeamName: m?.home_team_name, awayTeamName: m?.away_team_name };
  }
  if (question.key === "league_of_week") {
    if (tk === "pool_total_goals_bucket") {
      return { templateKey: tk, scope: { type: question.scopeType, match_refs: question.scopeRefs }, goalsBuckets: question.goalsBuckets };
    }
    if (tk === "pool_big_wins_count" || tk === "pool_btts_count" || tk === "pool_clean_sheets_count") {
      return { templateKey: tk, scope: { type: question.scopeType, match_refs: question.scopeRefs }, countMax: question.countMax };
    }
    if (tk === "pool_top_scoring_match") {
      return {
        templateKey: tk,
        matchOptions: question.scopeRefs.map((ref) => {
          const m = matchByRef.get(ref);
          return { match_ref: ref, label: m ? `${m.home_team_name} — ${m.away_team_name}` : ref };
        }),
      };
    }
    if (tk === "pool_outcome_balance") {
      return { templateKey: tk, scope: { type: question.scopeType, match_refs: question.scopeRefs }, includeDraws: question.includeDraws };
    }
    if (tk === "pool_biggest_margin") {
      return { templateKey: tk, scope: { type: question.scopeType, match_refs: question.scopeRefs } };
    }
    if (tk === "league_top_scoring" || tk === "league_most_home_wins") {
      return { templateKey: tk, leagues: question.leagueCodes.map((code) => ({ code, label: code })) };
    }
    return { templateKey: tk, groups: question.groups.map((g) => ({ id: g.id || undefined, title: g.title, match_ids: g.matchRefs })) };
  }
  if (question.key === "duel_of_week") {
    return {
      templateKey: tk,
      duel: {
        side_a: { kind: question.duelAKind, name: question.duelAName, team_name: question.duelATeam, match_ref: question.duelAMatchRef || null },
        side_b: { kind: question.duelBKind, name: question.duelBName, team_name: question.duelBTeam, match_ref: question.duelBMatchRef || null },
        void_if_did_not_play: question.duelVoidIfNoMinutes,
      },
    };
  }
  if (question.key === "upset_of_week") {
    if (tk === "upset_count") {
      return { templateKey: tk, upsetCountMatches: question.upsetCountMatches.map((m) => ({ match_ref: m.match_ref || null, favorite_side: m.favorite_side })) };
    }
    return { templateKey: tk, upsetCandidates: question.upsetCandidates.map((c) => ({ team_name: c.team_name, opponent_name: c.opponent_name, match_ref: c.match_ref || null, label: c.label })) };
  }
  // event_of_week
  return { templateKey: tk, scope: { type: question.scopeType, match_refs: question.scopeRefs } };
}

function buildQuestionPayload(questions: QuestionDraft[], matches: MatchDraft[]) {
  return QUESTION_KEYS.map((key, index) => {
    const q = questions.find((item) => item.key === key) || createDefaultQuestion(key);
    if (q.legacy || !getWeeklyTemplate(q.templateKey)) {
      // Preserve legacy options/config verbatim; only title/description/status are editable.
      return {
        question_key: key,
        title: q.title.trim() || weeklyQuestionDisplayCategory(key),
        description: q.description.trim() || null,
        question_type: "single_select",
        options: q.legacyOptions,
        config: q.legacyConfig,
        status: q.status,
        sort_order: index + 1,
      };
    }
    const tmpl = getWeeklyTemplate(q.templateKey)!;
    const built = tmpl.buildQuestion(templateInputFor(q, matches));
    return {
      question_key: key,
      title: q.title.trim() || tmpl.title,
      description: q.description.trim() || null,
      question_type: "single_select",
      options: built.options,
      config: built.config,
      status: q.status,
      sort_order: index + 1,
    };
  });
}

// ── styles ───────────────────────────────────────────────────────────────────
const inputLabelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0, fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" };
const textareaStyle: CSSProperties = { width: "100%", minHeight: 160, border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))", borderRadius: 12, padding: 12, background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text, #fff)", fontSize: 12, lineHeight: 1.5, outline: "none", resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", boxSizing: "border-box" };
const selectStyle: CSSProperties = { width: "100%", minWidth: 0, minHeight: 44, border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))", borderRadius: 12, padding: "0 12px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text, #fff)", fontSize: 13, fontWeight: 700, outline: "none", boxSizing: "border-box" };
const responsiveGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 10, alignItems: "start" };
const compactCardStyle: CSSProperties = { border: "1px solid var(--tg-separator, rgba(128,128,128,0.16))", borderRadius: 8, padding: 12, background: "var(--tg-bg, rgba(255,255,255,0.04))", minWidth: 0 };
const helperTextStyle: CSSProperties = { marginTop: 4, fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, lineHeight: 1.45 };
const fieldErrorStyle: CSSProperties = { marginTop: 4, fontSize: 11, color: "#ff453a", fontWeight: 800, lineHeight: 1.35 };

const WC_BONUS_ACCENT = "#ff8a3c";

const STATUS_TONE: Record<string, { label: string; color: string }> = {
  ok: { label: "Готов", color: "#2ec060" },
  draft: { label: "Черновик", color: "#d98a1a" },
  error: { label: "Ошибка", color: "#e5484d" },
  unset: { label: "Не настроен", color: "#999" },
  disabled: { label: "Отключён", color: "#888" },
};

export default function WeeklyChallengeAdminSection({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [challenges, setChallenges] = useState<WeeklyChallenge[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminGetResponse | null>(null);
  // List search/filters (client-side only — never mutate backend data).
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "active" | "completed" | "archived">("all");
  const [hideArchived, setHideArchived] = useState(false);
  // Delete confirmation.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WeeklyChallengeStatus>("draft");
  const [competitionMode, setCompetitionMode] = useState<WeeklyResolvedMode>("unspecified");
  const [openAt, setOpenAt] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [taskSchemaVersion, setTaskSchemaVersion] = useState<1 | 2>(2);
  const [bonusQuestionKey, setBonusQuestionKeyRaw] = useState<"match" | "league" | "duel" | "upset" | "event">("upset");
  const [bonusSaved, setBonusSaved] = useState(false);
  const setBonusQuestionKey = useCallback((v: "match" | "league" | "duel" | "upset" | "event") => { setBonusQuestionKeyRaw(v); setBonusSaved(false); }, []);
  const [settingsJson, setSettingsJson] = useState("{}");
  const [matches, setMatches] = useState<MatchDraft[]>([]);
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => QUESTION_KEYS.map(createDefaultQuestion));
  const [matchesJson, setMatchesJson] = useState("[]");
  const [questionsJson, setQuestionsJson] = useState("[]");
  const [matchErrors, setMatchErrors] = useState<Record<string, Record<string, string>>>({});
  const [questionEditError, setQuestionEditError] = useState("");

  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [importDay, setImportDay] = useState(dayInputValue());
  const [candidateMatches, setCandidateMatches] = useState<CandidateMatch[]>([]);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchTypeFilter, setMatchTypeFilter] = useState<"all" | "club" | "national_team">("all");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const didInitialLoadRef = useRef(false);

  const formQuestionPayload = useMemo(() => buildQuestionPayload(questions, matches), [questions, matches]);
  const activeQuestionCount = formQuestionPayload.filter((question) => question.status === "active").length;

  const poolRefs = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m, i) => {
      if (m.match_id.trim()) set.add(m.match_id.trim());
      set.add(`pool_${i + 1}`);
    });
    return set;
  }, [matches]);

  const scheduleErrors = useMemo(() => {
    const errs: string[] = [];
    const o = parseDateInput(openAt);
    const d = parseDateInput(deadlineAt);
    const c = parseDateInput(closeAt);
    if (openAt.trim() && o === null) errs.push("некорректная дата открытия");
    if (deadlineAt.trim() && d === null) errs.push("некорректная дата дедлайна");
    if (closeAt.trim() && c === null) errs.push("некорректная дата закрытия");
    if (o !== null && d !== null && !(o < d)) errs.push("открытие должно быть раньше дедлайна");
    if (d !== null && c !== null && !(d <= c)) errs.push("дедлайн должен быть не позже закрытия");
    if (o !== null && c !== null && !(o < c)) errs.push("открытие должно быть раньше закрытия");
    return errs;
  }, [openAt, deadlineAt, closeAt]);

  const otherActiveChallenge = useMemo(
    () => challenges.find((c) => c.status === "active" && c.id !== selectedId) || null,
    [challenges, selectedId],
  );

  // Client-side search + status filter + hide-archived (display only).
  const filteredChallenges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return challenges.filter((c) => {
      if (hideArchived && c.status === "archived") return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return `${c.title} ${c.code} ${c.id}`.toLowerCase().includes(q);
    });
  }, [challenges, searchQuery, statusFilter, hideArchived]);

  const structuralLocked = detail?.question_edit_state?.structural_locked ?? false;
  const taskConfigLocked = !!detail && (status !== "draft" || structuralLocked);
  // Bonus has unsaved changes when the local pick differs from the persisted value.
  const bonusDirty = !!detail && taskSchemaVersion >= 2 && (detail.challenge.bonus_question_key || "upset") !== bonusQuestionKey;
  const modeLocked = !!detail && (status !== "draft" || (detail.question_edit_state?.entries ?? 0) > 0);

  // Per-question validation issues (template-aware, against the current pool).
  const questionIssues = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const q of questions) {
      const tmpl = getWeeklyTemplate(q.templateKey);
      if (!tmpl) {
        out[q.key] = q.legacy ? [] : ["Шаблон не выбран"];
        continue;
      }
      const issues = tmpl.validate(templateInputFor(q, matches), { poolRefs, mode: competitionMode, status: q.status === "active" ? "active" : q.status });
      out[q.key] = issues.map((i) => i.message);
    }
    return out;
  }, [questions, matches, poolRefs, competitionMode]);

  const bonusQuestionReady = useMemo(() => {
    const targetKey = BONUS_KEY_TO_QUESTION[bonusQuestionKey];
    const q = questions.find((item) => item.key === targetKey);
    if (!q || q.status !== "active") return false;
    return (questionIssues[targetKey] || []).length === 0;
  }, [bonusQuestionKey, questions, questionIssues]);

  const activationProblems = useMemo(() => {
    const problems: string[] = [];
    if (matches.length === 0) problems.push("пул матчей пустой");
    if (activeQuestionCount < 5) problems.push("нужно 5 активных вопросов");
    for (const q of questions) {
      if (q.status === "active" && (questionIssues[q.key] || []).length > 0) {
        problems.push(`${weeklyQuestionDisplayCategory(q.key)}: ${(questionIssues[q.key] || [])[0]}`);
      }
    }
    if (taskSchemaVersion >= 2 && !bonusQuestionReady) problems.push("для заданий V2 нужен заполненный активный бонусный вопрос");
    if (scheduleErrors.length > 0) problems.push(`даты: ${scheduleErrors.join("; ")}`);
    if (otherActiveChallenge) problems.push(`уже активен другой вызов: ${otherActiveChallenge.title}`);
    return problems;
  }, [activeQuestionCount, matches.length, questions, questionIssues, scheduleErrors, otherActiveChallenge, taskSchemaVersion, bonusQuestionReady]);

  useEffect(() => { setMatchesJson(pretty(matchPayload(matches))); }, [matches]);
  useEffect(() => { setQuestionsJson(pretty(formQuestionPayload)); }, [formQuestionPayload]);

  const fillFormFromDetail = useCallback((res: AdminGetResponse) => {
    const nextMatches = (res.match_pool || []).map(draftFromMatch);
    const nextQuestions = QUESTION_KEYS.map((key) => {
      const existing = (res.questions || []).find((question) => question.question_key === key);
      return existing ? draftFromQuestion(existing) : createDefaultQuestion(key);
    });
    setDetail(res);
    setTitle(res.challenge.title);
    setDescription(res.challenge.description || "");
    setStatus(res.challenge.status);
    setCompetitionMode((res.challenge.competition_mode as WeeklyResolvedMode) || "unspecified");
    setOpenAt(formatDateInput(res.challenge.open_at));
    setDeadlineAt(formatDateInput(res.challenge.deadline_at));
    setCloseAt(formatDateInput(res.challenge.close_at));
    setSortOrder(String(res.challenge.sort_order || 100));
    setTaskSchemaVersion(Number(res.challenge.task_schema_version || 1) >= 2 ? 2 : 1);
    setBonusQuestionKey(res.challenge.bonus_question_key || "upset");
    setSettingsJson(pretty(res.challenge.settings || {}));
    setMatches(nextMatches);
    setQuestions(nextQuestions);
    setMatchErrors({});
    setQuestionEditError("");
  }, [setBonusQuestionKey]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth<AdminListResponse>("/admin/season-predictions/weekly-challenges");
      if (!res) return;
      setChallenges(res.challenges || []);
      // Auto-select the most relevant challenge; keep the current one if it still exists.
      if (!selectedId && res.challenges.length > 0) setSelectedId(pickDefaultChallenge(res.challenges));
      else if (selectedId && !res.challenges.find((challenge) => challenge.id === selectedId)) setSelectedId(pickDefaultChallenge(res.challenges));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, selectedId]);

  const loadDetail = useCallback(async (id: number) => {
    setError("");
    try {
      const res = await fetchWithAuth<AdminGetResponse>(`/admin/season-predictions/weekly-challenges/${id}`);
      if (!res) return;
      fillFormFromDetail(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить вызов");
    }
  }, [fetchWithAuth, fillFormFromDetail]);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  function patchQuestion(key: WeeklyChallengeQuestionKey, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((question) => question.key === key ? { ...question, ...patch } : question));
  }

  function changeTemplate(key: WeeklyChallengeQuestionKey, templateKey: string) {
    setQuestions((prev) => prev.map((q) => {
      if (q.key !== key) return q;
      if (q.templateKey === templateKey) return q;
      // Switching template clears template-specific fields; title resets unless custom.
      const next: QuestionDraft = { ...q, templateKey, ...blankQuestionFields() };
      // Goals-conceded duel only makes sense between teams.
      if (templateKey === "team_conceded_duel") { next.duelAKind = "team"; next.duelBKind = "team"; }
      if (!q.titleDirty) next.title = defaultTitleFor(templateKey);
      return next;
    }));
  }

  function resetTitle(key: WeeklyChallengeQuestionKey) {
    setQuestions((prev) => prev.map((q) => q.key === key ? { ...q, title: defaultTitleFor(q.templateKey), titleDirty: false } : q));
  }

  function validateMatches(): boolean {
    const next: Record<string, Record<string, string>> = {};
    for (const match of matches) {
      const errors: Record<string, string> = {};
      if (!match.home_team_name.trim()) errors.home_team_name = "Укажите команду 1";
      if (!match.away_team_name.trim()) errors.away_team_name = "Укажите команду 2";
      if (Object.keys(errors).length > 0) next[match.local_id] = errors;
    }
    setMatchErrors(next);
    return Object.keys(next).length === 0;
  }

  async function createChallenge() {
    if (!newCode.trim() || !newTitle.trim()) { setError("Укажите code и title"); return; }
    setSaving("create");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; challenge: WeeklyChallenge }>(
        "/admin/season-predictions/weekly-challenges",
        { method: "POST", body: JSON.stringify({ code: newCode.trim(), title: newTitle.trim(), status: "draft" }) },
      );
      if (!res) return;
      setNewCode("");
      setNewTitle("");
      await loadList();
      setSelectedId(res.challenge.id);
      setNotice("Вызов создан в статусе «Черновик».");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать вызов");
    } finally {
      setSaving("");
    }
  }

  async function createSampleChallenge() {
    setSaving("sample");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<AdminSampleResponse>(
        "/admin/season-predictions/weekly-challenges/create-sample",
        { method: "POST", body: JSON.stringify({ status: "active", code: "sample_week_1", title: "Вызов недели #1", deadline_days: 7, replace_existing_sample: false }) },
      );
      if (!res) return;
      await loadList();
      setSelectedId(res.challenge.id);
      fillFormFromDetail(res);
      setNotice(res.existing ? "Тестовый вызов уже существует. Открыл его для проверки." : "Тестовый вызов создан.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать тестовый вызов");
    } finally {
      setSaving("");
    }
  }

  async function saveSettings() {
    if (!detail) return;
    if (scheduleErrors.length > 0) { setError(`Исправьте даты: ${scheduleErrors.join("; ")}.`); return; }
    if (status === "active" && activationProblems.length > 0) { setError(`Нельзя активировать: ${activationProblems.join("; ")}.`); return; }
    setSaving("settings");
    setError("");
    setNotice("");
    try {
      const settings = parseJsonText(settingsJson, {} as Record<string, unknown>);
      const res = await fetchWithAuth<{ ok: boolean; challenge: WeeklyChallenge; warnings?: string[] }>(
        `/admin/season-predictions/weekly-challenges/${detail.challenge.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            title,
            description: description || null,
            status,
            competition_mode: competitionMode === "unspecified" ? null : competitionMode,
            open_at: parseDateInput(openAt),
            deadline_at: parseDateInput(deadlineAt),
            close_at: parseDateInput(closeAt),
            sort_order: Number(sortOrder) || 100,
            task_schema_version: taskSchemaVersion,
            bonus_question_key: taskSchemaVersion >= 2 ? bonusQuestionKey : null,
            settings_json: settings,
          }),
        },
      );
      if (!res) return;
      setNotice(["Настройки вызова сохранены.", ...(res.warnings || [])].join(" "));
      await loadList();
      await loadDetail(detail.challenge.id);
      if (taskSchemaVersion >= 2) setBonusSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить настройки");
    } finally {
      setSaving("");
    }
  }

  async function deleteChallenge() {
    if (!detail || deleteConfirmText.trim() !== "УДАЛИТЬ") return;
    const id = detail.challenge.id;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; deleted_challenge_id?: number; error?: string }>(
        `/admin/season-predictions/weekly-challenges/${id}`,
        { method: "DELETE" },
      );
      if (!res) return;
      setShowDeleteConfirm(false);
      setDeleteConfirmText("");
      const remaining = challenges.filter((c) => c.id !== id);
      setChallenges(remaining);
      setSelectedId(pickDefaultChallenge(remaining));
      setNotice("Вызов удалён.");
      await loadList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = Object.keys(WEEKLY_DELETE_REASON).find((k) => msg.includes(k));
      setError(code ? WEEKLY_DELETE_REASON[code] : (msg || "Не удалось удалить вызов"));
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  async function saveMatches() {
    if (!detail) return;
    if (status === "active" && matches.length === 0) { setError("Нельзя сохранить active challenge с пустым пулом матчей."); return; }
    if (!validateMatches()) return;
    setSaving("matches");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; match_pool: WeeklyChallengeMatch[] }>(
        `/admin/season-predictions/weekly-challenges/${detail.challenge.id}/matches`,
        { method: "PUT", body: JSON.stringify({ matches: matchPayload(matches) }) },
      );
      if (!res) return;
      setNotice(`Сохранено матчей: ${res.match_pool.length}`);
      await loadDetail(detail.challenge.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить матчи");
    } finally {
      setSaving("");
    }
  }

  async function saveQuestions() {
    if (!detail) return;
    // Block save when an active question has template issues.
    const blocking = questions.filter((q) => q.status === "active" && (questionIssues[q.key] || []).length > 0);
    if (blocking.length > 0) {
      setError(`Исправьте вопросы: ${blocking.map((q) => weeklyQuestionDisplayCategory(q.key)).join(", ")}.`);
      return;
    }
    setSaving("questions");
    setError("");
    setNotice("");
    setQuestionEditError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; questions: WeeklyChallengeQuestion[]; warnings?: string[] }>(
        `/admin/season-predictions/weekly-challenges/${detail.challenge.id}/questions`,
        { method: "PUT", body: JSON.stringify({ questions: formQuestionPayload }) },
      );
      if (!res) return;
      setNotice([`Сохранено вопросов: ${res.questions.length}`, ...(res.warnings || [])].join(" "));
      await loadDetail(detail.challenge.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("WEEKLY_QUESTION_STRUCTURE_LOCKED")) {
        setQuestionEditError("Структура вопросов заблокирована: есть участие пользователей. Можно менять только название и описание. Изменения не сохранены.");
      } else if (msg.includes("WEEKLY_QUESTION_OFFICIAL_ANSWER_INVALIDATED")) {
        setQuestionEditError("Нельзя удалить вариант, выбранный официальным ответом. Сначала измените официальный ответ в разделе «Итоги и правильные ответы». Изменения не сохранены.");
      } else if (msg.includes("WEEKLY_TEMPLATE_VALIDATION_FAILED")) {
        setQuestionEditError("Сервер отклонил вопросы по правилам шаблона. Проверьте подсветку ошибок выше. Изменения не сохранены.");
      } else {
        setError(msg || "Не удалось сохранить вопросы");
      }
    } finally {
      setSaving("");
    }
  }

  async function saveMatchesFromJson() {
    if (!detail) return;
    setSaving("matches-json");
    setError("");
    try {
      const parsed = parseJsonText(matchesJson, [] as unknown[]);
      if (!Array.isArray(parsed)) throw new Error("matches должен быть массивом");
      const res = await fetchWithAuth<{ ok: boolean; match_pool: WeeklyChallengeMatch[] }>(
        `/admin/season-predictions/weekly-challenges/${detail.challenge.id}/matches`,
        { method: "PUT", body: JSON.stringify({ matches: parsed }) },
      );
      if (!res) return;
      setNotice(`JSON сохранён. Матчей: ${res.match_pool.length}`);
      await loadDetail(detail.challenge.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить JSON матчей");
    } finally {
      setSaving("");
    }
  }

  async function saveQuestionsFromJson() {
    if (!detail) return;
    setSaving("questions-json");
    setError("");
    try {
      const parsed = parseJsonText(questionsJson, [] as unknown[]);
      if (!Array.isArray(parsed)) throw new Error("questions должен быть массивом");
      const res = await fetchWithAuth<{ ok: boolean; questions: WeeklyChallengeQuestion[]; warnings?: string[] }>(
        `/admin/season-predictions/weekly-challenges/${detail.challenge.id}/questions`,
        { method: "PUT", body: JSON.stringify({ questions: parsed }) },
      );
      if (!res) return;
      setNotice([`JSON сохранён. Вопросов: ${res.questions.length}`, ...(res.warnings || [])].join(" "));
      await loadDetail(detail.challenge.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить JSON вопросов");
    } finally {
      setSaving("");
    }
  }

  async function loadCandidateMatches() {
    if (!importDay) return;
    setSaving("import-load");
    setError("");
    try {
      const res = await fetchWithAuth<AdminCandidatesResponse>(`/admin/day/candidates?day=${encodeURIComponent(importDay)}`);
      if (!res) return;
      setCandidateMatches(res.matches || []);
      if ((res.matches || []).length === 0) setNotice("Для выбранного дня матчей не найдено.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить матчи дня");
    } finally {
      setSaving("");
    }
  }

  function togglePoolMatch(candidate: CandidateMatch) {
    setMatches((prev) => {
      const cid = compactString(candidate.id);
      const exists = prev.some((item) => item.match_id && item.match_id === cid);
      if (exists) return prev.filter((item) => item.match_id !== cid);
      return [...prev, candidateToDraft(candidate)];
    });
  }

  function moveMatch(localId: string, direction: -1 | 1) {
    setMatches((prev) => {
      const index = prev.findIndex((match) => match.local_id === localId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function updateMatch(localId: string, patch: Partial<MatchDraft>) {
    setMatches((prev) => prev.map((match) => match.local_id === localId ? { ...match, ...patch } : match));
  }

  const matchOptions = matches.map((match, index) => ({ ref: normalizeMatchRef(match, index), label: matchLabel(match, index) }));
  const leagueOptions = Array.from(new Set(matches.map((m) => compactString(m.tournament_code)).filter(Boolean))).map((code) => ({ code, label: code }));
  const selectedMatchIds = useMemo(() => new Set(matches.map((m) => m.match_id).filter(Boolean)), [matches]);
  const previewQuestions = formQuestionPayload.filter((question) => question.status === "active");

  const filteredCandidates = useMemo(() => {
    const q = matchSearch.trim().toLowerCase();
    return candidateMatches.filter((c) => {
      const type = String(c.competition_type || "").toLowerCase();
      if (matchTypeFilter !== "all" && type !== matchTypeFilter) return false;
      if (!q) return true;
      return `${c.home_name || ""} ${c.away_name || ""} ${c.competition_label || ""} ${c.competition_code || ""}`.toLowerCase().includes(q);
    });
  }, [candidateMatches, matchSearch, matchTypeFilter]);

  const activationChecklist = useMemo(() => ([
    { ok: matches.length > 0, label: "Пул матчей заполнен" },
    { ok: activeQuestionCount >= 5, label: "Настроены все 5 активных вопросов" },
    { ok: questions.every((q) => q.status !== "active" || (questionIssues[q.key] || []).length === 0), label: "Все вопросы без ошибок" },
    { ok: taskSchemaVersion < 2 || bonusQuestionReady, label: "Выбран бонусный вопрос" },
    { ok: scheduleErrors.length === 0, label: "Даты валидны" },
    { ok: !otherActiveChallenge, label: "Нет другого активного вызова" },
  ]), [matches.length, activeQuestionCount, questions, questionIssues, taskSchemaVersion, bonusQuestionReady, scheduleErrors.length, otherActiveChallenge]);

  return (
    <div data-testid="weekly-admin-root" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Вызов недели</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              {challenges.length} вызов(ов) · конструктор шаблонов
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <AdminButton size="sm" variant="secondary" onClick={createSampleChallenge} disabled={saving === "sample"}>
              {saving === "sample" ? "..." : "Тестовый шаблон"}
            </AdminButton>
            <AdminButton size="sm" variant="secondary" onClick={loadList} disabled={loading}>
              {loading ? "..." : "Обновить"}
            </AdminButton>
          </div>
        </div>
        {error && <AdminBadge variant="danger" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{error}</AdminBadge>}
        {notice && <AdminBadge variant="success" className="w-full justify-start p-3 whitespace-normal h-auto mt-3">{notice}</AdminBadge>}
      </AdminCard>

      <AdminCard>
        <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 8 }}>Создать новый вызов</div>
        <div style={{ ...responsiveGridStyle, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))" }}>
          <label style={inputLabelStyle}>Code<AdminInput value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="week_1" /></label>
          <label style={inputLabelStyle}>Название<AdminInput value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Вызов недели #1" /></label>
          <div style={{ alignSelf: "end", minWidth: 0 }}>
            <AdminButton onClick={createChallenge} disabled={saving === "create"} className="w-full">{saving === "create" ? "..." : "Создать вызов"}</AdminButton>
          </div>
        </div>
      </AdminCard>

      {challenges.length > 0 && (
        <AdminCard>
          {/* Search + filters (display only) */}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))" }}>
            <AdminInput data-testid="weekly-admin-search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Найти вызов" />
            <select data-testid="weekly-admin-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={selectStyle}>
              <option value="all">Все</option>
              <option value="draft">Черновики</option>
              <option value="active">Активные</option>
              <option value="completed">Завершённые</option>
              <option value="archived">Архив</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)" }}>
              <input data-testid="weekly-admin-hide-archived" type="checkbox" checked={hideArchived} onChange={(e) => setHideArchived(e.target.checked)} />
              Скрыть архивные
            </label>
          </div>
          <div style={{ ...helperTextStyle, marginTop: 6 }}>
            Показано {filteredChallenges.length} из {challenges.length}
          </div>
          {filteredChallenges.length === 0 ? (
            <div style={{ ...helperTextStyle, marginTop: 8 }}>Ничего не найдено. Измените поиск или фильтр.</div>
          ) : (
            <div data-testid="weekly-admin-challenge-list" style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {filteredChallenges.map((challenge) => {
                const selected = selectedId === challenge.id;
                const mode = String((challenge.competition_mode as string) || "unspecified");
                return (
                  <button
                    key={challenge.id}
                    type="button"
                    data-testid={`weekly-admin-challenge-card-${challenge.id}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedId(challenge.id)}
                    style={{ width: "100%", textAlign: "left", borderRadius: 10, padding: "10px 12px", minHeight: 44, cursor: "pointer", color: "var(--tg-text)", border: selected ? "2px solid var(--tg-button, #2481cc)" : "1px solid var(--tg-separator, rgba(128,128,128,0.2))", background: selected ? "color-mix(in srgb, var(--tg-button) 12%, var(--tg-bg))" : "var(--tg-bg, rgba(255,255,255,0.04))" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 14, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{challenge.title}</span>
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 850, color: challenge.status === "active" ? "#2ec060" : challenge.status === "draft" ? "#d98a1a" : "var(--tg-hint)" }}>{weeklyStatusLabel(challenge.status)}</span>
                    </div>
                    <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 700, color: "var(--tg-hint)" }}>
                      Режим: {WEEKLY_MODE_LABEL_SHORT[mode] || "Не задан"} · {challenge.match_count ?? 0} матч. · {challenge.question_count ?? 0} вопр.
                    </div>
                    {challenge.created_at != null && <div style={{ marginTop: 1, fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint)" }}>Создан {formatCreatedAt(challenge.created_at)}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </AdminCard>
      )}

      {detail && (
        <>
          {/* Step 1 — basic settings */}
          <AdminCollapsibleSection
            title="1. Основные настройки"
            description={scheduleErrors.length > 0 ? `Даты: ${scheduleErrors.join("; ")}.` : `статус: ${weeklyStatusLabel(status)} · режим: ${competitionMode === "unspecified" ? "не задан" : WEEKLY_COMPETITION_MODE_LABEL[competitionMode]}`}
            badge={<AdminBadge variant={status === "active" && activationProblems.length === 0 ? "success" : "default"} className="whitespace-normal h-auto">{weeklyStatusLabel(status)}</AdminBadge>}
            defaultOpen={status === "draft"}
            forceOpen={scheduleErrors.length > 0 || otherActiveChallenge !== null}
            keepMounted
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:settings`}
          >
            <div style={responsiveGridStyle}>
              <label style={inputLabelStyle}>Название<AdminInput value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label style={inputLabelStyle}>Статус
                <select value={status} onChange={(event) => setStatus(event.target.value as WeeklyChallengeStatus)} style={selectStyle}>
                  {STATUSES.map((item) => <option key={item} value={item}>{weeklyStatusLabel(item)}</option>)}
                </select>
              </label>
              <label style={inputLabelStyle}>Режим вызова
                <select data-testid="weekly-admin-mode-select" value={competitionMode} onChange={(event) => setCompetitionMode(event.target.value as WeeklyResolvedMode)} style={{ ...selectStyle, opacity: modeLocked ? 0.64 : 1 }} disabled={modeLocked}>
                  <option value="unspecified">Не задан</option>
                  <option value="club">Клубы</option>
                  <option value="national_team">Сборные</option>
                </select>
              </label>
              <label style={inputLabelStyle}>Открытие (МСК)<AdminInput type="datetime-local" value={openAt} onChange={(event) => setOpenAt(event.target.value)} /></label>
              <label style={inputLabelStyle}>Дедлайн (МСК)<AdminInput type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} /></label>
              <label style={inputLabelStyle}>Закрытие (МСК)<AdminInput type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} /></label>
              <label style={inputLabelStyle}>Порядок<AdminInput type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
              <label style={inputLabelStyle}>Версия заданий
                <div data-testid="weekly-admin-task-schema-display" style={{ ...selectStyle, display: "flex", alignItems: "center", opacity: 0.72, cursor: "default" }}>
                  {taskSchemaVersion >= 2 ? "V2: 3 задания" : "V1 legacy (архивная)"}
                </div>
              </label>
            </div>
            {taskSchemaVersion >= 2 && (
              <div data-testid="weekly-admin-v2-preview" style={{ ...helperTextStyle, marginTop: 8 }}>V2 preview: participation · bonus · result.</div>
            )}
            {modeLocked && <div style={helperTextStyle}>Режим заблокирован: вызов опубликован или есть участники.</div>}
            <label style={{ ...inputLabelStyle, marginTop: 10 }}>Описание
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} style={{ ...textareaStyle, minHeight: 80, fontFamily: "inherit" }} />
            </label>
            <div style={helperTextStyle}>Время указывается по МСК (UTC+3). Часовой пояс браузера не влияет на сохранённое значение.</div>
            {scheduleErrors.length > 0 && (
              <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #e5484d 28%, transparent)", color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", fontSize: 12, fontWeight: 700, lineHeight: 1.45 }}>
                {scheduleErrors.map((err, i) => <div key={i}>• {err}</div>)}
              </div>
            )}
            {otherActiveChallenge && (
              <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 10, background: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #d98a1a 28%, transparent)", color: "color-mix(in srgb, #d98a1a 84%, var(--tg-text))", fontSize: 12, fontWeight: 700, lineHeight: 1.45 }}>
                Уже активен другой вызов недели: «{otherActiveChallenge.title}». Сначала переведите его из active.
              </div>
            )}
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Дополнительно → settings_json</summary>
              <div style={helperTextStyle}>Ручное редактирование. competition_mode задаётся селектором выше.</div>
              <textarea value={settingsJson} onChange={(event) => setSettingsJson(event.target.value)} style={{ ...textareaStyle, minHeight: 90, marginTop: 8 }} />
            </details>
            <AdminButton onClick={saveSettings} disabled={saving === "settings" || scheduleErrors.length > 0 || (status === "active" && activationProblems.length > 0)} className="w-full mt-3">
              {saving === "settings" ? "Сохраняю..." : "Сохранить настройки"}
            </AdminButton>
          </AdminCollapsibleSection>

          {/* Step 2 — match pool */}
          <AdminCollapsibleSection
            title="2. Пул матчей недели"
            description={matches.length === 0 ? "пул пуст" : `${matches.length} матч(ей) в пуле`}
            defaultOpen={matches.length === 0}
            forceOpen={Object.keys(matchErrors).length > 0}
            keepMounted
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:match-pool`}
          >
            <div style={{ ...compactCardStyle, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 8 }}>Выбрать матчи дня</div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
                <label style={inputLabelStyle}>День<AdminInput type="date" value={importDay} onChange={(event) => setImportDay(event.target.value)} /></label>
                <label style={inputLabelStyle}>Тип
                  <select value={matchTypeFilter} onChange={(e) => setMatchTypeFilter(e.target.value as "all" | "club" | "national_team")} style={selectStyle}>
                    <option value="all">Все</option>
                    <option value="club">Клубы</option>
                    <option value="national_team">Сборные</option>
                  </select>
                </label>
                <label style={inputLabelStyle}>Поиск<AdminInput value={matchSearch} onChange={(e) => setMatchSearch(e.target.value)} placeholder="команда / турнир" /></label>
                <div style={{ alignSelf: "end" }}>
                  <AdminButton variant="secondary" onClick={loadCandidateMatches} disabled={saving === "import-load"} className="w-full">{saving === "import-load" ? "Загружаю..." : "Загрузить матчи"}</AdminButton>
                </div>
              </div>
              {filteredCandidates.length > 0 && (
                <div style={{ display: "grid", gap: 6, marginTop: 10, maxHeight: 320, overflowY: "auto" }}>
                  {filteredCandidates.map((match) => {
                    const checked = selectedMatchIds.has(compactString(match.id));
                    return (
                      <label key={match.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 8, background: checked ? "color-mix(in srgb, var(--tg-button) 12%, transparent)" : "transparent", cursor: "pointer", minWidth: 0 }}>
                        <input data-testid={`weekly-admin-candidate-${match.id}`} type="checkbox" checked={checked} onChange={() => togglePoolMatch(match)} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 900, minWidth: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>{match.home_name} — {match.away_name}</div>
                          <div style={{ fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
                            {match.competition_label || match.competition_code || "Турнир"} · {formatImportedDate(match.start_time_utc) || "без времени"} · {String(match.competition_type) === "national_team" ? "сборные" : "клубы"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {matches.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {matches.map((match, index) => {
                  const errors = matchErrors[match.local_id] || {};
                  return (
                    <div key={match.local_id} style={compactCardStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, fontWeight: 950, minWidth: 0, flex: "1 1 180px", lineHeight: 1.3, overflowWrap: "anywhere" }}>{index + 1}. {matchShort(match)}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <AdminButton size="sm" variant="secondary" onClick={() => moveMatch(match.local_id, -1)} disabled={index === 0}>↑</AdminButton>
                          <AdminButton size="sm" variant="secondary" onClick={() => moveMatch(match.local_id, 1)} disabled={index === matches.length - 1}>↓</AdminButton>
                          <AdminButton size="sm" variant="danger" onClick={() => setMatches((prev) => prev.filter((item) => item.local_id !== match.local_id))}>Удалить</AdminButton>
                        </div>
                      </div>
                      <div style={responsiveGridStyle}>
                        <label style={inputLabelStyle}>Турнир<AdminInput value={match.tournament_code} onChange={(event) => updateMatch(match.local_id, { tournament_code: event.target.value })} placeholder="PL / WCQ" /></label>
                        <label style={inputLabelStyle}>Команда 1
                          <AdminInput value={match.home_team_name} onChange={(event) => updateMatch(match.local_id, { home_team_name: event.target.value })} />
                          {errors.home_team_name && <span style={fieldErrorStyle}>{errors.home_team_name}</span>}
                        </label>
                        <label style={inputLabelStyle}>Команда 2
                          <AdminInput value={match.away_team_name} onChange={(event) => updateMatch(match.local_id, { away_team_name: event.target.value })} />
                          {errors.away_team_name && <span style={fieldErrorStyle}>{errors.away_team_name}</span>}
                        </label>
                        <label style={inputLabelStyle}>Дата и время<AdminInput type="datetime-local" value={match.kickoff_at} onChange={(event) => updateMatch(match.local_id, { kickoff_at: event.target.value })} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <AdminButton variant="secondary" onClick={() => setMatches((prev) => [...prev, createEmptyMatch(competitionMode)])}>Добавить матч вручную</AdminButton>
              <AdminButton onClick={saveMatches} disabled={saving === "matches"} className="flex-1">{saving === "matches" ? "Сохраняю..." : "Сохранить пул матчей"}</AdminButton>
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Дополнительно → ручной JSON пула</summary>
              <textarea value={matchesJson} onChange={(event) => setMatchesJson(event.target.value)} style={{ ...textareaStyle, marginTop: 8 }} />
              <AdminButton onClick={saveMatchesFromJson} disabled={saving === "matches-json"} variant="secondary" className="w-full mt-2">{saving === "matches-json" ? "Сохраняю..." : "Сохранить JSON матчей"}</AdminButton>
            </details>
          </AdminCollapsibleSection>

          {/* Step 3 — five question cards */}
          <AdminCollapsibleSection
            title="3. Вопросы"
            description={questionEditError ? "структура заблокирована" : `${activeQuestionCount}/5 активных`}
            defaultOpen={activeQuestionCount < 5}
            forceOpen={questionEditError !== "" || structuralLocked}
            keepMounted
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:questions`}
          >
            {structuralLocked && (
              <div data-testid="weekly-admin-lock-reason" style={{ padding: "10px 12px", borderRadius: 10, background: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #d98a1a 28%, transparent)", color: "color-mix(in srgb, #d98a1a 84%, var(--tg-text))", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45, marginBottom: 10 }}>
                <b>Структура вопросов заблокирована.</b> Есть участие пользователей. Можно менять только название и описание.
              </div>
            )}
            {questionEditError && (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #e5484d 28%, transparent)", color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45, marginBottom: 10 }}>{questionEditError}</div>
            )}
            <div style={{ display: "grid", gap: 12 }}>
              {questions.map((question) => (
                <QuestionCardEditor
                  key={question.key}
                  question={question}
                  mode={competitionMode}
                  locked={structuralLocked}
                  matchOptions={matchOptions}
                  leagueOptions={leagueOptions}
                  issues={questionIssues[question.key] || []}
                  builtOptions={(formQuestionPayload.find((p) => p.question_key === question.key)?.options || []) as WeeklyChallengeOption[]}
                  onPatch={(patch) => patchQuestion(question.key, patch)}
                  onChangeTemplate={(tk) => changeTemplate(question.key, tk)}
                  onResetTitle={() => resetTitle(question.key)}
                />
              ))}
            </div>
            <AdminButton onClick={saveQuestions} disabled={saving === "questions"} className="w-full mt-3">{saving === "questions" ? "Сохраняю..." : "Сохранить 5 вопросов"}</AdminButton>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Дополнительно → ручной JSON вопросов</summary>
              <textarea value={questionsJson} onChange={(event) => setQuestionsJson(event.target.value)} style={{ ...textareaStyle, marginTop: 8 }} />
              <AdminButton onClick={saveQuestionsFromJson} disabled={saving === "questions-json"} variant="secondary" className="w-full mt-2">{saving === "questions-json" ? "Сохраняю..." : "Сохранить JSON вопросов"}</AdminButton>
            </details>
          </AdminCollapsibleSection>

          {/* Step 4 — bonus question */}
          {taskSchemaVersion >= 2 && (
            <AdminCollapsibleSection
              title="4. Бонусный вопрос"
              description={taskConfigLocked ? "заблокирован" : bonusDirty ? "есть несохранённые изменения" : bonusQuestionReady ? "выбран и сохранён" : "выберите активный заполненный вопрос"}
              keepMounted
              storageKey={`admin:weekly-challenge:${detail.challenge.id}:bonus`}
            >
              {taskConfigLocked ? (
                <div data-testid="weekly-admin-bonus-lock" style={{ padding: "11px 13px", borderRadius: 10, background: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #d98a1a 28%, transparent)", color: "color-mix(in srgb, #d98a1a 86%, var(--tg-text))", fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>
                  <b>Бонусный вопрос заблокирован.</b><br />
                  После публикации вызова или появления ответов игроков бонусный вопрос изменить нельзя.<br />
                  Выбран: <b>{weeklyQuestionDisplayCategory(BONUS_KEY_TO_QUESTION[bonusQuestionKey])}</b> · награда {BONUS_REWARD_LABEL[bonusQuestionKey]}
                </div>
              ) : (
                <>
                  {bonusDirty && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#d98a1a" }}>● Есть несохранённые изменения — нажмите «Сохранить настройки».</div>}
                  {bonusSaved && !bonusDirty && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 800, color: "#2ec060" }}>✓ Бонус сохранён.</div>}
                  <div data-testid="weekly-admin-bonus-section" role="radiogroup" aria-label="Бонусный вопрос" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
                    {(["match", "league", "duel", "upset", "event"] as const).map((bk) => {
                      const targetKey = BONUS_KEY_TO_QUESTION[bk];
                      const q = questions.find((item) => item.key === targetKey);
                      const reason = q?.status !== "active" ? "Вопрос отключён" : (questionIssues[targetKey] || []).length > 0 ? "Сначала настройте вопрос" : null;
                      const ready = !reason;
                      const selected = bonusQuestionKey === bk;
                      return (
                        <button
                          key={bk}
                          type="button"
                          data-testid={`weekly-admin-bonus-card-${bk}`}
                          role="radio"
                          aria-checked={selected}
                          disabled={!ready}
                          onClick={() => setBonusQuestionKey(bk)}
                          style={{
                            textAlign: "left",
                            border: selected ? `2px solid ${WC_BONUS_ACCENT}` : "1px solid var(--tg-separator, rgba(128,128,128,0.28))",
                            borderRadius: 10,
                            padding: 11,
                            minHeight: 44,
                            background: selected ? `color-mix(in srgb, ${WC_BONUS_ACCENT} 14%, var(--tg-bg))` : "var(--tg-bg, rgba(255,255,255,0.06))",
                            color: "var(--tg-text)",
                            cursor: ready ? "pointer" : "not-allowed",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 950 }}>{weeklyQuestionDisplayCategory(targetKey)}</span>
                            <span aria-hidden style={{ fontSize: 14, color: selected ? WC_BONUS_ACCENT : "var(--tg-hint)" }}>{selected ? "✓" : "○"}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 70%, var(--tg-hint))", marginTop: 3 }}>Награда {BONUS_REWARD_LABEL[bk]}</div>
                          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 4, color: selected ? WC_BONUS_ACCENT : ready ? "#2ec060" : "#e5484d" }}>
                            {selected ? "Выбран бонусом" : ready ? "Доступен" : reason}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </AdminCollapsibleSection>
          )}

          {/* Step 5 — preview + activation */}
          <AdminCollapsibleSection
            title="5. Предпросмотр и активация"
            description="как увидит игрок + чек-лист"
            keepMounted
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:preview`}
          >
            <div style={{ ...compactCardStyle, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 8 }}>Чек-лист активации</div>
              <div style={{ display: "grid", gap: 5 }}>
                {activationChecklist.map((item) => (
                  <div key={item.label} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, fontWeight: 800 }}>
                    <span style={{ color: item.ok ? "#2ec060" : "#e5484d" }}>{item.ok ? "✓" : "✗"}</span>
                    <span style={{ color: item.ok ? "var(--tg-text)" : "#e5484d" }}>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div data-testid="weekly-admin-preview" style={{ ...compactCardStyle, background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 950, overflowWrap: "anywhere" }}>{title || "Вызов недели"}</div>
                  <div style={helperTextStyle}>{competitionMode !== "unspecified" ? WEEKLY_COMPETITION_MODE_LABEL[competitionMode] : "режим не задан"}{deadlineAt ? ` · дедлайн ${deadlineAt.replace("T", " ")}` : ""}</div>
                </div>
                <AdminBadge variant="default">0/{previewQuestions.length || 5}</AdminBadge>
              </div>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {previewQuestions.length === 0 && <div style={helperTextStyle}>Заполните 5 вопросов.</div>}
                {previewQuestions.map((question) => (
                  <div key={question.question_key} style={{ borderTop: "1px solid var(--tg-separator, rgba(128,128,128,0.16))", paddingTop: 10 }}>
                    <div style={{ fontSize: 13, color: "var(--tg-hint, #999)", fontWeight: 900 }}>{weeklyQuestionDisplayCategory(question.question_key)}</div>
                    <div style={{ marginTop: 3, fontSize: 15, fontWeight: 950, overflowWrap: "anywhere" }}>{question.title}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {(question.options || []).map((option) => (
                        <span key={String(option.id)} style={{ display: "inline-flex", minHeight: 30, alignItems: "center", borderRadius: 8, padding: "5px 9px", background: "var(--tg-bg, rgba(255,255,255,0.08))", fontSize: 12, fontWeight: 850, maxWidth: "100%", overflowWrap: "anywhere" }}>{option.label}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </AdminCollapsibleSection>

          {/* Editable per-challenge task rewards (V2) */}
          {taskSchemaVersion >= 2 && (
            <AdminCollapsibleSection
              title="Награды за задания"
              description="настраиваются для этого вызова"
              keepMounted
              storageKey={`admin:weekly-challenge:${detail.challenge.id}:rewards`}
            >
              <WeeklyChallengeRewardsEditor fetchWithAuth={fetchWithAuth} challengeId={detail.challenge.id} />
            </AdminCollapsibleSection>
          )}

          {/* Official answers + recalc */}
          <AdminCollapsibleSection
            title="Официальные ответы и пересчёт"
            description={status === "completed" ? "подведение итогов недели" : "официальные ответы и ручной пересчёт"}
            defaultOpen={status === "completed"}
            keepMounted
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:official-answers`}
          >
            <WeeklyChallengeOfficialAnswers fetchWithAuth={fetchWithAuth} challengeId={detail.challenge.id} />
          </AdminCollapsibleSection>

          {/* Danger zone — permanent delete (backend enforces eligibility) */}
          <AdminCollapsibleSection
            title="Опасная зона"
            description="удаление вызова"
            storageKey={`admin:weekly-challenge:${detail.challenge.id}:danger`}
          >
            <div data-testid="weekly-admin-danger-zone" style={{ borderRadius: 10, border: "1px solid color-mix(in srgb, #e5484d 30%, transparent)", background: "color-mix(in srgb, #e5484d 7%, var(--tg-bg))", padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 950, color: "color-mix(in srgb, #e5484d 86%, var(--tg-text))" }}>Удаление вызова</div>
              {detail.deletion?.deletable ? (
                <>
                  <div style={{ ...helperTextStyle, marginTop: 4 }}>
                    Будут безвозвратно удалены сам вызов, его вопросы, пул матчей и настройки. Это действие нельзя отменить.
                  </div>
                  <AdminButton data-testid="weekly-admin-delete-open" variant="danger" onClick={() => { setDeleteConfirmText(""); setShowDeleteConfirm(true); }} className="mt-3">
                    Удалить вызов
                  </AdminButton>
                </>
              ) : (
                <div data-testid="weekly-admin-delete-blocked" style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--tg-hint)" }}>Удаление недоступно</div>
                  <div style={{ ...helperTextStyle, marginTop: 2 }}>
                    {detail.deletion?.error ? (WEEKLY_DELETE_REASON[detail.deletion.error] || "Удаление недоступно для этого вызова.") : "Удаление недоступно для этого вызова."}
                  </div>
                </div>
              )}
            </div>
          </AdminCollapsibleSection>
        </>
      )}

      {showDeleteConfirm && detail && (
        <div role="dialog" aria-modal="true" data-testid="weekly-admin-delete-dialog" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.55)" }} onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", borderRadius: 16, padding: 16, background: "var(--tg-bg, #1c1c1e)", border: "1px solid var(--tg-separator, rgba(128,128,128,0.25))", boxShadow: "0 18px 50px rgba(0,0,0,0.4)" }}>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Удалить «{detail.challenge.title}»?</div>
            <div style={{ ...helperTextStyle, marginTop: 6 }}>
              Будут безвозвратно удалены сам вызов, его вопросы, пул матчей и настройки. Это действие нельзя отменить.
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 3, fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>
              <div>Статус: {weeklyStatusLabel(status)}</div>
              <div>Матчей: {detail.match_pool.length} · Вопросов: {detail.questions.length}</div>
              <div>Ответов игроков: {detail.deletion?.counts.entries ?? 0} · Выданных наград: {detail.deletion?.counts.rewards ?? 0}</div>
            </div>
            <label style={{ ...inputLabelStyle, marginTop: 12 }}>
              Введите УДАЛИТЬ для подтверждения
              <AdminInput data-testid="weekly-admin-delete-confirm-input" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="УДАЛИТЬ" />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <AdminButton variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="flex-1">Отмена</AdminButton>
              <AdminButton data-testid="weekly-admin-delete-confirm" variant="danger" onClick={deleteChallenge} disabled={deleting || deleteConfirmText.trim() !== "УДАЛИТЬ"} className="flex-1">
                {deleting ? "Удаляю…" : "Удалить безвозвратно"}
              </AdminButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-question card editor ─────────────────────────────────────────────────
function QuestionCardEditor({
  question,
  mode,
  locked,
  matchOptions,
  leagueOptions,
  issues,
  builtOptions,
  onPatch,
  onChangeTemplate,
  onResetTitle,
}: {
  question: QuestionDraft;
  mode: WeeklyResolvedMode;
  locked: boolean;
  matchOptions: Array<{ ref: string; label: string }>;
  leagueOptions: Array<{ code: string; label: string }>;
  issues: string[];
  builtOptions: WeeklyChallengeOption[];
  onPatch: (patch: Partial<QuestionDraft>) => void;
  onChangeTemplate: (templateKey: string) => void;
  onResetTitle: () => void;
}) {
  const templates: WeeklyQuestionTemplate[] = listWeeklyTemplatesForMode(question.key, mode);
  const tone = question.status !== "active"
    ? STATUS_TONE.disabled
    : question.legacy
      ? STATUS_TONE.draft
      : issues.length > 0
        ? STATUS_TONE.error
        : STATUS_TONE.ok;

  return (
    <div style={{ ...compactCardStyle, borderLeft: `3px solid ${tone.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 950 }}>{weeklyQuestionDisplayCategory(question.key)}</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: tone.color }}>{question.legacy ? "Custom / Legacy" : tone.label}</div>
        </div>
        <select value={question.status} disabled={locked} onChange={(event) => onPatch({ status: event.target.value as WeeklyChallengeQuestionStatus })} style={{ ...selectStyle, width: 140, opacity: locked ? 0.6 : 1 }}>
          <option value="active">Активен</option>
          <option value="disabled">Отключён</option>
          <option value="void">Аннулирован</option>
        </select>
      </div>

      {question.legacy ? (
        <div style={helperTextStyle}>
          Старый вопрос без шаблона. Структура сохранена как есть; редактируйте через «Дополнительно → ручной JSON вопросов».
          Можно сменить на шаблон ниже (это перезапишет варианты после подтверждения сохранения).
        </div>
      ) : null}

      <label style={{ ...inputLabelStyle, marginTop: 10 }}>Шаблон
        <select data-testid={`weekly-admin-template-${question.key}`} value={question.templateKey} disabled={locked} onChange={(event) => onChangeTemplate(event.target.value)} style={{ ...selectStyle, opacity: locked ? 0.6 : 1 }}>
          {question.legacy && <option value="">Custom / Legacy</option>}
          {templates.map((t) => <option key={t.templateKey} value={t.templateKey}>{t.title}</option>)}
        </select>
      </label>

      <div style={{ ...responsiveGridStyle, marginTop: 10 }}>
        <label style={inputLabelStyle}>Заголовок вопроса
          <AdminInput value={question.title} onChange={(event) => onPatch({ title: event.target.value, titleDirty: true })} />
        </label>
        <label style={inputLabelStyle}>Описание
          <AdminInput value={question.description} onChange={(event) => onPatch({ description: event.target.value })} />
        </label>
      </div>
      {!question.legacy && (
        <div style={{ marginTop: 6 }}>
          <AdminButton size="sm" variant="ghost" disabled={locked} onClick={onResetTitle}>Вернуть стандартный текст</AdminButton>
        </div>
      )}

      {!question.legacy && (
        <QuestionTemplateForm question={question} locked={locked} matchOptions={matchOptions} leagueOptions={leagueOptions} onPatch={onPatch} />
      )}

      {builtOptions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Предпросмотр вариантов</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {builtOptions.map((o) => <span key={String(o.id)} style={{ display: "inline-flex", minHeight: 26, alignItems: "center", borderRadius: 8, padding: "3px 8px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.12))", fontSize: 12, fontWeight: 800 }}>{o.label}</span>)}
          </div>
        </div>
      )}

      {issues.length > 0 && question.status === "active" && (
        <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
          {issues.map((m) => <div key={m} style={fieldErrorStyle}>• {m}</div>)}
        </div>
      )}
    </div>
  );
}

// ── Template-specific dynamic form ───────────────────────────────────────────
function QuestionTemplateForm({
  question,
  locked,
  matchOptions,
  leagueOptions,
  onPatch,
}: {
  question: QuestionDraft;
  locked: boolean;
  matchOptions: Array<{ ref: string; label: string }>;
  leagueOptions: Array<{ code: string; label: string }>;
  onPatch: (patch: Partial<QuestionDraft>) => void;
}) {
  const dis = locked;

  if (question.key === "match_of_week") {
    return (
      <label style={{ ...inputLabelStyle, marginTop: 10 }}>Матч из пула
        <select value={question.matchRef} disabled={dis} onChange={(e) => onPatch({ matchRef: e.target.value })} style={{ ...selectStyle, opacity: dis ? 0.6 : 1 }}>
          <option value="">Не выбран</option>
          {matchOptions.map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
        </select>
      </label>
    );
  }

  if (question.key === "league_of_week") {
    const tk = question.templateKey;
    const scopeSelector = (
      <label style={inputLabelStyle}>Охват
        <select value={question.scopeType} disabled={dis} onChange={(e) => onPatch({ scopeType: e.target.value as "all_pool" | "selected" })} style={selectStyle}>
          <option value="all_pool">Весь пул матчей</option>
          <option value="selected">Выбранные матчи</option>
        </select>
      </label>
    );
    const scopeChecklist = question.scopeType === "selected" ? (
      <div style={{ display: "grid", gap: 4 }}>
        {matchOptions.map((m) => (
          <label key={m.ref} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
            <input type="checkbox" disabled={dis} checked={question.scopeRefs.includes(m.ref)} onChange={(e) => {
              const refs = e.target.checked ? [...question.scopeRefs, m.ref] : question.scopeRefs.filter((r) => r !== m.ref);
              onPatch({ scopeRefs: refs });
            }} />
            {m.label}
          </label>
        ))}
      </div>
    ) : null;

    if (tk === "pool_total_goals_bucket") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
          {scopeSelector}{scopeChecklist}
          <label style={inputLabelStyle}>Границы бакетов по голам (через запятую)
            <AdminInput value={question.goalsBuckets.join(", ")} disabled={dis}
              onChange={(e) => onPatch({ goalsBuckets: e.target.value.split(",").map((s) => Math.floor(Number(s.trim()))).filter((n) => Number.isFinite(n) && n > 0) })}
              placeholder="10, 16" />
          </label>
          <div style={helperTextStyle}>Например «10, 16» → «Меньше 10», «10–15», «16+». Пусто → значения по умолчанию.</div>
        </div>
      );
    }
    if (tk === "pool_big_wins_count" || tk === "pool_btts_count" || tk === "pool_clean_sheets_count") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
          {scopeSelector}{scopeChecklist}
          <label style={inputLabelStyle}>Максимальный бакет счётчика
            <select value={String(question.countMax)} disabled={dis} onChange={(e) => onPatch({ countMax: Math.floor(Number(e.target.value)) || 3 })} style={selectStyle}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{`0…${n - 1} и ${n}+`}</option>)}
            </select>
          </label>
          <div style={helperTextStyle}>Например 3 → варианты 0 / 1 / 2 / 3+.</div>
        </div>
      );
    }
    if (tk === "pool_top_scoring_match") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 8, opacity: dis ? 0.6 : 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Матчи-кандидаты (минимум 2)</div>
          <div style={{ display: "grid", gap: 4 }}>
            {matchOptions.map((m) => (
              <label key={m.ref} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                <input type="checkbox" disabled={dis} checked={question.scopeRefs.includes(m.ref)} onChange={(e) => {
                  const refs = e.target.checked ? [...question.scopeRefs, m.ref] : question.scopeRefs.filter((r) => r !== m.ref);
                  onPatch({ scopeRefs: refs, scopeType: "selected" });
                }} />
                {m.label}
              </label>
            ))}
          </div>
          <div style={helperTextStyle}>Каждый отмеченный матч станет вариантом ответа. «Равенство» добавляется автоматически.</div>
        </div>
      );
    }
    if (tk === "pool_outcome_balance") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
          {scopeSelector}{scopeChecklist}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 850 }}>
            <input type="checkbox" disabled={dis} checked={question.includeDraws} onChange={(e) => onPatch({ includeDraws: e.target.checked })} />
            Добавить отдельный вариант «Больше ничьих»
          </label>
          <div style={helperTextStyle}>Базовые варианты: больше побед хозяев / гостей / поровну.</div>
        </div>
      );
    }
    if (tk === "pool_biggest_margin") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
          {scopeSelector}{scopeChecklist}
          <div style={helperTextStyle}>Берётся максимальная разница мячей среди матчей охвата. Варианты: не больше 1 / 2 / 3 / 4+.</div>
        </div>
      );
    }
    if (tk === "league_top_scoring" || tk === "league_most_home_wins") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 8, opacity: dis ? 0.6 : 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Лиги для сравнения (минимум 2)</div>
          {leagueOptions.length < 2 ? (
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#d98a1a" }}>▲ В пуле меньше двух турниров (tournament_code). Добавьте матчи из разных лиг.</div>
          ) : (
            <div style={{ display: "grid", gap: 4 }}>
              {leagueOptions.map((l) => (
                <label key={l.code} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                  <input type="checkbox" disabled={dis} checked={question.leagueCodes.includes(l.code)} onChange={(e) => {
                    const codes = e.target.checked ? [...question.leagueCodes, l.code] : question.leagueCodes.filter((c) => c !== l.code);
                    onPatch({ leagueCodes: codes });
                  }} />
                  {l.label}
                </label>
              ))}
            </div>
          )}
          <div style={helperTextStyle}>Лиги берутся из tournament_code матчей пула. «Равенство» добавляется автоматически.</div>
        </div>
      );
    }
    return (
      <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Группы матчей (2–5)</div>
        {question.groups.map((g, gi) => (
          <div key={g.local_id} style={{ ...compactCardStyle, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <AdminInput value={g.title} disabled={dis} placeholder={`Группа ${gi + 1}`} onChange={(e) => onPatch({ groups: question.groups.map((x) => x.local_id === g.local_id ? { ...x, title: e.target.value } : x) })} />
              <AdminButton size="sm" variant="danger" disabled={dis || question.groups.length <= 2} onClick={() => onPatch({ groups: question.groups.filter((x) => x.local_id !== g.local_id) })}>Удалить</AdminButton>
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              {matchOptions.map((m) => (
                <label key={m.ref} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                  <input type="checkbox" disabled={dis} checked={g.matchRefs.includes(m.ref)} onChange={(e) => {
                    const refs = e.target.checked ? [...g.matchRefs, m.ref] : g.matchRefs.filter((r) => r !== m.ref);
                    onPatch({ groups: question.groups.map((x) => x.local_id === g.local_id ? { ...x, matchRefs: refs } : x) });
                  }} />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
        ))}
        <AdminButton variant="secondary" disabled={dis || question.groups.length >= 5} onClick={() => onPatch({ groups: [...question.groups, createGroup(`Группа ${question.groups.length + 1}`)] })}>Добавить группу</AdminButton>
        <div style={helperTextStyle}>Вариант «Равенство» добавляется автоматически. Используйте понятные названия: Европа, Южная Америка, АПЛ, Ла Лига, Группа A.</div>
        {(() => {
          const usedRefs = new Set(question.groups.flatMap((g) => g.matchRefs));
          const notInGroups = matchOptions.filter((m) => !usedRefs.has(m.ref));
          const genericTitles = question.groups.filter((g) => isGenericGroupTitle(g.title));
          const covered = matchOptions.length - notInGroups.length;
          return (
            <div data-testid="weekly-admin-group-coverage" style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: notInGroups.length === 0 ? "#2ec060" : "#d98a1a" }}>
                {notInGroups.length === 0 ? "✓" : "▲"} В Раскладе участвуют: {covered} из {matchOptions.length} матчей
              </div>
              {notInGroups.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint, #999)" }}>
                  Не участвует: {notInGroups.map((m) => m.label.replace(/^\d+\.\s*/, "")).join("; ")}
                </div>
              )}
              {genericTitles.length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#d98a1a" }}>
                  Название группы слишком общее ({genericTitles.map((g) => g.title).join(", ")}). Игрокам будет сложнее понять вопрос.
                </div>
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  if (question.key === "duel_of_week") {
    return (
      <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
        {(["A", "B"] as const).map((side) => {
          const isA = side === "A";
          const kind = isA ? question.duelAKind : question.duelBKind;
          const name = isA ? question.duelAName : question.duelBName;
          const team = isA ? question.duelATeam : question.duelBTeam;
          const ref = isA ? question.duelAMatchRef : question.duelBMatchRef;
          const patch = (p: Partial<QuestionDraft>) => onPatch(p);
          return (
            <div key={side} style={{ ...compactCardStyle, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 950, marginBottom: 8 }}>Сторона {side}</div>
              <div style={responsiveGridStyle}>
                <label style={inputLabelStyle}>Тип
                  <select value={kind} disabled={dis} onChange={(e) => patch(isA ? { duelAKind: e.target.value as "player" | "team" } : { duelBKind: e.target.value as "player" | "team" })} style={selectStyle}>
                    <option value="player">Игрок</option>
                    <option value="team">Команда / сборная</option>
                  </select>
                </label>
                {kind === "player" && <label style={inputLabelStyle}>Имя игрока<AdminInput value={name} disabled={dis} onChange={(e) => patch(isA ? { duelAName: e.target.value } : { duelBName: e.target.value })} /></label>}
                <label style={inputLabelStyle}>{kind === "team" ? "Команда / сборная" : "Команда игрока"}<AdminInput value={team} disabled={dis} onChange={(e) => patch(isA ? { duelATeam: e.target.value } : { duelBTeam: e.target.value })} /></label>
                <label style={inputLabelStyle}>Матч
                  <select value={ref} disabled={dis} onChange={(e) => patch(isA ? { duelAMatchRef: e.target.value } : { duelBMatchRef: e.target.value })} style={selectStyle}>
                    <option value="">Без матча</option>
                    {matchOptions.map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
        {question.templateKey === "team_conceded_duel" ? (
          <div style={helperTextStyle}>Побеждает команда, пропустившая меньше за неделю. Обе стороны — команды.</div>
        ) : (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 850 }}>
            <input type="checkbox" disabled={dis} checked={question.duelVoidIfNoMinutes} onChange={(e) => onPatch({ duelVoidIfNoMinutes: e.target.checked })} />
            Аннулировать, если игрок не сыграл ни минуты
          </label>
        )}
      </div>
    );
  }

  if (question.key === "upset_of_week") {
    if (question.templateKey === "upset_count") {
      return (
        <div style={{ marginTop: 10, display: "grid", gap: 8, opacity: dis ? 0.6 : 1 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Матчи и их фавориты</div>
          {question.upsetCountMatches.map((m) => (
            <div key={m.local_id} style={{ ...responsiveGridStyle, alignItems: "end" }}>
              <label style={inputLabelStyle}>Матч
                <select value={m.match_ref} disabled={dis} onChange={(e) => onPatch({ upsetCountMatches: question.upsetCountMatches.map((x) => x.local_id === m.local_id ? { ...x, match_ref: e.target.value } : x) })} style={selectStyle}>
                  <option value="">Выбрать</option>
                  {matchOptions.map((mo) => <option key={mo.ref} value={mo.ref}>{mo.label}</option>)}
                </select>
              </label>
              <label style={inputLabelStyle}>Фаворит
                <select value={m.favorite_side} disabled={dis} onChange={(e) => onPatch({ upsetCountMatches: question.upsetCountMatches.map((x) => x.local_id === m.local_id ? { ...x, favorite_side: e.target.value as "home" | "away" } : x) })} style={selectStyle}>
                  <option value="home">Хозяева</option>
                  <option value="away">Гости</option>
                </select>
              </label>
              <AdminButton size="sm" variant="danger" disabled={dis} onClick={() => onPatch({ upsetCountMatches: question.upsetCountMatches.filter((x) => x.local_id !== m.local_id) })}>Удалить</AdminButton>
            </div>
          ))}
          <AdminButton variant="secondary" disabled={dis} onClick={() => onPatch({ upsetCountMatches: [...question.upsetCountMatches, { local_id: uid("upc"), match_ref: "", favorite_side: "home" }] })}>Добавить матч</AdminButton>
          <div style={helperTextStyle}>Варианты ответа 0 / 1 / 2 / 3+ генерируются автоматически.</div>
        </div>
      );
    }
    return (
      <div style={{ marginTop: 10, display: "grid", gap: 8, opacity: dis ? 0.6 : 1 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>Кандидаты (2–5)</div>
        {question.upsetCandidates.map((c, i) => (
          <div key={c.local_id} style={{ ...compactCardStyle, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 950 }}>Вариант {i + 1}</div>
              <AdminButton size="sm" variant="danger" disabled={dis || question.upsetCandidates.length <= 2} onClick={() => onPatch({ upsetCandidates: question.upsetCandidates.filter((x) => x.local_id !== c.local_id) })}>Удалить</AdminButton>
            </div>
            <div style={responsiveGridStyle}>
              <label style={inputLabelStyle}>Команда / сборная<AdminInput value={c.team_name} disabled={dis} onChange={(e) => onPatch({ upsetCandidates: question.upsetCandidates.map((x) => x.local_id === c.local_id ? { ...x, team_name: e.target.value } : x) })} /></label>
              <label style={inputLabelStyle}>Соперник<AdminInput value={c.opponent_name} disabled={dis} onChange={(e) => onPatch({ upsetCandidates: question.upsetCandidates.map((x) => x.local_id === c.local_id ? { ...x, opponent_name: e.target.value } : x) })} /></label>
              <label style={inputLabelStyle}>Матч
                <select value={c.match_ref} disabled={dis} onChange={(e) => onPatch({ upsetCandidates: question.upsetCandidates.map((x) => x.local_id === c.local_id ? { ...x, match_ref: e.target.value } : x) })} style={selectStyle}>
                  <option value="">Без матча</option>
                  {matchOptions.map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
                </select>
              </label>
              <label style={inputLabelStyle}>Подпись (опц.)<AdminInput value={c.label} disabled={dis} onChange={(e) => onPatch({ upsetCandidates: question.upsetCandidates.map((x) => x.local_id === c.local_id ? { ...x, label: e.target.value } : x) })} placeholder="Авто, если пусто" /></label>
            </div>
          </div>
        ))}
        <AdminButton variant="secondary" disabled={dis || question.upsetCandidates.length >= 5} onClick={() => onPatch({ upsetCandidates: [...question.upsetCandidates, createUpsetCandidate()] })}>Добавить кандидата</AdminButton>
        <div style={helperTextStyle}>Запасной вариант (Сенсаций не будет / Все фавориты победят) добавляется автоматически.</div>
      </div>
    );
  }

  // event_of_week
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10, opacity: dis ? 0.6 : 1 }}>
      <label style={inputLabelStyle}>Охват
        <select value={question.scopeType} disabled={dis} onChange={(e) => onPatch({ scopeType: e.target.value as "all_pool" | "selected" })} style={selectStyle}>
          <option value="all_pool">Весь пул матчей</option>
          <option value="selected">Выбранные матчи</option>
        </select>
      </label>
      {question.scopeType === "selected" && (
        <div style={{ display: "grid", gap: 4 }}>
          {matchOptions.map((m) => (
            <label key={m.ref} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
              <input type="checkbox" disabled={dis} checked={question.scopeRefs.includes(m.ref)} onChange={(e) => {
                const refs = e.target.checked ? [...question.scopeRefs, m.ref] : question.scopeRefs.filter((r) => r !== m.ref);
                onPatch({ scopeRefs: refs });
              }} />
              {m.label}
            </label>
          ))}
        </div>
      )}
      <div style={helperTextStyle}>Варианты ответа генерируются шаблоном автоматически.</div>
    </div>
  );
}
