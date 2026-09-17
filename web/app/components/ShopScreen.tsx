"use client";

import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { AppIcon } from "./ui/AppIcon";
import type { AppIconName } from "./ui/appIcons";
import { CaseOpeningAnimation, preloadCaseAnimationAssets } from "./shop/CaseOpeningAnimation";
import { SegmentedControl } from "./ui/SegmentedControl";
import { FortuneWheel, metaForReward, tierForSector, TIER_ODDS_DISPLAY, type FortuneSector, type FortuneReward, type Tier } from "./shop/FortuneWheel";

// Persisted idempotency key for an in-flight /shop/buy of a given item. Survives a Mini App
// reload (sessionStorage) so a retry after a lost response reuses the same operationId and the
// backend never double-charges. Stores no sensitive data (just a UUID + item code + timestamp).
function pendingShopOpKey(itemType: string): string {
    return `shop_pending_op:${itemType}`;
}
function getOrCreatePendingShopOp(itemType: string): string {
    try {
        const raw = sessionStorage.getItem(pendingShopOpKey(itemType));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.operationId && parsed?.itemType === itemType) return String(parsed.operationId);
        }
    } catch { /* sessionStorage unavailable — fall through to a fresh id */ }
    const operationId = crypto.randomUUID();
    try {
        sessionStorage.setItem(pendingShopOpKey(itemType), JSON.stringify({ operationId, itemType, createdAt: Date.now() }));
    } catch { /* best-effort persistence */ }
    return operationId;
}
function clearPendingShopOp(itemType: string): void {
    try { sessionStorage.removeItem(pendingShopOpKey(itemType)); } catch { /* noop */ }
}

// Same persisted-idempotency model for /cases/open. A paid premium open must not be charged twice
// after a lost response, so the openId survives a reload and is reused on retry of the same case.
function pendingCaseOpKey(caseType: string): string {
    return `case_pending_op:${caseType}`;
}
function getOrCreatePendingCaseOp(caseType: string): string {
    try {
        const raw = sessionStorage.getItem(pendingCaseOpKey(caseType));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.openId && parsed?.caseType === caseType) return String(parsed.openId);
        }
    } catch { /* fall through */ }
    const openId = crypto.randomUUID();
    try {
        sessionStorage.setItem(pendingCaseOpKey(caseType), JSON.stringify({ openId, caseType, createdAt: Date.now() }));
    } catch { /* best-effort */ }
    return openId;
}
function clearPendingCaseOp(caseType: string): void {
    try { sessionStorage.removeItem(pendingCaseOpKey(caseType)); } catch { /* noop */ }
}

// Persisted idempotency key for a fortune ("Фартовый мяч") spin, keyed by payment method so a
// lost response / reload reuses the SAME spinId and the backend never double-charges. The winning
// sector is always taken from the backend result (never re-rolled locally).
// Persisted idempotency key for an in-flight star exchange of a given tier. Survives a Mini App
// reload (sessionStorage) so a retry after a lost response reuses the SAME idempotency_key and
// the backend exchanges exactly once. Cleared only on a terminal response — NOT on an ambiguous
// network error (same pattern as shop / case / fortune operations above).
function pendingExchangeOpKey(tierId: number): string {
    return `exchange_pending_op:${tierId}`;
}
function getOrCreatePendingExchangeOp(tierId: number): string {
    try {
        const raw = sessionStorage.getItem(pendingExchangeOpKey(tierId));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.idempotencyKey && Number(parsed?.tierId) === tierId) return String(parsed.idempotencyKey);
        }
    } catch { /* fall through */ }
    const idempotencyKey = crypto.randomUUID();
    try {
        sessionStorage.setItem(pendingExchangeOpKey(tierId), JSON.stringify({ idempotencyKey, tierId, createdAt: Date.now() }));
    } catch { /* best-effort */ }
    return idempotencyKey;
}
function clearPendingExchangeOp(tierId: number): void {
    try { sessionStorage.removeItem(pendingExchangeOpKey(tierId)); } catch { /* noop */ }
}

function pendingFortuneOpKey(paymentMethod: string): string {
    return `fortune_pending_op:${paymentMethod}`;
}
function getOrCreatePendingFortuneOp(paymentMethod: string): string {
    try {
        const raw = sessionStorage.getItem(pendingFortuneOpKey(paymentMethod));
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.spinId && parsed?.paymentMethod === paymentMethod) return String(parsed.spinId);
        }
    } catch { /* fall through */ }
    const spinId = crypto.randomUUID();
    try {
        sessionStorage.setItem(pendingFortuneOpKey(paymentMethod), JSON.stringify({ spinId, paymentMethod, wheelCode: "default", createdAt: Date.now() }));
    } catch { /* best-effort */ }
    return spinId;
}
function clearPendingFortuneOp(paymentMethod: string): void {
    try { sessionStorage.removeItem(pendingFortuneOpKey(paymentMethod)); } catch { /* noop */ }
}

type ShopItem = {
    code: string;
    emoji: string;
    title: string;
    description: string;
    price_balls: number;
};

type ShopStarPack = {
    code: string;
    emoji?: string | null;
    title: string;
    description?: string | null;
    balls_amount: number;
    bonus_balls: number;
    total_balls: number;
    price_xtr: number;
    badge_text?: string | null;
};

function CurrencyAmount({
    value,
    icon,
    iconSize,
    style,
}: {
    value: ReactNode;
    icon: "ball" | "game_star";
    iconSize: number;
    style?: CSSProperties;
}) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", ...style }}>
            {value}
            <AppIcon name={icon} size={iconSize} />
        </span>
    );
}

function getShopItemIcon(code: string): AppIconName | null {
    if (code === "extra_joker" || code === "joker") return "joker";
    if (code === "double_chance") return "double_chance";
    if (code === "extra_league" || code === "extra_league_coupon" || code === "league_slot" || code === "extra_private_league") return "extra_league_coupon";
    return null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ===== Drop odds transparency block ("Шансы выпадения") =====
// Rows come straight from the public configs (/shop/config case rewards, /fortune/config
// sectors) — the server only exposes chance_percent + amount bounds, never sub-weights.
type DropOddsRow = {
    reward_type: string;
    reward_code?: string | null;
    label?: string | null;
    chance_percent?: number | null;
    min_amount?: number | null;
    max_amount?: number | null;
    fixed_amount?: number | null;
};

function oddsRowMeta(r: DropOddsRow): { icon: AppIconName; label: string } {
    const t = (r.reward_type || "").toLowerCase();
    if (t === "lucky_token") return { icon: "lucky_token", label: r.label || "Жетон" };
    if (t === "extra_joker_double_chance") return { icon: "joker", label: r.label || "Джокер + Двойной шанс" };
    const meta = metaForReward({ reward_type: t, reward_code: r.reward_code });
    return { icon: meta.icon, label: r.label || meta.label };
}

function oddsAmountText(r: DropOddsRow): string {
    const fixed = r.fixed_amount != null ? Number(r.fixed_amount) : null;
    const min = r.min_amount != null ? Number(r.min_amount) : null;
    const max = r.max_amount != null ? Number(r.max_amount) : null;
    if (fixed != null && fixed > 1) return `×${fixed}`;
    if (min != null && max != null && max > min) return `${min}–${max}`;
    return "";
}

function formatChancePercent(v: number): string {
    const rounded = Math.round(v * 100) / 100;
    return `${rounded}%`;
}

function cleanOddsRows(rows: DropOddsRow[]): DropOddsRow[] {
    return rows
        .filter(r => Number.isFinite(Number(r.chance_percent)) && Number(r.chance_percent) > 0)
        .slice()
        .sort((a, b) => Number(b.chance_percent) - Number(a.chance_percent));
}

// Optional grouping: the fortune odds are grouped by ball rarity — the same tiers
// (and ball artwork) the reel uses, so the list answers "what can drop from which ball".
type DropOddsGroup = { label: string; icon: AppIconName; color: string; rows: DropOddsRow[] };

const FORTUNE_TIER_ORDER: Tier[] = ["common", "good", "rare", "legendary"];

function buildFortuneOddsGroups(sectors: FortuneSector[]): DropOddsGroup[] {
    return FORTUNE_TIER_ORDER
        .map(tier => ({
            ...TIER_ODDS_DISPLAY[tier],
            rows: sectors.filter(s => tierForSector(s) === tier),
        }))
        .filter(g => g.rows.length > 0);
}

function DropOddsRowLine({ r, accent, maxChance }: { r: DropOddsRow; accent: string; maxChance: number }) {
    const meta = oddsRowMeta(r);
    const amount = oddsAmountText(r);
    const pct = Number(r.chance_percent);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, lineHeight: 1.3 }}>
            <AppIcon name={meta.icon} size={15} />
            <span style={{ color: 'rgba(255,255,255,0.75)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {meta.label}{amount ? ` ${amount}` : ''}
            </span>
            <div aria-hidden style={{ width: 44, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(4, (pct / maxChance) * 100)}%`, height: '100%', borderRadius: 2, background: accent, opacity: 0.9 }} />
            </div>
            <span style={{ fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums', width: 44, textAlign: 'right', flexShrink: 0 }}>
                {formatChancePercent(pct)}
            </span>
        </div>
    );
}

// Collapsible odds list, styled for the dark tinted cards (premium / fortune).
// Pass flat `rows` (premium case) or `groups` (fortune — grouped by ball rarity).
function DropOddsBlock({ rows, groups, accent }: { rows?: DropOddsRow[]; groups?: DropOddsGroup[]; accent: string }) {
    const [open, setOpen] = useState(false);
    const grouped = (groups ?? [])
        .map(g => ({ ...g, rows: cleanOddsRows(g.rows) }))
        .filter(g => g.rows.length > 0);
    const flat = grouped.length > 0 ? [] : cleanOddsRows(rows ?? []);
    const allRows = grouped.length > 0 ? grouped.flatMap(g => g.rows) : flat;
    if (allRows.length === 0) return null;
    const maxChance = Math.max(...allRows.map(r => Number(r.chance_percent)));
    return (
        <div style={{ marginTop: 12, position: 'relative', zIndex: 1 }}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
                }}
            >
                Шансы выпадения
                <span aria-hidden style={{
                    display: 'inline-block', fontSize: 9, lineHeight: 1,
                    transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease',
                }}>▼</span>
            </button>
            {open && (
                <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', flexDirection: 'column', gap: grouped.length > 0 ? 12 : 6,
                }}>
                    {grouped.length > 0 ? grouped.map((g, gi) => {
                        const total = g.rows.reduce((s, r) => s + Number(r.chance_percent), 0);
                        return (
                            <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 7, fontSize: 12,
                                    paddingBottom: 5, borderBottom: '1px solid rgba(255,255,255,0.08)',
                                }}>
                                    <AppIcon name={g.icon} size={17} />
                                    <span style={{ fontWeight: 700, color: g.color, flex: 1 }}>{g.label}</span>
                                    <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
                                        {formatChancePercent(total)}
                                    </span>
                                </div>
                                {g.rows.map((r, i) => <DropOddsRowLine key={i} r={r} accent={accent} maxChance={maxChance} />)}
                            </div>
                        );
                    }) : flat.map((r, i) => <DropOddsRowLine key={i} r={r} accent={accent} maxChance={maxChance} />)}
                </div>
            )}
        </div>
    );
}

function pluralRu(value: number, one: string, few: string, many: string): string {
    const abs = Math.abs(value);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

// Shop tabs, with the subsection keys the admin visibility settings use.
export const SHOP_TAB_SUBSECTION_KEY: Record<'boosts' | 'luck' | 'topup' | 'exchange', string> = {
    boosts: 'shop.boosts',
    luck: 'shop.luck',
    topup: 'shop.topup',
    exchange: 'shop.exchange',
};
export const SHOP_SUBSECTION_KEYS = Object.values(SHOP_TAB_SUBSECTION_KEY);

export default function ShopScreen({ balls: initialBalls, onClose, onBalanceUpdate, embedded = false, hiddenSubsections, initialTab, onCasesUpdate }: {
    balls: number;
    onClose: () => void;
    onBalanceUpdate?: (newBalls: number) => void;
    embedded?: boolean;
    // Subsection keys hidden by an admin (shop.boosts / .luck / .topup / .exchange).
    hiddenSubsections?: string[];
    // Tab to land on — the home "Открыть кейсы" bar opens the shop straight on 'luck'.
    initialTab?: 'boosts' | 'luck' | 'topup' | 'exchange';
    // Mirrors the case inventory back to the caller so the home bar never shows a stale count.
    onCasesUpdate?: (cases: Array<{ case_type: string; quantity: number }>) => void;
}) {
    const [balance, setBalance] = useState(initialBalls);
    // Keep the in-screen balance in sync with the header balance (it may resolve after
    // the shop mounts, or change elsewhere). Server responses still drive both.
    useEffect(() => { setBalance(initialBalls); }, [initialBalls]);
    const [activeTab, setActiveTab] = useState<'boosts' | 'luck' | 'topup' | 'exchange'>(initialTab || 'boosts');
    const [buying, setBuying] = useState<string | null>(null);
    const [buyingStarPack, setBuyingStarPack] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('success');
    const [confirmItem, setConfirmItem] = useState<ShopItem | null>(null);
    const [confirmStarPack, setConfirmStarPack] = useState<ShopStarPack | null>(null);

    // Case opening state
    const [confirmCaseType, setConfirmCaseType] = useState<string | null>(null);
    const [confirmCaseStars, setConfirmCaseStars] = useState(false);
    const [casePhase, setCasePhase] = useState<'idle' | 'opening' | 'reveal'>('idle');
    const [caseReward, setCaseReward] = useState<{ type: string; amount: number } | null>(null);
    const [openingCaseVariant, setOpeningCaseVariant] = useState<'premium' | 'basic'>('premium');
    const caseGuard = useRef(false);

    // Warm the case animation assets so the very first opening shows the case instantly.
    useEffect(() => { preloadCaseAnimationAssets(); }, []);

    const [shopConfig, setShopConfig] = useState<{ boosts: ShopItem[]; cases: any[]; star_packs: ShopStarPack[] } | null>(null);
    const [myCases, setMyCases] = useState<any[]>([]);
    // Every case-inventory write goes through here so the home screen's
    // "Открыть кейсы" bar never keeps a stale count after an opening.
    const applyMyCases = (cases: any[]) => {
        setMyCases(cases);
        onCasesUpdate?.(cases);
    };

    // Fortune wheel state
    type FortuneConfig = { enabled: boolean; title?: string; price_balls: number; price_stars?: number; free_spins: number; lucky_tokens: number; allow_token_payment: boolean; allow_balls_payment: boolean; allow_stars_payment?: boolean; token_cost: number; sectors: FortuneSector[] };
    const [fortuneConfig, setFortuneConfig] = useState<FortuneConfig | null>(null);
    const [fortuneConfirm, setFortuneConfirm] = useState(false);
    const [fortunePayMethod, setFortunePayMethod] = useState<"lucky_token" | "balls" | "stars">("balls");
    const [fortuneOpen, setFortuneOpen] = useState(false);
    const [fortuneWinIndex, setFortuneWinIndex] = useState<number | null>(null);
    const [fortuneReward, setFortuneReward] = useState<FortuneReward | null>(null);
    const [fortunePending, setFortunePending] = useState(false);
    const fortuneGuard = useRef(false);

    const loadFortune = () => {
        apiFetch<any>("/fortune/config").then(res => {
            if (res.ok) setFortuneConfig(res as FortuneConfig);
        }).catch(console.error);
    };

    type ExchangeTier = { id: number; tier_key: string; label: string; stars_cost: number; balls_reward: number };
    type ExchangeConfig = { enabled: boolean; weekly_star_limit: number; stars_used_this_week: number; stars_remaining: number; current_stars: number; tiers: ExchangeTier[]; cap_lifted?: boolean; days_until_season_end?: number | null; burn_warning?: boolean };
    const [exchangeConfig, setExchangeConfig] = useState<ExchangeConfig | null>(null);
    const [exchangeLoading, setExchangeLoading] = useState(false);
    const [exchangeError, setExchangeError] = useState<string | null>(null);
    const [exchanging, setExchanging] = useState<number | null>(null);
    const [exchangeConfirm, setExchangeConfirm] = useState<ExchangeTier | null>(null);

    // Silent re-fetch of the star balance for the header card: on mount and after any
    // action that spends stars (premium case / spin) or can win them (daily case).
    const refreshStars = () => {
        apiFetch<any>("/economy/star-exchange")
            .then(res => { if (res.ok) setExchangeConfig(res as ExchangeConfig); })
            .catch(console.error);
    };

    useEffect(() => {
        const initData = (window as any).Telegram?.WebApp?.initData || "";

        refreshStars();

        apiFetch<any>("/fortune/config").then(res => {
            if (res.ok) setFortuneConfig(res as FortuneConfig);
        }).catch(console.error);

        apiFetch<any>("/shop/config").then(res => {
            if (res.ok) {
                setShopConfig({
                    boosts: res.boosts || [],
                    cases: res.cases || [],
                    star_packs: res.star_packs || [],
                });
            }
        }).catch(console.error);

        if (initData) {
            apiFetch<any>("/me/boosts", {
                method: 'POST',
                body: JSON.stringify({ initData })
            }).then(res => {
                if (res.ok) applyMyCases(res.cases || []);
            }).catch(console.error);
        }
    }, []);

    // Tabs actually offered: admin visibility first, then the star-packs guard
    // that already hid «Мячи» when the shop has no packs configured.
    const visibleShopTabs = ((): Array<'boosts' | 'luck' | 'topup' | 'exchange'> => {
        const tabs: Array<'boosts' | 'luck' | 'topup' | 'exchange'> = ['boosts', 'luck'];
        if ((shopConfig?.star_packs?.length || 0) > 0) tabs.push('topup');
        tabs.push('exchange');
        return tabs.filter((tab) => !hiddenSubsections?.includes(SHOP_TAB_SUBSECTION_KEY[tab]));
    })();
    const visibleShopTabsKey = visibleShopTabs.join(',');

    useEffect(() => {
        if (activeTab === 'topup' && !(shopConfig?.star_packs?.length)) {
            setActiveTab('boosts');
        }
    }, [activeTab, shopConfig?.star_packs?.length]);

    // Land on a visible tab when an admin hid the current one.
    useEffect(() => {
        if (visibleShopTabs.length === 0) return;
        if (visibleShopTabs.includes(activeTab)) return;
        setActiveTab(visibleShopTabs[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleShopTabsKey, activeTab]);

    useEffect(() => {
        // Грузим и на вкладке «Удача»: там нужен current_stars для покупок за звёзды (§0.4).
        if (activeTab !== 'exchange' && activeTab !== 'luck') return;
        setExchangeLoading(true);
        setExchangeError(null);
        apiFetch<any>("/economy/star-exchange")
            .then(res => {
                if (res.ok) { setExchangeConfig(res as ExchangeConfig); }
                else { console.error('star-exchange config error', res); setExchangeError('Не удалось загрузить обмен. Попробуй позже.'); }
            })
            .catch(e => setExchangeError(String(e)))
            .finally(() => setExchangeLoading(false));
    }, [activeTab]);

    async function handleBuy(itemKey: string) {
        if (buying) return;
        setBuying(itemKey);
        setFeedback(null);
        // Stable idempotency key, persisted in sessionStorage and tied to (operationId,itemType).
        // A lost response / timeout / reload reuses the SAME id, so the backend charges + grants
        // exactly once. Cleared only on a confirmed terminal response — NOT on an ambiguous
        // network error. The disabled button is UX only, not economy protection.
        const operationId = getOrCreatePendingShopOp(itemKey);
        try {
            const initData = (window as any).Telegram?.WebApp?.initData || "";
            const res = await apiFetch<any>("/shop/buy", {
                method: "POST",
                body: JSON.stringify({ initData, itemType: itemKey, operationId }),
            });
            // Terminal response (success, duplicate-replay, or a definitive business error):
            // the operation reached a final state → safe to drop the pending id.
            clearPendingShopOp(itemKey);
            if (res.ok) {
                setBalance(res.balance);
                onBalanceUpdate?.(res.balance);
                const itemBought = shopConfig?.boosts.find(i => i.code === itemKey);
                setFeedback(itemBought ? `Куплено: ${itemBought.title} ✅` : "Покупка прошла ✅");
                setFeedbackType('success');
                setConfirmItem(null);
            } else {
                setFeedback(res.error === "SHOP_OPERATION_CONFLICT" ? "Покупка уже обрабатывается — подожди пару секунд" : (res.error || "Не удалось купить"));
                setFeedbackType('error');
            }
        } catch (e: any) {
            // Ambiguous network error (timeout / connection reset / lost response): KEEP the
            // pending operationId so the next attempt for this item replays the same id.
            setFeedback((e?.message || "Ошибка сети") + " — попробуй ещё раз, дважды не спишется");
            setFeedbackType('error');
        } finally {
            setBuying(null);
            setTimeout(() => setFeedback(null), 3000);
        }
    }

    /* === Case purchase & open === */
    async function handleOpenCase(caseType: string, payWithStars = false) {
        if (caseGuard.current) return;
        caseGuard.current = true;
        setOpeningCaseVariant(caseType === 'premium' ? 'premium' : 'basic');
        setConfirmCaseType(null);
        setCaseReward(null);
        setCasePhase('opening');

        // Persisted idempotency key: a lost response / timeout / reload reuses the SAME openId so a
        // paid premium open is never charged twice. Keyed by payment method so a balls- and a
        // stars-paid open never collide. Cleared only on a terminal response.
        const opKeyType = payWithStars ? `${caseType}:stars` : caseType;
        const openId = getOrCreatePendingCaseOp(opKeyType);
        const initData = (window as any).Telegram?.WebApp?.initData || "";
        try {
            const res = await apiFetch<any>("/cases/open", {
                method: "POST",
                body: JSON.stringify({ initData, caseType, openId, ...(payWithStars ? { payment: 'stars' } : {}) }),
            });
            // Terminal response (success, duplicate-replay, or a definitive business error).
            clearPendingCaseOp(opKeyType);
            if (!res.ok) {
                const msg = res.error === 'INSUFFICIENT_BALLS' ? 'Недостаточно мячей'
                    : res.error === 'INSUFFICIENT_STARS' ? 'Недостаточно игровых звёзд'
                    : res.error === 'CASE_NOT_FOR_STARS' ? 'Этот кейс нельзя купить за звёзды.'
                    : (res.error || 'Ошибка');
                alert(msg);
                setCasePhase('idle');
                caseGuard.current = false;
                return;
            }
            setBalance(res.balance ?? balance);
            onBalanceUpdate?.(res.balance ?? balance);
            // The response carries the post-open state: stars may have been spent
            // (premium via stars) or won (daily case drop) — apply them immediately.
            if (typeof res.stars === 'number') {
                setExchangeConfig(prev => prev ? { ...prev, current_stars: res.stars } : prev);
            }
            // A dropped Жетон is not part of the /cases/open state — re-pull the wheel config.
            if (res.reward?.type === 'lucky_token') loadFortune();

            // Re-sync cases so the card dismisses if quantity reached 0
            apiFetch<any>("/me/boosts", {
                method: 'POST',
                body: JSON.stringify({ initData })
            }).then(sync => {
                if (sync.ok) applyMyCases(sync.cases || []);
            });

            if (res.reward) {
                setCaseReward(res.reward);
                setCasePhase('reveal');
            } else {
                setCasePhase('idle');
            }
        } catch (e: any) {
            alert(e.message || 'Ошибка');
            setCasePhase('idle');
        } finally {
            caseGuard.current = false;
        }
    }

    /* === Fortune wheel spin ===
       Payment method is explicit (the user pressed one of two buttons). Balances are
       only updated from the server response — never optimistically. */
    async function handleSpinFortune(paymentMethod: "lucky_token" | "balls" | "stars") {
        if (fortuneGuard.current) return;
        fortuneGuard.current = true;
        setFortuneConfirm(false);
        setFortuneWinIndex(null);
        setFortuneReward(null);
        setFortunePending(true);
        setFortuneOpen(true);

        // Persisted idempotency key: a lost response / timeout / reload reuses the SAME spinId so
        // the spin is never charged twice. The winning sector comes from the backend, not a local
        // roll. Cleared only on a terminal response.
        const spinId = getOrCreatePendingFortuneOp(paymentMethod);
        const initData = (window as any).Telegram?.WebApp?.initData || "";
        try {
            const res = await apiFetch<any>("/fortune/spin", {
                method: "POST",
                body: JSON.stringify({ initData, spinId, paymentMethod }),
            });
            // Terminal response (success, duplicate-replay, or a definitive business error).
            clearPendingFortuneOp(paymentMethod);
            if (!res.ok) {
                const msg = res.error === 'INSUFFICIENT_BALLS' ? 'Недостаточно мячей'
                    : (res.error === 'INSUFFICIENT_LUCKY_TOKENS' || res.error === 'INSUFFICIENT_TOKENS') ? 'Недостаточно жетонов'
                    : res.error === 'INSUFFICIENT_STARS' ? 'Недостаточно игровых звёзд'
                    : res.error === 'TOKEN_PAYMENT_DISABLED' ? 'Оплата жетоном недоступна.'
                    : res.error === 'BALLS_PAYMENT_DISABLED' ? 'Оплата мячами недоступна.'
                    : (res.error === 'STARS_PAYMENT_DISABLED' || res.error === 'STARS_PRICE_NOT_SET') ? 'Оплата звёздами недоступна.'
                    : res.error === 'PAYMENT_METHOD_REQUIRED' ? 'Выберите способ оплаты.'
                    : res.error === 'FORTUNE_SPIN_OPERATION_CONFLICT' ? 'Прокрут уже обрабатывается — подожди пару секунд.'
                    : (res.error || 'Ошибка');
                alert(msg);
                setFortuneOpen(false);
                return;
            }
            if (typeof res.balance === 'number') {
                setBalance(res.balance);
                onBalanceUpdate?.(res.balance);
            }
            // Post-spin state from the server: stars may have been spent on the spin.
            if (typeof res.stars === 'number') {
                setExchangeConfig(prev => prev ? { ...prev, current_stars: res.stars } : prev);
            }
            setFortuneConfig(prev => prev ? {
                ...prev,
                lucky_tokens: Number(res.lucky_tokens ?? res.free_spins ?? prev.lucky_tokens),
                free_spins: Number(res.lucky_tokens ?? res.free_spins ?? prev.free_spins),
            } : prev);
            setFortuneWinIndex(Number(res.sector_index ?? 0));
            setFortuneReward(res.reward as FortuneReward);
        } catch (e: any) {
            alert(e.message || 'Ошибка');
            setFortuneOpen(false);
        } finally {
            setFortunePending(false);
            fortuneGuard.current = false;
        }
    }

    function closeFortune() {
        setFortuneOpen(false);
        setFortuneWinIndex(null);
        setFortuneReward(null);
        loadFortune();
        const initData = (window as any).Telegram?.WebApp?.initData || "";
        if (initData) {
            apiFetch<any>("/me/boosts", { method: 'POST', body: JSON.stringify({ initData }) })
                .then(sync => { if (sync.ok) applyMyCases(sync.cases || []); }).catch(() => {});
        }
    }

    async function pollStarOrder(orderId: string, attempts: number = 12) {
        for (let i = 0; i < attempts; i++) {
            try {
                const res = await apiFetch<any>(`/shop/xtr/order-status?orderId=${encodeURIComponent(orderId)}`);
                if (res?.ok && (res.credited || ['credited', 'failed', 'refunded'].includes(String(res.status || '')))) {
                    return res;
                }
            } catch {
                // keep polling quietly
            }
            await sleep(1500);
        }
        return null;
    }

    async function handleBuyStarPack(pack: ShopStarPack) {
        if (buyingStarPack) return;
        const tg = window.Telegram?.WebApp;
        if (!tg?.openInvoice) {
            setFeedback('Обнови Telegram, чтобы покупать через Telegram Stars.');
            setFeedbackType('error');
            setTimeout(() => setFeedback(null), 3500);
            return;
        }

        setConfirmStarPack(null);
        setBuyingStarPack(pack.code);
        setFeedback(null);
        try {
            const res = await apiFetch<any>('/shop/xtr/create-invoice', {
                method: 'POST',
                body: JSON.stringify({ packCode: pack.code }),
            });

            const invoiceUrl = String(res?.invoiceUrl || '');
            const orderId = String(res?.orderId || '');
            if (!invoiceUrl || !orderId) {
                throw new Error('Не удалось подготовить оплату.');
            }

            tg.openInvoice(invoiceUrl, async (status) => {
                const normalized = String(status || '').toLowerCase();
                if (normalized === 'paid' || normalized === 'pending') {
                    const finalState = await pollStarOrder(orderId, normalized === 'paid' ? 14 : 18);
                    if (finalState?.credited) {
                        const nextBalance = Number(finalState.balance ?? balance);
                        setBalance(nextBalance);
                        onBalanceUpdate?.(nextBalance);
                        setFeedback(`Зачислено ${Number(finalState.totalBalls || pack.total_balls)} ${pluralRu(Number(finalState.totalBalls || pack.total_balls), 'мяч', 'мяча', 'мячей')}`);
                        setFeedbackType('success');
                        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
                    } else if (finalState?.status === 'failed' || finalState?.status === 'refunded') {
                        setFeedback(finalState.lastError || 'Покупка не была подтверждена.');
                        setFeedbackType('error');
                    } else {
                        setFeedback('Платёж принят. Баланс обновится после синхронизации магазина.');
                        setFeedbackType('success');
                    }
                    setBuyingStarPack(null);
                    setTimeout(() => setFeedback(null), 4000);
                    return;
                }

                if (normalized === 'cancelled') {
                    setFeedback('Покупка отменена.');
                } else {
                    setFeedback('Не удалось завершить покупку.');
                }
                setFeedbackType('error');
                setBuyingStarPack(null);
                setTimeout(() => setFeedback(null), 3500);
            });
        } catch (e: any) {
            setFeedback(e.message || 'Не удалось создать счёт для оплаты.');
            setFeedbackType('error');
            setBuyingStarPack(null);
            setTimeout(() => setFeedback(null), 3500);
        }
    }

    function closeCaseReveal() {
        setCasePhase('idle');
        setCaseReward(null);
    }

    async function handleExchange(tier: ExchangeTier) {
        if (exchanging) return;
        setExchanging(tier.id);
        setExchangeConfirm(null);
        setFeedback(null);
        // Persisted idempotency key: a lost response / timeout / reload reuses the SAME key, so a
        // retry replays the committed exchange (already_processed) instead of exchanging twice.
        const idempotencyKey = getOrCreatePendingExchangeOp(tier.id);
        try {
            const res = await apiFetch<any>("/economy/star-exchange", {
                method: "POST",
                body: JSON.stringify({ tier_id: tier.id, idempotency_key: idempotencyKey }),
            });
            // Terminal response (success, replay, or a definitive business error) → drop the key.
            clearPendingExchangeOp(tier.id);
            if (res.ok) {
                const newBalls = Number(res.new_balls_balance);
                setBalance(newBalls);
                onBalanceUpdate?.(newBalls);
                setExchangeConfig(prev => prev ? {
                    ...prev,
                    current_stars: Math.max(0, (prev.current_stars || 0) - tier.stars_cost),
                    stars_used_this_week: prev.stars_used_this_week + tier.stars_cost,
                    stars_remaining: Math.max(0, prev.stars_remaining - tier.stars_cost),
                } : prev);
                setFeedback(`Обменяно: ${tier.stars_cost} игровых звёзд → ${tier.balls_reward} ${pluralRu(tier.balls_reward, 'мяч', 'мяча', 'мячей')}`);
                setFeedbackType('success');
                window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
            } else {
                const errMap: Record<string, string> = {
                    EXCHANGE_DISABLED: 'Обмен временно отключён.',
                    TIER_NOT_FOUND: 'Этот вариант обмена недоступен.',
                    INSUFFICIENT_STARS: `Недостаточно игровых звёзд — нужно ${tier.stars_cost}.`,
                    WEEKLY_STAR_LIMIT_EXCEEDED: `Превышен недельный лимит (${res.remaining ?? 0} осталось).`,
                };
                setFeedback(errMap[res.error] || res.error || 'Ошибка обмена');
                setFeedbackType('error');
            }
        } catch (e: any) {
            // Ambiguous network error: KEEP the pending key so the retry replays the same exchange.
            setFeedback((e.message || 'Ошибка') + ' — попробуй ещё раз, обмен не задвоится');
            setFeedbackType('error');
        } finally {
            setExchanging(null);
            setTimeout(() => setFeedback(null), 3500);
        }
    }

    const PREMIUM_CASE_COST = shopConfig?.cases?.find(c => c.code === 'premium')?.price_balls ?? 7;
    const PREMIUM_CASE_STARS_COST = Number(shopConfig?.cases?.find(c => c.code === 'premium')?.price_stars ?? 0);
    const premiumCaseRewards: DropOddsRow[] = shopConfig?.cases?.find(c => c.code === 'premium')?.rewards ?? [];
    const canBuyPremiumStars = PREMIUM_CASE_STARS_COST > 0 && (exchangeConfig?.current_stars ?? 0) >= PREMIUM_CASE_STARS_COST;
    const premiumCaseQuantity = myCases.find(c => c.case_type === 'premium')?.quantity || 0;
    const hasPremiumCase = premiumCaseQuantity > 0;
    const canAffordCase = balance >= PREMIUM_CASE_COST;
    const canOpenPremiumCase = hasPremiumCase || canAffordCase;

    return (
        <div style={{
            position: embedded ? "relative" : "fixed",
            inset: embedded ? undefined : 0,
            background: embedded ? "transparent" : "var(--tg-secondary-bg)",
            zIndex: embedded ? "auto" : 50,
            overflowY: embedded ? "visible" : "auto",
            color: "var(--tg-text)",
        }}>
            {/* Header */}
            <div style={{
                position: embedded ? "relative" : "sticky", top: 0, background: embedded ? "transparent" : "var(--tg-secondary-bg)", zIndex: 10,
                padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
                borderBottom: embedded ? "none" : "0.5px solid var(--tg-separator, rgba(128,128,128,0.1))",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AppIcon name="shop" size={26} loading="eager" />
                    <span style={{ fontSize: 20, fontWeight: 700 }}>Магазин</span>
                </div>
                {embedded ? <div style={{ width: 32, height: 32 }} /> : <button onClick={onClose} style={{
                    width: 32, height: 32, borderRadius: 16, background: "var(--tg-bg)",
                    border: "none", color: "var(--tg-hint)", fontSize: 16,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}>✕</button>}
            </div>

            {/* Balance card */}
            <div style={{ padding: "8px 16px 6px" }}>
                <div style={{
                    background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
                    borderRadius: 16, padding: "10px 14px", boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
                    display: "flex", alignItems: "stretch",
                }}>
                    <div style={{ flex: 1, textAlign: "center" }}>
                        <AppIcon name="ball" size={30} loading="eager" />
                        <div style={{ fontSize: 22, lineHeight: 1.05, fontWeight: 800, color: "#fff", marginTop: 4 }}>{balance}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", marginTop: 2 }}>Мячи</div>
                    </div>
                    <div style={{ width: 1, background: "rgba(255,255,255,0.12)", margin: "2px 0" }} />
                    <div style={{ flex: 1, textAlign: "center" }}>
                        <AppIcon name="game_star" size={30} loading="eager" />
                        <div style={{ fontSize: 22, lineHeight: 1.05, fontWeight: 800, color: "#fff", marginTop: 4 }}>
                            {exchangeConfig ? exchangeConfig.current_stars : "—"}
                        </div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.62)", marginTop: 2 }}>Звёзды</div>
                    </div>
                </div>
            </div>

            {/* Feedback */}
            {feedback && (
                <div style={{
                    margin: "0 16px 8px", padding: "10px 16px", borderRadius: 12,
                    background: feedbackType === 'success' ? 'rgba(52,199,89,0.15)' : 'rgba(255,59,48,0.15)',
                    color: feedbackType === 'success' ? '#34c759' : '#ff3b30',
                    fontSize: 14, fontWeight: 600, textAlign: 'center',
                }}>{feedback}</div>
            )}

            {/* Tabs */}
            <div style={{ padding: '0 16px 12px', display: visibleShopTabs.length > 1 ? undefined : 'none' }}>
                <SegmentedControl
                    value={activeTab}
                    onChange={setActiveTab}
                    ariaLabel="Разделы магазина"
                    trackStyle={{
                        gap: 4,
                        padding: 4,
                        borderRadius: 18,
                        background: 'rgba(128,128,128,0.1)',
                        border: '1px solid rgba(128,128,128,0.08)',
                    }}
                    pillStyle={{
                        borderRadius: 14,
                        background: 'linear-gradient(135deg, var(--tg-theme-button-color, #ff7a18), rgba(255,255,255,0.15))',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.14)',
                    }}
                    itemStyle={(active) => ({
                        minHeight: 42,
                        borderRadius: 14,
                        color: active ? 'var(--tg-theme-button-text-color, #fff)' : 'var(--tg-text)',
                        fontWeight: active ? 700 : 600,
                        fontSize: 13,
                        transition: 'color 180ms ease, font-weight 180ms ease',
                    })}
                    items={visibleShopTabs.map(tab => ({
                        key: tab,
                        content: tab === 'boosts' ? 'Бусты' : tab === 'luck' ? 'Фортуна' : tab === 'topup' ? 'Мячи' : 'Обмен',
                    }))}
                />
            </div>

            {/* Tab content */}
            <div style={{ padding: "0 16px 24px" }}>
                {visibleShopTabs.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: 'var(--tg-hint)', fontSize: 13, fontWeight: 700 }}>
                        Разделы магазина временно недоступны.
                    </div>
                ) : activeTab === 'boosts' ? (
                    /* Boosts section */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(shopConfig?.boosts || []).map((item) => {
                            const canAfford = balance >= item.price_balls;
                            const isBuyingThis = buying === item.code && !confirmItem;
                            return (
                                <div key={item.code} style={{
                                    background: "var(--tg-bg)", borderRadius: 16, padding: "16px",
                                    border: "1px solid rgba(128,128,128,0.08)", display: "flex", alignItems: "center", gap: 14,
                                }}>
                                    <div style={{
                                        width: 48, height: 48, borderRadius: 14,
                                        background: "linear-gradient(135deg, rgba(255,204,0,0.15), rgba(255,149,0,0.15))",
                                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0,
                                    }}>
                                        {getShopItemIcon(item.code) ? (
                                            <AppIcon name={getShopItemIcon(item.code)!} size={42} />
                                        ) : (
                                            item.emoji
                                        )}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--tg-text)" }}>{item.title}</div>
                                        <div style={{ fontSize: 12, color: "var(--tg-hint)", marginTop: 3, lineHeight: 1.4 }}>{item.description}</div>
                                    </div>
                                    <button onClick={() => setConfirmItem(item)} disabled={!canAfford || !!buying} style={{
                                        background: canAfford ? "linear-gradient(135deg, #ffcc00, #ff9500)" : "rgba(128,128,128,0.2)",
                                        border: "none", borderRadius: 12, padding: "8px 14px",
                                        cursor: canAfford && !buying ? "pointer" : "default", fontWeight: 700, fontSize: 13,
                                        color: canAfford ? "#000" : "var(--tg-hint)", whiteSpace: "nowrap", opacity: isBuyingThis ? 0.6 : 1,
                                        display: "flex", alignItems: "center", justifyContent: "center", gap: 4, flexShrink: 0, minWidth: 66,
                                    }}>
                                        {isBuyingThis ? "…" : <CurrencyAmount value={item.price_balls} icon="ball" iconSize={20} />}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : activeTab === 'luck' ? (
                    <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* ====== DAILY FREE CASE ====== */}
                        {(myCases.find(c => c.case_type === 'daily_free')?.quantity || 0) > 0 && (
                            <div style={{
                                borderRadius: 16, padding: '16px', position: 'relative', overflow: 'hidden',
                                background: 'linear-gradient(145deg, #0f2c45, #163f5e)',
                                border: '1px solid rgba(56,189,248,0.3)',
                                boxShadow: '0 2px 12px rgba(56,189,248,0.12)',
                            }}>
                                <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120, opacity: 0.04, borderRadius: '50%', background: '#38bdf8', pointerEvents: 'none' }} />
                                <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1 }}>
                                    <div style={{
                                        width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                                        background: 'linear-gradient(160deg, #1b3d69, #0f2c45)',
                                        border: '1.5px solid rgba(56,189,248,0.4)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                                    }}>
                                        <AppIcon name="case_basic" size={38} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>Ежедневный кейс</div>
                                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3, lineHeight: 1.4 }}>
                                            Доступно: {myCases.find(c => c.case_type === 'daily_free').quantity} шт.
                                        </div>
                                    </div>
                                    <button onClick={() => setConfirmCaseType('daily_free')} disabled={casePhase !== 'idle'} style={{
                                        background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
                                        border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36, width: 92,
                                        cursor: casePhase === 'idle' ? 'pointer' : 'default',
                                        fontWeight: 700, fontSize: 13,
                                        color: '#fff', whiteSpace: 'nowrap',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexShrink: 0,
                                    }}>
                                        Открыть
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ====== PREMIUM CASE CARD ====== */}
                        <div style={{
                            borderRadius: 16, padding: '16px', position: 'relative', overflow: 'hidden',
                            background: 'linear-gradient(145deg, #1f0a3d, #2a1252)',
                            border: '1px solid rgba(168,85,247,0.3)',
                            boxShadow: '0 2px 12px rgba(168,85,247,0.12)',
                        }}>
                            <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120, opacity: 0.04, borderRadius: '50%', background: '#A855F7', pointerEvents: 'none' }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1 }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                                    background: 'linear-gradient(160deg, #2d1b69, #1a0a3e)',
                                    border: '1.5px solid rgba(168,85,247,0.4)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                                }}>
                                    <AppIcon name="case_premium" size={46} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>Премиум-кейс</div>
                                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3, lineHeight: 1.4 }}>
                                        {hasPremiumCase
                                            ? `Доступно: ${premiumCaseQuantity} шт.`
                                            : 'Случайная награда: мячи, бусты, жетоны'}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, flexShrink: 0, width: 92 }}>
                                    <button onClick={() => canOpenPremiumCase && (setConfirmCaseStars(false), setConfirmCaseType('premium'))} disabled={!canOpenPremiumCase || casePhase !== 'idle'} style={{
                                        background: canOpenPremiumCase ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : 'rgba(128,128,128,0.2)',
                                        border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36,
                                        cursor: canOpenPremiumCase && casePhase === 'idle' ? 'pointer' : 'default',
                                        fontWeight: 700, fontSize: 13,
                                        color: canOpenPremiumCase ? '#fff' : 'var(--tg-hint)', whiteSpace: 'nowrap',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    }}>
                                        {hasPremiumCase ? 'Открыть' : <CurrencyAmount value={PREMIUM_CASE_COST} icon="ball" iconSize={20} />}
                                    </button>
                                    {/* §0.4: покупка премиум-кейса за игровые звёзды (когда нет в инвентаре) */}
                                    {!hasPremiumCase && PREMIUM_CASE_STARS_COST > 0 && (
                                        <button onClick={() => canBuyPremiumStars && casePhase === 'idle' && (setConfirmCaseStars(true), setConfirmCaseType('premium'))} disabled={!canBuyPremiumStars || casePhase !== 'idle'} style={{
                                            background: canBuyPremiumStars ? 'linear-gradient(135deg, #D946EF, #A21CAF)' : 'rgba(128,128,128,0.2)',
                                            border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36,
                                            cursor: canBuyPremiumStars && casePhase === 'idle' ? 'pointer' : 'default',
                                            fontWeight: 700, fontSize: 13, color: canBuyPremiumStars ? '#fff' : 'var(--tg-hint)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap',
                                        }}>
                                            <CurrencyAmount value={PREMIUM_CASE_STARS_COST} icon="game_star" iconSize={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <DropOddsBlock rows={premiumCaseRewards} accent="#C084FC" />
                        </div>
                    </div>
                    {fortuneConfig?.enabled && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                        {(() => {
                            const fc = fortuneConfig;
                            const tokens = fc?.lucky_tokens ?? fc?.free_spins ?? 0;
                            const price = fc?.price_balls || 0;
                            const allowToken = fc?.allow_token_payment !== false;
                            const allowBalls = fc?.allow_balls_payment !== false;
                            const priceStars = fc?.price_stars || 0;
                            const allowStars = fc?.allow_stars_payment === true && priceStars > 0;
                            const userStars = exchangeConfig?.current_stars ?? 0;
                            const canToken = allowToken && tokens >= 1;
                            const canBalls = allowBalls && balance >= price && price > 0;
                            const canStars = allowStars && userStars >= priceStars;
                            const spin = (method: "lucky_token" | "balls" | "stars") => { setFortunePayMethod(method); setFortuneConfirm(true); };
                            return (
                                <div style={{
                                    borderRadius: 16, padding: '16px', position: 'relative', overflow: 'hidden',
                                    background: 'linear-gradient(145deg, #3a1d05, #5e3410)',
                                    border: '1px solid rgba(249,115,22,0.3)',
                                    boxShadow: '0 2px 12px rgba(249,115,22,0.12)',
                                }}>
                                    <div style={{ position: 'absolute', top: -20, right: -20, width: 120, height: 120, opacity: 0.05, borderRadius: '50%', background: '#F97316', pointerEvents: 'none' }} />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative', zIndex: 1 }}>
                                        <div style={{
                                            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                                            background: 'linear-gradient(160deg, #5e3410, #3a1d05)',
                                            border: '1.5px solid rgba(249,115,22,0.4)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26,
                                        }}><AppIcon name="fortune" size={42} /></div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{fc?.title || 'Фартовый мяч'}</div>
                                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3, lineHeight: 1.4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                                <span data-testid="fortune-token-balance" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <AppIcon name="lucky_token" size={14} /> Жетоны: <b style={{ color: '#fff' }}>{tokens}</b>
                                                </span>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                    <AppIcon name="ball" size={14} /> Мячи: <b style={{ color: '#fff' }}>{balance}</b>
                                                </span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, flexShrink: 0, width: 92 }}>
                                            {allowToken && (
                                                <button data-testid="fortune-spin-token" onClick={() => canToken && !fortuneOpen && spin("lucky_token")} disabled={!canToken || fortuneOpen} style={{
                                                    background: canToken ? 'linear-gradient(135deg, #FFB020, #F97316)' : 'rgba(128,128,128,0.2)',
                                                    border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36,
                                                    cursor: canToken && !fortuneOpen ? 'pointer' : 'default',
                                                    fontWeight: 700, fontSize: 13, color: canToken ? '#fff' : 'var(--tg-hint)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap',
                                                }}>
                                                    1 <AppIcon name="lucky_token" size={16} />
                                                </button>
                                            )}
                                            {allowBalls && (
                                                <button data-testid="fortune-spin-balls" onClick={() => canBalls && !fortuneOpen && spin("balls")} disabled={!canBalls || fortuneOpen} style={{
                                                    background: canBalls ? 'linear-gradient(135deg, #EA580C, #C2410C)' : 'rgba(128,128,128,0.2)',
                                                    border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36,
                                                    cursor: canBalls && !fortuneOpen ? 'pointer' : 'default',
                                                    fontWeight: 700, fontSize: 13, color: canBalls ? '#fff' : 'var(--tg-hint)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap',
                                                }}>
                                                    <CurrencyAmount value={price} icon="ball" iconSize={16} />
                                                </button>
                                            )}
                                            {allowStars && (
                                                <button data-testid="fortune-spin-stars" onClick={() => canStars && !fortuneOpen && spin("stars")} disabled={!canStars || fortuneOpen} style={{
                                                    background: canStars ? 'linear-gradient(135deg, #FCD34D, #F59E0B)' : 'rgba(128,128,128,0.2)',
                                                    border: 'none', borderRadius: 12, padding: '8px 12px', minHeight: 36,
                                                    cursor: canStars && !fortuneOpen ? 'pointer' : 'default',
                                                    fontWeight: 700, fontSize: 13, color: canStars ? '#3a2a00' : 'var(--tg-hint)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, whiteSpace: 'nowrap',
                                                }}>
                                                    <CurrencyAmount value={priceStars} icon="game_star" iconSize={16} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <DropOddsBlock groups={buildFortuneOddsGroups(fc?.sectors ?? [])} accent="#FDBA74" />
                                </div>
                            );
                        })()}

                    </div>
                    )}
                    </>
                ) : activeTab === 'topup' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {(shopConfig?.star_packs || []).map((pack) => {
                            const isBuyingThis = buyingStarPack === pack.code && !confirmStarPack;
                            return (
                                <div key={pack.code} style={{
                                    background: 'var(--tg-bg)',
                                    borderRadius: 16,
                                    padding: 16,
                                    border: '1px solid rgba(128,128,128,0.08)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 14,
                                }}>
                                    <div style={{
                                        width: 48,
                                        height: 48,
                                        borderRadius: 14,
                                        background: 'linear-gradient(135deg, rgba(255,204,0,0.15), rgba(255,149,0,0.15))',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 24,
                                        flexShrink: 0,
                                    }}>
                                        {pack.emoji || '⭐'}
                                    </div>

                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--tg-text)', lineHeight: 1.2 }}>
                                            {pack.title}
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            flexWrap: 'wrap',
                                            marginTop: 4,
                                        }}>
                                            <CurrencyAmount value={pack.total_balls} icon="ball" iconSize={16} style={{ fontSize: 12, color: 'var(--tg-hint)', lineHeight: 1.3 }} />
                                            {pack.badge_text && (
                                                <div style={{
                                                    padding: '5px 8px',
                                                    borderRadius: 999,
                                                    background: 'rgba(0,122,255,0.14)',
                                                    color: '#6cb6ff',
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    lineHeight: 1,
                                                    whiteSpace: 'nowrap',
                                                    flexShrink: 0,
                                                }}>
                                                    {pack.badge_text}
                                                </div>
                                            )}
                                            {pack.bonus_balls > 0 && (
                                                <div style={{
                                                    fontSize: 11,
                                                    color: '#4ECCA3',
                                                    fontWeight: 700,
                                                    padding: '5px 8px',
                                                    borderRadius: 999,
                                                    background: 'rgba(78,204,163,0.12)',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    <CurrencyAmount value={`+${pack.bonus_balls}`} icon="ball" iconSize={16} />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => setConfirmStarPack(pack)}
                                        disabled={!!buyingStarPack}
                                        style={{
                                            minWidth: 104,
                                            minHeight: 40,
                                            padding: '0 12px',
                                            borderRadius: 12,
                                            border: 'none',
                                            background: 'linear-gradient(135deg, #2d7dff, #6b5bff)',
                                            color: '#fff',
                                            fontSize: 13,
                                            fontWeight: 700,
                                            cursor: buyingStarPack ? 'default' : 'pointer',
                                            opacity: buyingStarPack && !isBuyingThis ? 0.55 : 1,
                                            flexShrink: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 4,
                                        }}
                                    >
                                        {isBuyingThis ? '…' : `${pack.price_xtr} XTR`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    /* ====== EXCHANGE TAB ====== */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {exchangeLoading ? (
                            <div style={{ textAlign: 'center', padding: 40, color: 'var(--tg-hint)' }}>Загрузка…</div>
                        ) : !exchangeConfig?.enabled ? (
                            <div style={{
                                background: 'var(--tg-bg)', borderRadius: 16, padding: 24,
                                textAlign: 'center', color: 'var(--tg-hint)',
                            }}>
                                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                                    <AppIcon name="game_star" size={32} />
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Обмен недоступен</div>
                                <div style={{ fontSize: 13 }}>Обмен игровых звёзд на мячи временно отключён.</div>
                                {exchangeError && <div style={{ fontSize: 11, color: '#ff3b30', marginTop: 8, wordBreak: 'break-all' }}>Ошибка: {exchangeError}</div>}
                            </div>
                        ) : (
                            <>
                                {/* Баннер сгорания звёзд убран: звёзды переносятся в новый сезон
                                    (carryOverSeasonStars на бэкенде), торопить с обменом больше нечем.
                                    Сервер продолжает отдавать burn_warning / cap_lifted ради старых
                                    сборок, но они всегда false. */}

                                {/* Balance block */}
                                <div style={{
                                    background: 'var(--tg-bg)', borderRadius: 16, padding: '14px 16px',
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: 'var(--tg-hint)' }}>Игровые звёзды</span>
                                        <CurrencyAmount value={exchangeConfig.current_stars} icon="game_star" iconSize={16} style={{ fontSize: 15, fontWeight: 700, color: 'var(--tg-text)' }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: 'var(--tg-hint)' }}>Потрачено за неделю</span>
                                        <CurrencyAmount value={`${exchangeConfig.stars_used_this_week} / ${exchangeConfig.weekly_star_limit}`} icon="game_star" iconSize={16} style={{ fontSize: 13, fontWeight: 600, color: exchangeConfig.stars_remaining === 0 ? '#ff3b30' : 'var(--tg-text)' }} />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: 'var(--tg-hint)' }}>Осталось обменять</span>
                                        <CurrencyAmount value={exchangeConfig.stars_remaining} icon="game_star" iconSize={16} style={{ fontSize: 13, fontWeight: 600, color: exchangeConfig.stars_remaining === 0 ? '#ff3b30' : '#34c759' }} />
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--tg-hint)', marginTop: 2, opacity: 0.7 }}>
                                        Игровые звёзды — внутриигровая награда. Это не Telegram Stars.
                                    </div>
                                </div>

                                {/* Tier cards */}
                                {exchangeConfig.tiers.map(tier => {
                                    const canAfford = exchangeConfig.current_stars >= tier.stars_cost;
                                    const limitReached = exchangeConfig.stars_remaining < tier.stars_cost;
                                    const isDisabled = !canAfford || limitReached || !!exchanging;
                                    const isProcessing = exchanging === tier.id;

                                    const exchangeRate = (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                                            <CurrencyAmount value={tier.stars_cost} icon="game_star" iconSize={24} style={{ fontSize: 22, fontWeight: 900, color: 'var(--tg-text)' }} />
                                            <span style={{ fontSize: 22, fontWeight: 900, color: 'var(--tg-text)' }}>→</span>
                                            <CurrencyAmount value={tier.balls_reward} icon="ball" iconSize={24} style={{ fontSize: 22, fontWeight: 900, color: 'var(--tg-text)' }} />
                                        </span>
                                    );
                                    let helperText: ReactNode | null = null;
                                    let helperColor = 'var(--tg-hint)';
                                    if (limitReached) {
                                        helperText = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>На этой неделе осталось только <CurrencyAmount value={exchangeConfig.stars_remaining} icon="game_star" iconSize={16} /></span>;
                                        helperColor = '#ff9500';
                                    } else if (!canAfford) {
                                        helperText = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>Нужно ещё <CurrencyAmount value={tier.stars_cost - exchangeConfig.current_stars} icon="game_star" iconSize={16} /></span>;
                                        helperColor = '#ff3b30';
                                    }

                                    let btnText: string;
                                    if (isProcessing) btnText = 'Обмен…';
                                    else if (!canAfford) btnText = 'Не хватает';
                                    else if (limitReached) btnText = 'Лимит';
                                    else btnText = 'Обменять';

                                    return (
                                        <div key={tier.id} style={{
                                            background: 'var(--tg-bg)', borderRadius: 16, padding: '12px 14px',
                                            border: '1px solid rgba(128,128,128,0.08)',
                                            display: 'flex', alignItems: 'center', gap: 12,
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div>{exchangeRate}</div>
                                                {helperText && <div style={{ fontSize: 12, color: helperColor, marginTop: 5 }}>{helperText}</div>}
                                            </div>
                                            <button
                                                onClick={() => !isDisabled && setExchangeConfirm(tier)}
                                                disabled={isDisabled}
                                                style={{
                                                    background: isDisabled ? 'rgba(128,128,128,0.2)' : 'linear-gradient(135deg, #ffcc00, #ff9500)',
                                                    border: 'none', borderRadius: 12, padding: '8px 12px',
                                                    cursor: isDisabled ? 'default' : 'pointer',
                                                    fontWeight: 700, fontSize: 12,
                                                    color: isDisabled ? 'var(--tg-hint)' : '#000',
                                                    whiteSpace: 'nowrap', flexShrink: 0,
                                                    opacity: isProcessing ? 0.6 : 1,
                                                    minWidth: 80,
                                                }}
                                            >
                                                {btnText}
                                            </button>
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ====== EXCHANGE CONFIRM MODAL ====== */}
            {exchangeConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 16, background: 'rgba(0,0,0,0.5)',
                }} onClick={() => !exchanging && setExchangeConfirm(null)}>
                    <div style={{
                        background: 'var(--tg-theme-bg-color, #ffffff)',
                        color: 'var(--tg-theme-text-color, #000000)',
                        padding: 24, borderRadius: 24, width: '100%', maxWidth: 320,
                        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 16,
                            background: 'linear-gradient(135deg, rgba(255,204,0,0.15), rgba(255,149,0,0.15))',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
                            margin: '0 auto 16px',
                        }}>
                            <AppIcon name="game_star" size={28} />
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', marginBottom: 4 }}>
                            Обменять {exchangeConfirm.stars_cost} {pluralRu(exchangeConfirm.stars_cost, 'игровую звезду', 'игровые звёзды', 'игровых звёзд')} на {exchangeConfirm.balls_reward} {pluralRu(exchangeConfirm.balls_reward, 'мяч', 'мяча', 'мячей')}?
                        </div>
                        <div style={{ fontSize: 12, textAlign: 'center', color: 'var(--tg-theme-hint-color, #888)', marginBottom: 16 }}>
                            Игровые звёзды — внутриигровая награда, не Telegram Stars
                        </div>
                        <div style={{
                            background: 'var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))',
                            borderRadius: 16, padding: 16, marginBottom: 20, fontSize: 14,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ color: 'var(--tg-theme-hint-color, #888)' }}>Спишется:</span>
                                <CurrencyAmount value={exchangeConfirm.stars_cost} icon="game_star" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ color: 'var(--tg-theme-hint-color, #888)' }}>Начислится:</span>
                                <CurrencyAmount value={exchangeConfirm.balls_reward} icon="ball" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                            <div style={{ height: 1, background: 'rgba(128,128,128,0.2)', margin: '8px 0' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--tg-theme-hint-color, #888)' }}>Останется звёзд:</span>
                                <CurrencyAmount value={Math.max(0, (exchangeConfig?.current_stars ?? 0) - exchangeConfirm.stars_cost)} icon="game_star" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button onClick={() => setExchangeConfirm(null)} disabled={!!exchanging} style={{
                                flex: 1, padding: '12px', borderRadius: 12,
                                background: 'var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))',
                                color: 'var(--tg-theme-text-color, #000)', border: 'none',
                                fontSize: 15, fontWeight: 600, cursor: exchanging ? 'default' : 'pointer',
                                opacity: exchanging ? 0.5 : 1,
                            }}>Отмена</button>
                            <button onClick={() => handleExchange(exchangeConfirm)} disabled={!!exchanging} style={{
                                flex: 1, padding: '12px', borderRadius: 12,
                                background: 'linear-gradient(135deg, #ffcc00, #ff9500)',
                                color: '#000', border: 'none',
                                fontSize: 15, fontWeight: 600, cursor: exchanging ? 'default' : 'pointer',
                                opacity: exchanging ? 0.5 : 1,
                            }}>{exchanging ? 'Обмен…' : 'Обменять'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== BOOST CONFIRM MODAL ====== */}
            {confirmItem && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 100,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 16, background: "rgba(0,0,0,0.5)",
                }} onClick={() => !buying && setConfirmItem(null)}>
                    <div style={{
                        background: "var(--tg-theme-bg-color, #ffffff)",
                        color: "var(--tg-theme-text-color, #000000)",
                        padding: 24, borderRadius: 24, width: "100%", maxWidth: 320,
                        boxShadow: "0 10px 40px rgba(0,0,0,0.2)", position: "relative"
                    }} onClick={(e) => e.stopPropagation()}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, rgba(255,204,0,0.15), rgba(255,149,0,0.15))",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 16px"
                        }}>
                            {getShopItemIcon(confirmItem.code) ? (
                                <AppIcon name={getShopItemIcon(confirmItem.code)!} size={52} />
                            ) : (
                                confirmItem.emoji
                            )}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
                            Купить «{confirmItem.title}»?
                        </div>
                        <div style={{ fontSize: 14, textAlign: "center", color: "var(--tg-theme-hint-color, #888)", marginBottom: 16, lineHeight: 1.4 }}>
                            {confirmItem.description}
                        </div>
                        <div style={{
                            background: "var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))",
                            borderRadius: 16, padding: 16, marginBottom: 20, fontSize: 14
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                <span style={{ color: "var(--tg-theme-hint-color, #888)" }}>Стоимость:</span>
                                <CurrencyAmount value={confirmItem.price_balls} icon="ball" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                <span style={{ color: "var(--tg-theme-hint-color, #888)" }}>Твой баланс:</span>
                                <CurrencyAmount value={balance} icon="ball" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                            <div style={{ height: 1, background: "var(--tg-theme-hint-color, rgba(128,128,128,0.2))", margin: "8px 0" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                <span>Останется:</span>
                                <CurrencyAmount value={balance - confirmItem.price_balls} icon="ball" iconSize={16} style={{ color: (balance - confirmItem.price_balls) >= 0 ? "inherit" : "#ff3b30" }} />
                            </div>
                        </div>
                        <div style={{ fontSize: 12, textAlign: "center", color: "var(--tg-theme-hint-color, #888)", marginBottom: 16 }}>
                            После покупки валюта будет списана сразу.
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                            <button onClick={() => setConfirmItem(null)} disabled={!!buying} style={{
                                flex: 1, padding: "12px", borderRadius: 12,
                                background: "var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))",
                                color: "var(--tg-theme-text-color, #000)",
                                border: "none", fontSize: 15, fontWeight: 600, cursor: buying ? "default" : "pointer",
                                opacity: buying ? 0.5 : 1
                            }}>Отмена</button>
                            <button onClick={() => handleBuy(confirmItem.code)} disabled={!!buying || balance < confirmItem.price_balls} style={{
                                flex: 1, padding: "12px", borderRadius: 12,
                                background: "var(--tg-theme-button-color, #007aff)",
                                color: "var(--tg-theme-button-text-color, #fff)",
                                border: "none", fontSize: 15, fontWeight: 600, cursor: (buying || balance < confirmItem.price_balls) ? "default" : "pointer",
                                opacity: (buying || balance < confirmItem.price_balls) ? 0.5 : 1
                            }}>{buying ? "Покупка…" : "Купить"}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== STARS PACK CONFIRM MODAL ====== */}
            {confirmStarPack && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 100,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 16, background: "rgba(0,0,0,0.5)",
                }} onClick={() => !buyingStarPack && setConfirmStarPack(null)}>
                    <div style={{
                        background: "var(--tg-theme-bg-color, #ffffff)",
                        color: "var(--tg-theme-text-color, #000000)",
                        padding: 24, borderRadius: 24, width: "100%", maxWidth: 320,
                        boxShadow: "0 10px 40px rgba(0,0,0,0.2)", position: "relative"
                    }} onClick={(e) => e.stopPropagation()}>
                        <div style={{
                            width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, rgba(255,204,0,0.15), rgba(255,149,0,0.15))",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 16px"
                        }}>{confirmStarPack.emoji || '⭐'}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
                            Купить «{confirmStarPack.title}»?
                        </div>
                        <div style={{ fontSize: 14, textAlign: "center", color: "var(--tg-theme-hint-color, #888)", marginBottom: 16, lineHeight: 1.4 }}>
                            Оплата откроется через Telegram Stars.
                        </div>
                        <div style={{
                            background: "var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))",
                            borderRadius: 16, padding: 16, marginBottom: 20, fontSize: 14
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                <span style={{ color: "var(--tg-theme-hint-color, #888)" }}>Стоимость:</span>
                                <span style={{ fontWeight: 700 }}>{confirmStarPack.price_xtr} XTR</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                <span style={{ color: "var(--tg-theme-hint-color, #888)" }}>Начислится:</span>
                                <CurrencyAmount value={confirmStarPack.total_balls} icon="ball" iconSize={16} style={{ fontWeight: 700 }} />
                            </div>
                            {confirmStarPack.bonus_balls > 0 && (
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                                    <span style={{ color: "var(--tg-theme-hint-color, #888)" }}>Бонус:</span>
                                    <CurrencyAmount value={`+${confirmStarPack.bonus_balls}`} icon="ball" iconSize={16} style={{ fontWeight: 700, color: "#34c759" }} />
                                </div>
                            )}
                            {confirmStarPack.badge_text && (
                                <>
                                    <div style={{ height: 1, background: "var(--tg-theme-hint-color, rgba(128,128,128,0.2))", margin: "8px 0" }} />
                                    <div style={{ textAlign: "center", fontSize: 12, color: "var(--tg-theme-hint-color, #888)" }}>
                                        {confirmStarPack.badge_text}
                                    </div>
                                </>
                            )}
                        </div>
                        <div style={{ fontSize: 12, textAlign: "center", color: "var(--tg-theme-hint-color, #888)", marginBottom: 16, lineHeight: 1.4 }}>
                            После подтверждения откроется платёжное окно Telegram.
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                            <button onClick={() => setConfirmStarPack(null)} disabled={!!buyingStarPack} style={{
                                flex: 1, padding: "12px", borderRadius: 12,
                                background: "var(--tg-theme-secondary-bg-color, rgba(128,128,128,0.1))",
                                color: "var(--tg-theme-text-color, #000)",
                                border: "none", fontSize: 15, fontWeight: 600, cursor: buyingStarPack ? "default" : "pointer",
                                opacity: buyingStarPack ? 0.5 : 1
                            }}>Отмена</button>
                            <button onClick={() => handleBuyStarPack(confirmStarPack)} disabled={!!buyingStarPack} style={{
                                flex: 1, padding: "12px", borderRadius: 12,
                                background: "linear-gradient(135deg, #2d7dff, #6b5bff)",
                                color: "#fff",
                                border: "none", fontSize: 15, fontWeight: 600, cursor: buyingStarPack ? "default" : "pointer",
                                opacity: buyingStarPack ? 0.5 : 1
                            }}>{buyingStarPack ? "Подготовка…" : "Продолжить"}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== CASE CONFIRM MODAL ====== */}
            {confirmCaseType && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 100,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 16, background: "rgba(0,0,0,0.7)",
                }} onClick={() => setConfirmCaseType(null)}>
                    <div style={{
                        background: "var(--tg-bg, #1a2634)", borderRadius: 16,
                        padding: '24px 20px', maxWidth: 340, width: '100%',
                        border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
                            <AppIcon name={confirmCaseType === 'premium' ? "case_premium" : "case_basic"} size={confirmCaseType === 'premium' ? 60 : 56} />
                        </div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--tg-text, #fff)', marginBottom: 4 }}>
                            {confirmCaseType === 'premium' ? 'Премиум-кейс' : 'Ежедневный кейс'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--tg-hint, #999)', marginBottom: 16, lineHeight: 1.5 }}>
                            {confirmCaseType === 'premium' ? (
                                hasPremiumCase ? (
                                    <>
                                        Это премиум-кейс из инвентаря.<br />
                                        Доступно: <b style={{ color: '#A855F7' }}>{premiumCaseQuantity} шт.</b><br />
                                        Мячи не спишутся.<br />
                                    </>
                                ) : confirmCaseStars ? (
                                    <>
                                        Будет списано <b style={{ color: '#F0A500' }}><CurrencyAmount value={PREMIUM_CASE_STARS_COST} icon="game_star" iconSize={16} /></b><br />
                                        Твои звёзды: <b><CurrencyAmount value={exchangeConfig?.current_stars ?? 0} icon="game_star" iconSize={16} /></b><br />
                                    </>
                                ) : (
                                    <>
                                        Будет списано <b style={{ color: '#A855F7' }}><CurrencyAmount value={PREMIUM_CASE_COST} icon="ball" iconSize={16} /></b><br />
                                        Твой баланс: <b><CurrencyAmount value={balance} icon="ball" iconSize={16} /></b><br />
                                    </>
                                )
                            ) : (
                                <>Это твой бесплатный кейс.<br /></>
                            )}
                            Кейс откроется сразу<br />
                            Награда определяется случайно
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setConfirmCaseType(null)} style={{
                                flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
                                background: 'transparent', color: 'var(--tg-text, #fff)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                            }}>Отмена</button>
                            <button onClick={() => handleOpenCase(confirmCaseType, confirmCaseStars && !hasPremiumCase)} style={{
                                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                                background: confirmCaseType === 'premium' ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : 'linear-gradient(135deg, #38bdf8, #0284c7)', color: '#fff',
                                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                            }}>Подтвердить</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== CASE OPENING ANIMATION OVERLAY ====== */}
            {casePhase === 'reveal' && caseReward && (
                <CaseOpeningAnimation caseType={openingCaseVariant} reward={caseReward} onClose={closeCaseReveal} />
            )}

            {/* ====== FORTUNE CONFIRM MODAL ====== */}
            {fortuneConfirm && fortuneConfig && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 100,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: 16, background: "rgba(0,0,0,0.7)",
                }} onClick={() => setFortuneConfirm(false)}>
                    <div style={{
                        background: "var(--tg-bg, #1a2634)", borderRadius: 16,
                        padding: '24px 20px', maxWidth: 340, width: '100%',
                        border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><AppIcon name="fortune" size={56} /></div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--tg-text, #fff)', marginBottom: 4 }}>
                            {fortuneConfig.title || 'Фартовый мяч'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--tg-hint, #999)', marginBottom: 16, lineHeight: 1.5 }}>
                            {fortunePayMethod === 'lucky_token' ? (
                                <>Будет списан <b style={{ color: '#F97316' }}>1 жетон</b>.<br />Осталось: <b style={{ color: '#F97316' }}>{(fortuneConfig.lucky_tokens ?? fortuneConfig.free_spins ?? 0)} шт.</b><br /></>
                            ) : fortunePayMethod === 'stars' ? (
                                <>Будет списано <b style={{ color: '#F0A500' }}><CurrencyAmount value={fortuneConfig.price_stars ?? 0} icon="game_star" iconSize={16} /></b><br />Твои звёзды: <b><CurrencyAmount value={exchangeConfig?.current_stars ?? 0} icon="game_star" iconSize={16} /></b><br /></>
                            ) : (
                                <>Будет списано <b style={{ color: '#F97316' }}><CurrencyAmount value={fortuneConfig.price_balls} icon="ball" iconSize={16} /></b><br />Твой баланс: <b><CurrencyAmount value={balance} icon="ball" iconSize={16} /></b><br /></>
                            )}
                            Награда определяется случайно
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setFortuneConfirm(false)} style={{
                                flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)',
                                background: 'transparent', color: 'var(--tg-text, #fff)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                            }}>Отмена</button>
                            <button data-testid="fortune-confirm-spin" onClick={() => handleSpinFortune(fortunePayMethod)} style={{
                                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                                background: 'linear-gradient(135deg, #FFB020, #F97316)', color: '#fff',
                                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                            }}>Крутить</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ====== FORTUNE WHEEL OVERLAY ====== */}
            {fortuneOpen && fortuneConfig && (
                <FortuneWheel
                    sectors={fortuneConfig.sectors}
                    winningIndex={fortuneWinIndex}
                    reward={fortuneReward}
                    pending={fortunePending}
                    onStopRequest={() => { /* result already requested; errors surfaced via alert */ }}
                    onClose={closeFortune}
                />
            )}
        </div>
    );
}


