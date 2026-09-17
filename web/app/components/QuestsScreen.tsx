"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { CaseOpeningAnimation } from "./shop/CaseOpeningAnimation";
import { PartnerTasksSection } from "./PartnerTasksSection";
import { SeasonPredictionTasksSection, SEASON_TASK_SECTION_SUBSECTION_KEYS } from "../season-predictions/components/SeasonPredictionTasksSection";
import { WeeklyChallengeTasksSection } from "../season-predictions/components/WeeklyChallengeTasksSection";
import { useWeeklyClaimableCount, useSeasonTaskClaimableCount, CountBadge } from "./ClaimableBadge";
import { AppIcon } from "./ui/AppIcon";
import { SegmentedControl } from "./ui/SegmentedControl";
import type { SeasonPredictionTaskNavigation } from "../season-predictions/types";
import {
    TaskCard,
    TaskSummaryCard,
    TaskSectionIntro,
    TaskEmptyCard,
    TaskStatusPill,
    TaskProgressBar,
    TaskActionButton,
    TASK_ACCENT,
    TASK_REWARD,
    TASK_SOFT_BORDER,
    type TaskStatusKind,
} from "./taskUiKit";
import { pluralRu } from "@/lib/plural";

type DailyQuest = {
    id: string;
    emoji: string;
    title: string;
    description: string;
    stars: number;
    scope?: "global" | "league";
    completed: boolean;
    completedAt: number | null;
};

type TelegramWindow = Window & {
    Telegram?: { WebApp?: { initData?: string } };
};

type IntlWithSegmenter = typeof Intl & {
    Segmenter: new (locale: string, options: { granularity: "grapheme" }) => {
        segment(input: string): Iterable<{ segment: string }>;
    };
};

type CaseOpenResponse = {
    ok?: boolean;
    error?: string;
    reward?: ({ type?: string; amount?: number } & Record<string, unknown>) | null;
};

type DailyQuestsResponse = {
    ok?: boolean;
    quests?: DailyQuest[];
    totalCompleted?: number;
    totalQuests?: number;
    caseEligibleQuests?: number;
    caseEarned?: boolean;
    caseAlreadyOpened?: boolean;
    unopenedCases?: number;
};

function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}

type WeeklyQuest = {
    id: string;
    scope: "global" | "league";
    rarity: "common" | "rare" | "epic";
    emoji: string;
    title: string;
    description: string;
    threshold: number;
    stars_reward: number;
    reward_balls?: number;
    unlocked: boolean;
    progress: number;
    finalized: boolean;
    ranking_based: boolean;
    scope_id?: string;
    scope_name?: string | null;
    status_note?: string | null;
};

type WeeklyMeta = {
    key: string;
    seasonId: number;
    startsAt: string;
    endsAt: string;
    resetAt: string;
    cutoffAt: string;
    resetLabel: string;
    activeDays: number;
    finalized: boolean;
};

type WeeklyBonusCase = {
    caseType: string;
    totalRequired: number;
    completedCount: number;
    earned: boolean;
    available: boolean;
    quantity: number;
};

type GroupedWeeklyLeagueQuest = WeeklyQuest & {
    scope_names: string[];
};

type WeeklyResponse = {
    week: WeeklyMeta;
    global: WeeklyQuest[];
    league: WeeklyQuest[];
    bonusCase: WeeklyBonusCase;
    isFallback?: boolean;
};

function getPrimaryEmoji(emojiStr: string) {
    if (!emojiStr) return "🎯";
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
        try {
            const segmenter = new (Intl as IntlWithSegmenter).Segmenter("en", { granularity: "grapheme" });
            const segments = [...segmenter.segment(emojiStr)];
            if (segments.length > 0) return segments[0].segment;
        } catch {
            // noop
        }
    }
    return Array.from(emojiStr)[0] || "🎯";
}

function getWeeklyQuestIcon(quest: WeeklyQuest) {
    if (quest.id === "league_top3_week") return <AppIcon name="rank_bronze" size={24} />;
    if (quest.id === "league_champion_week") return <AppIcon name="trophy" size={24} />;
    return getPrimaryEmoji(quest.emoji);
}

function getIsoWeekInfo(date = new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

function buildWeeklyFallbackData(): WeeklyResponse {
    const now = new Date();
    const { year, week } = getIsoWeekInfo(now);
    const monday = new Date(now);
    const day = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - day + 1);
    monday.setUTCHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    sunday.setUTCHours(23, 59, 59, 999);
    const nextMonday = new Date(sunday.getTime() + 1);
    const weekKey = `${year}-W${String(week).padStart(2, "0")}`;

    return {
        isFallback: true,
        week: {
            key: weekKey,
            seasonId: 0,
            startsAt: monday.toISOString(),
            endsAt: sunday.toISOString(),
            resetAt: nextMonday.toISOString(),
            cutoffAt: new Date(sunday.getTime() + 12 * 60 * 60 * 1000).toISOString(),
            resetLabel: "Сброс: понедельник, 03:00 МСК",
            activeDays: 0,
            finalized: false,
        },
        bonusCase: {
            caseType: "premium",
            totalRequired: 3,
            completedCount: 0,
            earned: false,
            available: false,
            quantity: 0,
        },
        global: [
            {
                id: "weekly_active_days_3",
                scope: "global",
                rarity: "rare",
                emoji: "📅",
                title: "На дистанции",
                description: "Сделай прогнозы в 3 игровых дня этой недели",
                threshold: 3,
                stars_reward: 8,
                unlocked: false,
                progress: 0,
                finalized: true,
                ranking_based: false,
                status_note: "Сброс: понедельник, 03:00 МСК",
            },
            {
                id: "weekly_points_days_3",
                scope: "global",
                rarity: "rare",
                emoji: "📈",
                title: "Ровная игра",
                description: "Набери очки в 3 игровых дня этой недели",
                threshold: 3,
                stars_reward: 8,
                unlocked: false,
                progress: 0,
                finalized: true,
                ranking_based: false,
                status_note: "Сброс: понедельник, 03:00 МСК",
            },
            {
                id: "global_double_exact_week",
                scope: "global",
                rarity: "epic",
                emoji: "🎯",
                title: "Точный дубль",
                description: "Угадай 2 точных счёта за неделю",
                threshold: 2,
                stars_reward: 12,
                unlocked: false,
                progress: 0,
                finalized: true,
                ranking_based: false,
                status_note: "Сброс: понедельник, 03:00 МСК",
            },
        ],
        league: [
            {
                id: "league_top3_week",
                scope: "league",
                rarity: "rare",
                emoji: "",
                title: "В тройке недели",
                description: "Заверши неделю в топ-3 своей лиги",
                threshold: 3,
                stars_reward: 14,
                unlocked: false,
                progress: 0,
                finalized: false,
                ranking_based: true,
                status_note: "Итог по завершении недели",
            },
            {
                id: "league_champion_week",
                scope: "league",
                rarity: "epic",
                emoji: "",
                title: "Чемпион недели",
                description: "Заверши неделю на 1 месте в своей лиге",
                threshold: 1,
                stars_reward: 20,
                unlocked: false,
                progress: 0,
                finalized: false,
                ranking_based: true,
                status_note: "Итог по завершении недели",
            },
        ],
    };
}

function normalizeWeeklyPayload(payload: unknown): WeeklyResponse {
    const fallback = buildWeeklyFallbackData();
    const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    if (!data || data.ok === false) return fallback;
    const rawGlobal = Array.isArray(data.global) ? data.global as WeeklyQuest[] : [];
    const rawLeague = Array.isArray(data.league) ? data.league as WeeklyQuest[] : [];
    if (rawGlobal.length === 0 && rawLeague.length === 0) return fallback;
    return {
        isFallback: false,
        week: data.week && typeof data.week === "object" ? { ...fallback.week, ...data.week as Partial<WeeklyMeta> } : fallback.week,
        bonusCase: data.bonusCase && typeof data.bonusCase === "object" ? { ...fallback.bonusCase, ...data.bonusCase as Partial<WeeklyBonusCase> } : fallback.bonusCase,
        global: rawGlobal,
        league: rawLeague,
    };
}

function getWeeklyQuestDescription(quest: WeeklyQuest): string {
    switch (quest.id) {
        case "weekly_active_days_3":
            return "Сделай прогнозы в 3 игровых дня этой недели";
        case "weekly_points_days_3":
            return "Набери очки в 3 игровых дня этой недели";
        case "global_double_exact_week":
            return "Угадай 2 точных счёта за неделю";
        case "league_top3_week":
            return "Заверши неделю в топ-3 своей лиги";
        case "league_champion_week":
            return "Заверши неделю на 1 месте в своей лиге";
        default:
            return quest.description;
    }
}

function weeklyQuestStatus(quest: WeeklyQuest): TaskStatusKind {
    if (quest.unlocked) return quest.ranking_based ? "received" : "completed";
    if (quest.ranking_based) return "future";
    return quest.progress > 0 ? "in_progress" : "available";
}

function formatCountdown(resetAt: string, nowMs: number): string {
    const diff = Math.max(0, new Date(resetAt).getTime() - nowMs);
    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days} д ${hours} ч`;
    if (hours > 0) return `${hours} ч ${minutes} мин`;
    return `${minutes} мин`;
}

function isLeagueDailyQuest(quest: DailyQuest) {
    return quest.scope === "league" || quest.id.startsWith("dq_league_");
}

function groupWeeklyLeagueQuests(quests: WeeklyQuest[]) {
    const grouped = new Map<string, GroupedWeeklyLeagueQuest>();

    for (const item of quests) {
        const existing = grouped.get(item.id);
        const scopeName = item.scope_name?.trim();
        if (!existing) {
            grouped.set(item.id, {
                ...item,
                scope_names: scopeName ? [scopeName] : [],
            });
            continue;
        }

        existing.unlocked = existing.unlocked || item.unlocked;
        existing.progress = Math.max(Number(existing.progress || 0), Number(item.progress || 0));
        existing.finalized = existing.finalized || item.finalized;
        existing.status_note = existing.status_note ?? item.status_note ?? null;
        if (scopeName && !existing.scope_names.includes(scopeName)) {
            existing.scope_names.push(scopeName);
        }
    }

    return [...grouped.values()];
}

function weeklyLeagueBadge(quest: WeeklyQuest): string | undefined {
    const names = (quest as GroupedWeeklyLeagueQuest).scope_names;
    if (Array.isArray(names)) {
        if (names.length > 1) return `${names.length} ${pluralRu(names.length, "лига", "лиги", "лиг")}`;
        return names[0] || quest.scope_name || undefined;
    }
    return quest.scope_name || undefined;
}

function LoadingState() {
    return <div style={{ textAlign: "center", padding: 40, color: "var(--tg-hint)" }}>Загрузка…</div>;
}

// Two-level navigation: a top segmented control (categories) + an optional
// lighter second row of sub-tabs. Both rows are CSS grids that always fit the
// viewport, so there is no horizontal overflow / clipped tabs.
type QuestTab = "daily" | "weekly" | "partner" | "season" | "weekly_challenge";
type QuestCategory = "basic" | "modes" | "partner";

const CATEGORY_OF_TAB: Record<QuestTab, QuestCategory> = {
    daily: "basic",
    weekly: "basic",
    season: "modes",
    weekly_challenge: "modes",
    partner: "partner",
};

// [tab, full label, optional short label]. The short label is shown only when
// the sub-tab row is too narrow to fit the full one (container query below).
const CATEGORY_TABS: Record<QuestCategory, ReadonlyArray<readonly [QuestTab, string, string?]>> = {
    basic: [["daily", "Ежедневные"], ["weekly", "Еженедельные"]],
    modes: [["season", "Прогнозы сезона", "Сезон"], ["weekly_challenge", "Вызов недели", "Вызов"]],
    partner: [["partner", "Партнёрские"]],
};

const CATEGORY_SEGMENTS: ReadonlyArray<readonly [QuestCategory, string]> = [
    ["basic", "Основные"],
    ["modes", "Режимы"],
    ["partner", "Партнёрские"],
];

// Subsection keys the admin visibility settings use for these tabs. A category
// disappears once every tab inside it is hidden.
export const TASK_TAB_SUBSECTION_KEY: Record<QuestTab, string> = {
    daily: "tasks.daily",
    weekly: "tasks.weekly",
    season: "tasks.season",
    weekly_challenge: "tasks.weekly_challenge",
    partner: "tasks.partner",
};
// Both levels in one list: the tabs themselves plus the task groups nested
// inside «Прогнозы сезона». The screen forwards the whole list downwards, and
// each level picks out the keys it owns.
export const TASK_SUBSECTION_KEYS = [
    ...Object.values(TASK_TAB_SUBSECTION_KEY),
    ...SEASON_TASK_SECTION_SUBSECTION_KEYS,
];

// TASK_ACCENT is var(--tg-button); active states are soft tints of it so they
// read natively in light and dark Telegram themes (no hardcoded orange/black).
// Category/sub-tab active visuals now live on the SegmentedControl pill below.

const weeklyStatTileStyle: CSSProperties = {
    padding: "9px 11px",
    borderRadius: 12,
    background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
    border: TASK_SOFT_BORDER,
};

const weeklyStatLabelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 650,
    color: "var(--tg-hint)",
};

const weeklyStatValueStyle: CSSProperties = {
    fontSize: 14,
    fontWeight: 900,
    color: "var(--tg-text)",
    marginTop: 2,
};

const weeklyCaseBlockStyle: CSSProperties = {
    marginTop: 10,
    padding: 11,
    borderRadius: 12,
    background: "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))",
    border: TASK_SOFT_BORDER,
};

function weeklyCasePillStyle(available: boolean): CSSProperties {
    return {
        flexShrink: 0,
        minHeight: 20,
        borderRadius: 999,
        padding: "0 9px",
        display: "inline-flex",
        alignItems: "center",
        background: available
            ? "color-mix(in srgb, #34c759 14%, var(--tg-bg))"
            : `color-mix(in srgb, ${TASK_ACCENT} 12%, var(--tg-bg))`,
        color: available ? "#34c759" : `color-mix(in srgb, ${TASK_ACCENT} 80%, var(--tg-text))`,
        border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
        fontSize: 11,
        fontWeight: 850,
        whiteSpace: "nowrap",
    };
}

export default function QuestsScreen({ onClose, onGoToShop, embedded = false, initialTab, requestTab, onOpenSeasonPredictions, onOpenWeeklyChallenge, onBalanceChange, hiddenSubsections }: { onClose: () => void; onGoToShop?: () => void; embedded?: boolean; initialTab?: "daily" | "weekly" | "partner" | "season" | "weekly_challenge"; requestTab?: { tab: "daily" | "weekly" | "partner" | "season" | "weekly_challenge"; token: number; seasonTarget?: { section: string; subsection: string } }; onOpenSeasonPredictions?: () => void; onOpenWeeklyChallenge?: () => void; onBalanceChange?: (balls: number) => void; hiddenSubsections?: string[] }) {
    const [activeTab, setActiveTab] = useState<QuestTab>(initialTab || "daily");
    // Remember the last sub-tab chosen inside each multi-tab category so that
    // switching back to that category restores the user's place.
    const [lastBasicTab, setLastBasicTab] = useState<QuestTab>(
        initialTab === "weekly" ? "weekly" : "daily",
    );
    const [lastModeTab, setLastModeTab] = useState<QuestTab>(
        initialTab === "weekly_challenge" ? "weekly_challenge" : "season",
    );
    // Admin-controlled tab visibility, resolved per category.
    const tabShown = (tab: QuestTab) => !hiddenSubsections?.includes(TASK_TAB_SUBSECTION_KEY[tab]);
    const visibleCategoryTabs: Record<QuestCategory, ReadonlyArray<readonly [QuestTab, string, string?]>> = {
        basic: CATEGORY_TABS.basic.filter(([tab]) => tabShown(tab)),
        modes: CATEGORY_TABS.modes.filter(([tab]) => tabShown(tab)),
        partner: CATEGORY_TABS.partner.filter(([tab]) => tabShown(tab)),
    };
    const visibleCategories = CATEGORY_SEGMENTS.filter(([category]) => visibleCategoryTabs[category].length > 0);
    const firstVisibleTab: QuestTab | null = visibleCategories.length
        ? visibleCategoryTabs[visibleCategories[0][0]][0][0]
        : null;
    const activeCategory = CATEGORY_OF_TAB[activeTab];
    // "Можно забрать" badge counts — Weekly Challenge + season-prediction tasks (E10.2).
    const weeklyClaimable = useWeeklyClaimableCount();
    const seasonClaimable = useSeasonTaskClaimableCount();

    // Allow the parent to switch the active tab on demand (e.g. the "Задания сезона →"
    // shortcut from Прогнозы сезона). Keyed by token so repeat requests re-apply.
    const requestToken = requestTab?.token ?? 0;
    const requestedTab = requestTab?.tab;
    useEffect(() => {
        if (requestToken > 0 && requestedTab) setActiveTab(requestedTab);
    }, [requestToken, requestedTab]);

    // Land on a visible tab when the active one (default or deep-link) is hidden.
    const hiddenKey = (hiddenSubsections || []).join(",");
    useEffect(() => {
        if (!firstVisibleTab) return;
        if (tabShown(activeTab)) return;
        setActiveTab(firstVisibleTab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hiddenKey, activeTab]);

    // Keep the per-category memory in sync with whatever tab is currently active
    // (covers direct navigation via initialTab / requestTab too).
    useEffect(() => {
        if (activeTab === "daily" || activeTab === "weekly") setLastBasicTab(activeTab);
        else if (activeTab === "season" || activeTab === "weekly_challenge") setLastModeTab(activeTab);
    }, [activeTab]);

    function selectCategory(category: QuestCategory) {
        const remembered = category === "basic" ? lastBasicTab : category === "modes" ? lastModeTab : "partner";
        // The remembered tab may have been hidden since — fall back to the first
        // tab still visible in that category.
        const tabs = visibleCategoryTabs[category];
        if (tabs.some(([tab]) => tab === remembered)) setActiveTab(remembered);
        else if (tabs.length > 0) setActiveTab(tabs[0][0]);
    }

    // Route season-mode task CTAs to the right top-level app section.
    const handleSeasonModeNav = (action: SeasonPredictionTaskNavigation) => {
        const goWeekly = action.type === "open_weekly_challenge" || (action.type === "switch_tab" && action.tab === "weekly-challenge");
        if (goWeekly) onOpenWeeklyChallenge?.();
        else onOpenSeasonPredictions?.();
    };
    const [dailyQuests, setDailyQuests] = useState<DailyQuest[]>([]);
    const [dailyLoading, setDailyLoading] = useState(true);
    const [totalCompleted, setTotalCompleted] = useState(0);
    const [totalQuests, setTotalQuests] = useState(7);
    const [caseEligibleQuests, setCaseEligibleQuests] = useState(7);
    const [caseEarned, setCaseEarned] = useState(false);
    const [caseAlreadyOpened, setCaseAlreadyOpened] = useState(false);
    const [unopenedCases, setUnopenedCases] = useState(0);
    const [weeklyData, setWeeklyData] = useState<WeeklyResponse | null>(null);
    const [weeklyLoading, setWeeklyLoading] = useState(true);
    const [weeklyLoadError, setWeeklyLoadError] = useState(false);
    const [casePhase, setCasePhase] = useState<"idle" | "opening" | "reveal">("idle");
    const [caseReward, setCaseReward] = useState<{ type: string; amount: number } | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const caseGuard = useRef(false);

    async function handleOpenDailyCase() {
        if (caseGuard.current) return;
        caseGuard.current = true;
        setCaseReward(null);
        setCasePhase("opening");

        const openId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `daily-${Date.now()}`;
        const initData = (window as TelegramWindow).Telegram?.WebApp?.initData || "";
        try {
            const res = await apiFetch<CaseOpenResponse>("/cases/open", {
                method: "POST",
                body: JSON.stringify({ initData, caseType: "daily_free", openId }),
            });
            if (!res?.ok) {
                alert(res?.error || "Ошибка");
                setCasePhase("idle");
                caseGuard.current = false;
                return;
            }

            setCaseAlreadyOpened(true);
            setUnopenedCases((prev) => Math.max(0, prev - 1));

            if (res.reward) {
                setCaseReward({ type: res.reward.type || "unknown", amount: Number(res.reward.amount || 0) });
                setCasePhase("reveal");
            } else {
                setCasePhase("idle");
            }
        } catch (e: unknown) {
            alert(errorMessage(e, "Ошибка"));
            setCasePhase("idle");
        } finally {
            caseGuard.current = false;
        }
    }

    useEffect(() => {
        let cancelled = false;

        const loadDaily = async () => {
            try {
                const daily = await apiFetch<DailyQuestsResponse>("/quests/daily");
                if (!cancelled && daily?.ok) {
                    setDailyQuests(daily.quests || []);
                    setTotalCompleted(daily.totalCompleted || 0);
                    setTotalQuests(daily.totalQuests || 7);
                    setCaseEligibleQuests(daily.caseEligibleQuests || 7);
                    setCaseEarned(daily.caseEarned || false);
                    setCaseAlreadyOpened(daily.caseAlreadyOpened || false);
                    setUnopenedCases(daily.unopenedCases || 0);
                }
            } catch (e) {
                console.error("daily quests load failed", e);
            } finally {
                if (!cancelled) setDailyLoading(false);
            }
        };

        const loadWeekly = async () => {
            try {
                const weekly = await apiFetch<unknown>("/quests/weekly");
                if (!cancelled) setWeeklyLoadError(false);
                if (!cancelled) setWeeklyData(normalizeWeeklyPayload(weekly));
            } catch (e) {
                console.error("weekly quests load failed", e);
                if (!cancelled) {
                    setWeeklyLoadError(true);
                    setWeeklyData(buildWeeklyFallbackData());
                }
            } finally {
                if (!cancelled) setWeeklyLoading(false);
            }
        };

        void loadDaily();
        void loadWeekly();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const dailyGlobalQuests = useMemo(
        () => dailyQuests.filter((quest) => !isLeagueDailyQuest(quest)),
        [dailyQuests]
    );
    const dailyLeagueQuests = useMemo(
        () => dailyQuests.filter((quest) => isLeagueDailyQuest(quest)),
        [dailyQuests]
    );
    const weeklyInstant = useMemo(() => {
        const global = (weeklyData?.global || []).filter((quest) => !quest.ranking_based);
        const league = groupWeeklyLeagueQuests((weeklyData?.league || []).filter((quest) => !quest.ranking_based));
        return [...global, ...league];
    }, [weeklyData]);
    const weeklyRanking = useMemo(() => {
        const global = (weeklyData?.global || []).filter((quest) => quest.ranking_based);
        const league = groupWeeklyLeagueQuests((weeklyData?.league || []).filter((quest) => quest.ranking_based));
        return [...global, ...league];
    }, [weeklyData]);
    const weeklyCountdown = useMemo(
        () => (weeklyData ? formatCountdown(weeklyData.week.resetAt, nowMs) : ""),
        [weeklyData, nowMs]
    );
    const weeklyBonusProgress = useMemo(() => {
        const total = Math.max(0, weeklyData?.bonusCase?.totalRequired || 0);
        const completed = Math.min(total, Math.max(0, weeklyData?.bonusCase?.completedCount || 0));
        return { total, completed, percent: total > 0 ? (completed / total) * 100 : 0 };
    }, [weeklyData]);

    return (
        <div
            style={{
                position: embedded ? "relative" : "fixed",
                inset: embedded ? undefined : 0,
                zIndex: embedded ? "auto" : 10000,
                background: embedded ? "transparent" : "var(--tg-secondary-bg)",
                color: "var(--tg-text)",
                display: "flex",
                flexDirection: "column",
                overflow: embedded ? "visible" : "hidden",
                minHeight: embedded ? undefined : "100vh",
            }}
        >
            <div
                style={{
                    padding: "10px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: embedded ? "none" : TASK_SOFT_BORDER,
                }}
            >
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 18, fontWeight: 800, color: "var(--tg-text)" }}>
                    <AppIcon name="quests" size={24} loading="eager" />
                    <span>Задания</span>
                </div>
                {embedded ? <div style={{ width: 32, height: 32 }} /> : <button
                    onClick={onClose}
                    style={{
                        background: "color-mix(in srgb, var(--tg-hint) 18%, transparent)",
                        border: "none",
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        color: "var(--tg-hint)",
                        fontSize: 18,
                        cursor: "pointer",
                    }}
                >
                    ×
                </button>}
            </div>

            <div style={{ background: "var(--tg-bg)", padding: "6px 16px 10px", display: firstVisibleTab ? undefined : "none" }}>
                {/* First level: category segmented control (always fits — 3 equal columns). */}
                <div style={{ display: visibleCategories.length > 1 ? undefined : "none" }}>
                <SegmentedControl
                    value={activeCategory}
                    onChange={selectCategory}
                    ariaLabel="Категории заданий"
                    trackStyle={{
                        gap: 4,
                        padding: 4,
                        borderRadius: 14,
                        background: "color-mix(in srgb, var(--tg-secondary-bg) 82%, var(--tg-bg))",
                        border: TASK_SOFT_BORDER,
                    }}
                    pillStyle={{
                        borderRadius: 11,
                        border: `1px solid color-mix(in srgb, ${TASK_ACCENT} 52%, var(--tg-hint))`,
                        background: `color-mix(in srgb, ${TASK_ACCENT} 20%, var(--tg-bg))`,
                    }}
                    itemStyle={(active) => ({
                        minHeight: 34,
                        gap: 6,
                        borderRadius: 11,
                        color: active ? TASK_ACCENT : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
                        fontWeight: active ? 900 : 800,
                        fontSize: 12.5,
                        whiteSpace: "nowrap",
                        transition: "color 180ms ease",
                    })}
                    items={visibleCategories.map(([category, label]) => ({
                        key: category,
                        testId: `quests-category-${category}`,
                        content: (
                            <>
                                {label}
                                <CountBadge count={category === "modes" ? weeklyClaimable + seasonClaimable : 0} />
                            </>
                        ),
                    }))}
                />
                </div>

                {/* Second level: sub-tabs, only when the category has more than one tab. */}
                {visibleCategoryTabs[activeCategory].length > 1 && (
                    <div className="qs-subtabs" style={{ marginTop: 8 }}>
                        <SegmentedControl
                            value={activeTab}
                            onChange={setActiveTab}
                            ariaLabel="Вкладки заданий"
                            trackStyle={{
                                gap: 6,
                                padding: 3,
                                borderRadius: 999,
                                background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
                                border: TASK_SOFT_BORDER,
                            }}
                            pillStyle={{
                                borderRadius: 999,
                                border: `1px solid color-mix(in srgb, ${TASK_ACCENT} 42%, var(--tg-hint))`,
                                background: `color-mix(in srgb, ${TASK_ACCENT} 14%, var(--tg-bg))`,
                            }}
                            itemStyle={(active) => ({
                                minHeight: 28,
                                gap: 6,
                                padding: "0 8px",
                                borderRadius: 999,
                                color: active ? TASK_ACCENT : "color-mix(in srgb, var(--tg-text) 56%, var(--tg-hint))",
                                fontWeight: active ? 850 : 720,
                                fontSize: 11.5,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                transition: "color 180ms ease",
                            })}
                            items={visibleCategoryTabs[activeCategory].map(([tab, label, shortLabel]) => ({
                                key: tab,
                                testId: `quests-tab-${tab}`,
                                content: (
                                    <>
                                        {shortLabel ? (
                                            <>
                                                <span className="qs-label-full">{label}</span>
                                                <span className="qs-label-short">{shortLabel}</span>
                                            </>
                                        ) : (
                                            label
                                        )}
                                        <CountBadge count={tab === "weekly_challenge" ? weeklyClaimable : tab === "season" ? seasonClaimable : 0} />
                                    </>
                                ),
                            }))}
                        />
                    </div>
                )}
                <style jsx>{`
                    .qs-subtabs {
                        container-type: inline-size;
                    }
                    /* Safe default: short labels always fit (and is the fallback
                       for browsers without container queries). */
                    .qs-label-full {
                        display: none;
                    }
                    .qs-label-short {
                        display: inline;
                    }
                    /* Enough room → show the full names. */
                    @container (min-width: 240px) {
                        .qs-label-full {
                            display: inline;
                        }
                        .qs-label-short {
                            display: none;
                        }
                    }
                `}</style>
            </div>

            <div style={{ flex: 1, overflowY: embedded ? "visible" : "auto", padding: "12px 16px" }}>
                {!firstVisibleTab && (
                    <div style={{ padding: 16, textAlign: "center", color: "var(--tg-hint)", fontSize: 13, fontWeight: 700 }}>
                        Подразделы заданий временно недоступны.
                    </div>
                )}
                {tabShown("daily") && activeTab === "daily" && (
                    dailyLoading ? (
                        <LoadingState />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <TaskSummaryCard
                                title="Прогресс дня"
                                meta={`${totalCompleted}/${totalQuests}`}
                                progress={{ current: totalCompleted, target: totalQuests, tone: totalCompleted >= 4 ? "completed" : "in_progress" }}
                                description={caseAlreadyOpened
                                    ? "Дневной кейс уже открыт."
                                    : caseEarned
                                        ? "Кейс за день готов к открытию."
                                        : `Ещё ${Math.max(0, 4 - totalCompleted)} ${pluralRu(Math.max(0, 4 - totalCompleted), "задание", "задания", "заданий")} до кейса.`}
                            >
                                <div
                                    style={{
                                        marginTop: 10,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 9,
                                        padding: "9px 10px",
                                        borderRadius: 12,
                                        background: caseEarned && !caseAlreadyOpened
                                            ? `color-mix(in srgb, ${TASK_ACCENT} 12%, var(--tg-bg))`
                                            : caseAlreadyOpened
                                                ? "color-mix(in srgb, #34c759 12%, var(--tg-bg))"
                                                : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
                                        border: TASK_SOFT_BORDER,
                                    }}
                                >
                                    <span style={{ width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                                        {caseAlreadyOpened ? "✅" : caseEarned ? <AppIcon name="case_basic" size={24} /> : "🔒"}
                                    </span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 900, color: caseAlreadyOpened ? "#34c759" : caseEarned ? `color-mix(in srgb, ${TASK_ACCENT} 80%, var(--tg-text))` : "var(--tg-text)" }}>
                                            {caseAlreadyOpened ? "Кейс открыт" : caseEarned ? "Кейс доступен" : `Ещё ${Math.max(0, 4 - totalCompleted)} ${pluralRu(Math.max(0, 4 - totalCompleted), "задание", "задания", "заданий")} до кейса`}
                                        </div>
                                        <div style={{ fontSize: 11, fontWeight: 650, color: "var(--tg-hint)", marginTop: 2 }}>{`Выполни 4 из ${caseEligibleQuests} ежедневных заданий`}</div>
                                    </div>
                                    {caseEarned && !caseAlreadyOpened && (
                                        <TaskActionButton
                                            label={casePhase !== "idle" ? "Открываем…" : "Открыть"}
                                            onClick={() => handleOpenDailyCase()}
                                            disabled={casePhase !== "idle"}
                                            minWidth={92}
                                        />
                                    )}
                                </div>

                                {(!caseEarned || caseAlreadyOpened) && unopenedCases > 0 && (
                                    <div
                                        style={{
                                            marginTop: 8,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 9,
                                            padding: "9px 10px",
                                            borderRadius: 12,
                                            background: `color-mix(in srgb, ${TASK_REWARD} 12%, var(--tg-bg))`,
                                            border: `1px solid color-mix(in srgb, ${TASK_REWARD} 24%, transparent)`,
                                        }}
                                    >
                                        <span style={{ fontSize: 20 }}>🛍️</span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12, fontWeight: 900, color: `color-mix(in srgb, ${TASK_REWARD} 82%, var(--tg-text))` }}>Неоткрытые кейсы: {unopenedCases}</div>
                                            <div style={{ fontSize: 11, fontWeight: 650, color: "var(--tg-hint)", marginTop: 2 }}>У тебя остались кейсы за прошлые дни</div>
                                        </div>
                                        {onGoToShop && (
                                            <TaskActionButton label="В магазин" onClick={onGoToShop} tone="secondary" minWidth={92} />
                                        )}
                                    </div>
                                )}
                            </TaskSummaryCard>

                            {casePhase === "reveal" && caseReward && (
                                <CaseOpeningAnimation
                                    caseType="basic"
                                    reward={caseReward}
                                    onClose={() => {
                                        setCasePhase("idle");
                                        setCaseReward(null);
                                    }}
                                />
                            )}

                            {dailyGlobalQuests.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                    <TaskSectionIntro title="Общие задания дня" description="Засчитываются независимо от участия в лигах." />
                                    {dailyGlobalQuests.map((quest) => (
                                        <TaskCard
                                            key={quest.id}
                                            icon={quest.completed ? "✅" : getPrimaryEmoji(quest.emoji)}
                                            title={quest.title}
                                            description={quest.description}
                                            status={quest.completed ? "completed" : "available"}
                                            reward={{ stars: quest.stars }}
                                        />
                                    ))}
                                </div>
                            )}

                            {dailyLeagueQuests.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                    <TaskSectionIntro title="Задания по лигам" description="Считаются только в лигах." />
                                    {dailyLeagueQuests.map((quest) => (
                                        <TaskCard
                                            key={quest.id}
                                            icon={quest.completed ? "✅" : getPrimaryEmoji(quest.emoji)}
                                            title={quest.title}
                                            description={quest.description}
                                            status={quest.completed ? "completed" : "available"}
                                            reward={{ stars: quest.stars }}
                                            badge="Лиги"
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                )}

                {tabShown("weekly") && activeTab === "weekly" && (
                    weeklyLoading ? (
                        <LoadingState />
                    ) : !weeklyData ? (
                        <TaskEmptyCard text="Еженедельные задания пока недоступны." />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {weeklyLoadError && (
                                <TaskEmptyCard text="Не удалось загрузить прогресс за неделю. Ниже — список заданий без твоих результатов." />
                            )}

                            <TaskSummaryCard
                                title="Еженедельные задания"
                                description={weeklyData.week.finalized
                                    ? "Неделя закрыта, итоговые награды уже начислены."
                                    : "Прогресс считается только в дни, когда есть матчи."}
                                statusPill={
                                    <TaskStatusPill
                                        status={weeklyData.week.finalized ? "completed" : "in_progress"}
                                        label={weeklyData.week.finalized ? "Финализировано" : "В процессе"}
                                    />
                                }
                            >
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                                    <div style={weeklyStatTileStyle}>
                                        <div style={weeklyStatLabelStyle}>До сброса</div>
                                        <div style={weeklyStatValueStyle}>{weeklyCountdown}</div>
                                    </div>
                                    <div style={weeklyStatTileStyle}>
                                        <div style={weeklyStatLabelStyle}>Игровые дни</div>
                                        <div style={weeklyStatValueStyle}>{weeklyData.week.activeDays}</div>
                                    </div>
                                </div>
                                <div style={{ fontSize: 10, fontWeight: 650, color: "var(--tg-hint)", marginTop: 8, opacity: 0.85 }}>
                                    {weeklyData.week.key} • сброс по понедельникам, 03:00 МСК
                                </div>
                                {weeklyBonusProgress.total > 0 && (
                                    <div style={weeklyCaseBlockStyle}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 900, color: "var(--tg-text)" }}>
                                                    <AppIcon name="case_premium" size={24} />
                                                    <span>Премиум-кейс недели</span>
                                                </div>
                                                <div style={{ fontSize: 11, fontWeight: 650, color: "var(--tg-hint)", marginTop: 2, lineHeight: 1.4 }}>
                                                    Выполни все общие еженедельные задания и получи премиум-кейс.
                                                </div>
                                            </div>
                                            <span style={{ ...weeklyCasePillStyle(weeklyData.bonusCase.available), gap: 4 }}>
                                                <AppIcon name="case_premium" size={22} />
                                                {weeklyData.bonusCase.available ? `Доступен${weeklyData.bonusCase.quantity > 1 ? ` x${weeklyData.bonusCase.quantity}` : ""}` : "Премиум-кейс"}
                                            </span>
                                        </div>
                                        <div style={{ marginTop: 9 }}>
                                            <TaskProgressBar
                                                current={weeklyBonusProgress.completed}
                                                target={weeklyBonusProgress.total}
                                                tone={weeklyData.bonusCase.earned ? "completed" : "in_progress"}
                                                showMeta={false}
                                            />
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
                                                <span style={{ fontSize: 11, fontWeight: 850, color: weeklyData.bonusCase.earned ? "#34c759" : `color-mix(in srgb, ${TASK_ACCENT} 80%, var(--tg-text))` }}>
                                                    {weeklyBonusProgress.completed}/{weeklyBonusProgress.total}
                                                </span>
                                                <span style={{ fontSize: 11, fontWeight: 650, color: "var(--tg-hint)" }}>
                                                    {weeklyData.bonusCase.available
                                                        ? "Кейс уже в инвентаре"
                                                        : weeklyData.bonusCase.earned
                                                            ? "Награда выдана"
                                                            : `Осталось: ${Math.max(0, weeklyBonusProgress.total - weeklyBonusProgress.completed)}`}
                                                </span>
                                            </div>
                                        </div>
                                        {weeklyData.bonusCase.available && onGoToShop && (
                                            <div style={{ marginTop: 9 }}>
                                                <TaskActionButton label="Открыть в магазине" onClick={onGoToShop} minWidth={140} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </TaskSummaryCard>

                            {weeklyInstant.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                    <TaskSectionIntro title="Выполняются сразу" description="Награда начисляется сразу после выполнения условия." />
                                    {weeklyInstant.map((quest) => (
                                        <TaskCard
                                            key={`${quest.id}:${quest.scope === "league" ? "league" : "global"}`}
                                            icon={quest.unlocked ? "✅" : getWeeklyQuestIcon(quest)}
                                            title={quest.title}
                                            description={getWeeklyQuestDescription(quest)}
                                            status={weeklyQuestStatus(quest)}
                                            reward={{ stars: quest.stars_reward, balls: quest.reward_balls }}
                                            progress={{ current: quest.progress, target: quest.threshold }}
                                            badge={weeklyLeagueBadge(quest)}
                                        />
                                    ))}
                                </div>
                            )}

                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                <TaskSectionIntro title="Итог недели" description="Награды начисляются после завершения и финализации недели." />
                                {weeklyRanking.length === 0 ? (
                                    <TaskEmptyCard text="Итоговых недельных заданий для текущей недели пока нет." />
                                ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                        {weeklyRanking.map((quest) => (
                                            <TaskCard
                                                key={`${quest.id}:${quest.scope === "league" ? "league" : "global"}`}
                                                icon={quest.unlocked ? "✅" : getWeeklyQuestIcon(quest)}
                                                title={quest.title}
                                                description={getWeeklyQuestDescription(quest)}
                                                status={weeklyQuestStatus(quest)}
                                                reward={{ stars: quest.stars_reward, balls: quest.reward_balls }}
                                                badge={weeklyLeagueBadge(quest)}
                                                footer={!quest.unlocked && quest.status_note ? (
                                                    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>{quest.status_note}</div>
                                                ) : undefined}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                )}

                {tabShown("partner") && activeTab === "partner" && <PartnerTasksSection />}

                {tabShown("season") && activeTab === "season" && (
                    <SeasonPredictionTasksSection
                        // Re-mount on each deep-link request so the preselected
                        // tournament (section/subsection) is applied freshly.
                        key={`season-${requestTab?.token ?? 0}`}
                        topLeagues={[]}
                        europeanCups={[]}
                        mode="season"
                        onNavigate={handleSeasonModeNav}
                        initialSectionId={requestTab?.seasonTarget?.section}
                        initialSubsectionId={requestTab?.seasonTarget?.subsection}
                        onBalanceChange={onBalanceChange}
                        hiddenSubsections={hiddenSubsections}
                    />
                )}

                {tabShown("weekly_challenge") && activeTab === "weekly_challenge" && (
                    <WeeklyChallengeTasksSection onOpenWeeklyChallenge={onOpenWeeklyChallenge} />
                )}
            </div>
        </div>
    );
}
