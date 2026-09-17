"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { homeLeaderboardDeduper, viewerKeyPart } from "@/lib/requestDedupe";
import { getPublicDisplayName, getPublicProfileKey } from "@/lib/publicIdentity";
import { getWeekKeyForDay } from "@/lib/weekKey";
import { HomeMyStanding } from "./HomeMyStanding";
import { Pressable } from "./ui/Pressable";
import { homeCardCtaPill, homeCardSurface } from "./homeCardStyles";

type LeaderboardEntry = {
    id: string | number;
    // День/неделя: место с сервера, может быть общим (1, 2, 2, 4).
    rank?: number | null;
    profile_key?: string | null;
    display_name?: string | null;
    username?: string | null;
    first_name?: string | null;
    photo_url?: string | null;
    points?: number | null;
    score?: number | null;
};

type ViewerStanding = { rank: number; points: number; totalPlayers: number };
type PeriodData = { items: LeaderboardEntry[]; me: ViewerStanding | null; resolvedDay: string | null };
type GlobalLbResponse = { ok: boolean; leaderboard: LeaderboardEntry[]; me?: ViewerStanding | null; resolvedPeriod?: string };

const EMPTY_PERIOD: PeriodData = { items: [], me: null, resolvedDay: null };

export function HomeRatingCarousel({ currentDay, me, dedupeV2 = false, flagsReady = true, onOpenRating }: { currentDay: string, me: any, dedupeV2?: boolean, flagsReady?: boolean, onOpenRating: () => void }) {
    const [data, setData] = useState<{ day: PeriodData, week: PeriodData, season: PeriodData }>({ day: EMPTY_PERIOD, week: EMPTY_PERIOD, season: EMPTY_PERIOD });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Wait until feature flags are resolved so the (de)dupe mode is final before
        // the single load fires. flagsReady defaults true → unchanged when not gated.
        if (!flagsReady) return;
        let active = true;
        const load = async () => {
            try {
                const dayPeriod = `day:${currentDay}`;
                const weekPeriod = `week:${getWeekKeyForDay(currentDay)}`;
                const dayQ = new URLSearchParams({ period: dayPeriod, day: currentDay });
                const weekQ = new URLSearchParams({ period: weekPeriod, day: currentDay });
                const seasonQ = new URLSearchParams({ period: "season" });

                // Stage 9: when dedupe V2 is on, route identical global requests through
                // a shared in-flight coalescer keyed by viewer+period, so parallel/duplicate
                // loads share one network call. Default off => fetch directly (unchanged).
                const vk = viewerKeyPart(me);
                const getGlobal = (period: string, qs: string) =>
                    dedupeV2
                        ? homeLeaderboardDeduper.run(`global|${vk}|${period}`, () => apiFetch<GlobalLbResponse>(`/leaderboards/global?${qs}`)).catch(() => null)
                        : apiFetch<GlobalLbResponse>(`/leaderboards/global?${qs}`).catch(() => null);

                const [dRes, wRes, sRes] = await Promise.all([
                    getGlobal(dayPeriod, dayQ.toString()),
                    getGlobal(weekPeriod, weekQ.toString()),
                    getGlobal("season", seasonQ.toString()),
                ]);

                const toPeriod = (res: GlobalLbResponse | null): PeriodData => {
                    if (!res?.ok) return EMPTY_PERIOD;
                    const rp = String(res.resolvedPeriod || "");
                    return {
                        items: res.leaderboard || [],
                        me: res.me || null,
                        resolvedDay: rp.startsWith("day:") ? rp.slice(4) : null,
                    };
                };

                if (active) {
                    setData({
                        day: toPeriod(dRes),
                        week: toPeriod(wRes),
                        season: toPeriod(sRes),
                    });
                    setLoading(false);
                }
            } catch (e) {
                console.error(e);
                if (active) setLoading(false);
            }
        };
        load();
        return () => { active = false; };
        // me is intentionally NOT a dep: it only feeds the dedupe key (single user per
        // session) and re-running on me-arrival would double the requests.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDay, flagsReady, dedupeV2]);

    if (loading) return null;

    // The backend falls back to the previous day when today has no points yet —
    // show the actual day on the card instead of a misleading "За день".
    const dayFallback = data.day.resolvedDay && data.day.resolvedDay !== currentDay ? data.day.resolvedDay : null;
    const periods = [
        { key: 'day', label: 'За день', hint: dayFallback ? `результаты за ${dayFallback.slice(8, 10)}.${dayFallback.slice(5, 7)}` : null, items: data.day.items, me: data.day.me },
        { key: 'week', label: 'За неделю', hint: null as string | null, items: data.week.items, me: data.week.me },
        { key: 'season', label: 'За сезон', hint: null as string | null, items: data.season.items, me: data.season.me }
    ];

    const myProfileKey = me ? getPublicProfileKey(me) : null;

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ padding: "0 20px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>Рейтинг игроков</h2>
            </div>
            
            <div className="sg-hide-scrollbar" style={{ display: "flex", alignItems: "flex-start", gap: 12, overflowX: "auto", padding: "0 16px 8px", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
                {periods.map(period => {
                    const lb = period.items;
                    const top3 = lb.slice(0, 3);
                    const myIndex = lb.findIndex(x => getPublicProfileKey(x) === myProfileKey);
                    const myEntry = myIndex !== -1 ? lb[myIndex] : null;
                    // Server-computed standing over the FULL list — the visible list is
                    // capped at top-50, so this is the only truthful rank for everyone
                    // below the cap (keeps the home card in sync with the Rating tab).
                    const serverMe = period.me;
                    const myRank = myIndex >= 0 ? (myEntry?.rank ?? myIndex + 1) : (serverMe?.rank ?? null);
                    const myPoints = myEntry ? (myEntry.score ?? myEntry.points ?? 0) : (serverMe?.points ?? null);

                    // If user is in top3, we just highlight them there.
                    // If user is > top3, we show them at the bottom.
                    // If user not in leaderboard at all, we might show 0 points or omit.
                    const isMeInTop3 = myIndex >= 0 && myIndex < 3;

                    return (
                        <Pressable key={period.key} haptic="selection" onClick={onOpenRating} style={{
                            ...homeCardSurface,
                            scrollSnapAlign: "center",
                            flex: "0 0 85%",
                            padding: 16,
                            display: "flex",
                            flexDirection: "column",
                            textAlign: "left",
                        }}>
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--tg-text)" }}>
                                    {period.label}
                                </div>
                                {period.hint && (
                                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tg-hint)", marginTop: 2 }}>
                                        {period.hint}
                                    </div>
                                )}
                            </div>

                            <HomeMyStanding
                                rank={myRank}
                                points={myPoints}
                            />

                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                                {top3.length === 0 ? (
                                    <div style={{ fontSize: 13, color: "var(--tg-hint)", textAlign: "center", padding: "10px 0" }}>
                                        Нет данных
                                    </div>
                                ) : (
                                    top3.map((entry, idx) => {
                                        const name = getPublicDisplayName(entry, "Игрок");
                                        const pts = entry.score ?? entry.points ?? 0;
                                        const isMe = getPublicProfileKey(entry) === myProfileKey;
                                        const place = entry.rank ?? idx + 1;
                                        return (
                                            <div key={idx} style={{ 
                                                display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14,
                                                padding: isMe ? "4px 8px" : "4px 0",
                                                background: isMe ? "color-mix(in srgb, var(--tg-button) 15%, transparent)" : "transparent",
                                                borderRadius: 8,
                                                margin: isMe ? "0 -8px" : "0"
                                            }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                    <span style={{ fontWeight: 800, color: ["#ffd700", "#c0c0c0", "#cd7f32"][place - 1] || "var(--tg-hint)", width: 16, textAlign: "center" }}>
                                                        {place}
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

                                {!isMeInTop3 && myRank != null && (
                                    <>
                                        {(myIndex >= 0 ? myIndex > 3 : myRank > 4) && <div style={{ textAlign: "center", color: "var(--tg-hint)", fontSize: 12, lineHeight: 0.5 }}>…</div>}
                                        <div style={{
                                            display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 14,
                                            padding: "4px 8px", background: "color-mix(in srgb, var(--tg-button) 15%, transparent)", borderRadius: 8, margin: "0 -8px"
                                        }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                <span style={{ fontWeight: 800, color: "var(--tg-hint)", width: 16, textAlign: "center" }}>
                                                    {myRank}
                                                </span>
                                                <span style={{ fontWeight: 600, color: "var(--tg-button)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                                    {getPublicDisplayName(myEntry ?? me ?? {}, "Игрок")} (ты)
                                                </span>
                                            </div>
                                            <span style={{ fontWeight: 800, color: "var(--tg-link)" }}>{myPoints ?? 0}</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div style={homeCardCtaPill}>Весь рейтинг</div>
                        </Pressable>
                    );
                })}
            </div>
        </div>
    );
}
