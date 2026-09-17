"use client";

import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminBadge, AdminButton, AdminDataRow, AdminMetricCard } from "./components/ui";
import { formatAdminDate } from "@/lib/adminUtils";

export type AdminStatsData = {
    totalUsers: number;
    activeUsers7d: number;
    totalLeagues: number;
    totalMatches: number;
    matchesToday: number;
    totalPicks: number;
    picksToday: number;
    seasonMatches: number;
    seasonPicks: number;
    overview: {
        totalUsers: number;
        activeUsers7d: number;
        activeUsersToday: number;
        newUsersToday: number;
        totalLeagues: number;
        privateLeagues: number;
        channelLeagues: number;
        totalMatches: number;
        totalPicks: number;
    };
    today: {
        day: string;
        matches: number;
        picks: number;
        activeUsers: number;
        newUsers: number;
        leaguesWithScores: number;
        picksPerUser: number;
        picksPerMatch: number;
        matchStatus: {
            scheduled: number;
            live: number;
            finished: number;
            blocked: number;
        };
    };
    botReach?: {
        reachable: number;
        blocked: number;
        total: number;
    };
    stars?: {
        orders: number;
        revenue: number;
    };
    leagues: {
        total: number;
        private: number;
        channel: number;
        memberships: number;
        avgMembersPerLeague: number;
    };
    season: {
        id: number;
        number: number;
        name: string;
        status: string;
        start: string;
        end: string;
        matches: number;
        picks: number;
        totalDays: number;
        elapsedDays: number;
        remainingDays: number;
        progressPct: number;
        avgPicksPerMatch: number;
    };
    trend7d: Array<{
        day: string;
        matches: number;
        picks: number;
        activeUsers: number;
        newUsers?: number;
    }>;
};

function compactNumber(value: number) {
    return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function oneDecimal(value: number) {
    return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function getSeasonBadgeVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
    if (status === "active") return "success";
    if (status === "finalizing") return "warning";
    if (status === "finished") return "info";
    if (status === "upcoming") return "neutral";
    return "neutral";
}

export default function StatsTab({
    stats,
    updatedAt,
    loading,
    onRefresh,
}: {
    stats: AdminStatsData | null;
    updatedAt: string;
    loading: boolean;
    onRefresh: () => void;
}) {
    if (loading) {
        return (
            <AdminCard className="text-center text-[var(--tg-theme-hint-color,#999)] py-12 animate-pulse shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                <div className="w-8 h-8 rounded-full border-2 border-t-[var(--tg-theme-button-color,#007aff)] border-[var(--tg-theme-hint-color,rgba(255,255,255,0.1))] animate-spin mx-auto mb-4"></div>
                Загружаем дашборд...
            </AdminCard>
        );
    }

    if (!stats) {
        return (
            <AdminCard className="text-center text-[var(--tg-theme-hint-color,#999)] py-12 border-dashed">
                Нет данных статистики.
            </AdminCard>
        );
    }

    const maxPicks = Math.max(...stats.trend7d.map((item) => item.picks), 1);
    const maxActiveUsers = Math.max(...stats.trend7d.map((item) => item.activeUsers), 1);
    const maxNewUsers = Math.max(...stats.trend7d.map((item) => item.newUsers ?? 0), 1);
    const totalStatuses = Math.max(
        stats.today.matchStatus.scheduled +
        stats.today.matchStatus.live +
        stats.today.matchStatus.finished +
        stats.today.matchStatus.blocked,
        1
    );

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <AdminCard className="p-0 overflow-hidden shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-1 h-4 bg-cyan-500 rounded-full"></div>
                            <h2 className="text-[17px] font-bold tracking-tight text-[var(--tg-theme-text-color,#fff)]">
                                Дашборд
                            </h2>
                        </div>
                        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                            Сводка по пользователям, матчам, прогнозам и текущему сезону.
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <AdminBadge variant="neutral">
                            Обновлено: {formatAdminDate(updatedAt)}
                        </AdminBadge>
                        <AdminButton variant="secondary" size="sm" onClick={onRefresh}>
                            Обновить
                        </AdminButton>
                    </div>
                </div>
            </AdminCard>

            <AdminCollapsibleSection
                title="Общая сводка"
                description="Ключевые показатели проекта"
                defaultOpen
                storageKey="admin:stats:summary"
            >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    <AdminMetricCard label="Пользователи" value={compactNumber(stats.overview.totalUsers)} description="Всего аккаунтов" />
                    <AdminMetricCard label="Активные 7д" value={compactNumber(stats.overview.activeUsers7d)} description="Делали прогнозы" />
                    <AdminMetricCard label="Активные сегодня" value={compactNumber(stats.overview.activeUsersToday)} description={stats.today.day} />
                    <AdminMetricCard label="Новые сегодня" value={compactNumber(stats.overview.newUsersToday)} description="Регистраций за день" />
                    <AdminMetricCard label="Лиги" value={compactNumber(stats.overview.totalLeagues)} description={`${stats.leagues.private} private / ${stats.leagues.channel} channel`} />
                    <AdminMetricCard label="Матчи" value={compactNumber(stats.overview.totalMatches)} description="Всего в базе" />
                    <AdminMetricCard label="Матчи сегодня" value={compactNumber(stats.matchesToday)} description="Выбранный UTC-день" />
                    <AdminMetricCard label="Прогнозы" value={compactNumber(stats.overview.totalPicks)} description="Всего в базе" />
                    <AdminMetricCard label="Прогнозы сегодня" value={compactNumber(stats.picksToday)} description={`~ ${oneDecimal(stats.today.picksPerMatch)} на матч`} />
                </div>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Активность и прогнозы"
                description="Прогнозы, участие и статусы матчей за выбранный день"
                defaultOpen
                storageKey="admin:stats:activity"
            >
            <div className="grid grid-cols-1 gap-4">
                <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-4 bg-orange-500 rounded-full"></div>
                        <h3 className="text-[15px] font-bold tracking-tight">Сегодня</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                        <AdminMetricCard label="Матчи" value={compactNumber(stats.today.matches)} description="Сегодня" size="sm" />
                        <AdminMetricCard label="Прогнозы" value={compactNumber(stats.today.picks)} description="Сегодня" size="sm" />
                        <AdminMetricCard label="Активные игроки" value={compactNumber(stats.today.activeUsers)} description={stats.today.day} size="sm" />
                        <AdminMetricCard label="Лиги с очками" value={compactNumber(stats.today.leaguesWithScores)} description="За день" size="sm" />
                        <AdminMetricCard label="На игрока" value={oneDecimal(stats.today.picksPerUser)} description="Прогнозов" size="sm" />
                        <AdminMetricCard label="На матч" value={oneDecimal(stats.today.picksPerMatch)} description="Прогнозов" size="sm" />
                    </div>
                    <div className="mt-4">
                        <AdminDataRow label="Игровой день" value={stats.today.day} />
                    </div>

                    <div className="mt-5 space-y-3">
                        {[
                            { label: "Завершены", value: stats.today.matchStatus.finished, color: "#34c759", variant: "success" as const },
                            { label: "Live", value: stats.today.matchStatus.live, color: "#ff9500", variant: "warning" as const },
                            { label: "По расписанию", value: stats.today.matchStatus.scheduled, color: "#4da3ff", variant: "info" as const },
                            { label: "Отложены/отменены", value: stats.today.matchStatus.blocked, color: "#ff3b30", variant: "danger" as const },
                        ].map((item) => (
                            <div key={item.label} className="space-y-1.5">
                                <AdminDataRow
                                    label={item.label}
                                    value={compactNumber(item.value)}
                                    badge={<AdminBadge variant={item.variant}>{compactNumber(item.value)}</AdminBadge>}
                                />
                                <div className="h-2 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.max((item.value / totalStatuses) * 100, item.value > 0 ? 6 : 0)}%`,
                                            background: item.color,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </AdminCard>
            </div>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Рост, охват, монетизация"
                description="Регистрации, доступность бота и выручка Telegram Stars"
                defaultOpen
                storageKey="admin:stats:growth"
            >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                        <h3 className="text-[15px] font-bold tracking-tight">Новые пользователи · 7 дней</h3>
                    </div>
                    <div className="space-y-2">
                        {stats.trend7d.map((item) => {
                            const n = item.newUsers ?? 0;
                            return (
                                <div key={item.day} className="flex items-center gap-3">
                                    <div className="w-16 shrink-0 font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{item.day.slice(5)}</div>
                                    <div className="flex-1 h-2 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max((n / maxNewUsers) * 100, n > 0 ? 6 : 0)}%` }} />
                                    </div>
                                    <div className="w-10 shrink-0 text-right text-[12px] font-bold text-[var(--tg-theme-text-color,#fff)]">{compactNumber(n)}</div>
                                </div>
                            );
                        })}
                    </div>
                </AdminCard>

                <div className="grid grid-cols-1 gap-4">
                    <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-1 h-4 bg-blue-500 rounded-full"></div>
                            <h3 className="text-[15px] font-bold tracking-tight">Охват бота</h3>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <AdminMetricCard label="Доступны" value={compactNumber(stats.botReach?.reachable ?? 0)} description="active, без забаненных" size="sm" />
                            <AdminMetricCard label="Заблокировали" value={compactNumber(stats.botReach?.blocked ?? 0)} description="active = 0" size="sm" />
                            <AdminMetricCard label="Всего" value={compactNumber(stats.botReach?.total ?? 0)} description="в боте" size="sm" />
                        </div>
                        <div className="mt-2 text-[11px] text-[var(--tg-theme-hint-color,#999)]">Доступные — это потолок аудитории рассылки.</div>
                    </AdminCard>

                    <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                        <div className="flex items-center gap-2 mb-4">
                            <div className="w-1 h-4 bg-yellow-500 rounded-full"></div>
                            <h3 className="text-[15px] font-bold tracking-tight">Telegram Stars</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <AdminMetricCard label="Выручка" value={`${compactNumber(stats.stars?.revenue ?? 0)} ⭐`} description="Оплаченные заказы" size="sm" />
                            <AdminMetricCard label="Заказы" value={compactNumber(stats.stars?.orders ?? 0)} description="Статус credited" size="sm" />
                        </div>
                    </AdminCard>
                </div>
            </div>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Режимы и турниры"
                description="Текущий сезон и структура пользовательских лиг"
                defaultOpen={false}
                storageKey="admin:stats:modes"
            >
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-4 bg-cyan-500 rounded-full"></div>
                        <h3 className="text-[15px] font-bold tracking-tight">Сезон</h3>
                    </div>
                    <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                            <div className="text-[16px] font-bold">{stats.season.name}</div>
                            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                {formatAdminDate(stats.season.start)} → {formatAdminDate(stats.season.end)}
                            </div>
                        </div>
                        <AdminBadge variant={getSeasonBadgeVariant(stats.season.status)}>
                            {stats.season.status}
                        </AdminBadge>
                    </div>

                    <div className="mb-4">
                        <div className="flex items-center justify-between text-[12px] mb-2">
                            <span className="text-[var(--tg-theme-hint-color,#999)]">Прогресс сезона</span>
                            <span className="font-semibold">{stats.season.progressPct}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                            <div
                                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                                style={{ width: `${stats.season.progressPct}%` }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <AdminMetricCard label="Прогресс" value={`${stats.season.progressPct}%`} description="Сезона" size="sm" />
                        <AdminMetricCard label="Осталось" value={compactNumber(stats.season.remainingDays)} description="Дней" size="sm" />
                        <AdminMetricCard label="Матчи" value={compactNumber(stats.season.matches)} description="В сезоне" size="sm" />
                        <AdminMetricCard label="Прогнозы" value={compactNumber(stats.season.picks)} description="В сезоне" size="sm" />
                    </div>
                    <div className="space-y-2">
                        <AdminDataRow label="Дней прошло" value={`${compactNumber(stats.season.elapsedDays)} / ${compactNumber(stats.season.totalDays)}`} />
                        <AdminDataRow label="Среднее прогнозов на матч" value={oneDecimal(stats.season.avgPicksPerMatch)} />
                    </div>
                </AdminCard>

                <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-4 bg-yellow-500 rounded-full"></div>
                        <h3 className="text-[15px] font-bold tracking-tight">Структура лиг</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <AdminMetricCard label="Private" value={compactNumber(stats.leagues.private)} description="Лиги" size="sm" />
                        <AdminMetricCard label="Channel" value={compactNumber(stats.leagues.channel)} description="Лиги" size="sm" />
                    </div>

                    <div className="space-y-2">
                        <AdminDataRow label="Всего лиг" value={compactNumber(stats.leagues.total)} />
                        <AdminDataRow label="Всего участий" value={compactNumber(stats.leagues.memberships)} />
                        <AdminDataRow label="Средний размер лиги" value={oneDecimal(stats.leagues.avgMembersPerLeague)} />
                    </div>

                    <div className="mt-5 space-y-2">
                        {[
                            { label: "Private", value: stats.leagues.private, color: "#ffd166" },
                            { label: "Channel", value: stats.leagues.channel, color: "#ff8c42" },
                        ].map((item) => (
                            <div key={item.label} className="space-y-1.5">
                                <AdminDataRow label={item.label} value={compactNumber(item.value)} />
                                <div className="h-2 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${stats.leagues.total > 0 ? (item.value / stats.leagues.total) * 100 : 0}%`,
                                            background: item.color,
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </AdminCard>
            </div>
            </AdminCollapsibleSection>

            <AdminCollapsibleSection
                title="Тренд активности"
                description="Матчи, игроки и прогнозы за последние 7 дней"
                defaultOpen={false}
                storageKey="admin:stats:technical"
            >
            <AdminCard className="shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                    <h3 className="text-[15px] font-bold tracking-tight">Активность за 7 дней</h3>
                </div>

                <div className="space-y-3">
                    {stats.trend7d.map((item) => (
                        <div
                            key={item.day}
                            className="rounded-2xl border p-3 sm:p-4"
                            style={{
                                borderColor: "var(--tg-theme-hint-color,rgba(255,255,255,0.05))",
                                background: "var(--tg-theme-bg-color,rgba(255,255,255,0.02))",
                            }}
                        >
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="font-semibold">{item.day}</div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <AdminBadge variant="neutral">{compactNumber(item.matches)} матчей</AdminBadge>
                                    <AdminBadge variant="info">{compactNumber(item.activeUsers)} игроков</AdminBadge>
                                    <AdminBadge variant="success">{compactNumber(item.picks)} прогнозов</AdminBadge>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="space-y-1">
                                    <AdminDataRow label="Прогнозы" value={compactNumber(item.picks)} />
                                    <div className="h-2 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-emerald-500"
                                            style={{ width: `${Math.max((item.picks / maxPicks) * 100, item.picks > 0 ? 6 : 0)}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <AdminDataRow label="Активные игроки" value={compactNumber(item.activeUsers)} />
                                    <div className="h-2 rounded-full bg-[var(--tg-theme-secondary-bg-color,#111)] overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-cyan-500"
                                            style={{ width: `${Math.max((item.activeUsers / maxActiveUsers) * 100, item.activeUsers > 0 ? 6 : 0)}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </AdminCard>
            </AdminCollapsibleSection>
        </div>
    );
}
