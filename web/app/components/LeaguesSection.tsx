"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { validateLeagueNameInput } from "@/lib/nameValidation";
import { membersLabel } from "@/lib/plural";
import { AppIcon } from "./ui/AppIcon";

type League = {
    id: string;
    name: string;
    owner_id: number;
    privacy: string;
    type: string;
    telegram_chat_id?: number;
    telegram_chat_title?: string;
    telegram_chat_username?: string;
    avatar_url?: string;
    avatar_type?: string;
    role: string;
    members_count: number;
};

type Limits = {
    ownedPrivate: number;
    ownedChannel: number;
    freePrivateLimit: number;
    freeChannelLimit: number;
    extraSlots: number;
};

type BindStatus = {
    status: string;
    channel?: { id: number; title: string; username: string } | null;
};

export const CHANNEL_BIND_FLAG = "sg_channel_bind_active";

function surfaceText(error: unknown, fallback: string) {
    const raw = String(error ?? "").split(" | url=")[0].trim();
    return raw || fallback;
}

// Marker that survives the Mini App restart caused by opening the bot deep link,
// so page.tsx can land the returning user on the leagues tab instead of home.
// The bind session itself lives on the server — this is only a routing hint.
function setBindFlag() {
    try { localStorage.setItem(CHANNEL_BIND_FLAG, "1"); } catch { }
}
function clearBindFlag() {
    try { localStorage.removeItem(CHANNEL_BIND_FLAG); } catch { }
}

export function LeaguesSection({
    initData,
    selectedLeagueId,
    onSelectLeague,
    onJoinSuccess,
}: {
    initData: string;
    selectedLeagueId: string | null;
    onSelectLeague: (id: string | null) => void;
    onJoinSuccess?: () => void;
}) {
    const [leagues, setLeagues] = useState<League[]>([]);
    const [limits, setLimits] = useState<Limits | null>(null);
    const [loading, setLoading] = useState(false);

    // Create flow
    const [showCreate, setShowCreate] = useState(false);
    const [createType, setCreateType] = useState<'private' | 'channel' | null>(null);
    const [newName, setNewName] = useState("");
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    // Channel bind flow
    const [bindToken, setBindToken] = useState<string | null>(null);
    const [bindDeepLink, setBindDeepLink] = useState<string | null>(null);
    const [bindStatus, setBindStatus] = useState<BindStatus | null>(null);
    const [bindPolling, setBindPolling] = useState(false);
    const pollRef = useRef<any>(null);
    const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

    // Invite
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [inviteLink, setInviteLink] = useState<string | null>(null);

    const loadLeagues = useCallback(async () => {
        if (!initData) return;
        setLoading(true);
        try {
            const res = await apiFetch<{ ok: boolean; leagues: League[]; limits: Limits }>("/leagues/my", {
                method: "POST",
                body: JSON.stringify({ initData }),
            });
            setLeagues(res.leagues || []);
            setLimits(res.limits || null);
            if (!selectedLeagueId && res.leagues?.length === 1) {
                onSelectLeague(res.leagues[0].id);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, [initData]);

    useEffect(() => {
        loadLeagues();
    }, [loadLeagues]);

    // Restore an in-flight channel bind. Opening the bot deep link restarts the
    // Mini App, so bindToken/bindStatus are gone by the time the user comes back —
    // only the server still knows the session. Without this the completed bind
    // looks "lost" and the user starts over.
    useEffect(() => {
        if (!initData) return;
        let active = true;
        (async () => {
            try {
                const res = await apiFetch<{ ok: boolean; bind: null | { token: string; status: BindStatus['status']; channel: BindStatus['channel'] } }>(
                    "/leagues/channel/active-bind",
                    { method: "POST", body: JSON.stringify({ initData }) }
                );
                if (!active || !res?.ok || !res.bind) {
                    if (active && res?.ok && !res.bind) clearBindFlag();
                    return;
                }
                setBindToken(res.bind.token);
                setBindStatus({ status: res.bind.status, channel: res.bind.channel });
                setBindPolling(res.bind.status === 'pending');
                setShowCreate(true);
                setCreateType('channel');
            } catch (e) { console.error(e); }
        })();
        return () => { active = false; };
        // Restore once per mount — later state changes must not re-trigger it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initData]);

    // Poll bind status
    useEffect(() => {
        if (!bindToken || !bindPolling) return;
        const poll = async () => {
            try {
                const res = await apiFetch<{ ok: boolean } & BindStatus>("/leagues/channel/bind-status", {
                    method: "POST",
                    body: JSON.stringify({ initData, token: bindToken }),
                });
                if (res.ok) {
                    setBindStatus({ status: res.status, channel: res.channel });
                    if (res.status === 'completed' || res.status === 'expired' || res.status === 'cancelled') {
                        setBindPolling(false);
                    }
                    if (res.status === 'expired' || res.status === 'cancelled') clearBindFlag();
                }
            } catch (e) { console.error(e); }
        };
        poll();
        pollRef.current = setInterval(poll, 3000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [bindToken, bindPolling, initData]);

    const canCreatePrivate = limits ? (limits.ownedPrivate < limits.freePrivateLimit || limits.extraSlots > 0) : true;
    const canCreateChannel = limits ? (limits.ownedChannel < limits.freeChannelLimit || limits.extraSlots > 0) : true;
    const needsVoucherPrivate = limits ? limits.ownedPrivate >= limits.freePrivateLimit : false;
    const needsVoucherChannel = limits ? limits.ownedChannel >= limits.freeChannelLimit : false;
    const privateLeagueNameValidation = validateLeagueNameInput(newName);

    const createLeague = async (type: 'private' | 'channel') => {
        if (!initData) return;
        if (type === 'private' && !privateLeagueNameValidation.ok) {
            setCreateError(privateLeagueNameValidation.error);
            return;
        }
        
        setCreating(true);
        setCreateError(null);
        try {
            if (type === 'channel') {
                if (!bindToken || bindStatus?.status !== 'completed') {
                    setCreateError("Сначала выбери канал через бота");
                    setCreating(false);
                    return;
                }
                const res = await apiFetch<{ ok: boolean; leagueId: string; error?: string }>("/leagues", {
                    method: "POST",
                    body: JSON.stringify({ initData, privacy: "private", type: 'channel', bindToken }),
                });
                if (res.ok) {
                    resetCreateForm();
                    await loadLeagues();
                    onSelectLeague(res.leagueId);
                }
            } else {
                const leagueTitle = privateLeagueNameValidation.ok ? privateLeagueNameValidation.title : newName.trim();
                const res = await apiFetch<{ ok: boolean; leagueId: string; error?: string }>("/leagues", {
                    method: "POST",
                    body: JSON.stringify({ initData, name: leagueTitle, privacy: "private", type: 'private' }),
                });
                if (res.ok) {
                    resetCreateForm();
                    await loadLeagues();
                    onSelectLeague(res.leagueId);
                }
            }
        } catch (e: any) {
            const code = e?.message || '';
            if (code === 'FREE_LIMIT_PRIVATE') setCreateError("Бесплатный лимит приватных лиг исчерпан. Купи ваучер на дополнительную лигу в магазине.");
            else if (code === 'FREE_LIMIT_CHANNEL') setCreateError("Бесплатный лимит лиг каналов исчерпан. Купи ваучер на дополнительную лигу в магазине.");
            else if (code === 'LEAGUE_NAME_DUPLICATE') setCreateError("У тебя уже есть лига с таким названием. Выбери другое.");
            else if (code === 'CHANNEL_ALREADY_BOUND') setCreateError("Этот канал уже привязан к другой лиге.");
            else if (code === 'BIND_NOT_FOUND') setCreateError("Привязка канала не найдена. Повтори привязку.");
            else if (code.includes("League name must be")) setCreateError("Название лиги должно быть от 2 до 50 символов.");
            else setCreateError(surfaceText(e, "Ошибка создания лиги"));
        } finally {
            setCreating(false);
        }
    };

    const startChannelBind = async () => {
        setCreateError(null);
        try {
            const res = await apiFetch<{ ok: boolean; token: string; deepLink: string; error?: string }>("/leagues/channel/start-bind", {
                method: "POST",
                body: JSON.stringify({ initData }),
            });
            if (res.ok) {
                setBindToken(res.token);
                setBindDeepLink(res.deepLink);
                setBindStatus(null);
                setBindPolling(true);
                setBindFlag();
                // Open bot deep link
                // @ts-ignore
                const tg = window.Telegram?.WebApp;
                if (tg?.openTelegramLink) {
                    tg.openTelegramLink(res.deepLink);
                } else {
                    window.open(res.deepLink, '_blank');
                }
            }
        } catch (e: any) {
            if (e?.message === 'FREE_LIMIT_CHANNEL') {
                setCreateError("Бесплатный лимит лиг каналов исчерпан. Купи ваучер на дополнительную лигу в магазине.");
            } else {
                setCreateError(surfaceText(e, "Ошибка"));
            }
        }
    };

    // Abort an in-flight bind (server-side too, so the bot session dies with it).
    // Nothing is refunded — the extra-league voucher is charged only when the league
    // is actually created.
    const cancelChannelBind = async () => {
        const token = bindToken;
        clearBindFlag();
        setBindPolling(false);
        if (pollRef.current) clearInterval(pollRef.current);
        setBindToken(null);
        setBindDeepLink(null);
        setBindStatus(null);
        setCreateError(null);
        if (!token || !initData) return;
        try {
            await apiFetch("/leagues/channel/cancel-bind", {
                method: "POST",
                body: JSON.stringify({ initData, token }),
            });
        } catch (e) { console.error(e); }
    };

    const resetCreateForm = () => {
        clearBindFlag();
        setShowCreate(false);
        setCreateType(null);
        setNewName("");
        setCreateError(null);
        setBindToken(null);
        setBindDeepLink(null);
        setBindStatus(null);
        setBindPolling(false);
        if (pollRef.current) clearInterval(pollRef.current);
    };

    const createInvite = async (leagueId: string) => {
        try {
            const res = await apiFetch<{ ok: boolean; code: string; deepLink: string }>(
                `/leagues/${leagueId}/invites`,
                { method: "POST", body: JSON.stringify({ initData }) }
            );
            if (res.ok) {
                setInviteCode(res.code);
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
            tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("Присоединяйся к моей лиге!")}`);
        } else {
            navigator.clipboard.writeText(inviteLink);
            alert("Ссылка скопирована!");
        }
        setInviteCode(null);
        setInviteLink(null);
    };

    return (
        <div style={{ padding: "0 16px", marginBottom: 16 }}>
            {/* Header */}
            <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
            }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--tg-text)" }}>
                    Мои лиги
                </h3>
                <button
                    onClick={() => { setShowCreate(!showCreate); if (showCreate) resetCreateForm(); }}
                    style={{
                        padding: "6px 12px",
                        background: "var(--tg-button)",
                        color: "var(--tg-button-text)",
                        border: "none",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                    }}
                >
                    + Создать
                </button>
            </div>

            {/* Create Form */}
            {showCreate && !createType && (
                <div style={{
                    padding: 16, background: "var(--tg-bg)", borderRadius: 12, marginBottom: 12,
                }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--tg-text)" }}>
                        Выбери тип лиги:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* Private */}
                        <button
                            onClick={() => setCreateType('private')}
                            style={{
                                padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(128,128,128,0.15)',
                                background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)',
                                cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                            }}
                        >
                            <AppIcon name="league_private" size={26} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>Приватная лига</div>
                                <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginTop: 2 }}>
                                    Лига по приглашениям для друзей
                                    {needsVoucherPrivate && <span style={{ color: '#ff9500' }}> • нужен ваучер</span>}
                                </div>
                            </div>
                        </button>
                        {/* Channel */}
                        <button
                            onClick={() => setCreateType('channel')}
                            style={{
                                padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(128,128,128,0.15)',
                                background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)',
                                cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                            }}
                        >
                            <AppIcon name="league_channel" size={26} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>Лига канала</div>
                                <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginTop: 2 }}>
                                    Привяжи Telegram-канал
                                    {needsVoucherChannel && <span style={{ color: '#ff9500' }}> • нужен ваучер</span>}
                                </div>
                            </div>
                        </button>
                    </div>
                    <button onClick={resetCreateForm} style={{
                        marginTop: 10, background: 'none', border: 'none', color: 'var(--tg-hint)',
                        fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'center', padding: 6,
                    }}>Отмена</button>
                </div>
            )}

            {/* Private League Create */}
            {showCreate && createType === 'private' && (
                <div style={{ padding: 16, background: "var(--tg-bg)", borderRadius: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "var(--tg-text)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <AppIcon name="league_private" size={22} />
                            <span>Новая приватная лига</span>
                        </span>
                    </div>
                    {needsVoucherPrivate && !canCreatePrivate && (
                        <div style={{ padding: 10, background: 'rgba(255,149,0,0.1)', borderRadius: 10, marginBottom: 10, fontSize: 13, color: '#ff9500' }}>
                            Бесплатный лимит исчерпан. Купи ваучер на дополнительную лигу в магазине.
                        </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                        <input
                            value={newName}
                            onChange={(e) => {
                                const nextValue = e.target.value;
                                setNewName(nextValue);
                                const validation = validateLeagueNameInput(nextValue);
                                setCreateError(validation.ok ? null : validation.error);
                            }}
                            placeholder="Название лиги"
                            maxLength={50}
                            style={{
                                flex: 1, padding: "10px 12px", borderRadius: 8,
                                border: "1px solid var(--tg-hint)", background: "var(--tg-secondary-bg)",
                                color: "var(--tg-text)", fontSize: 15,
                            }}
                        />
                        <button
                            onClick={() => createLeague('private')}
                            disabled={creating || !privateLeagueNameValidation.ok || (!canCreatePrivate)}
                            style={{
                                padding: "10px 16px", background: "var(--tg-button)",
                                color: "var(--tg-button-text)", border: "none", borderRadius: 8,
                                fontWeight: 600, opacity: creating || !privateLeagueNameValidation.ok ? 0.6 : 1,
                            }}
                        >
                            {creating ? "…" : "Создать"}
                        </button>
                    </div>
                    {createError && <div style={{ marginTop: 8, fontSize: 13, color: '#ff3b30' }}>{createError}</div>}
                    <button onClick={() => { setCreateType(null); setNewName(''); setCreateError(null); }} style={{
                        marginTop: 8, background: 'none', border: 'none', color: 'var(--tg-hint)', fontSize: 13, cursor: 'pointer',
                    }}>← Назад</button>
                </div>
            )}

            {/* Channel League Create */}
            {showCreate && createType === 'channel' && (
                <div style={{ padding: 16, background: "var(--tg-bg)", borderRadius: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--tg-text)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <AppIcon name="league_channel" size={22} />
                            <span>Новая лига канала</span>
                        </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginBottom: 10, lineHeight: 1.5 }}>
                        Канал привязывается в личке бота.
                        Создать лигу может только администратор канала. Боту права в канале не нужны.
                    </div>
                    {needsVoucherChannel && !canCreateChannel && (
                        <div style={{ padding: 10, background: 'rgba(255,149,0,0.1)', borderRadius: 10, marginBottom: 10, fontSize: 13, color: '#ff9500' }}>
                            Бесплатный лимит исчерпан. Купи ваучер на дополнительную лигу в магазине.
                        </div>
                    )}

                    {/* Step 1: Wait to select channel (no manual name needed) */}
                    {!bindToken && (
                        <>
                            <div style={{ fontSize: 13, color: 'var(--tg-text)', marginBottom: 12 }}>
                                Название лиги будет автоматически установлено из названия Telegram-канала.
                            </div>
                            <button
                                onClick={startChannelBind}
                                disabled={!canCreateChannel}
                                style={{
                                    width: '100%', padding: "12px", borderRadius: 10, border: 'none',
                                    background: canCreateChannel ? 'linear-gradient(135deg, #007aff, #0055cc)' : 'rgba(128,128,128,0.2)',
                                    color: '#fff', fontWeight: 700, fontSize: 14, cursor: canCreateChannel ? 'pointer' : 'default',
                                }}
                            >
                                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                    <AppIcon name="league_channel" size={20} />
                                    <span>Выбрать канал через бота</span>
                                </span>
                            </button>
                        </>
                    )}

                    {/* Step 2: Waiting for bind */}
                    {bindToken && bindStatus?.status === 'pending' && (
                        <div style={{ textAlign: 'center', padding: 16 }}>
                            <div style={{ fontSize: 20, marginBottom: 8 }}>⏳</div>
                            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Ожидаем выбор канала…</div>
                            <div style={{ fontSize: 12, color: 'var(--tg-hint)', marginBottom: 12 }}>
                                Выбери канал в личке бота и вернись сюда.
                            </div>
                            <button
                                onClick={() => {
                                    // @ts-ignore
                                    const tg = window.Telegram?.WebApp;
                                    if (tg?.openTelegramLink && bindDeepLink) {
                                        tg.openTelegramLink(bindDeepLink);
                                    }
                                }}
                                style={{
                                    padding: '10px 20px', borderRadius: 10, border: 'none',
                                    background: 'var(--tg-button)', color: 'var(--tg-button-text)',
                                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                }}
                            >
                                Открыть бота
                            </button>
                            <button
                                onClick={() => { void cancelChannelBind(); }}
                                style={{
                                    marginLeft: 8, padding: '10px 20px', borderRadius: 10,
                                    border: '1px solid rgba(255,59,48,0.35)', background: 'transparent',
                                    color: '#ff3b30', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                }}
                            >
                                Отменить
                            </button>
                        </div>
                    )}

                    {/* Step 3: Channel selected — confirm */}
                    {bindToken && bindStatus?.status === 'completed' && bindStatus.channel && (
                        <div style={{ padding: 12, background: 'rgba(52,199,89,0.1)', borderRadius: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#34c759', marginBottom: 4 }}>
                                ✅ Канал выбран
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--tg-text)' }}>
                                {bindStatus.channel.title || bindStatus.channel.username || 'Канал'}
                            </div>
                            <button
                                onClick={() => {
                                    createLeague('channel');
                                }}
                                disabled={creating}
                                style={{
                                    marginTop: 10, width: '100%', padding: "12px", borderRadius: 10, border: 'none',
                                    background: 'linear-gradient(135deg, #34c759, #28a745)',
                                    color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                                    opacity: creating ? 0.6 : 1,
                                }}
                            >
                                {creating ? "Создание…" : "Создать лигу канала"}
                            </button>
                            <button
                                onClick={() => { void cancelChannelBind(); }}
                                disabled={creating}
                                style={{
                                    marginTop: 8, width: '100%', padding: "10px", borderRadius: 10,
                                    border: '1px solid rgba(255,59,48,0.35)', background: 'transparent',
                                    color: '#ff3b30', fontWeight: 600, fontSize: 13,
                                    cursor: creating ? 'default' : 'pointer', opacity: creating ? 0.6 : 1,
                                }}
                            >
                                Отменить и выбрать другой канал
                            </button>
                        </div>
                    )}

                    {/* Expired */}
                    {bindToken && bindStatus?.status === 'expired' && (
                        <div style={{ padding: 12, background: 'rgba(255,59,48,0.1)', borderRadius: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 13, color: '#ff3b30' }}>
                                ⏱ Время привязки истекло. Попробуй заново.
                            </div>
                            <button
                                onClick={() => { setBindToken(null); setBindDeepLink(null); setBindStatus(null); }}
                                style={{
                                    marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none',
                                    background: 'var(--tg-button)', color: 'var(--tg-button-text)',
                                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                }}
                            >Повторить</button>
                        </div>
                    )}

                    {/* Cancelled (from the bot or from here) */}
                    {bindToken && bindStatus?.status === 'cancelled' && (
                        <div style={{ padding: 12, background: 'rgba(255,149,0,0.1)', borderRadius: 10, marginBottom: 10 }}>
                            <div style={{ fontSize: 13, color: '#ff9500' }}>
                                Привязка отменена. Ваучер дополнительной лиги не списан.
                            </div>
                            <button
                                onClick={() => { setBindToken(null); setBindDeepLink(null); setBindStatus(null); }}
                                style={{
                                    marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none',
                                    background: 'var(--tg-button)', color: 'var(--tg-button-text)',
                                    fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                }}
                            >Начать заново</button>
                        </div>
                    )}

                    {createError && <div style={{ marginTop: 8, fontSize: 13, color: '#ff3b30' }}>{createError}</div>}
                    <button onClick={() => { void cancelChannelBind(); setCreateType(null); resetCreateForm(); }} style={{
                        marginTop: 8, background: 'none', border: 'none', color: 'var(--tg-hint)', fontSize: 13, cursor: 'pointer',
                    }}>← Назад</button>
                </div>
            )}

            {/* Leagues List */}
            {loading ? (
                <div style={{ color: "var(--tg-hint)", fontSize: 14 }}>Загрузка…</div>
            ) : leagues.length === 0 ? (
                <div style={{
                    padding: 20, background: "var(--tg-bg)", borderRadius: 12,
                    textAlign: "center", color: "var(--tg-hint)",
                }}>
                    Ты пока не состоишь в лигах
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {leagues.map((l) => (
                        <div
                            key={l.id}
                            style={{
                                padding: 12,
                                background: selectedLeagueId === l.id ? "var(--tg-button)" : "var(--tg-bg)",
                                color: selectedLeagueId === l.id ? "var(--tg-button-text)" : "var(--tg-text)",
                                borderRadius: 12, display: "flex", justifyContent: "space-between",
                                alignItems: "center", cursor: "pointer",
                            }}
                            onClick={() => onSelectLeague(l.id)}
                        >
                            <div>
                                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {l.avatar_url && !imgErrors[l.id] ? (
                                        <img src={l.avatar_url} alt="" onError={() => setImgErrors(prev => ({ ...prev, [l.id]: true }))} style={{
                                            width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                                        }} />
                                    ) : (
                                        <div style={{
                                            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                            background: l.type === 'channel' ? 'linear-gradient(135deg, #007aff, #5856d6)' : 'linear-gradient(135deg, #ff9500, #ff3b30)',
                                            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 12, fontWeight: 700,
                                        }}>
                                            {l.type === 'channel' ? <AppIcon name="league_channel" size={22} /> : (l.name || 'L').charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    {l.name}
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.7 }}>
                                    {membersLabel(l.members_count)} • {l.role === "owner" ? (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", verticalAlign: "middle" }}>
                                            <AppIcon name="owner_crown" size={14} />
                                            <span>Владелец</span>
                                        </span>
                                    ) : "Участник"}
                                </div>
                            </div>
                            <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    createInvite(l.id);
                                }}
                                style={{
                                    padding: "6px 12px",
                                    background: selectedLeagueId === l.id ? "rgba(255,255,255,0.2)" : "var(--tg-secondary-bg)",
                                    color: selectedLeagueId === l.id ? "var(--tg-button-text)" : "var(--tg-link)",
                                    border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer",
                                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                                }}
                            >
                                <AppIcon name="share_invite" size={20} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Invite Modal */}
            {inviteLink && (
                <div
                    style={{
                        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                        background: "rgba(0,0,0,0.5)", display: "flex",
                        alignItems: "center", justifyContent: "center", zIndex: 9999,
                    }}
                    onClick={() => { setInviteCode(null); setInviteLink(null); }}
                >
                    <div
                        style={{
                            background: "var(--tg-bg)", padding: 24, borderRadius: 16,
                            width: "80%", maxWidth: 300, textAlign: "center",
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>Ссылка готова!</div>
                        <div style={{ fontSize: 12, color: "var(--tg-hint)", marginBottom: 16, wordBreak: "break-all" }}>
                            {inviteLink}
                        </div>
                        <button
                            onClick={shareInvite}
                            style={{
                                width: "100%", padding: 12, background: "var(--tg-button)",
                                color: "var(--tg-button-text)", border: "none", borderRadius: 8,
                                fontWeight: 600, fontSize: 15,
                            }}
                        >
                            Поделиться
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
