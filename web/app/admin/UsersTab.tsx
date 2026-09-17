"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMsk, parseTsMs } from "./mskTime";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import {
    AdminBadge,
    AdminButton,
    AdminDataRow,
    AdminInput,
    AdminMetricCard,
    AdminSelect,
} from "./components/ui";
import { formatAdminDate } from "@/lib/adminUtils";

type UsersTabProps = {
    fetchWithAuth: <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;
};

type ApiResponse = {
    ok?: boolean;
    error?: string;
};

type UserSearchResult = {
    id: string | number;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    joined_at?: string | number | null;
    balls?: number | null;
    total_cases?: number | null;
    total_boosts?: number | null;
    is_banned?: number | null;
    banned_at?: string | number | null;
    ban_reason?: string | null;
};

type UserCase = {
    case_type: string;
    quantity: number;
};

type UserBoost = {
    boost_type: string;
    quantity: number;
};

type UserDetails = {
    cases: UserCase[];
    boosts: UserBoost[];
    lucky_tokens?: number;
    stars?: number;
};

type UserTransaction = {
    tx_type: string;
    case_type?: string | null;
    created_at?: string | null;
    comment?: string | null;
    operation_type?: string | null;
    admin_user_id?: string | number | null;
    quantity_before?: number | null;
    quantity_after?: number | null;
    amount: number;
};

type PredictionFilterState = {
    competition: string;
    status: string;
    season: string;
    day: string;
    sort: string;
    limit: number;
};

type PredictionPagination = {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
};

type PredictionOption = {
    value: string;
    label: string;
};

type PredictionMeta = {
    competitions: PredictionOption[];
    seasons: PredictionOption[];
    applied: PredictionFilterState & { page: number };
};

type PredictionSummary = {
    totalPredictions?: number;
    finishedPredictions?: number;
    correctOutcomes?: number;
    exactScores?: number;
    scoringMatches?: number;
    totalPointsAllTime?: number;
    currentSeasonLabel?: string | null;
    totalPointsCurrentSeason?: number;
    averagePointsPerFinishedMatch?: number;
    jokerUses?: number;
    extraJokerUses?: number;
    doubleChanceUses?: number;
};

type UserPrediction = {
    day: string;
    matchId: string | number;
    points: number | null;
    competitionLabel?: string | null;
    normalizedStatus?: string | null;
    seasonLabel?: string | null;
    startTime?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    pickHome?: number | null;
    pickAway?: number | null;
    pickUpdatedAt?: string | number | null;
    isFinished?: boolean;
    resultHome?: number | null;
    resultAway?: number | null;
    resultSource?: string | null;
    resultProviderLabel?: string | null;
    isJoker?: boolean;
    isExtraJoker?: boolean;
    hasDoubleChance?: boolean;
    doubleChance?: string | null;
    pointsReason?: string | null;
};

type UsersListResponse = ApiResponse & {
    users?: UserSearchResult[];
    total?: number;
    page?: number;
    limit?: number;
    pages?: number;
};

type UserDetailsResponse = ApiResponse & Partial<UserDetails>;

type UserTransactionsResponse = ApiResponse & {
    transactions?: UserTransaction[];
};

type UserPredictionsResponse = ApiResponse & {
    summary?: PredictionSummary | null;
    predictions?: UserPrediction[];
    filters?: Partial<PredictionMeta> & {
        applied?: Partial<PredictionFilterState & { page: number }>;
    };
    pagination?: Partial<PredictionPagination>;
};

type AdjustBallsResponse = ApiResponse & {
    newBalance?: number;
};

type AdjustCasesResponse = ApiResponse & {
    quantityAfter?: number;
};

const DEFAULT_PREDICTION_FILTERS = {
    competition: "all",
    status: "all",
    season: "all",
    day: "",
    sort: "desc",
    limit: 20,
};

const DEFAULT_PREDICTION_PAGINATION = {
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasMore: false,
};

const STATUS_OPTIONS = [
    { value: "all", label: "All statuses" },
    { value: "finished", label: "Finished" },
    { value: "unfinished", label: "Unfinished" },
    { value: "live", label: "Live" },
    { value: "scheduled", label: "Scheduled" },
    { value: "postponed", label: "Postponed" },
    { value: "cancelled", label: "Cancelled" },
];

const LIMIT_OPTIONS = [10, 20, 50];

function formatValueDate(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "") return "-";
    const formatted = formatMsk(value);
    return formatted === "—" ? "-" : formatted;
}

const USERS_PAGE_SIZE = 10;

function formatJoinedDate(value: string | number | null | undefined): string {
    if (value === null || value === undefined || value === "" || value === 0 || value === "0") return "-";
    const raw = typeof value === "string" ? value.trim() : value;
    if (raw === "" || raw === "0") return "-";
    const ms = parseTsMs(raw);
    if (ms == null) return "-";
    const date = new Date(ms);
    // Reject dates before 2020 — the project didn't exist before then
    if (date.getUTCFullYear() < 2020) return "-";
    return date.toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "Europe/Moscow",
    });
}

function formatScore(home: number | null | undefined, away: number | null | undefined): string {
    if (home === null || home === undefined || away === null || away === undefined) return "-";
    return `${home}:${away}`;
}

function getPredictionStatusLabel(status: string | null | undefined): string {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "FINISHED") return "Finished";
    if (normalized === "LIVE") return "Live";
    if (normalized === "SCHEDULED") return "Scheduled";
    if (normalized === "POSTPONED") return "Postponed";
    if (normalized === "CANCELLED") return "Cancelled";
    return normalized || "Unknown";
}

function getPredictionStatusVariant(status: string | null | undefined): "neutral" | "info" | "success" | "warning" | "danger" {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "FINISHED") return "success";
    if (normalized === "LIVE") return "info";
    if (normalized === "POSTPONED") return "warning";
    if (normalized === "CANCELLED") return "danger";
    return "neutral";
}

function getPointsReasonLabel(reason: string | null | undefined): string {
    switch (reason) {
        case "exact":
            return "Exact score";
        case "diff":
            return "Goal difference";
        case "outcome":
            return "Correct outcome";
        case "double_chance":
            return "Double chance hit";
        case "miss":
            return "No points";
        default:
            return "Pending result";
    }
}

// Points badge variant + label (display only — derived from the server-provided points).
function getPointsBadge(points: number | null): { variant: "neutral" | "success" | "danger"; label: string } {
    if (points === null) return { variant: "neutral", label: "Pending" };
    if (points > 0) return { variant: "success", label: `+${points} pts` };
    return { variant: "danger", label: "0 pts" };
}

// Display-only label maps for inventory/transaction asset codes (no data change).
function formatCaseType(type: string | null | undefined): string {
    if (type === "premium") return "Премиум-кейс";
    if (type === "daily_free") return "Ежедневный кейс";
    return type || "Кейс";
}

function formatBoostType(type: string | null | undefined): string {
    if (!type) return "Буст";
    return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "Unknown error");
}

export default function UsersTab({ fetchWithAuth }: UsersTabProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [users, setUsers] = useState<UserSearchResult[]>([]);
    const [usersPage, setUsersPage] = useState(1);
    const [usersPages, setUsersPages] = useState(1);
    const [usersTotal, setUsersTotal] = useState(0);
    const [loadingList, setLoadingList] = useState(false);

    const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
    const [userDetails, setUserDetails] = useState<UserDetails | null>(null);
    const [userTransactions, setUserTransactions] = useState<UserTransaction[]>([]);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [loadingPredictions, setLoadingPredictions] = useState(false);

    const [predictionFilters, setPredictionFilters] = useState<PredictionFilterState>({ ...DEFAULT_PREDICTION_FILTERS });
    const [predictionMeta, setPredictionMeta] = useState<PredictionMeta>({ competitions: [], seasons: [], applied: { ...DEFAULT_PREDICTION_FILTERS, page: 1 } });
    const [predictionSummary, setPredictionSummary] = useState<PredictionSummary | null>(null);
    const [predictionHistory, setPredictionHistory] = useState<UserPrediction[]>([]);
    const [predictionPagination, setPredictionPagination] = useState<PredictionPagination>({ ...DEFAULT_PREDICTION_PAGINATION });

    const [adjustBallsAmount, setAdjustBallsAmount] = useState("");
    const [adjustBallsReason, setAdjustBallsReason] = useState("");
    const [adjustCasesType, setAdjustCasesType] = useState("premium");
    const [adjustCasesAmount, setAdjustCasesAmount] = useState("");
    const [adjustCasesReason, setAdjustCasesReason] = useState("");
    const [adjustTokensAmount, setAdjustTokensAmount] = useState("");
    const [adjustTokensReason, setAdjustTokensReason] = useState("");
    const [adjustStarsAmount, setAdjustStarsAmount] = useState("");
    const [adjustStarsReason, setAdjustStarsReason] = useState("");
    const [banReason, setBanReason] = useState("");

    const [bannedUsers, setBannedUsers] = useState<UserSearchResult[] | null>(null);
    const [loadingBanned, setLoadingBanned] = useState(false);
    const [unbanningId, setUnbanningId] = useState<string | number | null>(null);

    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const loadBannedUsers = useCallback(async () => {
        setLoadingBanned(true);
        try {
            const res = await fetchWithAuth<{ ok?: boolean; users?: UserSearchResult[] }>("/admin/users/banned");
            if (res?.ok) setBannedUsers(res.users || []);
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoadingBanned(false);
        }
    }, [fetchWithAuth]);

    const unbanUser = async (id: string | number) => {
        setUnbanningId(id);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<ApiResponse & { banned?: boolean }>("/admin/users/ban", {
                method: "POST",
                body: JSON.stringify({ identifier: id, banned: false }),
            });
            if (res?.ok) {
                setSuccess("Пользователь разбанен.");
                setBannedUsers((prev) => (prev || []).filter((u) => String(u.id) !== String(id)));
            } else {
                setError(res?.error || "Ошибка разбана");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setUnbanningId(null);
        }
    };

    const fetchUsers = useCallback(async (query: string, page = 1) => {
        setLoadingList(true);
        setError("");
        try {
            const res = await fetchWithAuth<UsersListResponse>(
                `/admin/users?q=${encodeURIComponent(query)}&page=${page}&limit=${USERS_PAGE_SIZE}`
            );
            if (res?.ok) {
                setUsers(res.users || []);
                setUsersPage(res.page || page);
                setUsersPages(Math.max(1, res.pages || 1));
                setUsersTotal(res.total || 0);
            } else {
                setError(res?.error || "Failed to fetch users");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoadingList(false);
        }
    }, [fetchWithAuth]);

    useEffect(() => {
        fetchUsers("");
    }, [fetchUsers]);

    const loadUserPredictions = async (userId: string | number, filters = predictionFilters, page = 1) => {
        setLoadingPredictions(true);
        setError("");

        const params = new URLSearchParams();
        if (filters.competition !== "all") params.set("competition", filters.competition);
        if (filters.status !== "all") params.set("status", filters.status);
        if (filters.season !== "all") params.set("season", filters.season);
        if (filters.day) params.set("day", filters.day);
        params.set("sort", filters.sort);
        params.set("limit", String(filters.limit));
        params.set("page", String(page));

        try {
            const res = await fetchWithAuth<UserPredictionsResponse>(`/admin/users/${userId}/predictions?${params.toString()}`);
            if (res?.ok) {
                const appliedFilters = res.filters?.applied;
                setPredictionSummary(res.summary || null);
                setPredictionHistory(res.predictions || []);
                setPredictionMeta({
                    competitions: res.filters?.competitions || [],
                    seasons: res.filters?.seasons || [],
                    applied: {
                        competition: appliedFilters?.competition || filters.competition,
                        status: appliedFilters?.status || filters.status,
                        season: appliedFilters?.season || filters.season,
                        day: appliedFilters?.day || filters.day,
                        sort: appliedFilters?.sort || filters.sort,
                        limit: Number(appliedFilters?.limit || filters.limit),
                        page: Number(appliedFilters?.page || page),
                    },
                });
                setPredictionPagination({
                    ...DEFAULT_PREDICTION_PAGINATION,
                    ...res.pagination,
                    page: Number(res.pagination?.page || page),
                    limit: Number(res.pagination?.limit || filters.limit),
                });
                setPredictionFilters({
                    competition: appliedFilters?.competition || filters.competition,
                    status: appliedFilters?.status || filters.status,
                    season: appliedFilters?.season || filters.season,
                    day: appliedFilters?.day || filters.day,
                    sort: appliedFilters?.sort || filters.sort,
                    limit: Number(appliedFilters?.limit || filters.limit),
                });
            } else {
                setPredictionSummary(null);
                setPredictionHistory([]);
                setPredictionPagination({ ...DEFAULT_PREDICTION_PAGINATION, page: 1, limit: filters.limit });
                setError(res?.error || "Failed to fetch prediction history");
            }
            return res;
        } catch (e: unknown) {
            setPredictionSummary(null);
            setPredictionHistory([]);
            setPredictionPagination({ ...DEFAULT_PREDICTION_PAGINATION, page: 1, limit: filters.limit });
            setError(getErrorMessage(e));
            throw e;
        } finally {
            setLoadingPredictions(false);
        }
    };

    const openUserModal = async (user: UserSearchResult) => {
        const initialFilters = { ...DEFAULT_PREDICTION_FILTERS };
        setSelectedUser(user);
        setLoadingDetails(true);
        setError("");
        setSuccess("");
        setUserDetails(null);
        setUserTransactions([]);
        setPredictionFilters(initialFilters);
        setPredictionMeta({ competitions: [], seasons: [], applied: { ...initialFilters, page: 1 } });
        setPredictionSummary(null);
        setPredictionHistory([]);
        setPredictionPagination({ ...DEFAULT_PREDICTION_PAGINATION });

        try {
            const detailsPromise = fetchWithAuth<UserDetailsResponse>(`/admin/users/${user.id}/details`);
            const txPromise = fetchWithAuth<UserTransactionsResponse>(`/admin/users/${user.id}/transactions`);
            const predictionsPromise = loadUserPredictions(user.id, initialFilters, 1);

            const [detailsRes, txRes] = await Promise.all([detailsPromise, txPromise]);
            await predictionsPromise;

            if (detailsRes?.ok) {
                setUserDetails({
                    cases: detailsRes.cases || [],
                    boosts: detailsRes.boosts || [],
                    lucky_tokens: detailsRes.lucky_tokens ?? 0,
                    stars: detailsRes.stars ?? 0,
                });
            }

            if (txRes?.ok) {
                setUserTransactions(txRes.transactions || []);
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoadingDetails(false);
        }
    };

    const closeUserModal = () => {
        setSelectedUser(null);
        setUserDetails(null);
        setUserTransactions([]);
        setPredictionSummary(null);
        setPredictionHistory([]);
        setPredictionMeta({ competitions: [], seasons: [], applied: { ...DEFAULT_PREDICTION_FILTERS, page: 1 } });
        setPredictionPagination({ ...DEFAULT_PREDICTION_PAGINATION });
        setPredictionFilters({ ...DEFAULT_PREDICTION_FILTERS });
        fetchUsers(searchQuery, usersPage);
    };

    const refreshTransactions = async (userId: string | number) => {
        const txRes = await fetchWithAuth<UserTransactionsResponse>(`/admin/users/${userId}/transactions`);
        if (txRes?.ok) {
            setUserTransactions(txRes.transactions || []);
        }
    };

    const handleAdjustBalls = async () => {
        if (!selectedUser || !adjustBallsAmount) return;
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<AdjustBallsResponse>(`/admin/users/balls`, {
                method: "POST",
                body: JSON.stringify({
                    identifier: selectedUser.id,
                    amount: Number(adjustBallsAmount),
                    comment: adjustBallsReason || "Manual adjustment",
                }),
            });
            if (res?.ok) {
                setSuccess(`Successfully adjusted balls. New balance: ${res.newBalance}`);
                setAdjustBallsAmount("");
                setAdjustBallsReason("");
                setSelectedUser({ ...selectedUser, balls: res.newBalance });
                refreshTransactions(selectedUser.id);
            } else {
                setError(res?.error || "Error adjusting balls");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleAdjustCases = async () => {
        if (!selectedUser || !adjustCasesAmount || !adjustCasesType) return;
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<AdjustCasesResponse>(`/admin/users/cases`, {
                method: "POST",
                body: JSON.stringify({
                    identifier: selectedUser.id,
                    case_type: adjustCasesType,
                    amount: Number(adjustCasesAmount),
                    comment: adjustCasesReason || "Manual case adjustment",
                }),
            });
            if (res?.ok) {
                setSuccess(`Successfully adjusted cases. New quantity: ${res.quantityAfter}`);
                setAdjustCasesAmount("");
                setAdjustCasesReason("");
                const detailsRes = await fetchWithAuth<UserDetailsResponse>(`/admin/users/${selectedUser.id}/details`);
                if (detailsRes?.ok) {
                    setUserDetails({ cases: detailsRes.cases || [], boosts: detailsRes.boosts || [] });
                }
                refreshTransactions(selectedUser.id);
            } else {
                setError(res?.error || "Error adjusting cases");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleAdjustTokens = async () => {
        if (!selectedUser || !adjustTokensAmount) return;
        const amt = Number(adjustTokensAmount);
        if (!Number.isInteger(amt) || amt === 0) { setError("Введите целое число жетонов (не ноль)."); return; }
        if (!adjustTokensReason.trim()) { setError("Укажите причину операции с жетонами."); return; }
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<ApiResponse & { newBalance?: number }>(`/admin/users/lucky-tokens`, {
                method: "POST",
                body: JSON.stringify({
                    identifier: selectedUser.id,
                    amount: amt,
                    comment: adjustTokensReason,
                }),
            });
            if (res?.ok) {
                setSuccess(`Жетоны обновлены. Новый баланс: ${res.newBalance}`);
                setAdjustTokensAmount("");
                setAdjustTokensReason("");
                setUserDetails((prev) => prev ? { ...prev, lucky_tokens: Number(res.newBalance ?? prev.lucky_tokens ?? 0) } : prev);
                refreshTransactions(selectedUser.id);
            } else {
                setError(res?.error || "Ошибка изменения жетонов");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleAdjustStars = async () => {
        if (!selectedUser || !adjustStarsAmount) return;
        const amt = Number(adjustStarsAmount);
        if (!Number.isInteger(amt) || amt === 0) { setError("Введите целое число звёзд (не ноль)."); return; }
        if (!adjustStarsReason.trim()) { setError("Укажите причину операции со звёздами."); return; }
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<ApiResponse & { newBalance?: number }>(`/admin/users/stars`, {
                method: "POST",
                body: JSON.stringify({
                    identifier: selectedUser.id,
                    amount: amt,
                    comment: adjustStarsReason.trim(),
                }),
            });
            if (res?.ok) {
                setSuccess(`Звёзды обновлены. Новый баланс: ${res.newBalance}`);
                setAdjustStarsAmount("");
                setAdjustStarsReason("");
                setUserDetails((prev) => prev ? { ...prev, stars: Number(res.newBalance ?? prev.stars ?? 0) } : prev);
            } else {
                setError(res?.error === "SEASON_NOT_ACTIVE" ? "Нет активного сезона — звёзды начислять некуда." : (res?.error || "Ошибка изменения звёзд"));
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleBan = async () => {
        if (!selectedUser) return;
        const nextBanned = !(Number(selectedUser.is_banned) === 1);
        if (nextBanned && !banReason.trim()) { setError("Укажите причину бана."); return; }
        setActionLoading(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetchWithAuth<ApiResponse & { banned?: boolean }>(`/admin/users/ban`, {
                method: "POST",
                body: JSON.stringify({
                    identifier: selectedUser.id,
                    banned: nextBanned,
                    reason: nextBanned ? banReason.trim() : undefined,
                }),
            });
            if (res?.ok) {
                setSuccess(nextBanned ? "Пользователь забанен." : "Пользователь разбанен.");
                setBanReason("");
                setSelectedUser({ ...selectedUser, is_banned: nextBanned ? 1 : 0 });
            } else {
                setError(res?.error || "Ошибка изменения бана");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setActionLoading(false);
        }
    };

    const applyPredictionFilters = async () => {
        if (!selectedUser) return;
        await loadUserPredictions(selectedUser.id, predictionFilters, 1);
    };

    const resetPredictionFilters = async () => {
        if (!selectedUser) return;
        const nextFilters = { ...DEFAULT_PREDICTION_FILTERS };
        setPredictionFilters(nextFilters);
        await loadUserPredictions(selectedUser.id, nextFilters, 1);
    };

    const refreshPredictionHistory = async () => {
        if (!selectedUser) return;
        await loadUserPredictions(selectedUser.id, predictionFilters, predictionPagination.page);
    };

    const goToPredictionPage = async (nextPage: number) => {
        if (!selectedUser) return;
        await loadUserPredictions(selectedUser.id, predictionFilters, nextPage);
    };

    const predictionSummaryCards = predictionSummary ? [
        { label: "Total picks", value: predictionSummary.totalPredictions },
        { label: "Finished", value: predictionSummary.finishedPredictions },
        { label: "Correct outcomes", value: predictionSummary.correctOutcomes },
        { label: "Exact scores", value: predictionSummary.exactScores },
        { label: "Scoring matches", value: predictionSummary.scoringMatches },
        { label: "Points all-time", value: predictionSummary.totalPointsAllTime },
        { label: predictionSummary.currentSeasonLabel || "Current season", value: predictionSummary.totalPointsCurrentSeason },
        { label: "Avg / finished", value: predictionSummary.averagePointsPerFinishedMatch },
        { label: "Joker uses", value: predictionSummary.jokerUses },
        { label: "Extra Joker uses", value: predictionSummary.extraJokerUses },
        { label: "Double chance", value: predictionSummary.doubleChanceUses },
    ] : [];

    const totalCases = userDetails ? userDetails.cases.reduce((sum, c) => sum + (c.quantity || 0), 0) : 0;
    const totalBoosts = userDetails ? userDetails.boosts.reduce((sum, b) => sum + (b.quantity || 0), 0) : 0;
    const hasInventory = !!userDetails && (userDetails.cases.length > 0 || userDetails.boosts.length > 0);

    return (
        <div className="space-y-6">
            <AdminCollapsibleSection title="Поиск пользователей" description={`найдено ${usersTotal}`} defaultOpen keepMounted storageKey="admin:users:search">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <AdminInput
                            label="Поиск пользователя"
                            description="Telegram ID, username или имя"
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && fetchUsers(searchQuery, 1)}
                            placeholder="ID, @username или имя"
                        />
                    </div>
                    <AdminButton
                        variant="primary"
                        loading={loadingList}
                        onClick={() => fetchUsers(searchQuery, 1)}
                        className="w-full sm:w-auto"
                    >
                        Найти
                    </AdminButton>
                </div>

                <div className="mt-4 space-y-3">
                    {users.map((u) => (
                        <AdminCard key={String(u.id)} className="p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-500 to-emerald-500 text-lg font-bold text-white">
                                    {u.first_name?.[0] || "U"}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 truncate text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                        <span className="truncate">{u.first_name} {u.last_name || ""}</span>
                                        {Number(u.is_banned) === 1 && <AdminBadge variant="danger" size="sm">бан</AdminBadge>}
                                    </div>
                                    <div className="truncate font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{u.username ? `@${u.username}` : `ID ${u.id}`}</div>
                                </div>
                                <AdminButton variant="secondary" size="sm" onClick={() => openUserModal(u)}>
                                    Открыть
                                </AdminButton>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <AdminMetricCard size="sm" label="Мячи" value={u.balls ?? 0} />
                                <AdminMetricCard size="sm" label="Кейсы" value={u.total_cases ?? 0} />
                                <AdminMetricCard size="sm" label="Бусты" value={u.total_boosts ?? 0} />
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <AdminDataRow label="Telegram ID" value={u.id} />
                                <AdminDataRow label="Регистрация" value={formatJoinedDate(u.joined_at)} />
                            </div>
                        </AdminCard>
                    ))}
                    {users.length === 0 && !loadingList && (
                        <AdminCard className="border-dashed py-12 text-center text-[var(--tg-theme-hint-color,#999)]">
                            Пользователи не найдены.
                        </AdminCard>
                    )}
                </div>

                {usersTotal > 0 && (
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                            Стр. {usersPage} / {usersPages} · всего {usersTotal}
                        </div>
                        <div className="flex gap-3">
                            <AdminButton
                                onClick={() => fetchUsers(searchQuery, usersPage - 1)}
                                disabled={loadingList || usersPage <= 1}
                                variant="secondary"
                                size="sm"
                                className="flex-1 sm:flex-none"
                            >
                                Назад
                            </AdminButton>
                            <AdminButton
                                onClick={() => fetchUsers(searchQuery, usersPage + 1)}
                                disabled={loadingList || usersPage >= usersPages}
                                variant="secondary"
                                size="sm"
                                className="flex-1 sm:flex-none"
                            >
                                Вперёд
                            </AdminButton>
                        </div>
                    </div>
                )}
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Забаненные"
                description={bannedUsers === null ? "нажмите, чтобы загрузить" : `${bannedUsers.length} заблокировано`}
                storageKey="admin:users:banned"
            >
                <div className="flex items-center gap-2 mb-3">
                    <AdminButton variant="secondary" size="sm" loading={loadingBanned} onClick={loadBannedUsers}>
                        {bannedUsers === null ? "Показать забаненных" : "Обновить"}
                    </AdminButton>
                </div>

                {bannedUsers !== null && bannedUsers.length === 0 && (
                    <div className="text-[13px] text-[var(--tg-theme-hint-color,#999)]">Забаненных пользователей нет.</div>
                )}

                <div className="space-y-2">
                    {(bannedUsers || []).map((u) => (
                        <AdminCard key={String(u.id)} className="p-3">
                            <div className="flex items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 truncate text-[13px] font-bold text-[var(--tg-theme-text-color,#fff)]">
                                        <span className="truncate">{u.first_name} {u.last_name || ""}</span>
                                    </div>
                                    <div className="truncate font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{u.username ? `@${u.username}` : `ID ${u.id}`}</div>
                                    {u.ban_reason && (
                                        <div className="mt-1 text-[11px] text-red-300 break-words">Причина: {u.ban_reason}</div>
                                    )}
                                </div>
                                <AdminButton
                                    variant="secondary"
                                    size="sm"
                                    loading={String(unbanningId) === String(u.id)}
                                    onClick={() => unbanUser(u.id)}
                                >
                                    Разбанить
                                </AdminButton>
                            </div>
                        </AdminCard>
                    ))}
                </div>
            </AdminCollapsibleSection>

            {selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-2 backdrop-blur-sm sm:p-4">
                    <AdminCard className="relative my-4 flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden !p-0 shadow-2xl sm:my-8">
                        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-[var(--tg-theme-bg-color,#1c1c1e)] p-4 sm:p-6">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-blue-500 to-emerald-500 text-xl font-bold text-white">
                                    {selectedUser.first_name?.[0] || "U"}
                                </div>
                                <div className="min-w-0">
                                    <h2 className="truncate text-[16px] font-extrabold text-[var(--tg-theme-text-color,#fff)] sm:text-[18px]">{selectedUser.first_name} {selectedUser.last_name || ""}</h2>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                        {selectedUser.username && <AdminBadge variant="info" size="sm">@{selectedUser.username}</AdminBadge>}
                                        <AdminBadge variant="neutral" size="sm">ID {selectedUser.id}</AdminBadge>
                                        {Number(selectedUser.is_banned) === 1 && <AdminBadge variant="danger" size="sm">забанен</AdminBadge>}
                                    </div>
                                </div>
                            </div>
                            <AdminButton variant="ghost" size="sm" onClick={closeUserModal} aria-label="Закрыть" className="shrink-0">
                                ✕
                            </AdminButton>
                        </div>

                        <div className="grow space-y-6 overflow-y-auto p-4 sm:p-6">
                            {error && (
                                <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">
                                    {error}
                                </div>
                            )}
                            {success && (
                                <div className="rounded-2xl border border-[color-mix(in_srgb,#34c759_36%,transparent)] bg-[color-mix(in_srgb,#34c759_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#34c759_88%,var(--tg-theme-text-color,#fff))]">
                                    {success}
                                </div>
                            )}

                            <AdminCollapsibleSection title="Баланс и инвентарь" description={`${selectedUser.balls} мячей`} defaultOpen storageKey="admin:users:balance">
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                                        <AdminMetricCard label="Мячи" value={selectedUser.balls ?? 0} />
                                        <AdminMetricCard label="Звёзды" value={loadingDetails ? "…" : (userDetails?.stars ?? 0)} />
                                        <AdminMetricCard label="Кейсы" value={loadingDetails ? "…" : totalCases} />
                                        <AdminMetricCard label="Бусты" value={loadingDetails ? "…" : totalBoosts} />
                                        <AdminMetricCard label="Жетоны" value={loadingDetails ? "…" : (userDetails?.lucky_tokens ?? 0)} />
                                    </div>
                                    {!loadingDetails && hasInventory && (
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            {userDetails!.cases.map((c) => (
                                                <AdminDataRow
                                                    key={`case-${c.case_type}`}
                                                    label={formatCaseType(c.case_type)}
                                                    value={`×${c.quantity}`}
                                                    badge={<AdminBadge variant="info" size="sm">кейс</AdminBadge>}
                                                />
                                            ))}
                                            {userDetails!.boosts.map((b) => (
                                                <AdminDataRow
                                                    key={`boost-${b.boost_type}`}
                                                    label={formatBoostType(b.boost_type)}
                                                    value={`×${b.quantity}`}
                                                    badge={<AdminBadge variant="warning" size="sm">буст</AdminBadge>}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    {loadingDetails && <div className="text-[12px] font-semibold text-[var(--tg-theme-hint-color,#999)]">Загрузка инвентаря…</div>}
                                    {!loadingDetails && userDetails && !hasInventory && (
                                        <div className="text-[12px] font-semibold text-[var(--tg-theme-hint-color,#999)]">Нет кейсов и бустов</div>
                                    )}
                                </div>
                            </AdminCollapsibleSection>

                            <AdminCollapsibleSection title="Прогнозы и история" description={`${predictionPagination.total} прогнозов`} defaultOpen keepMounted storageKey="admin:users:history">
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <h3 className="text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Prediction Analytics</h3>
                                            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                                Final per-match points come from the server and follow current admin/manual results.
                                            </div>
                                        </div>
                                        <AdminButton
                                            onClick={refreshPredictionHistory}
                                            variant="secondary"
                                            size="sm"
                                            loading={loadingPredictions}
                                            className="w-full sm:w-auto"
                                        >
                                            Refresh history
                                        </AdminButton>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                        {predictionSummaryCards.map((card) => (
                                            <AdminMetricCard key={card.label} size="sm" label={card.label} value={card.value ?? 0} />
                                        ))}
                                        {!predictionSummary && loadingPredictions && [...Array(4)].map((_, idx) => (
                                            <div key={idx} className="h-[70px] animate-pulse rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20" />
                                        ))}
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">History Filters</div>
                                            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                                Showing {predictionHistory.length} of {predictionPagination.total} picks
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <AdminSelect
                                                label="Турнир"
                                                value={predictionFilters.competition}
                                                onChange={(value) => setPredictionFilters((prev) => ({ ...prev, competition: value }))}
                                                options={[{ value: "all", label: "All competitions" }, ...predictionMeta.competitions]}
                                            />
                                            <AdminSelect
                                                label="Статус"
                                                value={predictionFilters.status}
                                                onChange={(value) => setPredictionFilters((prev) => ({ ...prev, status: value }))}
                                                options={STATUS_OPTIONS}
                                            />
                                            <AdminSelect
                                                label="Сезон"
                                                value={predictionFilters.season}
                                                onChange={(value) => setPredictionFilters((prev) => ({ ...prev, season: value }))}
                                                options={[{ value: "all", label: "All seasons" }, ...predictionMeta.seasons]}
                                            />
                                            <AdminInput
                                                label="Дата"
                                                type="date"
                                                value={predictionFilters.day}
                                                onChange={(e) => setPredictionFilters((prev) => ({ ...prev, day: e.target.value }))}
                                            />
                                            <AdminSelect
                                                label="Сортировка"
                                                value={predictionFilters.sort}
                                                onChange={(value) => setPredictionFilters((prev) => ({ ...prev, sort: value }))}
                                                options={[{ value: "desc", label: "Newest first" }, { value: "asc", label: "Oldest first" }]}
                                            />
                                            <AdminSelect
                                                label="На странице"
                                                value={String(predictionFilters.limit)}
                                                onChange={(value) => setPredictionFilters((prev) => ({ ...prev, limit: Number(value) }))}
                                                options={LIMIT_OPTIONS.map((limit) => ({ value: String(limit), label: `${limit} per page` }))}
                                            />
                                        </div>

                                        <div className="flex flex-col gap-3 sm:flex-row">
                                            <AdminButton onClick={applyPredictionFilters} loading={loadingPredictions} className="w-full sm:w-auto">
                                                Apply Filters
                                            </AdminButton>
                                            <AdminButton onClick={resetPredictionFilters} disabled={loadingPredictions} variant="secondary" className="w-full sm:w-auto">
                                                Reset
                                            </AdminButton>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        {loadingPredictions ? (
                                            [...Array(3)].map((_, idx) => (
                                                <div key={idx} className="h-[180px] animate-pulse rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20" />
                                            ))
                                        ) : predictionHistory.length === 0 ? (
                                            <AdminCard className="border-dashed py-8 text-center text-[var(--tg-theme-hint-color,#999)]">
                                                No predictions match the current filters.
                                            </AdminCard>
                                        ) : (
                                            predictionHistory.map((prediction) => {
                                                const pointsBadge = getPointsBadge(prediction.points);
                                                return (
                                                    <div
                                                        key={`${prediction.day}-${prediction.matchId}`}
                                                        className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 sm:p-5"
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                                                    {prediction.competitionLabel && <AdminBadge variant="accent" size="sm">{prediction.competitionLabel}</AdminBadge>}
                                                                    <AdminBadge variant={getPredictionStatusVariant(prediction.normalizedStatus)} size="sm">
                                                                        {getPredictionStatusLabel(prediction.normalizedStatus)}
                                                                    </AdminBadge>
                                                                    {prediction.seasonLabel && <AdminBadge variant="neutral" size="sm">{prediction.seasonLabel}</AdminBadge>}
                                                                </div>
                                                                <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                                                    {formatAdminDate(prediction.startTime)} | {prediction.day}
                                                                </div>
                                                            </div>
                                                            <AdminBadge variant={pointsBadge.variant} size="md" className="shrink-0">{pointsBadge.label}</AdminBadge>
                                                        </div>

                                                        <div className="text-[15px] font-extrabold leading-snug text-[var(--tg-theme-text-color,#fff)]">
                                                            {prediction.homeTeam} <span className="text-[var(--tg-theme-hint-color,#999)]">—</span> {prediction.awayTeam}
                                                        </div>

                                                        <div className="grid grid-cols-2 gap-3">
                                                            <AdminMetricCard
                                                                size="sm"
                                                                label="User pick"
                                                                value={formatScore(prediction.pickHome, prediction.pickAway)}
                                                                description={`Saved: ${formatValueDate(prediction.pickUpdatedAt)}`}
                                                            />
                                                            <AdminMetricCard
                                                                size="sm"
                                                                label="Actual result"
                                                                value={prediction.isFinished ? formatScore(prediction.resultHome, prediction.resultAway) : "Pending"}
                                                                description={prediction.isFinished
                                                                    ? (prediction.resultSource === "manual" ? "Manual" : prediction.resultProviderLabel || "")
                                                                    : "Not final yet"}
                                                            />
                                                        </div>

                                                        <div className="flex flex-wrap gap-2">
                                                            {prediction.isJoker && <AdminBadge variant="success" size="sm">Joker ×2</AdminBadge>}
                                                            {prediction.isExtraJoker && <AdminBadge variant="warning" size="sm">Extra Joker</AdminBadge>}
                                                            {prediction.hasDoubleChance && <AdminBadge variant="info" size="sm">Double chance {prediction.doubleChance}</AdminBadge>}
                                                            {prediction.resultSource === "manual" && <AdminBadge variant="warning" size="sm">Manual result</AdminBadge>}
                                                            {prediction.resultSource === "api" && prediction.resultProviderLabel && (
                                                                <AdminBadge variant="neutral" size="sm">{prediction.resultProviderLabel}</AdminBadge>
                                                            )}
                                                        </div>

                                                        <AdminDataRow
                                                            label={getPointsReasonLabel(prediction.pointsReason)}
                                                            value={prediction.points === null ? "No points until the match is finished" : `Final points: ${prediction.points}`}
                                                        />
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                            Page {predictionPagination.page} / {predictionPagination.totalPages}
                                        </div>
                                        <div className="flex gap-3">
                                            <AdminButton
                                                onClick={() => goToPredictionPage(Math.max(1, predictionPagination.page - 1))}
                                                disabled={loadingPredictions || predictionPagination.page <= 1}
                                                variant="secondary"
                                                size="sm"
                                                className="flex-1 sm:flex-none"
                                            >
                                                Previous
                                            </AdminButton>
                                            <AdminButton
                                                onClick={() => goToPredictionPage(predictionPagination.page + 1)}
                                                disabled={loadingPredictions || predictionPagination.page >= predictionPagination.totalPages}
                                                variant="secondary"
                                                size="sm"
                                                className="flex-1 sm:flex-none"
                                            >
                                                Next
                                            </AdminButton>
                                        </div>
                                    </div>
                                </div>
                            </AdminCollapsibleSection>

                            <AdminCollapsibleSection title="Ручные корректировки" description={"Изменение баланса и кейсов"} keepMounted badge={<AdminBadge variant="warning" size="sm">ручная операция</AdminBadge>} storageKey="admin:users:adjustments">
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    <div className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 sm:p-5">
                                        <h3 className="text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Начисление / списание мячей</h3>
                                        <AdminInput
                                            label="Сумма (+ добавить, − списать)"
                                            type="number"
                                            inputMode="numeric"
                                            value={adjustBallsAmount}
                                            onChange={(e) => setAdjustBallsAmount(e.target.value)}
                                            placeholder="например +100 или -50"
                                        />
                                        <AdminInput
                                            label="Причина / комментарий"
                                            type="text"
                                            value={adjustBallsReason}
                                            onChange={(e) => setAdjustBallsReason(e.target.value)}
                                            placeholder="например: возврат за баг #123"
                                        />
                                        <AdminButton onClick={handleAdjustBalls} loading={actionLoading} disabled={!adjustBallsAmount} variant="warning" fullWidth>
                                            Применить корректировку мячей
                                        </AdminButton>
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 sm:p-5">
                                        <h3 className="text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Начисление / списание кейсов</h3>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <AdminSelect
                                                label="Тип кейса"
                                                value={adjustCasesType}
                                                onChange={setAdjustCasesType}
                                                options={[{ value: "premium", label: "Премиум" }, { value: "daily_free", label: "Ежедневный" }]}
                                            />
                                            <AdminInput
                                                label="Количество (+ или −)"
                                                type="number"
                                                inputMode="numeric"
                                                value={adjustCasesAmount}
                                                onChange={(e) => setAdjustCasesAmount(e.target.value)}
                                                placeholder="например +1 или -1"
                                            />
                                        </div>
                                        <AdminInput
                                            label="Причина / комментарий"
                                            type="text"
                                            value={adjustCasesReason}
                                            onChange={(e) => setAdjustCasesReason(e.target.value)}
                                            placeholder="например: победитель розыгрыша"
                                        />
                                        <AdminButton onClick={handleAdjustCases} loading={actionLoading} disabled={!adjustCasesAmount || !adjustCasesType} variant="warning" fullWidth>
                                            Применить корректировку кейсов
                                        </AdminButton>
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 sm:p-5">
                                        <h3 className="text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Начисление / списание жетонов</h3>
                                        <AdminInput
                                            label="Количество (+ добавить, − списать)"
                                            type="number"
                                            inputMode="numeric"
                                            value={adjustTokensAmount}
                                            onChange={(e) => setAdjustTokensAmount(e.target.value)}
                                            placeholder="например +3 или -1"
                                        />
                                        <AdminInput
                                            label="Причина / комментарий (обязательно)"
                                            type="text"
                                            value={adjustTokensReason}
                                            onChange={(e) => setAdjustTokensReason(e.target.value)}
                                            placeholder="например: компенсация прокрутки"
                                        />
                                        <AdminButton onClick={handleAdjustTokens} loading={actionLoading} disabled={!adjustTokensAmount || !adjustTokensReason.trim()} variant="warning" fullWidth>
                                            Применить корректировку жетонов
                                        </AdminButton>
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 sm:p-5">
                                        <h3 className="text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Начисление / списание звёзд</h3>
                                        <div className="text-[12px] font-semibold leading-snug text-[var(--tg-theme-hint-color,#999)]">
                                            Баланс активного сезона. Каждая операция пишется в stars_ledger и аудит-лог.
                                        </div>
                                        <AdminInput
                                            label="Количество (+ добавить, − списать)"
                                            type="number"
                                            inputMode="numeric"
                                            value={adjustStarsAmount}
                                            onChange={(e) => setAdjustStarsAmount(e.target.value)}
                                            placeholder="например +10 или -5"
                                        />
                                        <AdminInput
                                            label="Причина / комментарий (обязательно)"
                                            type="text"
                                            value={adjustStarsReason}
                                            onChange={(e) => setAdjustStarsReason(e.target.value)}
                                            placeholder="например: компенсация по платежу #123"
                                        />
                                        <AdminButton onClick={handleAdjustStars} loading={actionLoading} disabled={!adjustStarsAmount || !adjustStarsReason.trim()} variant="warning" fullWidth>
                                            Применить корректировку звёзд
                                        </AdminButton>
                                    </div>

                                    <div className="space-y-4 rounded-2xl border border-[color-mix(in_srgb,#ff5a52_35%,transparent)] bg-black/20 p-4 sm:p-5">
                                        <h3 className="text-[14px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Бан пользователя</h3>
                                        <div className="text-[12px] font-semibold leading-snug text-[var(--tg-theme-hint-color,#999)]">
                                            Забаненный пользователь теряет доступ ко всем функциям приложения. Админа забанить нельзя.
                                        </div>
                                        {Number(selectedUser.is_banned) !== 1 && (
                                            <AdminInput
                                                label="Причина бана (обязательно)"
                                                type="text"
                                                value={banReason}
                                                onChange={(e) => setBanReason(e.target.value)}
                                                placeholder="например: абьюз реферальной механики"
                                            />
                                        )}
                                        <AdminButton
                                            onClick={handleToggleBan}
                                            loading={actionLoading}
                                            disabled={Number(selectedUser.is_banned) !== 1 && !banReason.trim()}
                                            variant={Number(selectedUser.is_banned) === 1 ? "secondary" : "danger"}
                                            fullWidth
                                        >
                                            {Number(selectedUser.is_banned) === 1 ? "Разбанить пользователя" : "Забанить пользователя"}
                                        </AdminButton>
                                    </div>
                                </div>
                            </AdminCollapsibleSection>

                            <AdminCollapsibleSection title="История операций" description={`${userTransactions.length} операций`} storageKey="admin:users:transactions">
                                <div className="space-y-2">
                                    {userTransactions.length === 0 ? (
                                        <AdminCard className="border-dashed py-8 text-center text-[var(--tg-theme-hint-color,#999)]">No transactions recorded.</AdminCard>
                                    ) : (
                                        userTransactions.map((tx, idx) => (
                                            <div key={idx} className="space-y-2 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-3 sm:p-4">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <AdminBadge variant={tx.tx_type === "ball" ? "success" : "info"} size="sm">
                                                            {tx.tx_type === "ball" ? "Мячи" : `Кейс (${formatCaseType(tx.case_type)})`}
                                                        </AdminBadge>
                                                        <span className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">{formatAdminDate(tx.created_at)}</span>
                                                    </div>
                                                    <AdminBadge variant={tx.amount > 0 ? "success" : "danger"} size="sm">
                                                        {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                                                    </AdminBadge>
                                                </div>
                                                <div className="break-words text-[13px] text-[var(--tg-theme-text-color,#fff)]" title={tx.comment || tx.operation_type || undefined}>
                                                    {tx.comment ? tx.comment : tx.operation_type}
                                                    {tx.admin_user_id && <span className="ml-2 font-mono text-[10px] text-blue-400">(Admin: {tx.admin_user_id})</span>}
                                                </div>
                                                <div className="font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                                                    {tx.quantity_before} {"->"} <span className="text-[var(--tg-theme-text-color,#fff)]">{tx.quantity_after}</span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </AdminCollapsibleSection>
                        </div>
                    </AdminCard>
                </div>
            )}
        </div>
    );
}
