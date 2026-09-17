"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { membersLabel } from "@/lib/plural";
import UserAvatar from "./UserAvatar";
import { LeaderboardSeasonOption, LeaderboardSeasonSelector } from "./LeaderboardSeasonSelector";
import { firstNonEmpty, getPublicDisplayName, getPublicProfileKey } from "@/lib/publicIdentity";
import { getWeekKeyForDay } from "@/lib/weekKey";
import { AppIcon } from "./ui/AppIcon";
import { SegmentedControl } from "./ui/SegmentedControl";

type LeaderboardEntry = {
    id: string | number;
    rank?: number | null;
    profile_key?: string | null;
    display_name?: string | null;
    username?: string | null;
    first_name?: string | null;
    photo_url?: string | null;
    points?: number | null;
    name?: string | null;
    members_count?: number | null;
    score?: number | null;
    type?: string | null;
    avatar_url?: string | null;
    avatar_type?: string | null;
    telegram_chat_title?: string | null;
    telegram_chat_username?: string | null;
};

type RatingType = "global" | "topLeagues" | "topChannels";

// Rating tabs, with the subsection keys the admin visibility settings use.
const RATING_TYPE_TABS: Array<{ id: RatingType; label: string; subsectionKey: string }> = [
    { id: "global", label: "Игроки", subsectionKey: "leaderboard.players" },
    { id: "topLeagues", label: "Лиги", subsectionKey: "leaderboard.leagues" },
    { id: "topChannels", label: "Каналы", subsectionKey: "leaderboard.channels" },
];
export const RATING_TYPE_SUBSECTION_KEYS = RATING_TYPE_TABS.map((t) => t.subsectionKey);
type RatingPeriod = "season" | "day" | "week" | "all";
type ViewerStanding = { rank: number; points: number; totalPlayers: number };

function pointsWord(n: number): string {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs >= 11 && abs <= 19) return "очков";
    if (last === 1) return "очко";
    if (last >= 2 && last <= 4) return "очка";
    return "очков";
}

function RankMedal({ rank, size = 28 }: { rank: number; size?: number }) {
    if (rank === 1) return <AppIcon name="rank_gold" size={size} />;
    if (rank === 2) return <AppIcon name="rank_silver" size={size} />;
    if (rank === 3) return <AppIcon name="rank_bronze" size={size} />;
    return null;
}

function formatDayShort(day: string): string {
    return `${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}

function normalizeLeaderboardRows(rows: LeaderboardEntry[], type: RatingType): LeaderboardEntry[] {
    const isLeagueType = type !== "global";

    return rows.flatMap((entry) => {
        const displayName = isLeagueType
            ? firstNonEmpty(entry.name, entry.telegram_chat_title, entry.telegram_chat_username)
            : getPublicDisplayName(entry);
        const pointsValue = isLeagueType ? toFiniteNumber(entry.score) : toFiniteNumber(entry.points);

        if (!displayName || pointsValue === null || (isLeagueType ? pointsValue <= 0 : pointsValue < 0)) return [];

        return [{
            ...entry,
            name: isLeagueType ? displayName : entry.name,
            score: isLeagueType ? pointsValue : entry.score,
            points: isLeagueType ? entry.points : pointsValue,
            members_count: toFiniteNumber(entry.members_count) ?? 0,
        }];
    });
}

// djb2 — league ids are UUIDs, so a plain char-code sum would cluster them
// across the small palette; this spreads them evenly.
function hashToIndex(value: string, buckets: number): number {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % buckets;
}

function LeagueAvatar({ entry, size = 36 }: { entry: LeaderboardEntry; size?: number }) {
    const [imgError, setImgError] = useState(false);
    const avatarUrl = entry.avatar_url || null;
    const name = firstNonEmpty(entry.name, entry.telegram_chat_title, entry.telegram_chat_username) || "L";
    const isChannel = entry.type === "channel";
    const initial = name.charAt(0).toUpperCase();

    if (avatarUrl && !imgError) {
        return (
            <img
                src={avatarUrl}
                alt=""
                onError={() => setImgError(true)}
                style={{
                    width: size,
                    height: size,
                    borderRadius: "50%",
                    objectFit: "cover",
                    flexShrink: 0,
                }}
            />
        );
    }

    const COLORS = ["#007aff", "#5856d6", "#ff9500", "#af52de", "#34c759", "#ff3b30", "#5ac8fa", "#ff2d55"];
    // Keyed by league id, not by name: two leagues sharing a name would
    // otherwise get the same letter AND the same colour, leaving the rows
    // indistinguishable in the ratings tab.
    const bg = COLORS[hashToIndex(String(entry.id ?? name), COLORS.length)];

    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: isChannel ? `linear-gradient(135deg, ${bg}, ${bg}cc)` : bg,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: Math.round(size * 0.42),
                fontWeight: 700,
                flexShrink: 0,
            }}
        >
            {isChannel ? <AppIcon name="league_channel" size={Math.round(size * 0.72)} /> : initial}
        </div>
    );
}

export function RatingTab({
    currentDay,
    onViewUser,
    refreshKey = 0,
    hiddenSubsections,
}: {
    currentDay: string;
    onViewUser?: (profileKey: string) => void;
    refreshKey?: number;
    // Subsection keys hidden by an admin (leaderboard.players / .leagues / .channels).
    hiddenSubsections?: string[];
}) {
    const visibleTypeTabs = RATING_TYPE_TABS.filter((t) => !hiddenSubsections?.includes(t.subsectionKey));
    const [activeType, setActiveType] = useState<RatingType>("global");
    const [period, setPeriod] = useState<RatingPeriod>("season");
    const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
    const [seasons, setSeasons] = useState<LeaderboardSeasonOption[]>([]);
    const [data, setData] = useState<LeaderboardEntry[]>([]);
    const [myStanding, setMyStanding] = useState<ViewerStanding | null>(null);
    // The backend silently falls back to the previous day when the requested day
    // has no points yet — surface the actually shown day instead of lying.
    const [resolvedDay, setResolvedDay] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [seasonLoading, setSeasonLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadSeasons = async () => {
            setSeasonLoading(true);
            try {
                const res = await apiFetch<{
                    ok: boolean;
                    seasons: LeaderboardSeasonOption[];
                    defaultSeasonId: number | null;
                }>("/leaderboards/seasons");

                if (cancelled) return;

                const items = res?.ok ? (res.seasons || []) : [];
                setSeasons(items);
                setSelectedSeasonId((prev) => prev ?? res?.defaultSeasonId ?? items[0]?.id ?? null);
            } catch (e) {
                console.error(e);
                if (!cancelled) {
                    setSeasons([]);
                    setSelectedSeasonId(null);
                }
            } finally {
                if (!cancelled) setSeasonLoading(false);
            }
        };

        loadSeasons();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadLeaderboard = async () => {
            if (period === "season" && !selectedSeasonId) {
                setData([]);
                return;
            }

            setLoading(true);
            try {
                const query = new URLSearchParams();
                if (period === "season") {
                    query.set("period", "season");
                    query.set("seasonId", String(selectedSeasonId));
                } else if (period === "day") {
                    query.set("period", `day:${currentDay}`);
                    query.set("day", currentDay);
                } else if (period === "week") {
                    query.set("period", `week:${getWeekKeyForDay(currentDay)}`);
                    query.set("day", currentDay);
                } else {
                    query.set("period", "all");
                }

                let rows: LeaderboardEntry[] = [];
                let me: ViewerStanding | null = null;
                let resolvedPeriod = "";

                if (activeType === "global") {
                    const res = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[]; me?: ViewerStanding | null; resolvedPeriod?: string }>(`/leaderboards/global?${query.toString()}`);
                    rows = res.leaderboard || [];
                    me = res.me || null;
                    resolvedPeriod = String(res.resolvedPeriod || "");
                } else if (activeType === "topChannels") {
                    const res = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[]; resolvedPeriod?: string }>(`/leaderboards/channels?${query.toString()}`);
                    rows = res.leaderboard || [];
                    resolvedPeriod = String(res.resolvedPeriod || "");
                } else {
                    const res = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[]; resolvedPeriod?: string }>(`/leaderboards/leagues?${query.toString()}`);
                    rows = res.leaderboard || [];
                    resolvedPeriod = String(res.resolvedPeriod || "");
                }

                if (!cancelled) {
                    setData(normalizeLeaderboardRows(rows, activeType));
                    setMyStanding(me);
                    setResolvedDay(resolvedPeriod.startsWith("day:") ? resolvedPeriod.slice(4) : null);
                }
            } catch (e) {
                console.error(e);
                if (!cancelled) { setData([]); setMyStanding(null); setResolvedDay(null); }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadLeaderboard();
        return () => {
            cancelled = true;
        };
    }, [activeType, currentDay, period, selectedSeasonId, refreshKey]);

    // Land on a visible tab when an admin hid the current one.
    const visibleTypeKey = visibleTypeTabs.map((t) => t.id).join(",");
    useEffect(() => {
        if (visibleTypeTabs.length === 0) return;
        if (visibleTypeTabs.some((t) => t.id === activeType)) return;
        setActiveType(visibleTypeTabs[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleTypeKey, activeType]);

    const isLeagueType = activeType !== "global";
    const showSeasonSelector = period === "season";

    // Every rating tab hidden by an admin → nothing meaningful to render.
    if (visibleTypeTabs.length === 0) {
        return (
            <div style={{ padding: 16, textAlign: "center", color: "var(--tg-hint)", fontSize: 13, fontWeight: 700 }}>
                Подразделы рейтинга временно недоступны.
            </div>
        );
    }

    return (
        <div style={{ padding: "0 16px" }}>
            <div style={{ marginBottom: 12, display: visibleTypeTabs.length > 1 ? undefined : "none" }}>
                <SegmentedControl
                    value={activeType}
                    onChange={(key) => setActiveType(key as RatingType)}
                    ariaLabel="Тип рейтинга"
                    trackStyle={{
                        gap: 4,
                        padding: 3,
                        borderRadius: 12,
                        background: "var(--tg-secondary-bg)",
                    }}
                    pillStyle={{
                        borderRadius: 8,
                        background: "var(--tg-bg)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    }}
                    itemStyle={(active) => ({
                        padding: "10px 4px",
                        borderRadius: 8,
                        color: active ? "var(--tg-text)" : "var(--tg-hint)",
                        fontSize: 13,
                        fontWeight: 600,
                        transition: "color 180ms ease",
                    })}
                    items={visibleTypeTabs.map((t) => ({ key: t.id, content: t.label }))}
                />
            </div>

            <div style={{ marginBottom: showSeasonSelector ? 12 : 16 }}>
                <SegmentedControl
                    value={period}
                    onChange={(key) => setPeriod(key as RatingPeriod)}
                    ariaLabel="Период рейтинга"
                    trackStyle={{
                        gap: 4,
                        padding: 3,
                        borderRadius: 16,
                        background: "var(--tg-secondary-bg)",
                    }}
                    pillStyle={{
                        borderRadius: 13,
                        background: "var(--tg-button)",
                    }}
                    itemStyle={(active) => ({
                        padding: "6px 4px",
                        borderRadius: 13,
                        color: active ? "var(--tg-button-text)" : "var(--tg-hint)",
                        fontSize: 12,
                        transition: "color 180ms ease",
                    })}
                    items={[
                        { key: "season", content: "Сезон" },
                        { key: "day", content: "День" },
                        { key: "week", content: "Неделя" },
                        { key: "all", content: "Всё время" },
                    ]}
                />
            </div>

            {showSeasonSelector && (
                seasonLoading ? (
                    <div style={{ marginBottom: 16, fontSize: 12, color: "var(--tg-hint)" }}>Загрузка сезонов…</div>
                ) : (
                    <LeaderboardSeasonSelector
                        seasons={seasons}
                        selectedSeasonId={selectedSeasonId}
                        onSelect={setSelectedSeasonId}
                    />
                )
            )}

            {!loading && period === "day" && resolvedDay && resolvedDay !== currentDay && data.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 12, color: "var(--tg-hint)", textAlign: "center" }}>
                    За сегодня очков ещё нет — показан последний день с результатами ({formatDayShort(resolvedDay)}).
                </div>
            )}

            {loading ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--tg-hint)" }}>Загрузка…</div>
            ) : data.length === 0 ? (
                <div
                    style={{
                        textAlign: "center",
                        padding: 40,
                        background: "var(--tg-bg)",
                        borderRadius: 16,
                    }}
                >
                    <div style={{ marginBottom: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                        <AppIcon name="rating" size={40} />
                    </div>
                    <div style={{ color: "var(--tg-hint)" }}>
                        {showSeasonSelector && seasons.length === 0
                            ? "Нет доступных сезонов для рейтинга"
                            : "Нет данных для выбранного рейтинга"}
                    </div>
                </div>
            ) : (
                <div style={{ background: "var(--tg-bg)", borderRadius: 16 }}>
                    {data.map((entry, i) => {
                        const displayName = isLeagueType
                            ? firstNonEmpty(entry.name, entry.telegram_chat_title, entry.telegram_chat_username)
                            : getPublicDisplayName(entry);
                        const pointsValue = isLeagueType ? entry.score : entry.points;
                        const profileKey = getPublicProfileKey(entry);
                        // День/неделя приходят с общим местом (1, 2, 2, 4); остальное — по позиции.
                        const place = toFiniteNumber(entry.rank) ?? i + 1;

                        return (
                            <div
                                key={`${activeType}-${profileKey ?? entry.id ?? i}`}
                                onClick={() => activeType === "global" && profileKey && onViewUser?.(profileKey)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "10px 16px",
                                    borderBottom: i < data.length - 1 ? "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))" : "none",
                                    cursor: activeType === "global" && profileKey ? "pointer" : "default",
                                }}
                            >
                                <div
                                    style={{
                                        width: 34,
                                        flexShrink: 0,
                                        fontWeight: 700,
                                        color: place <= 3 ? ["#ffd700", "#c0c0c0", "#cd7f32"][place - 1] : "var(--tg-hint)",
                                        fontSize: 14,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    {place <= 3 ? <RankMedal rank={place} /> : `${place}`}
                                </div>

                                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, marginLeft: 8 }}>
                                    {activeType === "global" ? (
                                        <UserAvatar
                                            photoUrl={entry.photo_url || undefined}
                                            name={displayName || "U"}
                                            size={36}
                                        />
                                    ) : (
                                        <LeagueAvatar entry={entry} size={36} />
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontWeight: 500,
                                                color: "var(--tg-text)",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                maxWidth: 160,
                                            }}
                                        >
                                            {displayName}
                                        </div>
                                        {isLeagueType && (
                                            <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                                                {membersLabel(entry.members_count ?? 0)}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div style={{ fontWeight: 700, color: "var(--tg-link)", fontSize: 15, flexShrink: 0 }}>
                                    {pointsValue} {pointsWord(toFiniteNumber(pointsValue) ?? 0)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Viewer's own standing — always visible for the player rating, even outside the top
                list. Sticky to the bottom of the viewport so the player sees their rank without
                scrolling to the end; once scrolled all the way down it settles into the flow. */}
            {!loading && activeType === "global" && myStanding && (
                <div
                    style={{
                        position: "sticky",
                        bottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
                        zIndex: 30,
                        marginTop: 10,
                        marginBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 16px",
                        borderRadius: 16,
                        background: "color-mix(in srgb, var(--tg-button) 12%, var(--tg-bg))",
                        border: "1px solid color-mix(in srgb, var(--tg-button) 30%, transparent)",
                        boxShadow: "0 6px 20px rgba(0,0,0,0.28)",
                        backdropFilter: "blur(12px)",
                        WebkitBackdropFilter: "blur(12px)",
                    }}
                >
                    <div
                        style={{
                            width: 34,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 800,
                            fontSize: 14,
                            color: "var(--tg-button)",
                        }}
                    >
                        {myStanding.rank <= 3 ? <RankMedal rank={myStanding.rank} /> : `#${myStanding.rank}`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "var(--tg-text)" }}>Твоё место</div>
                        <div style={{ fontSize: 12, color: "var(--tg-hint)" }}>
                            из {myStanding.totalPlayers} игроков
                        </div>
                    </div>
                    <div style={{ fontWeight: 800, color: "var(--tg-button)", fontSize: 15, flexShrink: 0 }}>
                        {myStanding.points} {pointsWord(myStanding.points)}
                    </div>
                </div>
            )}
        </div>
    );
}
