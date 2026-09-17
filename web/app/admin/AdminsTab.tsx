"use client";

import { useCallback, useEffect, useState } from "react";
import { formatMsk } from "./mskTime";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import {
    AdminBadge,
    AdminButton,
    AdminCheckbox,
    AdminDataRow,
    AdminInput,
    AdminSegmentedControl,
} from "./components/ui";

type AdminsTabProps = {
    fetchWithAuth: <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;
};

type ErrorScope = "list" | "create" | "permissions" | "audit" | null;

type AdminsResponse = {
    ok?: boolean;
    envAdmins?: string[];
    extraAdmins?: ExtraAdmin[];
    error?: string;
};

type AuditResponse = {
    ok?: boolean;
    entries?: AuditEntry[];
    total?: number;
    error?: string;
};

type MutateAdminResponse = {
    ok?: boolean;
    error?: string;
};

type ExtraAdmin = {
    tgId: string;
    permissions: string[];
};

type AuditEntry = {
    id: number;
    action: string;
    payload_json: string;
    created_at: string;
    actor_id: number;
};

// Must stay in sync with the tab list in page.tsx and with
// ADMIN_PATH_PERMISSIONS in api-worker/src/index.ts (server-side enforcement).
const PERMISSION_KEYS = [
    { key: "matches", label: "Матчи" },
    { key: "maintenance", label: "Техработы" },
    { key: "users", label: "Пользователи" },
    { key: "broadcast", label: "Рассылка" },
    { key: "season", label: "Сезон" },
    { key: "economy", label: "Экономика" },
    { key: "quests", label: "Задания" },
    { key: "admins", label: "Админы" },
    { key: "flags", label: "Флаги" },
    { key: "stats", label: "Статистика" },
    { key: "moderation", label: "Модерация" },
    { key: "season_predictions", label: "Прогнозы сезона" },
    { key: "app_sections", label: "Разделы" },
    { key: "score_edit", label: "Редактирование счёта" },
];

function PermissionPills({ selected, onChange, disabled }: { selected: string[]; onChange: (perms: string[]) => void; disabled?: boolean }) {
    const allPermissionKeys = PERMISSION_KEYS.map((p) => p.key);
    const isAll = selected.includes("all");
    const expandedSelected = isAll ? allPermissionKeys : selected;
    const enabledCount = isAll ? allPermissionKeys.length : selected.length;

    const toggleAll = () => {
        onChange(isAll ? [] : ["all"]);
    };

    const toggleKey = (key: string) => {
        const nextSet = new Set(expandedSelected);
        if (nextSet.has(key)) {
            nextSet.delete(key);
        } else {
            nextSet.add(key);
        }

        const next = allPermissionKeys.filter((permKey) => nextSet.has(permKey));
        if (next.length === allPermissionKeys.length) {
            onChange(["all"]);
            return;
        }
        onChange(next);
    };

    return (
        <div className="space-y-3">
            <AdminDataRow
                label="Разрешения"
                value={`${enabledCount} из ${allPermissionKeys.length}`}
                badge={<AdminBadge variant={isAll ? "success" : "info"}>{isAll ? "Полный доступ" : "Выборочно"}</AdminBadge>}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <AdminCheckbox
                checked={isAll}
                onChange={toggleAll}
                disabled={disabled}
                label="Все права"
                description="Полный доступ ко всем разделам админки."
            />
            {PERMISSION_KEYS.map((p) => {
                const active = expandedSelected.includes(p.key);
                return (
                    <AdminCheckbox
                        key={p.key}
                        checked={active}
                        onChange={() => toggleKey(p.key)}
                        disabled={disabled}
                        label={p.label}
                        description={p.key}
                    />
                );
            })}
            </div>
        </div>
    );
}

function AuditActionBadge({ action }: { action: string }) {
    const map: Record<string, { variant: "neutral" | "info" | "success" | "warning" | "danger" | "accent"; label: string }> = {
        MANUAL_RESULT: { variant: "warning", label: "Manual Result" },
        FINALIZE_MATCH: { variant: "success", label: "Finalize Match" },
        FINALIZE_DAY: { variant: "success", label: "Finalize Day" },
        SET_TOP3_OVERRIDE: { variant: "accent", label: "Set Top3" },
        SET_MAINTENANCE: { variant: "danger", label: "Maintenance" },
        CREATE_SEASON: { variant: "info", label: "Create Season" },
        UPDATE_SEASON_DATES: { variant: "info", label: "Update Season" },
        FINALIZE_SEASON: { variant: "success", label: "Finalize Season" },
        ACTIVATE_SEASON: { variant: "success", label: "Activate Season" },
        ARCHIVE_SEASON: { variant: "neutral", label: "Archive Season" },
        SET_MATCH_MODE: { variant: "warning", label: "Match Mode" },
        UPDATE_TOP3_RULES: { variant: "accent", label: "Rules Update" },
        SET_SEASON: { variant: "info", label: "Set Season" },
        DAILY_CASE_BACKFILL: { variant: "info", label: "Case Backfill" },
        // Economy & Transfers
        TRANSFER_BALLS: { variant: "warning", label: "Balls Transfer" },
        TRANSFER_CASES: { variant: "accent", label: "Cases Transfer" },
        UPDATE_BOOSTS: { variant: "accent", label: "Boosts Update" },
        UPDATE_CASE: { variant: "accent", label: "Case Settings" },
        UPDATE_CASE_REWARDS: { variant: "accent", label: "Case Rewards" },
        // Quests
        UPDATE_QUEST: { variant: "accent", label: "Quest Update" },
        // Summaries & System
        RESEND_SUMMARIES: { variant: "info", label: "Resend Summary" },
        CASES_BACKFILL_MANUAL: { variant: "info", label: "Cases Backfill" },
        RECALCULATE_SEASON_STATUS: { variant: "info", label: "Recalc Season" },
        REFINALIZE_SEASON: { variant: "success", label: "Refinalize" },
        // Admin Management
        ADD_ADMIN: { variant: "success", label: "Add Admin" },
        UPDATE_ADMIN_PERMS: { variant: "info", label: "Edit Perms" },
        REMOVE_ADMIN: { variant: "danger", label: "Remove Admin" },
    };
    const info = map[action] || { variant: "neutral" as const, label: action };
    return <AdminBadge variant={info.variant}>{info.label}</AdminBadge>;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || "");
}

export default function AdminsTab({ fetchWithAuth }: AdminsTabProps) {
    const [envAdmins, setEnvAdmins] = useState<string[]>([]);
    const [extraAdmins, setExtraAdmins] = useState<ExtraAdmin[]>([]);
    const [newAdminId, setNewAdminId] = useState("");
    const [newPerms, setNewPerms] = useState<string[]>(["all"]);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");
    const [errorScope, setErrorScope] = useState<ErrorScope>(null);
    const [success, setSuccess] = useState("");

    // Editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editPerms, setEditPerms] = useState<string[]>([]);

    // Audit state
    const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
    const [auditTotal, setAuditTotal] = useState(0);
    const [auditOffset, setAuditOffset] = useState(0);
    const [auditLoading, setAuditLoading] = useState(false);
    const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null);

    // Active section
    const [activeSection, setActiveSection] = useState<"admins" | "audit">("admins");

    const showError = useCallback((message: string, scope: ErrorScope = null) => {
        setError(message);
        setErrorScope(scope);
    }, []);

    const clearError = useCallback(() => {
        setError("");
        setErrorScope(null);
    }, []);

    const fetchAdmins = useCallback(async () => {
        setLoading(true);
        clearError();
        try {
            const res = await fetchWithAuth<AdminsResponse>("/admin/admins");
            if (res?.ok) {
                setEnvAdmins(res.envAdmins || []);
                setExtraAdmins(res.extraAdmins || []);
            } else {
                showError(res?.error || "Failed to load admins", "list");
            }
        } catch (e: unknown) {
            showError(getErrorMessage(e) || "Failed to load admins", "list");
        } finally {
            setLoading(false);
        }
    }, [clearError, fetchWithAuth, showError]);

    const fetchAudit = useCallback(async (offset = 0) => {
        setAuditLoading(true);
        clearError();
        try {
            const res = await fetchWithAuth<AuditResponse>(`/admin/admins/audit?limit=30&offset=${offset}`);
            if (res?.ok) {
                if (offset === 0) {
                    setAuditEntries(res.entries || []);
                } else {
                    setAuditEntries(prev => [...prev, ...(res.entries || [])]);
                }
                setAuditTotal(res.total || 0);
                setAuditOffset(offset + (res.entries?.length || 0));
            } else if (res === null) {
                // fetchWithAuth returned null (initData not ready yet), retry shortly
                setTimeout(() => fetchAudit(offset), 500);
                return;
            } else {
                showError(res?.error || "Failed to load audit log", "audit");
            }
        } catch (e: unknown) {
            showError(getErrorMessage(e), "audit");
        } finally {
            setAuditLoading(false);
        }
    }, [clearError, fetchWithAuth, showError]);

    useEffect(() => {
        fetchAdmins();
    }, [fetchAdmins]);

    useEffect(() => {
        if (activeSection === "audit") {
            fetchAudit(0);
        }
    }, [activeSection, fetchAudit]);

    const handleAddAdmin = async () => {
        if (!newAdminId.trim()) return;
        if (!newPerms.length) {
            showError("Select at least one permission", "create");
            return;
        }
        setActionLoading(true);
        clearError();
        setSuccess("");
        try {
            const res = await fetchWithAuth<MutateAdminResponse>("/admin/admins", {
                method: "POST",
                body: JSON.stringify({ tgId: newAdminId, permissions: newPerms }),
            });
            if (res?.ok) {
                setSuccess(`Added ${newAdminId} as admin.`);
                setNewAdminId("");
                setNewPerms(["all"]);
                fetchAdmins();
            } else {
                showError(res?.error || "Failed to add admin", "create");
            }
        } catch (e: unknown) {
            showError(getErrorMessage(e) || "Failed to add admin", "create");
        } finally {
            setActionLoading(false);
        }
    };

    const handleRemoveAdmin = async (id: string) => {
        if (!window.confirm(`Remove admin access for ${id}?`)) return;
        setActionLoading(true);
        clearError();
        setSuccess("");
        try {
            const res = await fetchWithAuth<MutateAdminResponse>(`/admin/admins/${id}`, { method: "DELETE" });
            if (res?.ok) {
                setSuccess(`Removed ${id}.`);
                fetchAdmins();
            } else {
                showError(res?.error || "Failed to remove admin", "list");
            }
        } catch (e: unknown) {
            showError(getErrorMessage(e) || "Failed to remove admin", "list");
        } finally {
            setActionLoading(false);
        }
    };

    const handleSavePerms = async (id: string) => {
        if (!editPerms.length) {
            showError("Select at least one permission", "permissions");
            return;
        }
        setActionLoading(true);
        clearError();
        setSuccess("");
        try {
            const res = await fetchWithAuth<MutateAdminResponse>(`/admin/admins/${id}`, {
                method: "PUT",
                body: JSON.stringify({ permissions: editPerms }),
            });
            if (res?.ok) {
                setSuccess(`Updated permissions for ${id}.`);
                setEditingId(null);
                fetchAdmins();
            } else {
                showError(res?.error || "Failed to update permissions", "permissions");
            }
        } catch (e: unknown) {
            showError(getErrorMessage(e) || "Failed to update", "permissions");
        } finally {
            setActionLoading(false);
        }
    };

    const formatTime = (iso: string) => formatMsk(iso);

    const permLabels = (perms: string[]) => {
        if (perms.includes("all")) return "Полный доступ";
        return perms.map(k => PERMISSION_KEYS.find(p => p.key === k)?.label || k).join(", ");
    };

    const adminsSummary = `Всего ${envAdmins.length + extraAdmins.length} · активных ${envAdmins.length + extraAdmins.length}`;
    const editingAdmin = extraAdmins.find((admin) => admin.tgId === editingId);
    const enabledEditPermissionsCount = editPerms.includes("all") ? PERMISSION_KEYS.length : editPerms.length;
    const permissionsDescription = editingAdmin
        ? `${editingAdmin.tgId} · ${enabledEditPermissionsCount} разрешений включено`
        : "Выберите администратора в списке, чтобы изменить права.";

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {error && <AdminBadge variant="danger" size="md" className="whitespace-normal">{error}</AdminBadge>}
            {success && <AdminBadge variant="success" size="md" className="whitespace-normal">{success}</AdminBadge>}

            {/* Section Toggle */}
            <AdminSegmentedControl
                ariaLabel="Раздел управления администраторами"
                value={activeSection}
                onChange={setActiveSection}
                fullWidth
                scrollable={false}
                options={[
                    { value: "admins", label: "Администраторы", badge: envAdmins.length + extraAdmins.length },
                    { value: "audit", label: "Аудит", badge: auditTotal || undefined },
                ]}
            />

            {/* ====== ADMINS SECTION ====== */}
            {activeSection === "admins" && (
                <>
                <AdminCard className="p-0 overflow-hidden shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                    <div className="p-5 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-1 h-4 bg-red-500 rounded-full" />
                            <h2 className="text-[17px] font-bold tracking-tight text-[var(--tg-theme-text-color,#fff)]">Роли администраторов</h2>
                        </div>
                        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] leading-relaxed max-w-2xl mt-2">
                            Корневые админы имеют полный доступ. Дополнительным админам можно выдавать отдельные разрешения панели.
                        </div>
                    </div>
                </AdminCard>

                <AdminCollapsibleSection
                    key={`create-${errorScope === "create" ? "error" : "normal"}`}
                    title="Добавить администратора"
                    description="Telegram ID, роль доступа и стартовые permissions"
                    badge={<AdminBadge variant="success">новый</AdminBadge>}
                    defaultOpen={false}
                    forceOpen={errorScope === "create"}
                    keepMounted
                    storageKey="admin:admins:create"
                >
                        {/* Add new admin form */}
                        <div className="space-y-4 rounded-2xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_60%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))] p-4">
                            <AdminInput
                                type="text"
                                label="Telegram ID"
                                description="ID пользователя Telegram, которому нужно выдать доступ."
                                placeholder="Например, 123456789"
                                value={newAdminId}
                                onChange={(e) => setNewAdminId(e.target.value)}
                                inputMode="numeric"
                            />
                            <div>
                                <PermissionPills selected={newPerms} onChange={setNewPerms} disabled={actionLoading} />
                            </div>
                            <AdminButton variant="primary" fullWidth loading={actionLoading} onClick={handleAddAdmin} disabled={actionLoading || loading || !newAdminId.trim()}>
                                Выдать доступ
                            </AdminButton>
                        </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                    key={`list-${errorScope === "list" || errorScope === "permissions" ? errorScope : "normal"}-${editingId ?? "none"}`}
                    title="Администраторы"
                    description={adminsSummary}
                    defaultOpen
                    forceOpen={errorScope === "list" || errorScope === "permissions" || editingId !== null}
                    keepMounted
                    storageKey="admin:admins:list"
                >
                        <div className="grid grid-cols-1 gap-6">
                            {/* Dynamic extra admins */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-[var(--tg-theme-text-color,#fff)] text-sm">Дополнительные админы</h3>
                                </div>
                                <div className="space-y-2">
                                    {loading ? (
                                        <div className="text-center text-[var(--tg-theme-hint-color,#999)] py-4 animate-pulse">Загрузка...</div>
                                    ) : extraAdmins.length === 0 ? (
                                        <div className="bg-black/20 rounded-xl p-4 text-center border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] text-[12px] text-[var(--tg-theme-hint-color,#999)] font-medium">
                                            Дополнительных админов пока нет.
                                        </div>
                                    ) : (
                                        extraAdmins.map((admin) => (
                                            <div key={admin.tgId} className="space-y-3 rounded-2xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_60%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))] p-3">
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div className="min-w-0">
                                                        <div className="font-mono text-sm font-black tracking-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{admin.tgId}</div>
                                                        <div className="mt-1 flex flex-wrap gap-2">
                                                            <AdminBadge variant="info" dot>active</AdminBadge>
                                                            <AdminBadge variant={admin.permissions.includes("all") ? "success" : "neutral"}>
                                                                {admin.permissions.includes("all") ? "Полный доступ" : `${admin.permissions.length} permissions`}
                                                            </AdminBadge>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                                                        <AdminButton
                                                            variant="secondary"
                                                            size="sm"
                                                            onClick={() => {
                                                                if (editingId === admin.tgId) {
                                                                    setEditingId(null);
                                                                } else {
                                                                    setEditingId(admin.tgId);
                                                                    setEditPerms([...admin.permissions]);
                                                                }
                                                            }}
                                                        >
                                                            {editingId === admin.tgId ? "Отмена" : "Изменить"}
                                                        </AdminButton>
                                                        <AdminButton
                                                            variant="danger"
                                                            size="sm"
                                                            onClick={() => handleRemoveAdmin(admin.tgId)}
                                                            disabled={actionLoading}
                                                        >
                                                            Отозвать
                                                        </AdminButton>
                                                    </div>
                                                </div>
                                                <div className="space-y-2">
                                                    <AdminDataRow label="Telegram ID" value={admin.tgId} />
                                                    <AdminDataRow label="Источник доступа" value="Дополнительный админ" badge={<AdminBadge variant="neutral">custom</AdminBadge>} />
                                                    <AdminDataRow label="Права" value={permLabels(admin.permissions)} />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

                            {/* Root env admins */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-[var(--tg-theme-text-color,#fff)] text-sm">Корневые админы (ENV)</h3>
                                </div>
                                <div className="space-y-2">
                                    {loading ? (
                                        <div className="text-center text-[var(--tg-theme-hint-color,#999)] py-4 animate-pulse">Загрузка...</div>
                                    ) : envAdmins.length === 0 ? (
                                        <div className="bg-black/20 rounded-xl p-4 text-center border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] text-[12px] text-[var(--tg-theme-hint-color,#999)] font-medium">
                                            Корневые админы не настроены.
                                        </div>
                                    ) : (
                                        envAdmins.map((id) => (
                                            <div key={id} className="space-y-2 rounded-2xl border border-[color-mix(in_srgb,#34c759_24%,transparent)] bg-[color-mix(in_srgb,#34c759_8%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] p-3">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="font-mono text-sm font-black tracking-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{id}</div>
                                                    <div className="flex gap-2">
                                                        <AdminBadge variant="success" dot>Root</AdminBadge>
                                                        <AdminBadge variant="neutral">ENV</AdminBadge>
                                                    </div>
                                                </div>
                                                <AdminDataRow label="Источник доступа" value="Окружение" description="Полный доступ, управляется ENV-конфигурацией." />
                                                <AdminDataRow label="Telegram ID" value={id} />
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                </AdminCollapsibleSection>

                <AdminCollapsibleSection
                    key={`permissions-${editingId ?? "none"}-${errorScope === "permissions" ? "error" : "normal"}`}
                    title="Права и разрешения"
                    description={permissionsDescription}
                    defaultOpen={false}
                    forceOpen={editingId !== null || errorScope === "permissions"}
                    keepMounted
                    storageKey="admin:admins:permissions"
                >
                    {editingId ? (
                        <div className="space-y-3">
                            <PermissionPills selected={editPerms} onChange={setEditPerms} disabled={actionLoading} />
                            <div className="flex flex-col sm:flex-row gap-2">
                                <AdminButton size="sm" variant="primary" onClick={() => handleSavePerms(editingId)} disabled={actionLoading} loading={actionLoading} fullWidth>
                                    Сохранить права
                                </AdminButton>
                                <AdminButton size="sm" variant="secondary" onClick={() => setEditingId(null)} disabled={actionLoading} fullWidth>
                                    Отмена
                                </AdminButton>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-black/20 rounded-xl p-4 text-center border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] text-[12px] text-[var(--tg-theme-hint-color,#999)] font-medium">
                            Выберите дополнительного администратора в списке, чтобы изменить его permissions.
                        </div>
                    )}
                </AdminCollapsibleSection>
                </>
            )}

            {/* ====== AUDIT LOG SECTION ====== */}
            {activeSection === "audit" && (
                <AdminCollapsibleSection
                    key={`audit-${errorScope === "audit" ? "error" : "normal"}`}
                    title="Журнал действий админов"
                    description={`${auditTotal} записей · аудит операций управления доступом`}
                    defaultOpen
                    forceOpen={errorScope === "audit"}
                    keepMounted
                    storageKey="admin:admins:audit"
                >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                        <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)] font-medium">
                            {auditTotal} всего
                        </div>
                        <AdminButton
                            variant="secondary"
                            size="sm"
                            onClick={() => fetchAudit(0)}
                            disabled={auditLoading}
                            loading={auditLoading}
                        >
                            {auditLoading ? "Обновляем..." : "Обновить"}
                        </AdminButton>
                    </div>

                    <div className="space-y-2">
                        {auditLoading && auditEntries.length === 0 ? (
                            <div className="p-8 text-center text-[var(--tg-theme-hint-color,#999)] animate-pulse">Загружаем журнал...</div>
                        ) : auditEntries.length === 0 ? (
                            <div className="p-8 text-center text-[var(--tg-theme-hint-color,#999)] text-sm">Записей пока нет.</div>
                        ) : (
                            auditEntries.map(entry => (
                                <div
                                    key={entry.id}
                                    className="cursor-pointer rounded-2xl border border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)] bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_58%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))] p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_7%,transparent)]"
                                    onClick={() => setExpandedAuditId(expandedAuditId === entry.id ? null : entry.id)}
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <AuditActionBadge action={entry.action} />
                                            <AdminBadge variant="neutral">actor #{entry.actor_id}</AdminBadge>
                                        </div>
                                        <div className="text-[11px] font-semibold text-[var(--tg-theme-hint-color,var(--tg-hint,#999))]">
                                            {formatTime(entry.created_at)}
                                        </div>
                                    </div>
                                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                        <AdminDataRow label="Действие" value={entry.action} />
                                        <AdminDataRow label="Запись" value={`#${entry.id}`} />
                                    </div>
                                    {expandedAuditId === entry.id && (
                                        <div className="mt-2 p-3 bg-black/30 rounded-lg border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                                            <pre className="text-[11px] text-[var(--tg-theme-hint-color,#aaa)] font-mono whitespace-pre-wrap overflow-auto max-h-40 leading-relaxed">
                                                {(() => {
                                                    try { return JSON.stringify(JSON.parse(entry.payload_json), null, 2); }
                                                    catch { return entry.payload_json; }
                                                })()}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {auditOffset < auditTotal && (
                        <div className="p-4 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
                            <AdminButton
                                variant="secondary"
                                onClick={() => fetchAudit(auditOffset)}
                                disabled={auditLoading}
                                loading={auditLoading}
                                fullWidth
                            >
                                {auditLoading ? "Загрузка..." : `Загрузить ещё (${auditTotal - auditOffset} осталось)`}
                            </AdminButton>
                        </div>
                    )}
                </AdminCollapsibleSection>
            )}
        </div>
    );
}

