"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { membersLabel } from "@/lib/plural";
import { homeLeaderboardDeduper, viewerKeyPart } from "@/lib/requestDedupe";
import { firstNonEmpty, getPublicDisplayName, getPublicProfileKey } from "@/lib/publicIdentity";
import { HomeMyStanding } from "./HomeMyStanding";
import { Pressable } from "./ui/Pressable";
import { homeCardCtaPill, homeCardSurface } from "./homeCardStyles";

type League = {
    id: string;
    name: string;
    type: string;
    members_count: number;
    avatar_url?: string;
    telegram_chat_title?: string;
    telegram_chat_username?: string;
};

type LeaderboardEntry = {
    id: string | number;
    points?: number;
    score?: number;
    name?: string | null;
    telegram_chat_title?: string | null;
    telegram_chat_username?: string | null;
    first_name?: string | null;
    display_name?: string | null;
    username?: string | null;
    profile_key?: string | null;
    user_id?: number | string | null;
};

export function HomeLeaguesCarousel({ initData, me, lazyLoadV2 = false, flagsReady = true, onOpenLeague, onOpenLeaguesTab }: { initData: string, me: any, lazyLoadV2?: boolean, flagsReady?: boolean, onOpenLeague: (id: string) => void, onOpenLeaguesTab: () => void }) {
    const [leagues, setLeagues] = useState<League[]>([]);
    const [leaderboards, setLeaderboards] = useState<Record<string, { entries: LeaderboardEntry[], myRank: number | null, me: LeaderboardEntry | null }>>({});
    const [loading, setLoading] = useState(true);
    const activeRef = useRef(true);
    const loadedRef = useRef<Set<string>>(new Set()); // leagues already loaded/in-flight

    // Load ONE league leaderboard at most once (deduped). `force` re-fetches for a
    // manual refresh. Errors of one league never break others. (Stage 9)
    const loadLeague = useCallback(async (leagueId: string, force = false) => {
        if (!force && loadedRef.current.has(leagueId)) return;
        loadedRef.current.add(leagueId);
        const vk = viewerKeyPart(me);
        const fetchOne = () => apiFetch<{ ok: boolean; leaderboard: LeaderboardEntry[] }>(`/leagues/${leagueId}/leaderboard`, {
            method: "POST",
            body: JSON.stringify({ initData, period: "season" }),
        });
        try {
            const lbRes = force ? await fetchOne() : await homeLeaderboardDeduper.run(`league|${vk}|${leagueId}`, fetchOne);
            if (activeRef.current && lbRes.ok && lbRes.leaderboard) {
                setLeaderboards((prev) => ({ ...prev, [leagueId]: { entries: lbRes.leaderboard, myRank: null, me: null } }));
            }
        } catch (e) {
            console.error(e);
            loadedRef.current.delete(leagueId); // allow retry on error
        }
    }, [initData, me]);
    // Stable ref so the startup effect / observer don't re-run when `me` arrives.
    const loadLeagueRef = useRef(loadLeague);
    useEffect(() => { loadLeagueRef.current = loadLeague; }, [loadLeague]);

    useEffect(() => {
        // Gate on flagsReady so the lazy-vs-eager mode is final before the single load.
        if (!initData || !flagsReady) return;
        activeRef.current = true;
        loadedRef.current = new Set();

        const load = async () => {
            try {
                const res = await apiFetch<{ ok: boolean; leagues: League[] }>("/leagues/my", {
                    method: "POST",
                    body: JSON.stringify({ initData }),
                });
                if (!activeRef.current || !res.ok) return;

                const loadedLeagues = res.leagues || [];
                setLeagues(loadedLeagues);

                if (lazyLoadV2) {
                    // V2: load ONLY the primary (first/visible) league now. The rest load
                    // when their card scrolls into view (IntersectionObserver below).
                    if (loadedLeagues[0]) await loadLeagueRef.current(loadedLeagues[0].id);
                } else {
                    // Legacy: eagerly load up to 5 league leaderboards (current behavior).
                    await Promise.all(loadedLeagues.slice(0, 5).map((l) => loadLeagueRef.current(l.id)));
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (activeRef.current) setLoading(false);
            }
        };

        load();
        return () => { activeRef.current = false; };
    }, [initData, lazyLoadV2, flagsReady]);

    // Stage 9: lazy-load non-primary league cards when they appear (V2 only).
    const cardObserver = useRef<IntersectionObserver | null>(null);
    const observeCard = useCallback((node: HTMLElement | null) => {
        if (!lazyLoadV2 || !node || typeof IntersectionObserver === "undefined") return;
        if (!cardObserver.current) {
            cardObserver.current = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const id = (entry.target as HTMLElement).dataset.leagueId;
                        if (id) loadLeagueRef.current(id);
                    }
                }
            }, { threshold: 0.25 });
        }
        cardObserver.current.observe(node);
    }, [lazyLoadV2]);
    useEffect(() => () => { cardObserver.current?.disconnect(); cardObserver.current = null; }, []);

    const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

    if (loading) return null;
    if (leagues.length === 0) return null;

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ padding: "0 20px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>Мои лиги</h2>
            </div>
            
            <div className="sg-hide-scrollbar" style={{ display: "flex", alignItems: "flex-start", gap: 12, overflowX: "auto", padding: "0 16px 8px", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
                {leagues.slice(0, 5).map((league) => {
                    const lb = leaderboards[league.id]?.entries || [];
                    const top3 = lb.slice(0, 3);
                    const myProfileKey = me ? getPublicProfileKey(me) : null;
                    const myIndex = lb.findIndex((x: any) => getPublicProfileKey(x) === myProfileKey);
                    const myEntry = myIndex !== -1 ? lb[myIndex] : null;
                    const isMeInTop3 = myIndex >= 0 && myIndex < 3;

                    return (
                        <Pressable key={league.id} ref={observeCard} data-league-id={league.id} haptic="selection" onClick={() => onOpenLeague(league.id)} style={{
                            ...homeCardSurface,
                            scrollSnapAlign: "center",
                            flex: leagues.length === 1 ? "0 0 100%" : "0 0 85%",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            textAlign: "left",
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                                {league.avatar_url && !imgErrors[league.id] ? (
                                    <img src={league.avatar_url} alt="" onError={() => setImgErrors(prev => ({ ...prev, [league.id]: true }))} style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover" }} />
                                ) : (
                                    <div style={{
                                        width: 40, height: 40, borderRadius: "50%",
                                        background: league.type === "channel" ? "linear-gradient(135deg, #007aff, #5856d6)" : "linear-gradient(135deg, #ff9500, #ff3b30)",
                                        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700
                                    }}>
                                        {league.type === "channel" ? "📢" : "🔒"}
                                    </div>
                                )}
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 16, fontWeight: 800, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {league.name}
                                    </div>
                                    <div style={{ fontSize: 13, color: "var(--tg-hint)", fontWeight: 500 }}>
                                        {membersLabel(league.members_count)}
                                    </div>
                                </div>
                            </div>

                            {lb.length > 0 && (
                                <HomeMyStanding
                                    rank={myIndex >= 0 ? myIndex + 1 : null}
                                    points={myEntry ? (myEntry.score ?? myEntry.points ?? 0) : null}
                                />
                            )}

                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                                {top3.length === 0 ? (
                                    <div style={{ fontSize: 13, color: "var(--tg-hint)", textAlign: "center", padding: "10px 0" }}>
                                        Нет данных рейтинга
                                    </div>
                                ) : (
                                    top3.map((entry, idx) => {
                                        const name = getPublicDisplayName(entry, "Игрок");
                                        const pts = entry.score ?? entry.points ?? 0;
                                        const isMe = getPublicProfileKey(entry) === myProfileKey;
                                        return (
                                            <div key={idx} style={{ 
                                                display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14,
                                                padding: isMe ? "4px 8px" : "4px 0",
                                                background: isMe ? "color-mix(in srgb, var(--tg-button) 15%, transparent)" : "transparent",
                                                borderRadius: 8,
                                                margin: isMe ? "0 -8px" : "0"
                                            }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                    <span style={{ fontWeight: 800, color: ["#ffd700", "#c0c0c0", "#cd7f32"][idx] || "var(--tg-hint)", width: 16, textAlign: "center" }}>
                                                        {idx + 1}
                                                    </span>
                                                    <span style={{ fontWeight: 600, color: isMe ? "var(--tg-button)" : "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                        {name} {isMe && "(ты)"}
                                                    </span>
                                                </div>
                                                <span style={{ fontWeight: 800, color: "var(--tg-link)" }}>{pts}</span>
                                            </div>
                                        );
                                    })
                                )}

                                {!isMeInTop3 && myEntry && (
                                    <>
                                        {myIndex > 3 && <div style={{ textAlign: "center", color: "var(--tg-hint)", fontSize: 12, lineHeight: 0.5 }}>…</div>}
                                        <div style={{ 
                                            display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14,
                                            padding: "4px 8px", background: "color-mix(in srgb, var(--tg-button) 15%, transparent)", borderRadius: 8, margin: "0 -8px"
                                        }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                <span style={{ fontWeight: 800, color: "var(--tg-hint)", width: 16, textAlign: "center" }}>
                                                    {myIndex + 1}
                                                </span>
                                                <span style={{ fontWeight: 600, color: "var(--tg-button)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {getPublicDisplayName(myEntry, "Игрок")} (ты)
                                                </span>
                                            </div>
                                            <span style={{ fontWeight: 800, color: "var(--tg-link)" }}>{myEntry.score ?? myEntry.points ?? 0}</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div style={homeCardCtaPill}>Открыть лигу</div>
                        </Pressable>
                    );
                })}
            </div>
        </div>
    );
}
