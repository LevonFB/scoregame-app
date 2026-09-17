"use client";

import { useState, useEffect, useCallback } from "react";
import { formatMsk } from "./mskTime";
import { AdminCard } from "./components/AdminCard";
import { AdminToggle } from "./components/AdminToggle";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import ReferralSection from "./ReferralSection";
import {
    AdminBadge,
    AdminButton,
    AdminDataRow,
    AdminInput,
    AdminMetricCard,
    AdminSegmentedControl,
    AdminSelect,
} from "./components/ui";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Minimal economy shapes (fields actually read/written here). Index signature keeps
// dynamic field updates (`obj[field] = …`) and extra API props type-safe without `any`.
interface OkResult { ok?: boolean; error?: string }
interface EconomyBoost { code?: string; emoji?: string; is_active?: number; price_balls?: number | string; title?: string; [key: string]: unknown }
interface EconomyCase { id: string; code?: string; emoji?: string; is_active?: number; price_balls?: number | string; title?: string; [key: string]: unknown }
interface EconomyStarPack { id?: string | null; badge_text?: string; balls_amount?: number | string; bonus_balls?: number | string; code?: string; description?: string; emoji?: string; is_active?: number; price_xtr?: number | string; sort_order?: number | string; title?: string; [key: string]: unknown }
interface EconomyStarOrder { order_id?: string | number; created_at?: number; credited_at?: number; current_balance?: number; first_name?: string; pack_code?: string; pack_title?: string; paid_at?: number; price_xtr?: number; refund_available?: boolean; refund_reason?: string | null; status?: string; total_balls?: number; unspent_purchase_balls?: number; user_id?: number; username?: string | null; [key: string]: unknown }
interface EconomyReward { reward_type?: string; reward_code?: string; chance_percent?: number | string; fixed_amount?: number | string | null; min_amount?: number | string | null; max_amount?: number | string | null; meta_json?: string | null; is_active?: number; [key: string]: unknown }
interface EconomyExchangeTier { id?: number | null; tier_key?: string; label?: string; stars_cost?: number | string; balls_reward?: number | string; is_active?: number; sort_order?: number; [key: string]: unknown }
// weight may temporarily be a string while being edited in the admin UI; it is
// converted back to a number on save (effectiveDiscreteAmounts).
interface RewardMeta { discrete_amounts?: Array<{ amount: number; weight: number | string }>; [key: string]: unknown }
interface LedgerItem {
    id: number; user_id: number; username: string | null; display_name: string;
    stars_spent: number; balls_received: number; tier_id: number; tier_key: string | null;
    week_key: string; idempotency_key: string; status: string;
    created_at: number; config_snapshot_json: string | null;
}
interface BoostsResponse extends OkResult { boosts?: EconomyBoost[] }
interface CasesResponse extends OkResult { cases?: EconomyCase[] }
interface StarPacksResponse extends OkResult { packs?: EconomyStarPack[] }
interface StarOrdersResponse extends OkResult { orders?: EconomyStarOrder[] }
interface ExchangeResponse extends OkResult { config?: { enabled: boolean; weekly_limit: number } | null; tiers?: EconomyExchangeTier[] }
interface RewardsResponse extends OkResult { rewards?: EconomyReward[] }
interface LedgerResponse extends OkResult { items?: LedgerItem[]; pagination?: { total?: number } }
interface FortuneSectorAdmin extends EconomyReward { label?: string | null; color?: string | null; sort_order?: number | string }
interface FortuneConfigAdmin { title?: string; description?: string | null; price_balls?: number | string; is_active?: number; allow_token_payment?: number; allow_balls_payment?: number }
interface FortuneResponse extends OkResult { config?: FortuneConfigAdmin | null; sectors?: FortuneSectorAdmin[] }

const REWARD_TYPE_OPTIONS = [
    { value: "stars", label: "Stars" },
    { value: "balls", label: "Balls" },
    { value: "extra_joker", label: "Joker" },
    { value: "double_chance", label: "Double Chance" },
    { value: "extra_joker_double_chance", label: "Джокер + Двойной шанс" },
    { value: "extra_league", label: "Extra League" },
    { value: "lucky_token", label: "Жетон" },
];

// Fortune sectors can additionally award a case as a prize.
const FORTUNE_REWARD_TYPE_OPTIONS = [
    ...REWARD_TYPE_OPTIONS,
    { value: "case", label: "Case" },
];
const FORTUNE_CASE_CODE_OPTIONS = [
    { value: "daily_free", label: "Daily case" },
    { value: "premium", label: "Premium case" },
];

const sanitizeNumericInput = (val: string) => {
    if (!val) return '';
    let s = val.replace(/,/g, '.').replace(/[^0-9.]/g, '');
    const parts = s.split('.');
    if (parts.length > 2) s = parts[0] + '.' + parts.slice(1).join('');

    // Prevent multiple leading zeros, but allow "0."
    if (s.length > 1 && s.startsWith('0') && s[1] !== '.') {
        s = s.replace(/^0+/, '');
        if (s === '') s = '0';
        if (s.startsWith('.')) s = '0' + s;
    }
    return s;
};

function parseRewardMeta(metaJson?: string | null): RewardMeta {
    if (!metaJson) return {};
    try {
        const parsed = JSON.parse(metaJson);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
}

// Discrete amounts actually used by the backend roll: finite, weight > 0, inside [min, max].
// Mirrors api-worker getEffectiveDiscreteAmounts().
function effectiveDiscreteAmounts(meta: RewardMeta, lo: number, hi: number): Array<{ amount: number; weight: number }> {
    const raw = Array.isArray(meta.discrete_amounts) ? meta.discrete_amounts : [];
    return raw
        .map((d) => ({ amount: Number(d?.amount), weight: Number(d?.weight) }))
        .filter((d) => Number.isFinite(d.amount) && Number.isFinite(d.weight) && d.amount >= lo && d.amount <= hi);
}

// Editor for sparse per-amount sub-weights (meta_json.discrete_amounts) of a ranged reward.
// The backend normalizes weights by their sum, so the sum does NOT have to be 100 —
// the editor shows the resulting share per amount instead of demanding a fixed total.
function DiscreteWeightsEditor({ row, onChangeMeta }: {
    row: EconomyReward;
    onChangeMeta: (metaJson: string | null) => void;
}) {
    const [newAmount, setNewAmount] = useState("");

    const hasFixed = row.fixed_amount != null && row.fixed_amount !== '';
    const lo = Number(row.min_amount);
    const hi = Number(row.max_amount);
    if (hasFixed || row.min_amount == null || row.min_amount === '' || row.max_amount == null || row.max_amount === '' || !Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return null;

    const meta = parseRewardMeta(row.meta_json);
    // Keep raw weight values (possibly strings mid-edit) so decimals can be typed freely.
    const discrete = (Array.isArray(meta.discrete_amounts) ? meta.discrete_amounts : [])
        .map((d) => ({ amount: Number(d?.amount), weight: d?.weight ?? 0 }))
        .filter((d) => Number.isInteger(d.amount) && d.amount >= lo && d.amount <= hi)
        .sort((a, b) => a.amount - b.amount);
    const subSum = discrete.reduce((s, d) => s + (Number(d.weight) || 0), 0);

    const writeMeta = (entries: Array<{ amount: number; weight: number | string }>) => {
        const next: RewardMeta = { ...meta };
        if (entries.length > 0) next.discrete_amounts = entries;
        else delete next.discrete_amounts;
        onChangeMeta(Object.keys(next).length > 0 ? JSON.stringify(next) : null);
    };

    const setWeight = (amount: number, weightStr: string) => {
        const sane = sanitizeNumericInput(weightStr);
        const rest = discrete.filter((d) => d.amount !== amount);
        writeMeta([...rest, { amount, weight: sane }].sort((a, b) => a.amount - b.amount));
    };

    const removeAmount = (amount: number) => {
        writeMeta(discrete.filter((d) => d.amount !== amount));
    };

    const parsedNew = Number(newAmount);
    const canAdd = newAmount !== '' && Number.isInteger(parsedNew) && parsedNew >= lo && parsedNew <= hi
        && !discrete.some((d) => d.amount === parsedNew);
    const addAmount = () => {
        if (!canAdd) return;
        writeMeta([...discrete, { amount: parsedNew, weight: 0 }].sort((a, b) => a.amount - b.amount));
        setNewAmount("");
    };

    return (
        <div className="mt-2 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] pt-4">
            <div className="mb-3 text-[11px] font-extrabold uppercase tracking-wide text-[var(--tg-theme-hint-color,#999)]">
                Суб-шансы по номиналам ({lo}–{hi})
            </div>
            {discrete.length === 0 ? (
                <div className="mb-3 text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                    Веса не заданы — выпадает случайный номинал от {lo} до {hi} равномерно. Добавьте номиналы, чтобы задать веса.
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {discrete.map((d) => (
                        <div key={d.amount} className="rounded-lg border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-2">
                            <div className="mb-1 flex items-center justify-between gap-1">
                                <span className="text-[11px] font-bold text-[var(--tg-theme-text-color,#fff)]">{d.amount} шт</span>
                                <button type="button" onClick={() => removeAmount(d.amount)} aria-label={`Убрать номинал ${d.amount}`} className="text-[11px] text-red-400 hover:text-red-300">✕</button>
                            </div>
                            <AdminInput
                                label="Вес"
                                type="text"
                                inputMode="decimal"
                                value={String(d.weight)}
                                onChange={e => setWeight(d.amount, e.target.value)}
                            />
                            <div className="mt-1 text-[10px] text-[var(--tg-theme-hint-color,#999)]">
                                {subSum > 0 ? `${((Number(d.weight) || 0) / subSum * 100).toFixed(1)}% внутри награды` : '—'}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <div className="mt-3 flex items-end gap-2">
                <AdminInput
                    label="Новый номинал"
                    type="text"
                    inputMode="numeric"
                    value={newAmount}
                    placeholder={`${lo}–${hi}`}
                    onChange={e => setNewAmount(sanitizeNumericInput(e.target.value))}
                />
                <AdminButton variant="secondary" size="sm" onClick={addAmount} disabled={!canAdd}>+ Добавить</AdminButton>
            </div>
            {discrete.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <AdminBadge variant={subSum > 0 ? "success" : "danger"} size="md">
                        {subSum > 0 ? `Σ весов: ${subSum.toFixed(2)}` : '⚠️ Все веса нулевые — будет равномерный ролл'}
                    </AdminBadge>
                    <span className="text-[10px] text-[var(--tg-theme-hint-color,#999)]">Веса нормируются автоматически — сумма не обязана быть 100.</span>
                </div>
            )}
        </div>
    );
}

export default function EconomyTab({ fetchWithAuth }: { fetchWithAuth: <T = unknown>(url: string, opts?: RequestInit) => Promise<T | null> }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const [boosts, setBoosts] = useState<EconomyBoost[]>([]);
    const [cases, setCases] = useState<EconomyCase[]>([]);
    const [starPacks, setStarPacks] = useState<EconomyStarPack[]>([]);
    const [starOrders, setStarOrders] = useState<EconomyStarOrder[]>([]);
    const [starOrderFilter, setStarOrderFilter] = useState<"all" | "refundable" | "credited" | "refunded" | "failed">("all");
    const [refundingOrderId, setRefundingOrderId] = useState<string>("");
    const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
    const [rewards, setRewards] = useState<EconomyReward[]>([]);

    const [fortuneConfig, setFortuneConfig] = useState<FortuneConfigAdmin | null>(null);
    const [fortuneSectors, setFortuneSectors] = useState<FortuneSectorAdmin[]>([]);

    const [exchangeConfig, setExchangeConfig] = useState<{ enabled: boolean; weekly_limit: number } | null>(null);
    const [exchangeTiers, setExchangeTiers] = useState<EconomyExchangeTier[]>([]);

    const [ledgerItems, setLedgerItems] = useState<LedgerItem[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [ledgerError, setLedgerError] = useState("");
    const [ledgerTotal, setLedgerTotal] = useState(0);
    const [ledgerOffset, setLedgerOffset] = useState(0);
    const LEDGER_LIMIT = 50;
    const [ledgerFilterQ, setLedgerFilterQ] = useState("");
    const [ledgerFilterWeek, setLedgerFilterWeek] = useState("");
    const [ledgerFilterTier, setLedgerFilterTier] = useState("");
    const [ledgerDetail, setLedgerDetail] = useState<LedgerItem | null>(null);

    const loadEconomy = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const bRes = await fetchWithAuth<BoostsResponse>("/admin/economy/boosts");
            if (bRes?.ok) setBoosts(bRes.boosts || []);

            const cRes = await fetchWithAuth<CasesResponse>("/admin/economy/cases");
            if (cRes?.ok) setCases(cRes.cases || []);

            const sRes = await fetchWithAuth<StarPacksResponse>("/admin/economy/star-packs");
            if (sRes?.ok) {
                const processedPacks = (sRes.packs || []).map((p: EconomyStarPack) => ({
                    ...p,
                    price_xtr: Number(p.price_xtr ?? 0),
                    balls_amount: Number(p.balls_amount ?? 0),
                    bonus_balls: Number(p.bonus_balls ?? 0),
                    sort_order: Number(p.sort_order ?? 0),
                }));
                setStarPacks(processedPacks);
            }

            const ordersRes = await fetchWithAuth<StarOrdersResponse>("/admin/economy/star-orders?limit=30");
            if (ordersRes?.ok) {
                setStarOrders(ordersRes.orders || []);
            }

            const exchRes = await fetchWithAuth<ExchangeResponse>("/admin/economy/star-exchange");
            if (exchRes?.ok) {
                setExchangeConfig(exchRes.config ?? { enabled: false, weekly_limit: 200 });
                setExchangeTiers(exchRes.tiers || []);
            }

            const fRes = await fetchWithAuth<FortuneResponse>("/admin/economy/fortune");
            if (fRes?.ok) {
                setFortuneConfig(fRes.config ?? null);
                setFortuneSectors(fRes.sectors || []);
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [fetchWithAuth]);

    const loadRewards = async (caseId: string) => {
        setLoading(true);
        setSelectedCaseId(caseId);
        try {
            const rRes = await fetchWithAuth<RewardsResponse>(`/admin/economy/cases/${caseId}/rewards`);
            if (rRes?.ok) setRewards(rRes.rewards || []);
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    };

    const loadLedger = useCallback(async (offset = 0, q = ledgerFilterQ, week = ledgerFilterWeek, tier = ledgerFilterTier) => {
        setLedgerLoading(true);
        setLedgerError("");
        try {
            const params = new URLSearchParams({ limit: String(LEDGER_LIMIT), offset: String(offset) });
            if (q) params.set("q", q);
            if (week) params.set("week_key", week);
            if (tier) params.set("tier_id", tier);
            const res = await fetchWithAuth<LedgerResponse>(`/admin/economy/star-exchange/ledger?${params}`);
            if (res?.ok) {
                setLedgerItems(res.items || []);
                setLedgerTotal(res.pagination?.total ?? 0);
                setLedgerOffset(offset);
            } else {
                setLedgerError(res?.error || "Ошибка загрузки журнала");
            }
        } catch (e: unknown) {
            setLedgerError(getErrorMessage(e) || "Ошибка загрузки журнала");
        } finally {
            setLedgerLoading(false);
        }
    }, [fetchWithAuth, ledgerFilterQ, ledgerFilterWeek, ledgerFilterTier]);

    useEffect(() => {
        loadEconomy();
        loadLedger(0, "", "", "");
    // loadLedger omitted intentionally — initial load only (adding it would reload
    // the ledger on every filter change; filters are applied via explicit buttons).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadEconomy]);

    const handleSaveBoosts = async () => {
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const processedBoosts = boosts.map(b => ({ ...b, price_balls: Number(b.price_balls) }));
            const res = await fetchWithAuth<OkResult>("/admin/economy/boosts", {
                method: "PUT",
                body: JSON.stringify(processedBoosts),
            });
            if (res?.ok) {
                setSuccess("Boosts updated!");
                setTimeout(() => setSuccess(""), 3000);
            } else {
                setError(res?.error || "Error saving boosts");
            }
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const handleSaveCases = async () => {
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            for (const c of cases) {
                const processedCase = { ...c, price_balls: Number(c.price_balls) };
                const res = await fetchWithAuth<OkResult>("/admin/economy/cases", {
                    method: "PUT",
                    body: JSON.stringify(processedCase),
                });
                if (!res?.ok) throw new Error(`Error saving case ${c.title}`);
            }
            setSuccess("Cases updated!");
            setTimeout(() => setSuccess(""), 3000);
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const handleSaveStarPacks = async () => {
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const processedPacks = starPacks.map((p) => ({
                ...p,
                price_xtr: Number(p.price_xtr),
                balls_amount: Number(p.balls_amount),
                bonus_balls: Number(p.bonus_balls),
                sort_order: Number(p.sort_order),
            }));
            const res = await fetchWithAuth<OkResult>("/admin/economy/star-packs", {
                method: "PUT",
                body: JSON.stringify(processedPacks),
            });
            if (res?.ok) {
                setSuccess("Telegram Stars packs updated!");
                setTimeout(() => setSuccess(""), 3000);
                await loadEconomy();
            } else {
                setError(res?.error || "Error saving Telegram Stars packs");
            }
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const handleSaveExchange = async () => {
        if (!exchangeConfig) return;
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            const cfgRes = await fetchWithAuth<OkResult>("/admin/economy/star-exchange/config", {
                method: "PUT",
                body: JSON.stringify({ enabled: exchangeConfig.enabled, weekly_limit: exchangeConfig.weekly_limit }),
            });
            if (!cfgRes?.ok) throw new Error(cfgRes?.error || "Error saving config");

            const tiersRes = await fetchWithAuth<OkResult>("/admin/economy/star-exchange/tiers", {
                method: "PUT",
                body: JSON.stringify(exchangeTiers.map(t => ({
                    ...t,
                    stars_cost: Number(t.stars_cost),
                    balls_reward: Number(t.balls_reward),
                    sort_order: Number(t.sort_order ?? 0),
                }))),
            });
            if (!tiersRes?.ok) throw new Error(tiersRes?.error || "Error saving tiers");

            setSuccess("Exchange config saved!");
            setTimeout(() => setSuccess(""), 3000);
            await loadEconomy();
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const handleRefundStarOrder = async (orderId: string) => {
        if (!orderId) return;
        if (!window.confirm("Вернуть Telegram Stars по этому заказу? Refund делаем только если купленные мячики не были потрачены.")) {
            return;
        }

        setRefundingOrderId(orderId);
        setSuccess("");
        setError("");
        try {
            const res = await fetchWithAuth<OkResult>(`/admin/economy/star-orders/${encodeURIComponent(orderId)}/refund`, {
                method: "POST",
            });
            if (res?.ok) {
                setSuccess("Refund выполнен.");
                setTimeout(() => setSuccess(""), 3000);
                await loadEconomy();
            } else {
                setError(res?.error || "Refund failed");
            }
        } catch (e: unknown) {
            setError(getErrorMessage(e));
        } finally {
            setRefundingOrderId("");
        }
    };

    const handleSaveRewards = async () => {
        if (!selectedCaseId) return;
        setLoading(true);
        setSuccess("");
        setError("");
        try {
            // validate 100%
            const sum = rewards.reduce((s, r) => s + Number(r.chance_percent), 0);
            if (Math.abs(sum - 100) > 0.01) {
                throw new Error(`Probabilities must sum to 100 (current: ${sum})`);
            }

            const processedRewards = rewards.map((r, i) => {
                const newR = { ...r, chance_percent: Number(r.chance_percent) };
                if (newR.fixed_amount != null && newR.fixed_amount !== '') newR.fixed_amount = Number(newR.fixed_amount);
                else newR.fixed_amount = null;
                if (newR.min_amount != null && newR.min_amount !== '') newR.min_amount = Number(newR.min_amount);
                else newR.min_amount = null;
                if (newR.max_amount != null && newR.max_amount !== '') newR.max_amount = Number(newR.max_amount);
                else newR.max_amount = null;

                if (newR.fixed_amount != null) {
                    newR.meta_json = null;
                } else if (newR.min_amount != null && newR.max_amount != null && Number(newR.min_amount) < Number(newR.max_amount)) {
                    // Keep only the sparse amounts the backend roll will actually use
                    // (in range, weight > 0). No sum-to-100 requirement: rollDynamicLoot
                    // normalizes by the total weight.
                    const lo = Number(newR.min_amount);
                    const hi = Number(newR.max_amount);
                    const meta = parseRewardMeta(r.meta_json);
                    const raw = effectiveDiscreteAmounts(meta, lo, hi);
                    if (raw.length > 0 && !raw.some((d) => d.weight > 0)) {
                        throw new Error(`Строка ${i+1}: все веса номиналов нулевые — задайте хотя бы один вес > 0 или удалите номиналы`);
                    }
                    const nextDiscrete = raw.filter((d) => d.weight > 0).sort((a, b) => a.amount - b.amount);
                    const nextMeta: RewardMeta = { ...meta };
                    if (nextDiscrete.length > 0) nextMeta.discrete_amounts = nextDiscrete;
                    else delete nextMeta.discrete_amounts;
                    newR.meta_json = Object.keys(nextMeta).length > 0 ? JSON.stringify(nextMeta) : null;
                } else {
                    newR.meta_json = null;
                }
                return newR;
            });

            const res = await fetchWithAuth<OkResult>(`/admin/economy/cases/${selectedCaseId}/rewards`, {
                method: "PUT",
                body: JSON.stringify(processedRewards),
            });
            if (res?.ok) {
                setRewards(processedRewards);
                setSuccess("Rewards updated!");
                setTimeout(() => setSuccess(""), 3000);
            } else {
                setError(res?.error || "Error saving rewards");
            }
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const updateBoost = (index: number, field: string, val: string | number) => {
        const newBoosts = [...boosts];
        if (field === 'price_balls') newBoosts[index][field] = sanitizeNumericInput(String(val));
        else newBoosts[index][field] = val;
        setBoosts(newBoosts);
    };

    const updateCase = (index: number, field: string, val: string | number) => {
        const newCases = [...cases];
        if (field === 'price_balls') newCases[index][field] = sanitizeNumericInput(String(val));
        else newCases[index][field] = val;
        setCases(newCases);
    };

    const updateStarPack = (index: number, field: string, val: string | number) => {
        const next = [...starPacks];
        if (['price_xtr', 'balls_amount', 'bonus_balls', 'sort_order'].includes(field)) {
            next[index][field] = sanitizeNumericInput(String(val));
        } else {
            next[index][field] = val;
        }
        setStarPacks(next);
    };

    const addStarPack = () => {
        setStarPacks([
            ...starPacks,
            {
                id: null,
                code: '',
                title: '',
                description: '',
                emoji: '⭐',
                balls_amount: 20,
                bonus_balls: 0,
                price_xtr: 49,
                badge_text: 'Telegram Stars',
                is_active: 0,
                sort_order: Number(starPacks.at(-1)?.sort_order ?? 0) + 10,
            }
        ]);
    };

    const updateReward = (index: number, field: string, val: string | number) => {
        const newRewards = [...rewards];
        if (['fixed_amount', 'min_amount', 'max_amount', 'chance_percent'].includes(field)) {
            newRewards[index][field] = sanitizeNumericInput(String(val));
        } else {
            newRewards[index][field] = val;
        }
        setRewards(newRewards);
    };

    const updateRewardMeta = (index: number, metaJson: string | null) => {
        const newRewards = [...rewards];
        newRewards[index] = { ...newRewards[index], meta_json: metaJson };
        setRewards(newRewards);
    };

    const addReward = () => {
        setRewards([
            ...rewards,
            { reward_type: 'stars', chance_percent: 0, is_active: 1 }
        ]);
    };

    /* === Fortune wheel editor === */
    const updateFortuneConfig = (field: keyof FortuneConfigAdmin, val: string | number) => {
        setFortuneConfig(prev => {
            const base = prev ?? { title: 'Фартовый мяч', price_balls: 0, is_active: 0 };
            if (field === 'price_balls') return { ...base, price_balls: sanitizeNumericInput(String(val)) };
            return { ...base, [field]: val };
        });
    };

    const updateFortuneSector = (index: number, field: string, val: string | number) => {
        const next = [...fortuneSectors];
        if (['fixed_amount', 'min_amount', 'max_amount', 'chance_percent', 'sort_order'].includes(field)) {
            next[index][field] = sanitizeNumericInput(String(val));
        } else {
            next[index][field] = val;
        }
        setFortuneSectors(next);
    };

    const addFortuneSector = () => {
        setFortuneSectors([
            ...fortuneSectors,
            { reward_type: 'balls', chance_percent: 0, fixed_amount: 1, label: '', color: '#ffcc00', is_active: 1, sort_order: (fortuneSectors.length + 1) * 10 },
        ]);
    };

    const removeFortuneSector = (index: number) => {
        setFortuneSectors(fortuneSectors.filter((_, i) => i !== index));
    };

    const updateFortuneSectorMeta = (index: number, metaJson: string | null) => {
        const next = [...fortuneSectors];
        next[index] = { ...next[index], meta_json: metaJson };
        setFortuneSectors(next);
    };

    const fortuneActiveChance = fortuneSectors.filter(s => Number(s.is_active) === 1).reduce((s, r) => s + Number(r.chance_percent || 0), 0);
    const fortuneChanceValid = Math.abs(fortuneActiveChance - 100) <= 0.01;

    const handleSaveFortuneConfig = async () => {
        setLoading(true); setSuccess(""); setError("");
        try {
            const cfg = fortuneConfig ?? { title: 'Фартовый мяч', price_balls: 0, is_active: 0 };
            const res = await fetchWithAuth<OkResult>("/admin/economy/fortune/config", {
                method: "PUT",
                body: JSON.stringify({
                    title: cfg.title || 'Фартовый мяч',
                    description: cfg.description ?? null,
                    price_balls: Number(cfg.price_balls || 0),
                    is_active: Number(cfg.is_active) === 1 ? 1 : 0,
                    allow_token_payment: cfg.allow_token_payment === undefined ? 1 : (Number(cfg.allow_token_payment) === 1 ? 1 : 0),
                    allow_balls_payment: cfg.allow_balls_payment === undefined ? 1 : (Number(cfg.allow_balls_payment) === 1 ? 1 : 0),
                }),
            });
            if (res?.ok) { setSuccess("Wheel config updated!"); setTimeout(() => setSuccess(""), 3000); }
            else setError(res?.error === "BOTH_PAYMENTS_DISABLED" ? "Нельзя выключить оба способа оплаты при активном барабане." : (res?.error || "Error saving wheel config"));
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const handleSaveFortuneSectors = async () => {
        setLoading(true); setSuccess(""); setError("");
        try {
            if (!fortuneChanceValid) {
                throw new Error(`Active sector probabilities must sum to 100 (current: ${fortuneActiveChance.toFixed(2)})`);
            }
            const processed = fortuneSectors.map((s, i) => {
                const next: FortuneSectorAdmin = { ...s, chance_percent: Number(s.chance_percent || 0) };
                next.fixed_amount = (s.fixed_amount != null && s.fixed_amount !== '') ? Number(s.fixed_amount) : null;
                next.min_amount = (s.min_amount != null && s.min_amount !== '') ? Number(s.min_amount) : null;
                next.max_amount = (s.max_amount != null && s.max_amount !== '') ? Number(s.max_amount) : null;
                next.sort_order = Number(s.sort_order || 0);
                // Reward code only meaningful for 'case' sectors.
                if (String(s.reward_type) !== 'case') next.reward_code = undefined;
                // Same sparse sub-weights cleanup as case rewards (backend normalizes by sum).
                if (next.fixed_amount != null) {
                    next.meta_json = null;
                } else if (next.min_amount != null && next.max_amount != null && next.min_amount < next.max_amount) {
                    const meta = parseRewardMeta(s.meta_json);
                    const raw = effectiveDiscreteAmounts(meta, next.min_amount, next.max_amount);
                    if (raw.length > 0 && !raw.some((d) => d.weight > 0)) {
                        throw new Error(`Сектор ${i+1}: все веса номиналов нулевые — задайте хотя бы один вес > 0 или удалите номиналы`);
                    }
                    const nextDiscrete = raw.filter((d) => d.weight > 0).sort((a, b) => a.amount - b.amount);
                    const nextMeta: RewardMeta = { ...meta };
                    if (nextDiscrete.length > 0) nextMeta.discrete_amounts = nextDiscrete;
                    else delete nextMeta.discrete_amounts;
                    next.meta_json = Object.keys(nextMeta).length > 0 ? JSON.stringify(nextMeta) : null;
                } else {
                    next.meta_json = null;
                }
                return next;
            });
            const res = await fetchWithAuth<OkResult>("/admin/economy/fortune/sectors", {
                method: "PUT",
                body: JSON.stringify(processed),
            });
            if (res?.ok) { setSuccess("Wheel sectors updated!"); setTimeout(() => setSuccess(""), 3000); }
            else setError(res?.error || "Error saving wheel sectors");
        } catch (e: unknown) { setError(getErrorMessage(e)); }
        finally { setLoading(false); }
    };

    const formatDateTime = (value: unknown) => {
        const num = Number(value || 0);
        if (!num) return "—";
        return formatMsk(num);
    };

    const getStarOrderStatusVariant = (status: string) => {
        if (status === "credited") return "success" as const;
        if (status === "refunded") return "warning" as const;
        if (status === "failed" || status === "cancelled") return "danger" as const;
        return "neutral" as const;
    };

    const getRefundReasonText = (reason?: string | null) => {
        switch (reason) {
            case "ALREADY_REFUNDED":
                return "Уже возвращён";
            case "ORDER_NOT_CREDITED":
                return "Заказ ещё не зачислен";
            case "TELEGRAM_CHARGE_MISSING":
                return "Нет Telegram charge id";
            case "NO_BALLS_IN_ORDER":
                return "В заказе нет мячиков";
            case "PURCHASE_LEDGER_MISSING":
                return "Не найден ledger покупки";
            case "SPEND_AFTER_PURCHASE":
                return "После покупки уже были траты мячиков";
            case "CURRENT_BALANCE_BELOW_PACK":
                return "Текущий баланс ниже размера пакета";
            case "BALLS_PARTIALLY_SPENT":
                return "Часть купленных мячиков уже потрачена";
            case "BALLS_ALREADY_SPENT":
                return "Купленные мячики уже потрачены";
            default:
                return reason || "Refund недоступен";
        }
    };

    const filteredStarOrders = starOrders.filter((order) => {
        if (starOrderFilter === "all") return true;
        if (starOrderFilter === "refundable") return !!order.refund_available;
        if (starOrderFilter === "credited") return String(order.status || "") === "credited";
        if (starOrderFilter === "refunded") return String(order.status || "") === "refunded";
        if (starOrderFilter === "failed") return ["failed", "cancelled"].includes(String(order.status || ""));
        return true;
    });

    const removeReward = (index: number) => {
        setRewards(rewards.filter((_, i) => i !== index));
    };

    // Rewards modal: total probability + validity (math unchanged).
    const rewardsTotalChance = rewards.reduce((s, r) => s + Number(r.chance_percent), 0);
    const rewardsValid = Math.abs(rewardsTotalChance - 100) <= 0.01;

    if (loading && boosts.length === 0) return (
        <AdminCard className="p-12 text-center text-[var(--tg-theme-hint-color,#999)] border-dashed animate-pulse">
            Loading Economy Settings...
        </AdminCard>
    );

    return (
        <div className="space-y-6">
            {error && (
                <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">
                    {error}
                </div>
            )}
            {success && (
                <div className="whitespace-pre-wrap break-words rounded-2xl border border-[color-mix(in_srgb,#34c759_36%,transparent)] bg-[color-mix(in_srgb,#34c759_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#34c759_88%,var(--tg-theme-text-color,#fff))]">
                    {success}
                </div>
            )}

            {/* ===== BOOSTS ===== */}
            <AdminCollapsibleSection title="Бусты" description={`${boosts.length} бустов · активно ${boosts.filter(b => b.is_active === 1).length}`} defaultOpen keepMounted storageKey="admin:economy:boosts">
            <AdminCard className="space-y-5">
                <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">🚀 Boosts Pricing</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {boosts.map((b, i) => (
                        <div key={b.code} className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/20 p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                        <span className="shrink-0 text-2xl">{b.emoji}</span>
                                        <span className="truncate">{b.title}</span>
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{b.code}</div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    <AdminToggle checked={b.is_active === 1} onChange={checked => updateBoost(i, 'is_active', checked ? 1 : 0)} />
                                    <AdminBadge variant={b.is_active === 1 ? "success" : "neutral"} size="sm">{b.is_active === 1 ? "вкл" : "выкл"}</AdminBadge>
                                </div>
                            </div>
                            <AdminInput label="Цена (мячи)" type="text" inputMode="decimal" value={String(b.price_balls ?? '')} onChange={e => updateBoost(i, 'price_balls', e.target.value)} />
                        </div>
                    ))}
                </div>
                <AdminButton onClick={handleSaveBoosts} loading={loading} variant="primary" fullWidth>
                    Save Boosts Config
                </AdminButton>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* ===== CASES ===== */}
            <AdminCollapsibleSection title="Кейсы" description={`${cases.length} типов · активно ${cases.filter(c => c.is_active === 1).length}`} keepMounted storageKey="admin:economy:cases">
            <AdminCard className="space-y-5">
                <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">📦 Cases Config</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {cases.map((c, i) => (
                        <div key={c.id} className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors ${selectedCaseId === c.id ? 'border-blue-500/50 bg-blue-600/10' : 'border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/20'}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                        <span className="shrink-0 text-2xl">{c.emoji}</span>
                                        <span className="truncate">{c.title}</span>
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{c.code}</div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    <AdminToggle checked={c.is_active === 1} onChange={checked => updateCase(i, 'is_active', checked ? 1 : 0)} />
                                    <AdminBadge variant={c.is_active === 1 ? "success" : "neutral"} size="sm">{c.is_active === 1 ? "вкл" : "выкл"}</AdminBadge>
                                </div>
                            </div>
                            <AdminInput label="Цена (мячи)" type="text" inputMode="decimal" value={String(c.price_balls ?? '')} disabled={c.code === 'daily_free'} onChange={e => updateCase(i, 'price_balls', e.target.value)} />
                            <AdminButton onClick={() => loadRewards(c.id)} variant={selectedCaseId === c.id ? "primary" : "secondary"} fullWidth>
                                {selectedCaseId === c.id ? 'Editing Rewards' : 'Настроить награды'}
                            </AdminButton>
                        </div>
                    ))}
                </div>
                <AdminButton onClick={handleSaveCases} loading={loading} variant="primary" fullWidth>
                    Save Cases Config
                </AdminButton>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* ===== FORTUNE WHEEL ===== */}
            <AdminCollapsibleSection title="Фартовый мяч" description={`${fortuneSectors.length} секторов · ${fortuneConfig?.is_active === 1 ? 'включено' : 'выключено'}`} keepMounted storageKey="admin:economy:fortune">
            <AdminCard className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">🎡 Fortune Wheel</h2>
                    <div className="flex items-center gap-2">
                        <AdminToggle checked={fortuneConfig?.is_active === 1} onChange={checked => updateFortuneConfig('is_active', checked ? 1 : 0)} />
                        <AdminBadge variant={fortuneConfig?.is_active === 1 ? "success" : "neutral"} size="sm">{fortuneConfig?.is_active === 1 ? "вкл" : "выкл"}</AdminBadge>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <AdminInput label="Название" type="text" value={String(fortuneConfig?.title ?? 'Фартовый мяч')} onChange={e => updateFortuneConfig('title', e.target.value)} />
                    <AdminInput label="Описание" type="text" value={String(fortuneConfig?.description ?? '')} onChange={e => updateFortuneConfig('description', e.target.value)} />
                    <AdminInput label="Цена прокрута (мячи)" type="text" inputMode="decimal" value={String(fortuneConfig?.price_balls ?? '')} onChange={e => updateFortuneConfig('price_balls', e.target.value)} />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="flex items-center gap-2 text-[13px] font-bold text-[var(--tg-theme-text-color,#fff)]">
                        <AdminToggle checked={(fortuneConfig?.allow_token_payment ?? 1) === 1} onChange={checked => updateFortuneConfig('allow_token_payment', checked ? 1 : 0)} />
                        Оплата жетоном (1 жетон = 1 прокрут)
                    </label>
                    <label className="flex items-center gap-2 text-[13px] font-bold text-[var(--tg-theme-text-color,#fff)]">
                        <AdminToggle checked={(fortuneConfig?.allow_balls_payment ?? 1) === 1} onChange={checked => updateFortuneConfig('allow_balls_payment', checked ? 1 : 0)} />
                        Оплата мячиками
                    </label>
                </div>
                <AdminButton onClick={handleSaveFortuneConfig} loading={loading} variant="secondary" fullWidth>
                    Save Wheel Config
                </AdminButton>

                <div className="flex items-center gap-3 pt-2">
                    <AdminMetricCard size="sm" label="Секторов" value={fortuneSectors.length} />
                    <AdminMetricCard
                        size="sm"
                        label="Сумма шансов (активные)"
                        value={`${fortuneActiveChance.toFixed(2)}%`}
                        badge={<AdminBadge variant={fortuneChanceValid ? "success" : "danger"} size="sm">{fortuneChanceValid ? "100% OK" : "≠ 100%"}</AdminBadge>}
                    />
                </div>

                <div className="space-y-3">
                    {fortuneSectors.map((s, i) => (
                        <div key={i} className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/20 p-4">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[13px] font-bold text-[var(--tg-theme-hint-color,#999)]">Сектор #{i + 1}</span>
                                <div className="flex items-center gap-2">
                                    <AdminToggle checked={Number(s.is_active) === 1} onChange={checked => updateFortuneSector(i, 'is_active', checked ? 1 : 0)} />
                                    <AdminButton onClick={() => removeFortuneSector(i)} variant="danger" size="sm">Удалить</AdminButton>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                <AdminSelect
                                    label="Тип награды"
                                    options={FORTUNE_REWARD_TYPE_OPTIONS}
                                    value={String(s.reward_type ?? 'balls')}
                                    onChange={value => updateFortuneSector(i, 'reward_type', value)}
                                />
                                {String(s.reward_type) === 'case' && (
                                    <AdminSelect
                                        label="Тип кейса"
                                        options={FORTUNE_CASE_CODE_OPTIONS}
                                        value={String(s.reward_code ?? 'daily_free')}
                                        onChange={value => updateFortuneSector(i, 'reward_code', value)}
                                    />
                                )}
                                <AdminInput label="Chance %" type="text" inputMode="decimal" value={String(s.chance_percent ?? '')} onChange={e => updateFortuneSector(i, 'chance_percent', e.target.value)} />
                                <AdminInput label="Fixed amount" type="text" inputMode="decimal" value={String(s.fixed_amount ?? '')} onChange={e => updateFortuneSector(i, 'fixed_amount', e.target.value)} />
                                <AdminInput label="Min amount" type="text" inputMode="decimal" value={String(s.min_amount ?? '')} onChange={e => updateFortuneSector(i, 'min_amount', e.target.value)} />
                                <AdminInput label="Max amount" type="text" inputMode="decimal" value={String(s.max_amount ?? '')} onChange={e => updateFortuneSector(i, 'max_amount', e.target.value)} />
                                <AdminInput label="Подпись" type="text" value={String(s.label ?? '')} onChange={e => updateFortuneSector(i, 'label', e.target.value)} />
                                <AdminInput label="Цвет (hex)" type="text" value={String(s.color ?? '')} onChange={e => updateFortuneSector(i, 'color', e.target.value)} />
                                <AdminInput label="Порядок" type="text" inputMode="decimal" value={String(s.sort_order ?? '')} onChange={e => updateFortuneSector(i, 'sort_order', e.target.value)} />
                            </div>
                            <DiscreteWeightsEditor row={s} onChangeMeta={mj => updateFortuneSectorMeta(i, mj)} />
                        </div>
                    ))}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                    <AdminButton onClick={addFortuneSector} variant="secondary" fullWidth>+ Добавить сектор</AdminButton>
                    <AdminButton onClick={handleSaveFortuneSectors} loading={loading} variant="primary" fullWidth disabled={!fortuneChanceValid}>
                        Save Wheel Sectors
                    </AdminButton>
                </div>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* ===== REFERRAL PROGRAM ===== */}
            <ReferralSection fetchWithAuth={fetchWithAuth} />

            {/* ===== STAR PACKS ===== */}
            <AdminCollapsibleSection title="Telegram Stars: пакеты" description={`${starPacks.length} пакетов`} keepMounted storageKey="admin:economy:star-packs">
            <AdminCard className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">⭐ Telegram Stars Packs</h2>
                    <AdminButton onClick={addStarPack} variant="secondary" size="sm">+ Add Pack</AdminButton>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {starPacks.map((pack, i) => (
                        <div key={`${pack.id ?? 'new'}-${i}`} className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/20 p-4">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                        <span className="shrink-0 text-2xl">{pack.emoji || '⭐'}</span>
                                        <span className="truncate">{pack.title || 'New pack'}</span>
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">{pack.code || 'new_code'}</div>
                                </div>
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                    <AdminToggle checked={pack.is_active === 1} onChange={checked => updateStarPack(i, 'is_active', checked ? 1 : 0)} />
                                    <AdminBadge variant={pack.is_active === 1 ? "success" : "neutral"} size="sm">{pack.is_active === 1 ? "Активен" : "Выключен"}</AdminBadge>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <AdminInput label="Code" type="text" value={String(pack.code ?? '')} onChange={e => updateStarPack(i, 'code', e.target.value.toLowerCase())} />
                                <AdminInput label="Emoji" type="text" value={String(pack.emoji ?? '')} onChange={e => updateStarPack(i, 'emoji', e.target.value)} />
                            </div>
                            <AdminInput label="Title" type="text" value={String(pack.title ?? '')} onChange={e => updateStarPack(i, 'title', e.target.value)} />
                            <AdminInput label="Description" type="text" value={String(pack.description ?? '')} onChange={e => updateStarPack(i, 'description', e.target.value)} />
                            <div className="grid grid-cols-2 gap-3">
                                <AdminInput label="Balls" type="text" inputMode="decimal" value={String(pack.balls_amount ?? '')} onChange={e => updateStarPack(i, 'balls_amount', e.target.value)} />
                                <AdminInput label="Bonus Balls" type="text" inputMode="decimal" value={String(pack.bonus_balls ?? '')} onChange={e => updateStarPack(i, 'bonus_balls', e.target.value)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <AdminInput label="Price (XTR)" type="text" inputMode="decimal" value={String(pack.price_xtr ?? '')} onChange={e => updateStarPack(i, 'price_xtr', e.target.value)} />
                                <AdminInput label="Sort" type="text" inputMode="decimal" value={String(pack.sort_order ?? '')} onChange={e => updateStarPack(i, 'sort_order', e.target.value)} />
                            </div>
                            <AdminInput label="Badge" type="text" value={String(pack.badge_text ?? '')} onChange={e => updateStarPack(i, 'badge_text', e.target.value)} />
                        </div>
                    ))}
                </div>
                <AdminButton onClick={handleSaveStarPacks} loading={loading} variant="primary" fullWidth>
                    Save Telegram Stars Packs
                </AdminButton>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* ===== STAR ORDERS ===== */}
            <AdminCollapsibleSection title="Telegram Stars: заказы" description={`всего ${starOrders.length} · refundable ${starOrders.filter(o => !!o.refund_available).length}`} badge={<AdminBadge variant="warning" size="sm">возвраты</AdminBadge>} keepMounted storageKey="admin:economy:star-orders">
            <AdminCard className="space-y-5">
                <div className="flex flex-col gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-[17px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] flex items-center gap-2">💳 Telegram Stars Orders</h2>
                        <div className="mt-1 text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                            Refund включается только для полностью нетронутого пакета мячиков.
                        </div>
                    </div>
                    <AdminButton onClick={loadEconomy} variant="secondary" size="sm" disabled={loading || refundingOrderId !== ""}>
                        Обновить
                    </AdminButton>
                </div>

                <AdminSegmentedControl<typeof starOrderFilter>
                    ariaLabel="Фильтр заказов Telegram Stars"
                    value={starOrderFilter}
                    onChange={setStarOrderFilter}
                    options={[
                        { value: "all", label: `Все ${starOrders.length}` },
                        { value: "refundable", label: `Refund ${starOrders.filter((o) => !!o.refund_available).length}` },
                        { value: "credited", label: `Credited ${starOrders.filter((o) => String(o.status || "") === "credited").length}` },
                        { value: "refunded", label: `Refunded ${starOrders.filter((o) => String(o.status || "") === "refunded").length}` },
                        { value: "failed", label: `Failed ${starOrders.filter((o) => ["failed", "cancelled"].includes(String(o.status || ""))).length}` },
                    ]}
                />

                <div className="space-y-3">
                    {filteredStarOrders.length === 0 ? (
                        <div className="rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4 text-[13px] text-[var(--tg-theme-hint-color,#999)]">
                            По выбранному фильтру заказов нет.
                        </div>
                    ) : filteredStarOrders.map((order) => {
                        const displayName = order.first_name || order.username
                            ? `${order.first_name || ""}${order.username ? ` · @${order.username}` : ""}`.trim()
                            : `User ${order.user_id}`;
                        const isRefundingThis = refundingOrderId === String(order.order_id);
                        return (
                            <div
                                key={String(order.order_id)}
                                className="flex flex-col gap-4 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">
                                            {order.pack_title || order.pack_code || "Stars pack"}
                                        </div>
                                        <div className="mt-1 break-all text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                                            {displayName} · id {order.user_id}
                                        </div>
                                        <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                                            order {order.order_id}
                                        </div>
                                    </div>
                                    <AdminBadge variant={getStarOrderStatusVariant(String(order.status || ""))} size="sm">
                                        {String(order.status || "").toUpperCase()}
                                    </AdminBadge>
                                </div>

                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                    <AdminMetricCard size="sm" label="Цена" value={`${Number(order.price_xtr || 0)} XTR`} />
                                    <AdminMetricCard size="sm" label="Мячики" value={Number(order.total_balls || 0)} />
                                    <AdminMetricCard size="sm" label="Баланс сейчас" value={Number(order.current_balance || 0)} />
                                    <AdminMetricCard size="sm" label="Нетронуто" value={Number(order.unspent_purchase_balls || 0)} />
                                </div>

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <AdminDataRow label="Создан" value={formatDateTime(order.created_at)} />
                                    <AdminDataRow label="Оплачен" value={formatDateTime(order.paid_at)} />
                                    <AdminDataRow label="Зачислен" value={formatDateTime(order.credited_at)} />
                                </div>

                                <div className="flex flex-col gap-3 rounded-xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/10 p-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className={`text-[13px] font-semibold ${order.refund_available ? 'text-emerald-300' : 'text-[var(--tg-theme-text-color,#fff)]'}`}>
                                            {order.refund_available ? 'Refund доступен' : getRefundReasonText(order.refund_reason)}
                                        </div>
                                        {!order.refund_available && (
                                            <div className="mt-1 text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                                                Возврат разрешаем только для полностью неиспользованного пакета.
                                            </div>
                                        )}
                                    </div>
                                    <AdminButton
                                        variant={order.refund_available ? "danger" : "secondary"}
                                        size="sm"
                                        loading={isRefundingThis}
                                        disabled={!order.refund_available}
                                        onClick={() => handleRefundStarOrder(String(order.order_id))}
                                        aria-label={`Refund заказа ${order.order_id}`}
                                        className="w-full sm:w-auto"
                                    >
                                        Refund
                                    </AdminButton>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* Rewards Modal */}
            {selectedCaseId && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto backdrop-blur-sm">
                    <AdminCard className="w-full max-w-4xl my-4 sm:my-8 relative flex flex-col max-h-[95vh] !p-0 overflow-hidden shadow-2xl">
                        {/* Header */}
                        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-[var(--tg-theme-bg-color,#1c1c1e)] p-4 sm:p-6">
                            <div className="flex min-w-0 items-center gap-2">
                                <h2 className="truncate text-[16px] font-extrabold tracking-tight text-[var(--tg-theme-text-color,#fff)] sm:text-[18px]">
                                    Rewards: {cases.find(c => c.id === selectedCaseId)?.title}
                                </h2>
                                {cases.find(c => c.id === selectedCaseId)?.code && (
                                    <AdminBadge variant="accent" size="sm">{cases.find(c => c.id === selectedCaseId)?.code}</AdminBadge>
                                )}
                            </div>
                            <AdminButton variant="ghost" size="sm" onClick={() => setSelectedCaseId(null)} aria-label="Закрыть" className="shrink-0">✕</AdminButton>
                        </div>

                        {/* Content box */}
                        <div className="p-4 sm:p-6 overflow-y-auto grow space-y-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                                <div className="grid flex-1 grid-cols-2 gap-3">
                                    <AdminMetricCard size="sm" label="Строк наград" value={rewards.length} />
                                    <AdminMetricCard
                                        size="sm"
                                        label="Сумма вероятностей"
                                        value={`${rewardsTotalChance.toFixed(2)}%`}
                                        badge={<AdminBadge variant={rewardsValid ? "success" : "danger"} size="sm">{rewardsValid ? "100% OK" : "≠ 100%"}</AdminBadge>}
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <AdminButton onClick={addReward} variant="secondary" className="flex-1 sm:flex-none">+ Add Row</AdminButton>
                                    <AdminButton onClick={handleSaveRewards} loading={loading} variant="primary" className="flex-1 sm:flex-none">Save Rewards</AdminButton>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {rewards.map((r, i) => (
                                    <div key={i} className="flex flex-col gap-4 rounded-xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-[12px] font-extrabold uppercase tracking-wide text-[var(--tg-theme-hint-color,#999)]">Награда #{i + 1}</div>
                                            <div className="flex items-center gap-3">
                                                <AdminToggle checked={r.is_active === 1} onChange={checked => updateReward(i, 'is_active', checked ? 1 : 0)} />
                                                <AdminButton variant="danger" size="sm" onClick={() => removeReward(i)} aria-label={`Удалить награду ${i + 1}`}>✕</AdminButton>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <AdminSelect
                                                label="Type"
                                                value={String(r.reward_type ?? "stars")}
                                                onChange={value => updateReward(i, 'reward_type', value)}
                                                options={REWARD_TYPE_OPTIONS}
                                            />
                                            <AdminInput label="Context Code" type="text" value={r.reward_code || ''} onChange={e => updateReward(i, 'reward_code', e.target.value)} placeholder="code" className="font-mono" />
                                            <AdminInput label="Chance %" type="text" inputMode="decimal" value={String(r.chance_percent ?? '')} onChange={e => updateReward(i, 'chance_percent', e.target.value)} />
                                        </div>

                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <AdminInput label="Fixed Amt" type="text" inputMode="decimal" value={String(r.fixed_amount ?? '')} onChange={e => updateReward(i, 'fixed_amount', e.target.value)} placeholder="qty" />
                                            <AdminInput label="Min Amt" type="text" inputMode="decimal" value={String(r.min_amount ?? '')} disabled={r.fixed_amount != null && r.fixed_amount !== ''} onChange={e => updateReward(i, 'min_amount', e.target.value)} className={r.fixed_amount != null && r.fixed_amount !== '' ? 'opacity-30' : ''} />
                                            <AdminInput label="Max Amt" type="text" inputMode="decimal" value={String(r.max_amount ?? '')} disabled={r.fixed_amount != null && r.fixed_amount !== ''} onChange={e => updateReward(i, 'max_amount', e.target.value)} className={r.fixed_amount != null && r.fixed_amount !== '' ? 'opacity-30' : ''} />
                                        </div>

                                        <DiscreteWeightsEditor row={r} onChangeMeta={mj => updateRewardMeta(i, mj)} />
                                    </div>
                                ))}
                                {rewards.length === 0 && (
                                    <div className="rounded-xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] py-12 text-center text-[var(--tg-theme-hint-color,#999)]">
                                        {"No rewards configured. Click '+ Add Row' to start."}
                                    </div>
                                )}
                            </div>
                        </div>
                    </AdminCard>
                </div>
            )}

            {/* ===== STAR EXCHANGE CONFIG ===== */}
            {exchangeConfig !== null && (
            <AdminCollapsibleSection title="Обмен звёзд на мячики" description={`${exchangeConfig.enabled ? "включён" : "выключен"} · тиров ${exchangeTiers.length}`} keepMounted storageKey="admin:economy:exchange">
                <AdminCard className="space-y-4">
                    <h3 className="text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">⭐ Обмен звёзд на мячики</h3>

                    <div className="grid grid-cols-2 gap-3">
                        <AdminMetricCard
                            size="sm"
                            label="Статус обмена"
                            value={exchangeConfig.enabled ? "Включён" : "Выключен"}
                            badge={<AdminBadge variant={exchangeConfig.enabled ? "success" : "neutral"} size="sm">{exchangeConfig.enabled ? "on" : "off"}</AdminBadge>}
                        />
                        <AdminMetricCard size="sm" label="Тиров" value={exchangeTiers.length} />
                    </div>

                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/10 p-3">
                        <span className="text-[13px] font-semibold text-[var(--tg-theme-text-color,#fff)]">{exchangeConfig.enabled ? 'Обмен включён' : 'Обмен выключен'}</span>
                        <AdminToggle
                            checked={!!exchangeConfig.enabled}
                            onChange={v => setExchangeConfig(c => c ? { ...c, enabled: v } : c)}
                        />
                    </div>

                    <AdminInput
                        label="Лимит игровых звёзд для обмена в неделю"
                        description="SUM(stars_spent) не должен превышать это значение за 7 дней"
                        type="text"
                        inputMode="numeric"
                        value={String(exchangeConfig.weekly_limit)}
                        onChange={e => {
                            const v = Math.max(1, Math.min(10000, Number(sanitizeNumericInput(e.target.value)) || 1));
                            setExchangeConfig(c => c ? { ...c, weekly_limit: v } : c);
                        }}
                    />

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Тиры обмена</span>
                            <AdminButton
                                variant="secondary"
                                size="sm"
                                onClick={() => setExchangeTiers(t => [...t, { tier_key: `tier_${Date.now()}`, label: '', stars_cost: 10, balls_reward: 1, is_active: 1, sort_order: (t.at(-1)?.sort_order ?? 0) + 10 }])}
                            >
                                + Добавить тир
                            </AdminButton>
                        </div>
                        <div className="flex flex-col gap-3">
                            {exchangeTiers.map((tier, i) => (
                                <div key={tier.id ?? i} className="flex flex-col gap-3 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-black/10 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[12px] font-extrabold uppercase tracking-wide text-[var(--tg-theme-hint-color,#999)]">Тир #{i + 1}</span>
                                        <div className="flex items-center gap-3">
                                            <AdminToggle
                                                checked={!!tier.is_active}
                                                onChange={v => {
                                                    const next = [...exchangeTiers];
                                                    next[i] = { ...next[i], is_active: v ? 1 : 0 };
                                                    setExchangeTiers(next);
                                                }}
                                            />
                                            <AdminButton
                                                variant="danger"
                                                size="sm"
                                                aria-label={`Удалить тир ${i + 1}`}
                                                onClick={() => setExchangeTiers(t => t.filter((_, j) => j !== i))}
                                            >✕</AdminButton>
                                        </div>
                                    </div>
                                    <AdminInput
                                        label="Название"
                                        type="text"
                                        placeholder="Название"
                                        value={String(tier.label ?? '')}
                                        onChange={e => {
                                            const next = [...exchangeTiers];
                                            next[i] = { ...next[i], label: e.target.value };
                                            setExchangeTiers(next);
                                        }}
                                    />
                                    <div className="grid grid-cols-2 gap-3">
                                        <AdminInput
                                            label="⭐ стоит"
                                            type="text"
                                            inputMode="numeric"
                                            value={String(tier.stars_cost ?? '')}
                                            onChange={e => {
                                                const next = [...exchangeTiers];
                                                next[i] = { ...next[i], stars_cost: Number(sanitizeNumericInput(e.target.value)) || 0 };
                                                setExchangeTiers(next);
                                            }}
                                        />
                                        <AdminInput
                                            label="⚽ даёт"
                                            type="text"
                                            inputMode="numeric"
                                            value={String(tier.balls_reward ?? '')}
                                            onChange={e => {
                                                const next = [...exchangeTiers];
                                                next[i] = { ...next[i], balls_reward: Number(sanitizeNumericInput(e.target.value)) || 0 };
                                                setExchangeTiers(next);
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                            {exchangeTiers.length === 0 && (
                                <div className="py-4 text-center text-[13px] text-[var(--tg-theme-hint-color,#999)]">
                                    Нет тиров. Добавьте хотя бы один.
                                </div>
                            )}
                        </div>
                    </div>

                    <AdminButton onClick={handleSaveExchange} loading={loading} variant="primary" fullWidth>
                        Сохранить обмен
                    </AdminButton>
                </AdminCard>
            </AdminCollapsibleSection>
            )}

            {/* ===== STAR EXCHANGE LEDGER ===== */}
            <AdminCollapsibleSection title="Журнал обменов" description={`всего ${ledgerTotal}`} forceOpen={!!ledgerError} keepMounted storageKey="admin:economy:ledger">
            <AdminCard>
                <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">📋 Журнал обменов</h3>
                            <div className="mt-0.5 text-[12px] text-[var(--tg-theme-hint-color,#999)]">Последние операции обмена игровых звёзд на мячики</div>
                        </div>
                        <AdminButton variant="secondary" size="sm" onClick={() => loadLedger(0)} loading={ledgerLoading}>
                            Обновить
                        </AdminButton>
                    </div>

                    {/* Filters */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <AdminInput
                            label="Поиск"
                            type="text"
                            placeholder="Пользователь / ID"
                            value={ledgerFilterQ}
                            onChange={e => setLedgerFilterQ(e.target.value)}
                        />
                        <AdminInput
                            label="Неделя"
                            type="text"
                            placeholder="напр. 2026-W20"
                            value={ledgerFilterWeek}
                            onChange={e => setLedgerFilterWeek(e.target.value)}
                        />
                        <AdminInput
                            label="Tier ID"
                            type="text"
                            placeholder="Tier ID"
                            value={ledgerFilterTier}
                            onChange={e => setLedgerFilterTier(e.target.value)}
                        />
                        <div className="flex items-end">
                            <AdminButton onClick={() => loadLedger(0, ledgerFilterQ, ledgerFilterWeek, ledgerFilterTier)} loading={ledgerLoading} variant="primary" fullWidth>
                                Найти
                            </AdminButton>
                        </div>
                    </div>

                    {/* List */}
                    {ledgerError ? (
                        <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">{ledgerError}</div>
                    ) : ledgerLoading ? (
                        <div className="py-8 text-center text-[13px] text-[var(--tg-theme-hint-color,#999)]">Загружаем журнал...</div>
                    ) : ledgerItems.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] py-8 text-center text-[13px] text-[var(--tg-theme-hint-color,#999)]">
                            Операций обмена пока нет
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {ledgerItems.map(item => {
                                const dateStr = formatMsk(item.created_at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                                return (
                                    <div key={item.id} className="flex flex-col gap-2 rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] bg-black/20 p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">{item.display_name}</div>
                                                <div className="truncate text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                                                    {item.username ? `@${item.username} · ` : ""}ID {item.user_id}
                                                </div>
                                            </div>
                                            <AdminButton variant="ghost" size="sm" onClick={() => setLedgerDetail(item)} aria-label={`Детали обмена ${item.id}`}>Детали</AdminButton>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <AdminBadge variant="warning" size="sm">-{item.stars_spent} ⭐</AdminBadge>
                                            <AdminBadge variant="success" size="sm">+{item.balls_received} ⚽</AdminBadge>
                                            <AdminBadge variant="neutral" size="sm">{item.tier_key ?? item.tier_id}</AdminBadge>
                                            <AdminBadge variant="neutral" size="sm">{item.week_key}</AdminBadge>
                                        </div>
                                        <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">{dateStr}</div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Pagination */}
                    {ledgerTotal > LEDGER_LIMIT && (
                        <div className="flex items-center justify-between gap-2 pt-1">
                            <AdminButton
                                variant="secondary"
                                size="sm"
                                onClick={() => loadLedger(Math.max(0, ledgerOffset - LEDGER_LIMIT))}
                                disabled={ledgerOffset === 0 || ledgerLoading}
                            >← Назад</AdminButton>
                            <span className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                                {ledgerOffset + 1}–{Math.min(ledgerOffset + LEDGER_LIMIT, ledgerTotal)} из {ledgerTotal}
                            </span>
                            <AdminButton
                                variant="secondary"
                                size="sm"
                                onClick={() => loadLedger(ledgerOffset + LEDGER_LIMIT)}
                                disabled={ledgerOffset + LEDGER_LIMIT >= ledgerTotal || ledgerLoading}
                            >Далее →</AdminButton>
                        </div>
                    )}
                </div>
            </AdminCard>
            </AdminCollapsibleSection>

            {/* ===== LEDGER DETAIL MODAL ===== */}
            {ledgerDetail && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
                    onClick={() => setLedgerDetail(null)}
                >
                    <div
                        className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-2xl bg-[var(--tg-theme-bg-color,#1c1c1e)] p-5 text-[var(--tg-theme-text-color,#fff)] shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between gap-2">
                            <h4 className="text-[15px] font-extrabold">Детали обмена #{ledgerDetail.id}</h4>
                            <div className="flex items-center gap-2">
                                <AdminBadge variant="neutral" size="sm">{ledgerDetail.status}</AdminBadge>
                                <AdminButton variant="ghost" size="sm" onClick={() => setLedgerDetail(null)} aria-label="Закрыть">✕</AdminButton>
                            </div>
                        </div>
                        <div className="flex flex-col gap-2">
                            <AdminDataRow label="ID" value={ledgerDetail.id} />
                            <AdminDataRow label="User ID" value={ledgerDetail.user_id} />
                            <AdminDataRow label="Пользователь" value={ledgerDetail.display_name} />
                            <AdminDataRow label="Username" value={ledgerDetail.username ? `@${ledgerDetail.username}` : '—'} />
                            <AdminDataRow label="Звёзды списано" value={`${ledgerDetail.stars_spent} ⭐`} />
                            <AdminDataRow label="Мячи начислено" value={`${ledgerDetail.balls_received} ⚽`} />
                            <AdminDataRow label="Tier ID" value={ledgerDetail.tier_id} />
                            <AdminDataRow label="Tier key" value={ledgerDetail.tier_key ?? '—'} />
                            <AdminDataRow label="Неделя" value={ledgerDetail.week_key} />
                            <AdminDataRow label="Статус" value={ledgerDetail.status} />
                            <AdminDataRow label="Дата" value={formatMsk(ledgerDetail.created_at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} />
                            <AdminDataRow label="Idempotency key" value={<span className="break-all font-mono">{ledgerDetail.idempotency_key}</span>} />
                        </div>
                        {ledgerDetail.config_snapshot_json && (
                            <div className="mt-4">
                                <div className="mb-2 text-[11px] font-semibold text-[var(--tg-theme-hint-color,#999)]">Snapshot курса на момент обмена</div>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-[rgba(128,128,128,0.1)] p-3 text-[12px]">
                                    {(() => { try { return JSON.stringify(JSON.parse(ledgerDetail.config_snapshot_json), null, 2); } catch { return ledgerDetail.config_snapshot_json; } })()}
                                </pre>
                            </div>
                        )}
                        <div className="mt-4">
                            <AdminButton variant="secondary" onClick={() => setLedgerDetail(null)} fullWidth>Закрыть</AdminButton>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
