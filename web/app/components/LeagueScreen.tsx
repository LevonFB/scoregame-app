"use client";

import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { membersLabel } from "@/lib/plural";
import { Match, Result } from "./MatchesList";
import UserAvatar from "./UserAvatar";
import CropModal from "./CropModal";
import { getCroppedImg } from "@/lib/cropImage";
import { LeaderboardSeasonOption, LeaderboardSeasonSelector } from "./LeaderboardSeasonSelector";
import { getWeekKeyForDay } from "@/lib/weekKey";
import { getPublicDisplayName, getPublicProfileKey } from "@/lib/publicIdentity";
import { AppIcon } from "./ui/AppIcon";
import { SegmentedControl } from "./ui/SegmentedControl";

type Member = {
    user_id: number | null;
    profile_key?: string | null;
    display_name?: string | null;
    username?: string;
    first_name?: string;
    photo_url?: string;
    role: string;
    joined_at: string;
};

type League = {
    id: string;
    name: string;
    owner_id: number;
    privacy: string;
    type?: string;
    avatar_url?: string;
    avatar_type?: string;
    telegram_chat_title?: string;
    members_count: number;
    max_members?: number | null;
};

function RankMedal({ rank, size = 28 }: { rank: number; size?: number }) {
    if (rank === 1) return <AppIcon name="rank_gold" size={size} />;
    if (rank === 2) return <AppIcon name="rank_silver" size={size} />;
    if (rank === 3) return <AppIcon name="rank_bronze" size={size} />;
    return null;
}

type LeaderboardEntry = {
    id: number | null;
    profile_key?: string | null;
    display_name?: string | null;
    username?: string;
    first_name?: string;
    photo_url?: string;
    points: number;
};

type LeagueLeaderboardEmptyReason = "LEAGUE_NOT_IN_SEASON" | "NO_LEAGUE_DATA" | null;

export function LeagueScreen({
    initData,
    leagueId,
    currentDay,
    matches,
    results,
    refreshKey,
    onBack,
    onDeleted,
    onViewUser,
}: {
    initData: string;
    leagueId: string;
    currentDay: string;
    matches: Match[];
    results: Record<string, Result>;
    refreshKey?: number;
    onBack: () => void;
    onDeleted: () => void;
    onViewUser?: (profileKey: string) => void;
}) {
    const [league, setLeague] = useState<League | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [leaderboardEmptyReason, setLeaderboardEmptyReason] = useState<LeagueLeaderboardEmptyReason>(null);
    const [myRole, setMyRole] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"members" | "rating">("members");
    const [period, setPeriod] = useState<"day" | "week" | "season" | "all">("season");
    const [seasons, setSeasons] = useState<LeaderboardSeasonOption[]>([]);
    const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
    const [seasonLoading, setSeasonLoading] = useState(false);
    const [loading, setLoading] = useState(true);
    const [imgError, setImgError] = useState(false);

    // Invite modal
    const [inviteLink, setInviteLink] = useState<string | null>(null);

    // Delete modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTimer, setDeleteTimer] = useState(3);
    const [deleting, setDeleting] = useState(false);

    // Avatar state
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const [showAvatarMenu, setShowAvatarMenu] = useState(false);

    // Crop State
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    const loadLeague = async () => {
        try {
            const res = await apiFetch<{ ok: boolean; league: League; myRole: string }>(`/leagues/${leagueId}`, {
                method: "POST",
                body: JSON.stringify({ initData })
            });
            setLeague(res.league);
            setMyRole(res.myRole);
        } catch (e) {
            console.error(e);
        }
    };

    const loadMembers = async () => {
        try {
            const res = await apiFetch<{ ok: boolean; members: Member[] }>(`/leagues/${leagueId}/members`);
            setMembers(res.members || []);
        } catch (e) {
            console.error(e);
        }
    };

    const loadLeaderboard = async () => {
        try {
            const resolvedPeriod = period === "day"
                ? `day:${currentDay}`
                : period === "week"
                    ? `week:${getWeekKeyForDay(currentDay)}`
                    : period;
            const res = await apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[]; emptyReason?: LeagueLeaderboardEmptyReason }>(`/leagues/${leagueId}/leaderboard`, {
                method: "POST",
                body: JSON.stringify({
                    initData,
                    period: resolvedPeriod,
                    seasonId: period === "season" ? selectedSeasonId : null,
                    day: currentDay,
                })
            });
            setLeaderboard(res.leaderboard || []);
            setLeaderboardEmptyReason(res.emptyReason ?? null);
        } catch (e) {
            console.error(e);
            setLeaderboardEmptyReason(null);
        }
    };

    const loadSeasons = async () => {
        setSeasonLoading(true);
        try {
            const res = await apiFetch<{
                ok: boolean;
                seasons: LeaderboardSeasonOption[];
                defaultSeasonId: number | null;
            }>("/leaderboards/seasons");
            setSeasons(res?.ok ? (res.seasons || []) : []);
            setSelectedSeasonId((prev) => prev ?? res?.defaultSeasonId ?? res?.seasons?.[0]?.id ?? null);
        } catch (e) {
            console.error(e);
            setSeasons([]);
            setSelectedSeasonId(null);
        } finally {
            setSeasonLoading(false);
        }
    };

    useEffect(() => {
        setLoading(true);
        Promise.all([loadLeague(), loadMembers(), loadSeasons()]).finally(() => setLoading(false));
    }, [leagueId, initData, refreshKey]);

    useEffect(() => {
        if (activeTab === "rating" && (period !== "season" || selectedSeasonId)) {
            loadLeaderboard();
        }
    }, [activeTab, period, selectedSeasonId, leagueId, refreshKey, currentDay]);

    const createInvite = async () => {
        try {
            const res = await apiFetch<{ ok: boolean; deepLink: string }>(`/leagues/${leagueId}/invites`, {
                method: "POST",
                body: JSON.stringify({ initData })
            });
            if (res.ok) {
                setInviteLink(res.deepLink);
            }
        } catch (e: any) {
            alert(e?.message || "Ошибка");
        }
    };

    const shareInvite = () => {
        if (!inviteLink) return;
        // @ts-ignore
        const tg = window.Telegram?.WebApp;
        if (tg?.openTelegramLink) {
            tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(`Присоединяйся к лиге "${league?.name}"!`)}`);
        } else {
            navigator.clipboard.writeText(inviteLink);
            alert("Ссылка скопирована!");
        }
        setInviteLink(null);
    };

    const handleDeleteClick = () => {
        setShowDeleteModal(true);
        setDeleteTimer(3);
        const interval = setInterval(() => {
            setDeleteTimer(t => {
                if (t <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return t - 1;
            });
        }, 1000);
    };

    const confirmDelete = async () => {
        if (deleteTimer > 0 || deleting) return;
        setDeleting(true);
        try {
            await apiFetch(`/leagues/${leagueId}/delete`, {
                method: "POST",
                body: JSON.stringify({ initData })
            });
            // @ts-ignore
            window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
            setShowDeleteModal(false);
            onDeleted();
        } catch (e: any) {
            alert(e?.message || "Ошибка удаления");
        } finally {
            setDeleting(false);
        }
    };

    const kickMember = async (userId: number) => {
        if (!confirm("Удалить участника из лиги?")) return;
        try {
            await apiFetch(`/leagues/${leagueId}/kick`, {
                method: "POST",
                body: JSON.stringify({ initData, user_id: userId })
            });
            loadMembers();
        } catch (e: any) {
            alert(e?.message || "Ошибка");
        }
    };

    const leaveLeague = async () => {
        if (!confirm("Покинуть лигу?")) return;
        try {
            await apiFetch(`/leagues/${leagueId}/leave`, {
                method: "POST",
                body: JSON.stringify({ initData })
            });
            onBack();
        } catch (e: any) {
            alert(e?.message || "Ошибка");
        }
    };

    const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            setAvatarError("Выбери изображение.");
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            setAvatarError("Файл должен быть не больше 5 МБ.");
            return;
        }

        const reader = new FileReader();
        reader.addEventListener("load", () => {
            setImageSrc(reader.result?.toString() || null);
            setShowAvatarMenu(false);
            if (e.target) e.target.value = '';
        });
        reader.readAsDataURL(file);
    };

    const uploadCroppedAvatar = async (cropData: { x: number; y: number; width: number; height: number }) => {
        if (!imageSrc) return;
        setUploadingAvatar(true);
        setAvatarError(null);

        try {
            const croppedFile = await getCroppedImg(imageSrc, cropData);
            if (!croppedFile) throw new Error("Could not crop image");

            const formData = new FormData();
            formData.append("avatar", croppedFile);

            const res = await apiFetch<{ ok: boolean, avatar_url: string, error?: string }>(`/leagues/${leagueId}/avatar`, {
                method: "POST",
                headers: {
                    "x-telegram-init-data": initData
                },
                body: formData as any
            });

            if (res.ok) {
                setLeague(prev => prev ? { ...prev, avatar_url: `${res.avatar_url}?v=${Date.now()}` } : null);
                setImgError(false);
                setImageSrc(null); // Close cropper
            } else {
                console.error(res.error);
                setAvatarError("Не удалось загрузить аватарку. Попробуй ещё раз.");
            }
        } catch (e: any) {
            console.error(e);
            setAvatarError("Ошибка соединения. Попробуй позже.");
        } finally {
            setUploadingAvatar(false);
        }
    };

    const handleAvatarRemove = async () => {
        if (!confirm("Удалить текущую аватарку?")) return;
        setUploadingAvatar(true);
        setAvatarError(null);

        try {
            const res = await apiFetch<{ ok: boolean, error?: string }>(`/leagues/${leagueId}/avatar`, {
                method: "DELETE",
                headers: {
                    "x-telegram-init-data": initData
                }
            });

            if (res.ok) {
                setLeague(prev => prev ? { ...prev, avatar_url: undefined } : null);
                setImgError(false);
            } else {
                console.error(res.error);
                setAvatarError("Не удалось удалить аватарку.");
            }
        } catch (e: any) {
            console.error(e);
            setAvatarError("Не удалось удалить аватарку.");
        } finally {
            setUploadingAvatar(false);
        }
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: "center", color: "var(--tg-hint)" }}>Загрузка…</div>;
    }

    return (
        <div style={{ padding: "0 16px" }}>
            {/* Header */}
            <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
                padding: "12px 0",
            }}>
                <button onClick={onBack} style={{
                    background: "none", border: "none", color: "var(--tg-link)",
                    fontSize: 15, cursor: "pointer", padding: 0
                }}>
                    ← Назад
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={createInvite} style={{
                        padding: "8px 12px", background: "var(--tg-button)",
                        color: "var(--tg-button-text)", border: "none", borderRadius: 8,
                        fontSize: 13, fontWeight: 600, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 6
                    }}>
                        <AppIcon name="share_invite" size={20} /> Пригласить
                    </button>
                    {myRole === "owner" ? (
                        <button onClick={handleDeleteClick} style={{
                            padding: "8px 12px", background: "#ff3b30",
                            color: "#fff", border: "none", borderRadius: 8,
                            fontSize: 13, fontWeight: 600, cursor: "pointer"
                        }}>
                            🗑️
                        </button>
                    ) : (
                        <button onClick={leaveLeague} style={{
                            padding: "8px 12px", background: "var(--tg-secondary-bg)",
                            color: "var(--tg-hint)", border: "none", borderRadius: 8,
                            fontSize: 13, cursor: "pointer"
                        }}>
                            Выйти
                        </button>
                    )}
                </div>
            </div>

            {/* League Info */}
            <div style={{
                background: "var(--tg-bg)",
                borderRadius: 16,
                padding: 16,
                marginBottom: 16,
                textAlign: "center"
            }}>
                <div style={{ position: "relative", display: "inline-block", marginBottom: 8 }}>
                    {league?.type === 'channel' && league?.avatar_url && !imgError ? (
                        <img src={league.avatar_url} alt="" onError={() => setImgError(true)} style={{
                            width: 64, height: 64, borderRadius: '50%', objectFit: 'cover',
                        }} />
                    ) : (
                        <div style={{
                            width: 64, height: 64, borderRadius: '50%',
                            background: league?.type === 'channel'
                                ? 'linear-gradient(135deg, #007aff, #5856d6)'
                                : 'linear-gradient(135deg, #ff9500, #ff3b30)',
                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 28, fontWeight: 700, marginLeft: 'auto', marginRight: 'auto',
                        }}>
                            <AppIcon name={league?.type === 'channel' ? "league_channel" : "league_private"} size={34} />
                        </div>
                    )}

                    {/* Edit Avatar Controls (only for private league owners) */}
                    {false && myRole === "owner" && league?.type === 'private' && (
                        <div style={{
                            position: "absolute",
                            bottom: -4,
                            right: -8,
                            background: "var(--tg-button)",
                            borderRadius: "50%",
                            padding: 6,
                            cursor: "pointer",
                            display: "flex",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
                        }} onClick={() => setShowAvatarMenu(true)}>
                            <span style={{ fontSize: 14 }}>✏️</span>
                        </div>
                    )}
                </div>

                {false && uploadingAvatar && <div style={{ fontSize: 12, color: "var(--tg-hint)", marginBottom: 8 }}>Загрузка…</div>}
                {false && avatarError && <div style={{ fontSize: 12, color: "#ff3b30", marginBottom: 8 }}>{avatarError}</div>}

                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--tg-text)" }}>{league?.name}</div>
                <div style={{ fontSize: 14, color: "var(--tg-hint)", marginTop: 4 }}>
                    {membersLabel(members.length)} • {myRole === "owner" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", verticalAlign: "middle" }}>
                            <AppIcon name="owner_crown" size={16} />
                            <span>Владелец</span>
                        </span>
                    ) : "Участник"}
                </div>
            </div>

            {/* Inner Tabs */}
            <div style={{ marginBottom: 16 }}>
                <SegmentedControl
                    value={activeTab}
                    onChange={setActiveTab}
                    ariaLabel="Разделы лиги"
                    trackStyle={{
                        gap: 8,
                        padding: 4,
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
                        fontSize: 14,
                        fontWeight: 600,
                        transition: "color 180ms ease",
                    })}
                    items={[
                        { key: "members", content: "Участники" },
                        { key: "rating", content: "Рейтинг лиги" },
                    ]}
                />
            </div>

            {/* Content — Members */}
            {activeTab === "members" && (
                <div style={{ background: "var(--tg-bg)", borderRadius: 16, overflow: "hidden" }}>
                    {league?.max_members != null && (
                        <div style={{
                            padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
                            fontSize: 13, color: "var(--tg-hint)",
                            borderBottom: "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))",
                        }}>
                            <span>Участники</span>
                            <span style={{ fontWeight: 700, color: members.length >= league.max_members ? "#ff3b30" : "var(--tg-text)" }}>
                                {members.length}/{league.max_members}
                            </span>
                        </div>
                    )}
                    {members.length === 0 ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--tg-hint)" }}>
                            Только ты пока здесь. Пригласи друзей!
                        </div>
                    ) : (
                        members.map((m, i) => (
                            <div key={m.profile_key || m.user_id || i}
                                onClick={() => {
                                    const profileKey = getPublicProfileKey(m);
                                    if (profileKey) onViewUser?.(profileKey);
                                }}
                                style={{
                                    display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                                    borderBottom: i < members.length - 1 ? "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))" : "none",
                                    cursor: getPublicProfileKey(m) ? "pointer" : "default",
                                }}
                            >
                                <UserAvatar
                                    photoUrl={m.photo_url}
                                    name={getPublicDisplayName(m, "U")}
                                    size={40}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 500, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {getPublicDisplayName(m)}
                                        {m.role === "owner" && (
                                            <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 6, verticalAlign: "middle" }}>
                                                <AppIcon name="owner_crown" size={16} />
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {myRole === "owner" && m.role !== "owner" && m.user_id && (
                                    <button onClick={(e) => { e.stopPropagation(); kickMember(Number(m.user_id)); }} style={{
                                        background: "none", border: "none", color: "#ff3b30",
                                        fontSize: 12, cursor: "pointer", flexShrink: 0,
                                    }}>
                                        Удалить
                                    </button>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Content — Rating */}
            {activeTab === "rating" && (
                <>
                    {/* Period selector */}
                    <div style={{ marginBottom: period === "season" ? 12 : 16 }}>
                        <SegmentedControl
                            value={period}
                            onChange={(key) => setPeriod(key as "day" | "week" | "season" | "all")}
                            ariaLabel="Период рейтинга лиги"
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
                                { key: "week", content: "Неделя" },
                                { key: "day", content: "День" },
                                { key: "all", content: "Всё время" },
                            ]}
                        />
                    </div>

                    {period === "season" && (
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

                    {period === "season" && (
                        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--tg-hint)" }}>
                            Учитываются только очки, набранные внутри этой лиги.
                        </div>
                    )}

                    {period === "day" && (
                        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--tg-hint)" }}>
                            Показаны очки внутри этой лиги за день {currentDay}.
                        </div>
                    )}

                    {period === "week" && (
                        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--tg-hint)" }}>
                            Показаны очки внутри этой лиги за неделю {getWeekKeyForDay(currentDay)}.
                        </div>
                    )}

                    <div style={{ background: "var(--tg-bg)", borderRadius: 16, overflow: "hidden" }}>
                        {leaderboard.length === 0 ? (
                            <div style={{ padding: 40, textAlign: "center", color: "var(--tg-hint)" }}>
                                {period === "season" && seasons.length === 0
                                    ? "Нет доступных сезонов для рейтинга."
                                    : leaderboardEmptyReason === "LEAGUE_NOT_IN_SEASON"
                                        ? "Лига ещё не существовала в этом сезоне."
                                        : period === "season"
                                            ? "В этом сезоне по лиге пока нет данных."
                                            : "Пока нет очков. Делай прогнозы!"}
                            </div>
                        ) : (
                            leaderboard.map((entry, i) => (
                                <div key={entry.profile_key || entry.id || i}
                                    onClick={() => {
                                        const profileKey = getPublicProfileKey(entry);
                                        if (profileKey) onViewUser?.(profileKey);
                                    }}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                                        borderBottom: i < leaderboard.length - 1 ? "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))" : "none",
                                        cursor: getPublicProfileKey(entry) ? "pointer" : "default",
                                    }}
                                >
                                    <div style={{
                                        width: 34, fontWeight: 700, flexShrink: 0, textAlign: "center",
                                        color: i < 3 ? ["#ffd700", "#c0c0c0", "#cd7f32"][i] : "var(--tg-hint)",
                                        fontSize: 14, display: "flex", justifyContent: "center", alignItems: "center",
                                    }}>
                                        {i < 3 ? <RankMedal rank={i + 1} /> : `${i + 1}`}
                                    </div>
                                    <UserAvatar
                                        photoUrl={entry.photo_url}
                                        name={getPublicDisplayName(entry, "U")}
                                        size={36}
                                    />
                                    <div style={{
                                        flex: 1, minWidth: 0,
                                        fontWeight: 500, color: "var(--tg-text)",
                                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                    }}>
                                        {getPublicDisplayName(entry)}
                                    </div>
                                    <div style={{ fontWeight: 700, color: "var(--tg-link)", fontSize: 15, flexShrink: 0 }}>
                                        {entry.points} очков
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {/* Invite Modal */}
            {inviteLink && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.5)", display: "flex",
                    alignItems: "center", justifyContent: "center", zIndex: 9999,
                }} onClick={() => setInviteLink(null)}>
                    <div style={{
                        background: "var(--tg-bg)", padding: 24, borderRadius: 16,
                        width: "80%", maxWidth: 300, textAlign: "center",
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Ссылка готова!</div>
                        <div style={{ fontSize: 12, color: "var(--tg-hint)", marginBottom: 16, wordBreak: "break-all" }}>
                            {inviteLink}
                        </div>
                        <button onClick={shareInvite} style={{
                            width: "100%", padding: 12, background: "var(--tg-button)",
                            color: "var(--tg-button-text)", border: "none", borderRadius: 8,
                            fontWeight: 600, fontSize: 15,
                        }}>
                            Поделиться
                        </button>
                    </div>
                </div>
            )}

            {/* Delete Modal */}
            {showDeleteModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.5)", display: "flex",
                    alignItems: "center", justifyContent: "center", zIndex: 9999,
                }} onClick={() => setShowDeleteModal(false)}>
                    <div style={{
                        background: "var(--tg-bg)", padding: 24, borderRadius: 16,
                        width: "80%", maxWidth: 300, textAlign: "center",
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Удалить лигу &quot;{league?.name}&quot;?</div>
                        <div style={{
                            fontSize: 13, color: "var(--tg-hint)", marginBottom: 16,
                        }}>
                            Это действие нельзя отменить. Все участники будут исключены.
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setShowDeleteModal(false)} style={{
                                flex: 1, padding: 12, background: "var(--tg-secondary-bg)",
                                color: "var(--tg-text)", border: "none", borderRadius: 8,
                                fontWeight: 600, fontSize: 15,
                            }}>
                                Отмена
                            </button>
                            <button onClick={confirmDelete} disabled={deleteTimer > 0 || deleting} style={{
                                flex: 1, padding: 12, background: deleteTimer > 0 ? "#ccc" : "#ff3b30",
                                color: "#fff", border: "none", borderRadius: 8,
                                fontWeight: 600, fontSize: 15, opacity: deleteTimer > 0 || deleting ? 0.7 : 1,
                            }}>
                                {deleting ? "…" : deleteTimer > 0 ? `${deleteTimer}s` : "Удалить"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Avatar Action Menu */}
            {false && showAvatarMenu && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.5)", zIndex: 10000,
                    display: "flex", flexDirection: "column", justifyContent: "flex-end",
                }} onClick={() => setShowAvatarMenu(false)}>
                    <div style={{
                        background: "var(--tg-secondary-bg)",
                        borderTopLeftRadius: 16, borderTopRightRadius: 16,
                        padding: "16px 16px 32px",
                        display: "flex", flexDirection: "column", gap: 8,
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: "center", marginBottom: 8, fontSize: 16, fontWeight: 600, color: "var(--tg-text)" }}>
                            Аватарка лиги
                        </div>

                        <label style={{
                            padding: "12px", background: "var(--tg-bg)", borderRadius: 12,
                            color: "var(--tg-text)", textAlign: "center", fontSize: 16, cursor: "pointer",
                            fontWeight: 500, display: "block"
                        }}>
                            {league?.avatar_url ? "Изменить аватарку" : "Загрузить аватарку"}
                            <input
                                type="file"
                                accept="image/jpeg, image/png, image/webp, image/jpg"
                                style={{ display: "none" }}
                                onChange={(e) => {
                                    setShowAvatarMenu(false);
                                    onFileSelect(e);
                                }}
                                disabled={uploadingAvatar}
                            />
                        </label>

                        {league?.avatar_url && (
                            <button onClick={() => {
                                setShowAvatarMenu(false);
                                handleAvatarRemove();
                            }} style={{
                                padding: "12px", background: "var(--tg-bg)", borderRadius: 12,
                                border: "none", color: "#ff3b30", fontSize: 16, cursor: "pointer", fontWeight: 500
                            }}>
                                Удалить аватарку
                            </button>
                        )}

                        <button onClick={() => setShowAvatarMenu(false)} style={{
                            padding: "12px", background: "var(--tg-bg)", borderRadius: 12, marginTop: 8,
                            border: "none", color: "var(--tg-hint)", fontSize: 16, cursor: "pointer", fontWeight: 500
                        }}>
                            Отмена
                        </button>
                    </div>
                </div>
            )}
            {/* Crop Overlay Modal */}
            {false && imageSrc && (
                <CropModal
                    imageSrc={imageSrc || ""}
                    onCancel={() => setImageSrc(null)}
                    onCropComplete={uploadCroppedAvatar}
                />
            )}
        </div>
    );
}
