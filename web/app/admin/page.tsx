"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { apiFetch, setApiInitData } from "@/lib/api";
import type { AdminStatsData } from "./StatsTab";
import { AdminShell } from "./components/AdminShell";
import { AdminTabs } from "./components/AdminTabs";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton as UiButton, AdminInput as UiInput } from "./components/ui";

// Tabs are loaded on demand: MatchesTab alone is ~240KB of source, and an admin
// session rarely opens more than a few tabs, so eager-bundling all of them made
// the initial admin load pay for everything.
const TabLoading = () => (
    <div className="py-16 text-center text-sm font-semibold text-[var(--tg-theme-hint-color,#999)]">Загрузка раздела…</div>
);
const MatchesTab = dynamic(() => import("./MatchesTab"), { loading: TabLoading, ssr: false });
const MaintenanceTab = dynamic(() => import("./MaintenanceTab"), { loading: TabLoading, ssr: false });
const UsersTab = dynamic(() => import("./UsersTab"), { loading: TabLoading, ssr: false });
const BroadcastTab = dynamic(() => import("./BroadcastTab"), { loading: TabLoading, ssr: false });
const AdminsTab = dynamic(() => import("./AdminsTab"), { loading: TabLoading, ssr: false });
const FlagsTab = dynamic(() => import("./FlagsTab"), { loading: TabLoading, ssr: false });
const SeasonTab = dynamic(() => import("./SeasonTab"), { loading: TabLoading, ssr: false });
const StatsTab = dynamic(() => import("./StatsTab"), { loading: TabLoading, ssr: false });
const EconomyTab = dynamic(() => import("./EconomyTab"), { loading: TabLoading, ssr: false });
const QuestsTab = dynamic(() => import("./QuestsTab"), { loading: TabLoading, ssr: false });
const ModerationTab = dynamic(() => import("./ModerationTab"), { loading: TabLoading, ssr: false });
const SeasonPredictionsTab = dynamic(() => import("./SeasonPredictionsTab"), { loading: TabLoading, ssr: false });
const AppSectionsVisibilityTab = dynamic(() => import("./AppSectionsVisibilityTab"), { loading: TabLoading, ssr: false });


function formatLocalDateKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function shiftDateKey(dateKey: string, days: number) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    date.setDate(date.getDate() + days);
    return formatLocalDateKey(date);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

type AdminTabKey = "matches" | "maintenance" | "users" | "broadcast" | "admins" | "flags" | "season" | "stats" | "economy" | "quests" | "moderation" | "season_predictions" | "app_sections";

function AdminDatePicker({
    value,
    onChange,
}: {
    value: string;
    onChange: (date: string) => void;
}) {
    const today = formatLocalDateKey(new Date());
    const tomorrow = shiftDateKey(today, 1);

    return (
        <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[44px_1fr_44px] gap-2 items-end">
                <UiButton variant="secondary" size="md" aria-label="Предыдущий день" onClick={() => onChange(shiftDateKey(value, -1))}>−</UiButton>
                <UiInput
                    type="date"
                    value={value}
                    onChange={(event) => {
                        if (event.target.value) onChange(event.target.value);
                    }}
                    className="[&::-webkit-calendar-picker-indicator]:invert-[1] [&::-webkit-calendar-picker-indicator]:opacity-50"
                    style={{ colorScheme: "dark" }}
                />
                <UiButton variant="secondary" size="md" aria-label="Следующий день" onClick={() => onChange(shiftDateKey(value, 1))}>+</UiButton>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: "Сегодня", date: today },
                    { label: "Завтра", date: tomorrow },
                    { label: "+7 дней", date: shiftDateKey(value, 7) },
                ].map((item) => {
                    const active = value === item.date;
                    const displayLabel = item.date === today ? "Сегодня" : item.date === tomorrow ? "Завтра" : "+7 дней";
                    return (
                        <UiButton
                            key={`${displayLabel}-${item.date}`}
                            size="sm"
                            variant={active ? "primary" : "secondary"}
                            onClick={() => onChange(item.date)}
                        >
                            {displayLabel}
                        </UiButton>
                    );
                })}
            </div>
            <div className="text-[11px] font-semibold text-center text-[var(--tg-theme-hint-color,#999)]">
                Выбрана дата: {value}
            </div>
        </div>
    );
}

export default function AdminPage() {
    const [initData, setInitData] = useState("");
    const [isAdmin, setIsAdmin] = useState(false);
    const [isCheckingInfo, setIsCheckingInfo] = useState(true);
    const [adminPermissions, setAdminPermissions] = useState<string[]>([]);

    const hasPermission = (key: string) => adminPermissions.includes('all') || adminPermissions.includes(key);

    const [activeTab, setActiveTab] = useState<AdminTabKey>("matches");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [userId, setUserId] = useState<string | null>(null);

    const [selectedDate, setSelectedDate] = useState(() => formatLocalDateKey(new Date()));

    // Rules / Maintenance / Season tabs were extracted into their own components
    // (they own their state + lazy load).

    // Stats Tab
    const [stats, setStats] = useState<AdminStatsData | null>(null);
    const [statsUpdatedAt, setStatsUpdatedAt] = useState("");
    const [statsLoading, setStatsLoading] = useState(false);

    // 1. Init Telegram & Check Admin
    useEffect(() => {
        let mounted = true;
        let viewportEventsAttached = false;
        let activeWebApp: NonNullable<Window["Telegram"]>["WebApp"] | null = null;

        const applyViewportHeight = (tg: NonNullable<Window["Telegram"]>["WebApp"]) => {
            const telegramHeight = Number(tg.viewportStableHeight || tg.viewportHeight || 0);
            const viewportHeight = telegramHeight > 0 ? telegramHeight : window.innerHeight;
            if (viewportHeight > 0) {
                document.documentElement.style.setProperty("--sg-viewport-height", `${Math.round(viewportHeight)}px`);
            }
        };

        const handleViewportChanged = () => {
            if (activeWebApp) applyViewportHeight(activeWebApp);
        };

        const tick = () => {
            if (!mounted) return;
            const tg = window.Telegram?.WebApp;
            if (!tg) {
                // Retry if SDK not ready
                setTimeout(tick, 50);
                return;
            }

            // SDK Ready
            tg.ready?.();
            tg.expand?.();
            tg.disableVerticalSwipes?.();
            activeWebApp = tg;
            applyViewportHeight(tg);
            if (!viewportEventsAttached && typeof tg.onEvent === "function") {
                tg.onEvent("viewportChanged", handleViewportChanged);
                viewportEventsAttached = true;
            }
            const data = tg.initData;
            setApiInitData(data || "");
            setInitData(data || "");

            // Parse ID locally for debug
            try {
                if (data) {
                    const usp = new URLSearchParams(data);
                    const userStr = usp.get("user");
                    if (userStr) {
                        const u = JSON.parse(userStr);
                        setUserId(String(u.id));
                    }
                }
            } catch (e) {
                console.error("Local parse error", e);
            }

            if (data) {
                // Check /me
                apiFetch<{ ok: boolean, data: { user: unknown, isAdmin: boolean, permissions?: string[] }, error?: string }>("/me", {
                    headers: { "x-telegram-init-data": data }
                })
                    .then(j => {
                        if (!mounted) return;
                        if (j.ok && j.data.isAdmin) {
                            setIsAdmin(true);
                            setAdminPermissions(j.data.permissions || ['all']);
                        } else {
                            setIsAdmin(false);
                            if (j.error) setError(j.error);
                        }
                    })
                    .catch(e => {
                        console.error("Auth check failed", e);
                        if (mounted) {
                            setIsAdmin(false);
                            setError(String(e));
                        }
                    })
                    .finally(() => {
                        if (mounted) setIsCheckingInfo(false);
                    });
            } else {
                // No initData found (e.g. browser)
                if (mounted) setIsCheckingInfo(false);
            }
        };

        tick();

        return () => {
            mounted = false;
            if (viewportEventsAttached) {
                activeWebApp?.offEvent?.("viewportChanged", handleViewportChanged);
            }
        };
    }, []);

    const fetchWithAuth = useCallback(async <T = unknown>(path: string, options: RequestInit = {}) => {
        if (!initData) return null;
        try {
            return await apiFetch<T>(path, {
                ...options,
                headers: {
                    ...options.headers,
                    "x-telegram-init-data": initData
                }
            });
        } catch (e: unknown) {
            const msg = getErrorMessage(e);
            // Translate common codes
            if (msg.includes("TOP3_LOCKED_AFTER_FIRST_LOCK")) {
                setError("🔒 Cannot change: First match has already started (LOCKED).");
            } else if (msg.includes("MATCH_MODE_MISMATCH")) {
                setError("Selected matches are blocked by the current match mode for this day.");
            } else if (msg.includes("initData expired")) {
                setError("⏳ Сессия Telegram устарела. Закройте и заново откройте Mini App.");
            } else if (msg.includes("FORBIDDEN_ROOT_ONLY")) {
                setError("⛔ Управлять списком админов могут только root-админы (ADMIN_IDS).");
            } else if (msg.includes("HTTP 403")) {
                setError("⛔ Access Denied: You are not an admin.");
            } else {
                setError(`Error: ${msg}`);
            }
            return null;
        }
    }, [initData]);


    // Stats functions
    const loadStats = async () => {
        try {
            setStatsLoading(true);
            const res = await fetchWithAuth<{ ok: boolean, stats: AdminStatsData, updatedAt: string }>('/admin/stats');
            if (res?.ok) {
                setStats(res.stats);
                setStatsUpdatedAt(res.updatedAt);
            }
        } catch (e: unknown) {
            setError("Ошибка загрузки статистики: " + getErrorMessage(e));
        } finally {
            setStatsLoading(false);
        }
    };

    // --- RENDER ---

    if (isCheckingInfo) {
        return <div className="min-h-screen bg-slate-900 text-gray-400 flex items-center justify-center">Verifying access...</div>;
    }

    if (!initData) {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center">
                <div className="text-xl mb-4">🔐 Telegram Auth Required</div>
                <div className="text-gray-400 text-center">Please open this page inside the Telegram App.</div>
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex flex-col items-center justify-center text-center">
                <div className="text-4xl mb-4">⛔</div>
                <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
                <p className="text-gray-400 mb-2">You do not have administrative privileges.</p>
                <div className="bg-white/10 p-2 rounded text-sm font-mono mb-6 space-y-1 text-left">
                    <div>User ID: {userId || "Unknown"}</div>
                    {error && <div className="text-red-300">Error: {error}</div>}
                    <div className="text-xs text-gray-400">InitData Length: {initData?.length || 0}</div>
                </div>
                <button
                    onClick={() => window.location.href = "/"}
                    className="px-6 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition"
                >
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <AdminShell>
            {/* Premium Sticky Header */}
            <div className="sticky top-0 z-40 bg-[var(--tg-theme-secondary-bg-color,#000000)]/80 backdrop-blur-2xl w-[calc(100%+2rem)] -mx-4 px-4 pb-3 mb-5 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                <div className="pt-4 pb-4 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <span className="text-white font-black text-xl leading-none">A</span>
                        </div>
                        <div>
                            <h1 className="text-lg font-bold tracking-tight text-[var(--tg-theme-text-color,#fff)] leading-tight">
                                Scoregame Admin
                            </h1>
                            <div className="text-[11px] font-medium text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider">
                                Management Hub
                            </div>
                        </div>
                    </div>
                    
                    <button
                        onClick={() => window.location.href = "/"}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 active:scale-95 rounded-xl text-red-500 font-bold text-sm transition-all shadow-inner border border-red-500/20"
                    >
                        <span>Выйти из админки</span>
                    </button>
                </div>

                {/* Toolbar for Matches Tab */}
                {activeTab === "matches" && (
                    <div className="pb-4 w-full">
                        <AdminDatePicker
                            value={selectedDate}
                            onChange={(d) => setSelectedDate(d)}
                        />
                    </div>
                )}

                {/* Navigation Tabs */}
                <div className="pb-1 w-full">
                    <AdminTabs
                        active={activeTab}
                        onChange={(val: AdminTabKey) => {
                            setActiveTab(val);
                            if (val === 'stats') loadStats();
                        }}
                        tabs={([
                            { key: "matches", label: "Матчи" },
                            { key: "maintenance", label: "Техработы" },
                            { key: "users", label: "Пользователи" },
                            { key: "broadcast", label: "Рассылка" },
                            { key: "admins", label: "Админы" },
                            { key: "flags", label: "Флаги" },
                            { key: "season", label: "Сезон" },
                            { key: "stats", label: "Статистика" },
                            { key: "economy", label: "Экономика" },
                            { key: "quests", label: "Задания" },
                            { key: "moderation", label: "Модерация" },
                            { key: "season_predictions", label: "Прогнозы сезона" },
                            { key: "app_sections", label: "Разделы" },
                        ] satisfies Array<{ key: AdminTabKey; label: string }>).filter(t => hasPermission(t.key))}
                    />
                </div>
            </div>

            <div className="w-full space-y-4">
                {error && <AdminBadge variant="danger" className="w-full p-3 text-sm flex items-center gap-2 whitespace-normal h-auto leading-tight text-left block">{error}</AdminBadge>}
                {success && <AdminBadge variant="success" className="w-full p-3 text-sm flex items-center gap-2 whitespace-normal h-auto leading-tight text-left block">{success}</AdminBadge>}

                {/* Matches Tab — extracted to MatchesTab (owns its state + handlers) */}
                {activeTab === "matches" && (
                    <MatchesTab
                        fetchWithAuth={fetchWithAuth}
                        loading={loading}
                        setLoading={setLoading}
                        onSuccess={setSuccess}
                        onError={setError}
                        selectedDate={selectedDate}
                    />
                )}

                {/* Maintenance Tab — extracted to MaintenanceTab */}
                {activeTab === "maintenance" && (
                    <MaintenanceTab fetchWithAuth={fetchWithAuth} onSuccess={setSuccess} onError={setError} />
                )}

                {/* Users Tab */}
                {
                    activeTab === "users" && (
                        <UsersTab fetchWithAuth={fetchWithAuth} />
                    )
                }

                {/* Broadcast Tab */}
                {
                    activeTab === "broadcast" && (
                        <BroadcastTab fetchWithAuth={fetchWithAuth} onSuccess={setSuccess} onError={setError} />
                    )
                }

                {/* Admins Tab */}
                {
                    activeTab === "admins" && (
                        <AdminsTab fetchWithAuth={fetchWithAuth} />
                    )
                }

                {/* Flags Tab */}
                {
                    activeTab === "flags" && (
                        <FlagsTab fetchWithAuth={fetchWithAuth} onSuccess={setSuccess} onError={setError} />
                    )
                }

                {/* Economy Tab */}
                {
                    activeTab === "economy" && (
                        <EconomyTab fetchWithAuth={fetchWithAuth} />
                    )
                }

                {/* Quests Tab */}
                {
                    activeTab === "quests" && (
                        <QuestsTab
                            fetchWithAuth={fetchWithAuth}
                            onGlobalSuccess={(message) => {
                                setSuccess(message);
                                setTimeout(() => setSuccess(""), 3000);
                            }}
                            onGlobalError={(message) => setError(message)}
                        />
                    )
                }

                {/* Season Tab */}
                {
                    activeTab === "season" && (
                        <SeasonTab
                            fetchWithAuth={fetchWithAuth}
                            onGlobalSuccess={(message) => {
                                setSuccess(message);
                                setTimeout(() => setSuccess(""), 3000);
                            }}
                            onGlobalError={(message) => setError(message)}
                        />
                    )
                }

                                {/* Moderation Tab */}
                {activeTab === "moderation" && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <ModerationTab />
                    </div>
                )}

                {activeTab === "season_predictions" && (
                    <SeasonPredictionsTab fetchWithAuth={fetchWithAuth} />
                )}

                {activeTab === "app_sections" && (
                    <AppSectionsVisibilityTab fetchWithAuth={fetchWithAuth} />
                )}

                {activeTab === "stats" && (
                    <StatsTab
                        stats={stats}
                        updatedAt={statsUpdatedAt}
                        loading={statsLoading}
                        onRefresh={loadStats}
                    />
                )}
            </div>
        </AdminShell>
    );
}
