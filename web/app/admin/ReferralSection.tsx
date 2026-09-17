"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminCard } from "./components/AdminCard";
import { AdminToggle } from "./components/AdminToggle";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminBadge, AdminButton, AdminInput, AdminMetricCard, AdminSelect } from "./components/ui";

type AdminFetchWithAuth = <T = unknown>(path: string, init?: RequestInit) => Promise<T | null>;

type Reward = { type: string; amount: number };
type Milestone = { count: number; reward: Reward };
type ReferralConfig = {
    enabled: boolean;
    invitee_reward: Reward;
    per_friend_reward: Reward;
    milestones: Milestone[];
    daily_cap: number;
};
type ConfigResponse = { ok?: boolean; error?: string; config?: ReferralConfig; defaults?: ReferralConfig };
type StatsResponse = {
    ok?: boolean;
    attached?: number;
    activated?: number;
    rewarded?: number;
    top_inviters?: Array<{ inviter_id: number; name: string; invited: number; activated: number }>;
    sources?: Array<{ source: string; users: number }>;
};

const REWARD_TYPE_OPTIONS = [
    { value: "daily_case", label: "Daily case" },
    { value: "premium_case", label: "Premium case" },
    { value: "lucky_token", label: "Фартовый жетон" },
    { value: "none", label: "Без награды" },
];

function RewardEditor({ label, reward, onChange }: { label: string; reward: Reward; onChange: (r: Reward) => void }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            <AdminSelect
                label={label}
                options={REWARD_TYPE_OPTIONS}
                value={reward.type}
                onChange={(value) => onChange({ type: value, amount: value === "none" ? 0 : Math.max(1, reward.amount) })}
            />
            <AdminInput
                label="Кол-во (1–3)"
                type="text"
                inputMode="numeric"
                disabled={reward.type === "none"}
                value={reward.type === "none" ? "0" : String(reward.amount)}
                onChange={(e) => {
                    const n = Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")));
                    onChange({ ...reward, amount: Number.isFinite(n) ? n : 1 });
                }}
            />
        </div>
    );
}

// Referral program config + stats (server: /admin/economy/referral/*).
// The server re-validates everything (closed reward vocabulary, bounds), the
// client-side checks below only exist for early feedback.
export default function ReferralSection({ fetchWithAuth }: { fetchWithAuth: AdminFetchWithAuth }) {
    const [config, setConfig] = useState<ReferralConfig | null>(null);
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ kind: "success" | "danger"; text: string } | null>(null);

    const load = useCallback(async () => {
        const [cfg, st] = await Promise.all([
            fetchWithAuth<ConfigResponse>("/admin/economy/referral/config"),
            fetchWithAuth<StatsResponse>("/admin/economy/referral/stats"),
        ]);
        if (cfg?.ok && cfg.config) setConfig(cfg.config);
        if (st?.ok) setStats(st);
    }, [fetchWithAuth]);

    useEffect(() => { load(); }, [load]);

    const patch = (p: Partial<ReferralConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));

    const validAmount = (r: Reward) => r.type === "none" || (Number.isInteger(r.amount) && r.amount >= 1 && r.amount <= 3);
    const milestoneCountsUnique = new Set((config?.milestones || []).map((m) => m.count)).size === (config?.milestones || []).length;
    const valid = !!config
        && validAmount(config.invitee_reward)
        && validAmount(config.per_friend_reward)
        && Number.isInteger(config.daily_cap) && config.daily_cap >= 1 && config.daily_cap <= 100
        && config.milestones.length <= 10
        && milestoneCountsUnique
        && config.milestones.every((m) => Number.isInteger(m.count) && m.count >= 1 && m.count <= 10000 && validAmount(m.reward));

    const save = async () => {
        if (!config || !valid) return;
        setSaving(true);
        setMessage(null);
        try {
            const res = await fetchWithAuth<ConfigResponse>("/admin/economy/referral/config", {
                method: "PUT",
                body: JSON.stringify({ config }),
            });
            if (res?.ok && res.config) {
                setConfig(res.config);
                setMessage({ kind: "success", text: "Конфиг рефералки сохранён (кэш обновится до 60 сек)." });
            } else {
                setMessage({ kind: "danger", text: res?.error || "Не удалось сохранить конфиг." });
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminCollapsibleSection
            title="Реферальная программа"
            description={config ? `${config.enabled ? "включена" : "выключена"} · активаций ${stats?.activated ?? "…"}` : "загрузка…"}
            keepMounted
            storageKey="admin:economy:referral"
        >
            <AdminCard className="space-y-5">
                {!config ? (
                    <div className="text-[13px] text-[var(--tg-theme-hint-color,#999)]">Загрузка…</div>
                ) : (
                    <>
                        <div className="flex flex-col gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] pb-4 sm:flex-row sm:items-center sm:justify-between">
                            <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">🤝 Рефералы</h2>
                            <div className="flex items-center gap-2">
                                <AdminToggle checked={config.enabled} onChange={(checked) => patch({ enabled: checked })} />
                                <AdminBadge variant={config.enabled ? "success" : "neutral"} size="sm">{config.enabled ? "вкл" : "выкл"}</AdminBadge>
                            </div>
                        </div>

                        <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                            Награды только предметами (кейсы/жетоны) — звёзды и мячи напрямую запрещены схемой. Активация друга = первый сохранённый прогноз.
                        </div>

                        <RewardEditor label="Приглашённому (за первый прогноз)" reward={config.invitee_reward} onChange={(r) => patch({ invitee_reward: r })} />
                        <RewardEditor label="Пригласившему (за каждого друга)" reward={config.per_friend_reward} onChange={(r) => patch({ per_friend_reward: r })} />

                        <AdminInput
                            label="Кап наград пригласившему (за 24ч, 1–100)"
                            type="text"
                            inputMode="numeric"
                            value={String(config.daily_cap)}
                            onChange={(e) => {
                                const n = Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")));
                                patch({ daily_cap: Number.isFinite(n) ? n : 10 });
                            }}
                        />

                        <div className="space-y-3">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--tg-theme-hint-color,#999)]">Milestone-награды (по числу активированных друзей)</div>
                            {config.milestones.map((m, i) => (
                                <div key={i} className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/20 p-4">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[13px] font-bold text-[var(--tg-theme-hint-color,#999)]">Рубеж #{i + 1}</span>
                                        <AdminButton
                                            variant="danger"
                                            size="sm"
                                            onClick={() => patch({ milestones: config.milestones.filter((_, j) => j !== i) })}
                                        >
                                            Удалить
                                        </AdminButton>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <AdminInput
                                            label="Друзей"
                                            type="text"
                                            inputMode="numeric"
                                            value={String(m.count)}
                                            onChange={(e) => {
                                                const n = Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")));
                                                patch({ milestones: config.milestones.map((x, j) => (j === i ? { ...x, count: Number.isFinite(n) ? n : 1 } : x)) });
                                            }}
                                        />
                                        <AdminSelect
                                            label="Награда"
                                            options={REWARD_TYPE_OPTIONS}
                                            value={m.reward.type}
                                            onChange={(value) => patch({ milestones: config.milestones.map((x, j) => (j === i ? { ...x, reward: { type: value, amount: value === "none" ? 0 : Math.max(1, x.reward.amount) } } : x)) })}
                                        />
                                        <AdminInput
                                            label="Кол-во"
                                            type="text"
                                            inputMode="numeric"
                                            disabled={m.reward.type === "none"}
                                            value={m.reward.type === "none" ? "0" : String(m.reward.amount)}
                                            onChange={(e) => {
                                                const n = Math.floor(Number(e.target.value.replace(/[^0-9]/g, "")));
                                                patch({ milestones: config.milestones.map((x, j) => (j === i ? { ...x, reward: { ...x.reward, amount: Number.isFinite(n) ? n : 1 } } : x)) });
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                            {config.milestones.length < 10 && (
                                <AdminButton
                                    variant="secondary"
                                    fullWidth
                                    onClick={() => {
                                        const nextCount = Math.max(0, ...config.milestones.map((m) => m.count)) + 5;
                                        patch({ milestones: [...config.milestones, { count: nextCount, reward: { type: "premium_case", amount: 1 } }] });
                                    }}
                                >
                                    + Добавить рубеж
                                </AdminButton>
                            )}
                        </div>

                        {!valid && <AdminBadge variant="danger" size="sm">Проверьте значения: кол-во 1–3, кап 1–100, рубежи уникальны (макс 10)</AdminBadge>}
                        {message && <AdminBadge variant={message.kind} className="w-full p-2 whitespace-normal h-auto leading-tight text-left block" size="sm">{message.text}</AdminBadge>}

                        <AdminButton onClick={save} loading={saving} disabled={!valid} variant="primary" fullWidth>
                            Сохранить конфиг рефералки
                        </AdminButton>

                        <div className="flex items-center gap-3 pt-2">
                            <AdminMetricCard size="sm" label="Привязано" value={stats?.attached ?? "—"} />
                            <AdminMetricCard size="sm" label="Активировано" value={stats?.activated ?? "—"} />
                            <AdminMetricCard size="sm" label="Наград выдано" value={stats?.rewarded ?? "—"} />
                        </div>

                        {!!stats?.top_inviters?.length && (
                            <div className="space-y-2">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--tg-theme-hint-color,#999)]">Топ пригласивших</div>
                                {stats.top_inviters.map((t) => (
                                    <div key={t.inviter_id} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-[13px]">
                                        <span className="font-bold text-[var(--tg-theme-text-color,#fff)] truncate">{t.name}</span>
                                        <span className="text-[var(--tg-theme-hint-color,#999)] shrink-0 ml-3">актив. {t.activated} / привяз. {t.invited}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!!stats?.sources?.length && (
                            <div className="space-y-2">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--tg-theme-hint-color,#999)]">Каналы привлечения (src_)</div>
                                {stats.sources.map((s) => (
                                    <div key={s.source} className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-[13px]">
                                        <span className="font-mono text-[var(--tg-theme-text-color,#fff)] truncate">{s.source}</span>
                                        <span className="text-[var(--tg-theme-hint-color,#999)] shrink-0 ml-3">{s.users}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <AdminButton variant="secondary" size="sm" onClick={load}>Обновить</AdminButton>
                    </>
                )}
            </AdminCard>
        </AdminCollapsibleSection>
    );
}
