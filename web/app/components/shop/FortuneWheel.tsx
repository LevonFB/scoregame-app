"use client";

/* eslint-disable @next/next/no-img-element -- the rolling football reel needs raw <img> for the 3D ball asset + rotation transform. */

/* PES myClub-style pack opening: a stream of footballs rolls horizontally at
 * speed (motion-blurred, spinning). The prize is hidden — the ball's colour
 * hints at the rarity. The player taps "Стоп"; the stream decelerates and the
 * winning ball (decided server-side) settles under the centre slot, then bursts
 * open to reveal the actual reward. */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AppIcon } from "../ui/AppIcon";
import { pluralRu } from "@/lib/plural";
import { APP_ICONS, type AppIconName } from "../ui/appIcons";

export type FortuneSector = {
    id: number;
    reward_type: string;
    reward_code?: string | null;
    label?: string | null;
    color?: string | null;
    fixed_amount?: number | null;
    min_amount?: number | null;
    max_amount?: number | null;
    chance_percent?: number | null;
};

export type FortuneReward = { type: string; amount: number; code?: string | null; label?: string | null; color?: string | null };

const REWARD_META: Record<string, { icon: AppIconName; label: string; color: string }> = {
    stars: { icon: "game_star", label: "Звёзды", color: "#FFD700" },
    balls: { icon: "ball", label: "Мячики", color: "#4ECCA3" },
    extra_joker: { icon: "joker", label: "Джокер", color: "#A855F7" },
    joker: { icon: "joker", label: "Джокер", color: "#A855F7" },
    double_chance: { icon: "double_chance", label: "Двойной шанс", color: "#F59E0B" },
    extra_league: { icon: "extra_league_coupon", label: "Слот лиги", color: "#EF4444" },
};

export function metaForReward(s: { reward_type: string; reward_code?: string | null }): { icon: AppIconName; label: string; color: string } {
    const t = (s.reward_type || "").toLowerCase();
    if (t === "case") {
        const isPremium = (s.reward_code || "") === "premium";
        return isPremium
            ? { icon: "case_premium", label: "Премиум-кейс", color: "#A855F7" }
            : { icon: "case_basic", label: "Кейс", color: "#38bdf8" };
    }
    if (t === "fortune_spin") return { icon: "ball", label: "Прокрут", color: "#5ac8fa" };
    return REWARD_META[t] || { icon: "ball", label: s.reward_type, color: "#FFD700" };
}

/** Large reveal artwork — the same "drop" icons the case opening uses. */
function revealIcon(reward: FortuneReward): AppIconName {
    const t = (reward.type || "").toLowerCase();
    if (t === "balls" || t === "fortune_spin") return "drop_ball_large";
    if (t === "stars") return "drop_game_star_large";
    if (t === "extra_joker" || t === "joker") return "drop_joker_large";
    if (t === "double_chance") return "drop_double_chance_large";
    if (t === "extra_league") return "drop_extra_league_coupon_large";
    // Cases reuse the case artwork, exactly like the shop/case opening.
    return metaForReward({ reward_type: t, reward_code: reward.code }).icon;
}

function rewardResultText(reward: FortuneReward): string {
    const t = (reward.type || "").toLowerCase();
    const meta = metaForReward({ reward_type: t, reward_code: reward.code });
    if (t === "stars") return `${reward.amount} ⭐ ${pluralRu(reward.amount, "звезда", "звезды", "звёзд")}`;
    if (t === "balls") return `${reward.amount} ⚽ ${pluralRu(reward.amount, "мяч", "мяча", "мячей")}`;
    if (t === "fortune_spin") return reward.amount > 1 ? `${reward.amount} ${pluralRu(reward.amount, "прокрут", "прокрута", "прокрутов")}` : "Бесплатный прокрут";
    return meta.label;
}

/* ===== Rarity tiers — PES used ball colour to hint at the pull's rarity.
 * Each tier has its own ball artwork (see APP_ICONS.ball_*). `useDedicatedArt`
 * flips to false while every tier still points at the same fallback ball, so we
 * keep the colour ring/filter as the differentiator until real balls land. ===== */
export type Tier = "common" | "good" | "rare" | "legendary";
const TIER_STYLE: Record<Tier, { ring: string; glow: string; icon: AppIconName; ballFilter?: string }> = {
    common: { ring: "rgba(235,235,235,0.85)", glow: "rgba(255,255,255,0.45)", icon: "ball_common" },
    good: { ring: "#cfd8e8", glow: "rgba(180,205,235,0.6)", icon: "ball_silver", ballFilter: "saturate(0.2) brightness(1.15)" },
    rare: { ring: "#FFD700", glow: "rgba(255,215,0,0.65)", icon: "ball_gold", ballFilter: "sepia(1) saturate(3) hue-rotate(5deg) brightness(1.05)" },
    legendary: { ring: "#FFAA3C", glow: "rgba(255,140,0,0.75)", icon: "ball_legendary", ballFilter: "brightness(0.5) saturate(1.5) hue-rotate(-10deg)" },
};

// Dedicated per-tier ball artwork is now in place, so the CSS colour filter is off
// and the real ball colours show unmodified.
const USE_COLOR_FILTER_FALLBACK = false;

// Ball artwork + display name per rarity tier — reused by the drop-odds block in the
// shop card so the odds list groups by the same ball colours the reel actually shows.
export const TIER_ODDS_DISPLAY: Record<Tier, { label: string; icon: AppIconName; color: string }> = {
    common: { label: "Обычный мяч", icon: "ball_common", color: "#EBEBEB" },
    good: { label: "Серебряный мяч", icon: "ball_silver", color: "#CFD8E8" },
    rare: { label: "Золотой мяч", icon: "ball_gold", color: "#FFD700" },
    legendary: { label: "Легендарный мяч", icon: "ball_legendary", color: "#FFAA3C" },
};

/* Редкость идёт за ценностью приза в мячах (цены магазина: джокер 4⚽, двойной
 * шанс 3⚽, слот лиги 20⚽, премиум-кейс ≈6⚽, ежедневный кейс ≈0.8⚽), иначе
 * барабан врёт: джекпот в 20⚽ выглядел бы скромнее двойного шанса за 3⚽.
 * Мячи ранжируются по номиналу — с миграции 0135 каждый номинал живёт в своём
 * секторе с fixed_amount, поэтому peak здесь равен самому призу, а не потолку
 * общего диапазона (раньше max_amount=20 красил серебром весь сектор мячей). */
export function tierForSector(s: FortuneSector): Tier {
    const t = (s.reward_type || "").toLowerCase();
    const peak = Number(s.fixed_amount ?? s.max_amount ?? 0);
    if (t === "extra_league") return "legendary";
    if (t === "case") return "rare";
    if (t === "double_chance") return "good";
    if (t === "extra_joker") return "good";
    if (t === "stars") return peak >= 8 ? "good" : "common";
    if (t === "balls") {
        if (peak >= 20) return "legendary";
        if (peak >= 10) return "rare";
        return peak >= 4 ? "good" : "common";
    }
    return "common";
}

const BALL = 64;
const GAP = 16;
const ITEM_FULL = BALL + GAP;
const REEL_REPS = 10; // total loops of balls rendered in the strip
const SETTLE_MIN_GLIDE_LOOPS = 1.2; // minimum glide after the tap before the ball can land
const SPIN_LOOP_MS = 1500; // one seamless loop while rolling (moderate pace, PES-like — not super fast)

const REEL_CSS = `
@keyframes fwReelLoop { from { transform: translateX(0); } to { transform: translateX(var(--loopShift)); } }
@keyframes fwRoll { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes fwSpeed { from { transform: translateX(0); } to { transform: translateX(-220px); } }
@keyframes fwResultIn { 0% { opacity: 0; transform: translateY(12px) scale(0.92); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes fwGlow { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
/* PES-style: a tense charge-up of the ball just before it bursts open. */
@keyframes fwCharge { 0% { opacity: 0.25; transform: translate(-50%,-50%) scale(0.55); } 100% { opacity: 0.95; transform: translate(-50%,-50%) scale(1.18); } }
@keyframes fwChargeShake { 0%,100% { transform: translateX(-50%) rotate(0deg); } 25% { transform: translateX(-50%) rotate(-1.5deg); } 50% { transform: translateX(-50%) rotate(1.5deg); } 75% { transform: translateX(-50%) rotate(-1deg); } }
/* White screen flash at the instant of opening. */
@keyframes fwFlash { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.3); } 22% { opacity: 0.95; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(2.1); } }
@keyframes fwBurst { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.3); } 35% { opacity: 0.95; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(1.9); } }
/* Rotating god-rays sunburst behind the reward. */
@keyframes fwRays { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
@keyframes fwRaysIn { 0% { opacity: 0; } 30% { opacity: 0.85; } 100% { opacity: 0.7; } }
@keyframes fwSpark { 0% { opacity: 1; transform: translate(-50%,-50%) rotate(var(--a)) translateX(0); } 100% { opacity: 0; transform: translate(-50%,-50%) rotate(var(--a)) translateX(var(--d)); } }
@keyframes fwConfetti { 0% { opacity: 1; transform: translate(-50%,-50%) translate(0,0) rotate(0deg); } 100% { opacity: 0; transform: translate(-50%,-50%) translate(var(--cx),var(--cy)) rotate(var(--cr)); } }
@keyframes fwScreenShake { 0%,100% { transform: translate(0,0); } 18% { transform: translate(-6px,3px); } 36% { transform: translate(6px,-3px); } 54% { transform: translate(-4px,2px); } 72% { transform: translate(4px,-2px); } 88% { transform: translate(-2px,1px); } }
@keyframes fwRewardPop { 0% { opacity: 0; transform: translate(-50%,-50%) scale(0.2); } 60% { opacity: 1; transform: translate(-50%,-55%) scale(1.15); } 100% { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
`;

function hapticImpact(style: "light" | "medium" | "heavy") {
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style); } catch { /* no-op */ }
}
function hapticSuccess() {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success"); } catch { /* no-op */ }
}

function tierForReward(r: FortuneReward): Tier {
    return tierForSector({ id: 0, reward_type: r.type, reward_code: r.code, fixed_amount: r.amount, min_amount: r.amount, max_amount: r.amount });
}

function ReelBall({ tier, rolling }: { tier: Tier; rolling: boolean }) {
    const tc = TIER_STYLE[tier];
    return (
        <div style={{ width: BALL, height: BALL, position: "relative", flexShrink: 0 }}>
            <div style={{
                position: "absolute", inset: -7, borderRadius: "50%",
                background: `radial-gradient(circle, ${tc.glow} 0%, transparent 70%)`,
            }} />
            <img
                src={APP_ICONS[tc.icon]}
                alt=""
                width={BALL}
                height={BALL}
                draggable={false}
                style={{
                    position: "relative", display: "block", width: BALL, height: BALL,
                    borderRadius: "50%", objectFit: "contain",
                    filter: USE_COLOR_FILTER_FALLBACK ? tc.ballFilter : undefined,
                    animation: rolling ? "fwRoll 0.8s linear infinite" : undefined,
                }}
            />
        </div>
    );
}

export function FortuneWheel({ sectors, winningIndex, reward, pending, onStopRequest, onClose }: {
    sectors: FortuneSector[];
    /** Winning sector index from the server; null while the spin request is in flight. */
    winningIndex: number | null;
    reward: FortuneReward | null;
    /** True while the spin POST is still resolving. */
    pending: boolean;
    /** Called when the user taps "Стоп" (used to surface errors if the request failed). */
    onStopRequest: () => void;
    onClose: () => void;
}) {
    const n = sectors.length;
    const [phase, setPhase] = useState<"spinning" | "settling" | "reveal" | "done">("spinning");
    const [stopRequested, setStopRequested] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rafRef = useRef<number | null>(null);

    useEffect(() => () => {
        if (revealTimer.current) clearTimeout(revealTimer.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }, []);

    const loopWidth = n * ITEM_FULL;
    const reps = REEL_REPS; // strip = enough loops to cover the settle glide + a viewport buffer

    // Shuffle the ball order once so the reel doesn't look sorted by sector. The
    // same shuffled order repeats every loop, which keeps the spin seam seamless.
    // Randomised in an effect (Math.random is impure → not allowed during render).
    const [shuffledOrder, setShuffledOrder] = useState<number[]>(() => Array.from({ length: n }, (_, i) => i));
    useEffect(() => {
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time shuffle of the reel order on mount
        setShuffledOrder(order);
    }, [n]);

    const beginSettle = useCallback(() => {
        const track = trackRef.current;
        const container = containerRef.current;
        if (!track || !container || winningIndex == null || n === 0) return;

        // Freeze the current looping transform into an inline value.
        const current = getComputedStyle(track).transform;
        let currentX = 0;
        if (current && current !== "none") {
            const m = current.match(/matrix.*\((.+)\)/);
            if (m) {
                const parts = m[1].split(", ").map(Number);
                currentX = parts.length === 6 ? parts[4] : (parts[12] ?? 0);
            }
        }
        track.style.animation = "none";
        track.style.transition = "none";
        track.style.transform = `translateX(${currentX}px)`;

        // Land on the nearest winning ball at least a short glide ahead of the tap point.
        const containerCenter = container.offsetWidth / 2;
        const posInBlock = Math.max(0, shuffledOrder.indexOf(winningIndex));
        const xForIndex = (idx: number) => containerCenter - (idx * ITEM_FULL + ITEM_FULL / 2 - GAP / 2);
        const curIndex = (containerCenter - currentX - ITEM_FULL / 2 + GAP / 2) / ITEM_FULL;
        const minGlidePx = loopWidth * SETTLE_MIN_GLIDE_LOOPS;
        let targetIndex = Math.ceil(curIndex);
        while ((((targetIndex % n) + n) % n) !== posInBlock || (currentX - xForIndex(targetIndex)) < minGlidePx) {
            targetIndex++;
        }
        const finalX = xForIndex(targetIndex);

        // Physically-real friction stop: continue at the current spin speed, then
        // decelerate at a CONSTANT rate to a halt exactly on the target ball. This
        // matches the reel's velocity at the moment of the tap (no jerk) and eases
        // out naturally over the whole glide (no instant snap).
        const v0 = loopWidth / SPIN_LOOP_MS; // px per ms, the steady spin speed
        const dist = currentX - finalX; // > 0, leftward travel
        const accel = (v0 * v0) / (2 * dist); // deceleration that lands exactly on target
        const duration = v0 / accel; // = 2 * dist / v0
        const start = performance.now();

        const tick = (now: number) => {
            const t = now - start;
            if (t >= duration) {
                track.style.transform = `translateX(${finalX}px)`;
                rafRef.current = null;
                // PES build-up: the landed ball charges up (reveal) before it bursts (done).
                setPhase("reveal");
                hapticImpact("medium");
                revealTimer.current = setTimeout(() => {
                    setPhase("done");
                    hapticSuccess();
                }, 700);
                return;
            }
            const travelled = v0 * t - 0.5 * accel * t * t; // x = v0·t − ½·a·t²
            track.style.transform = `translateX(${currentX - travelled}px)`;
            rafRef.current = requestAnimationFrame(tick);
        };

        setPhase("settling");
        rafRef.current = requestAnimationFrame(tick);
    }, [winningIndex, n, shuffledOrder, loopWidth]);

    // If the user asked to stop before the server result arrived, settle as soon as
    // the winning index lands in props — a genuine prop-sync transition.
    useEffect(() => {
        if (stopRequested && winningIndex != null && phase === "spinning") {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- settle is reacting to the async spin result arriving via props
            beginSettle();
        }
    }, [stopRequested, winningIndex, phase, beginSettle]);

    const handleStop = () => {
        if (phase !== "spinning") return;
        setStopRequested(true);
        onStopRequest();
        if (winningIndex != null) beginSettle();
    };

    const onTrackTransitionEnd = () => {
        if (phase !== "settling") return;
        // PES build-up: the landed ball charges up (reveal) before it bursts (done).
        setPhase("reveal");
        hapticImpact("medium");
        revealTimer.current = setTimeout(() => {
            setPhase("done");
            hapticSuccess();
        }, 700);
    };

    const meta = reward ? metaForReward({ reward_type: reward.type, reward_code: reward.code }) : null;
    const isRolling = phase === "spinning" || phase === "settling";

    // Reveal intensity scales with rarity (PES: rarer pull = bigger explosion).
    const winTier: Tier = reward ? tierForReward(reward) : "common";
    const isRare = winTier === "rare" || winTier === "legendary";
    const isLegendary = winTier === "legendary";
    const sparkCount = isLegendary ? 18 : isRare ? 12 : 8;
    const tierColor = meta?.color ?? "#FFD700";

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 9998,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            background: "#000", padding: 16,
            animation: isLegendary && phase === "done" ? "fwScreenShake 0.45s ease-in-out both" : undefined,
        }}>
            <style>{REEL_CSS}</style>

            {/* PES-style spotlight dim — edges darken after the tap, focusing on the ball */}
            <div style={{
                position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
                background: "radial-gradient(circle at 50% 42%, transparent 6%, rgba(0,0,0,0.55) 46%, rgba(0,0,0,0.9) 100%)",
                opacity: phase === "spinning" ? 0 : 1,
                transition: "opacity 0.6s ease",
            }} />

            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 22 }}>
                <AppIcon name="fortune" size={28} />
                Фартовый мяч
            </div>

            {/* Reel viewport */}
            <div ref={containerRef} style={{
                position: "relative", zIndex: 2, width: "100%", maxWidth: 440, height: BALL + 44,
                overflow: "hidden",
                borderRadius: 18,
                background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
                border: "1px solid rgba(255,255,255,0.08)",
                maskImage: "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)",
                WebkitMaskImage: "linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)",
            }}>
                {/* Speed lines — only while the stream rolls fast */}
                {phase === "spinning" && (
                    <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", opacity: 0.16 }}>
                        {[18, 38, 58, 78].map((top, i) => (
                            <div key={i} style={{
                                position: "absolute", top: `${top}%`, left: 0, right: -220, height: 2,
                                background: "linear-gradient(to right, transparent, rgba(255,255,255,0.9), transparent)",
                                animation: `fwSpeed ${0.45 + i * 0.08}s linear infinite`,
                            }} />
                        ))}
                    </div>
                )}

                {/* Centre slot marker — hidden once the ball has opened */}
                {phase !== "done" && (
                    <>
                        <div style={{
                            position: "absolute", top: 6, bottom: 6, left: "50%", width: BALL + 10, transform: "translateX(-50%)",
                            borderRadius: 16,
                            border: `2px solid ${phase === "reveal" ? tierColor : "rgba(249,115,22,0.9)"}`,
                            boxShadow: phase === "reveal"
                                ? `0 0 22px ${tierColor}, inset 0 0 18px ${tierColor}`
                                : "0 0 16px rgba(249,115,22,0.6), inset 0 0 14px rgba(249,115,22,0.25)",
                            zIndex: 4, pointerEvents: "none",
                            animation: phase === "spinning"
                                ? "fwGlow 1s ease-in-out infinite"
                                : phase === "reveal"
                                    ? "fwChargeShake 0.12s linear infinite, fwGlow 0.3s ease-in-out infinite"
                                    : undefined,
                        }} />
                        <div style={{ position: "absolute", top: -3, left: "50%", transform: "translateX(-50%)", zIndex: 5, color: "#F97316", fontSize: 15 }}>▼</div>
                    </>
                )}

                {/* Charge-up glow building behind the ball just before it bursts */}
                {phase === "reveal" && (
                    <div style={{
                        position: "absolute", top: "50%", left: "50%", zIndex: 3, width: 150, height: 150,
                        borderRadius: "50%", pointerEvents: "none", mixBlendMode: "screen",
                        background: `radial-gradient(circle, ${tierColor} 0%, transparent 65%)`,
                        animation: "fwCharge 0.7s ease-in both",
                    }} />
                )}

                {/* Track of rolling footballs — fades out as the reward bursts open */}
                <div
                    ref={trackRef}
                    onTransitionEnd={onTrackTransitionEnd}
                    style={{
                        position: "absolute", top: 22, left: 0, zIndex: 2,
                        display: "flex", gap: GAP,
                        willChange: "transform",
                        filter: phase === "spinning" ? "blur(0.6px)" : undefined,
                        opacity: phase === "done" ? 0 : 1,
                        transition: phase === "done" ? "opacity 0.4s ease 0.15s" : undefined,
                        ...(phase === "spinning" ? {
                            animation: `fwReelLoop ${SPIN_LOOP_MS}ms linear infinite`,
                            ["--loopShift" as string]: `-${loopWidth}px`,
                        } : {}),
                    } as CSSProperties}
                >
                    {Array.from({ length: reps }).flatMap((_, r) =>
                        shuffledOrder.map((si, k) => (
                            <ReelBall key={`${r}-${k}`} tier={tierForSector(sectors[si])} rolling={isRolling} />
                        ))
                    )}
                </div>

            </div>

            {/* ===== Reveal explosion — full-screen layer (anchored over the reel) so rays/sparks aren't clipped by the reel viewport ===== */}
            {phase === "done" && reward && meta && (
                <div style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "none", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: "40%", left: "50%", width: 0, height: 0 }}>
                        {/* White flash at the instant of opening */}
                        <div style={{
                            position: "absolute", top: "50%", left: "50%", zIndex: 6, width: 240, height: 240,
                            background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 35%, transparent 70%)",
                            pointerEvents: "none", animation: "fwFlash 0.45s ease-out both",
                        }} />

                        {/* Rotating god-rays sunburst (rare+) */}
                        {isRare && (
                            <div style={{
                                position: "absolute", top: "50%", left: "50%", zIndex: 5, width: 360, height: 360,
                                pointerEvents: "none", mixBlendMode: "screen",
                                background: `repeating-conic-gradient(from 0deg, ${tierColor}cc 0deg 6deg, transparent 6deg 18deg)`,
                                maskImage: "radial-gradient(circle, #000 0%, transparent 62%)",
                                WebkitMaskImage: "radial-gradient(circle, #000 0%, transparent 62%)",
                                animation: `fwRaysIn 0.6s ease-out both, fwRays ${isLegendary ? 9 : 14}s linear infinite`,
                            }} />
                        )}

                        {/* Coloured burst glow */}
                        <div style={{
                            position: "absolute", top: "50%", left: "50%", zIndex: 6, width: 220, height: 220,
                            background: `radial-gradient(circle, ${tierColor} 0%, transparent 62%)`,
                            mixBlendMode: "screen", pointerEvents: "none",
                            animation: "fwBurst 0.8s ease-out 0.08s both",
                        }} />

                        {/* Radial sparks */}
                        {Array.from({ length: sparkCount }).map((_, i) => {
                            const dist = 90 + (i % 3) * 28;
                            return (
                                <div key={`sp-${i}`} style={{
                                    position: "absolute", top: "50%", left: "50%", zIndex: 7,
                                    width: 6, height: 6, borderRadius: "50%",
                                    background: tierColor, boxShadow: `0 0 8px ${tierColor}`,
                                    pointerEvents: "none",
                                    animation: `fwSpark ${0.55 + (i % 3) * 0.1}s ease-out 0.1s both`,
                                    ["--a" as string]: `${(360 / sparkCount) * i}deg`,
                                    ["--d" as string]: `${dist}px`,
                                } as CSSProperties} />
                            );
                        })}

                        {/* Confetti for big wins */}
                        {isRare && Array.from({ length: isLegendary ? 18 : 12 }).map((_, i) => {
                            const colors = ["#FFD700", "#FF7A18", "#34c759", "#5ac8fa", "#ff2d55", "#fff"];
                            const ang = (Math.PI * 2 * i) / (isLegendary ? 18 : 12) + 0.3;
                            const dist = 120 + (i % 4) * 26;
                            return (
                                <div key={`cf-${i}`} style={{
                                    position: "absolute", top: "50%", left: "50%", zIndex: 8,
                                    width: 7, height: 11, borderRadius: 2,
                                    background: colors[i % colors.length], pointerEvents: "none",
                                    animation: `fwConfetti ${0.9 + (i % 4) * 0.15}s ease-out 0.12s both`,
                                    ["--cx" as string]: `${Math.cos(ang) * dist}px`,
                                    ["--cy" as string]: `${Math.sin(ang) * dist - 30}px`,
                                    ["--cr" as string]: `${(i % 2 ? 1 : -1) * (360 + i * 30)}deg`,
                                } as CSSProperties} />
                            );
                        })}

                        {/* The reward itself */}
                        <div style={{
                            position: "absolute", top: "50%", left: "50%", zIndex: 9, pointerEvents: "none",
                            animation: "fwRewardPop 0.6s cubic-bezier(0.175,0.885,0.32,1.275) 0.15s both",
                            filter: `drop-shadow(0 0 18px ${tierColor})`,
                        }}>
                            <AppIcon name={revealIcon(reward)} size={108} />
                        </div>
                    </div>
                </div>
            )}

            {/* Controls / result */}
            <div style={{ position: "relative", zIndex: 2, marginTop: 26, minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start" }}>
                {phase !== "done" ? (
                    <>
                        <button
                            onClick={handleStop}
                            disabled={phase !== "spinning"}
                            style={{
                                padding: "14px 56px", minHeight: 52, borderRadius: 16, border: "none",
                                background: phase === "spinning" ? "linear-gradient(135deg, #FFB020, #F97316)" : "rgba(255,255,255,0.15)",
                                color: "#fff", fontSize: 18, fontWeight: 800,
                                cursor: phase === "spinning" ? "pointer" : "default",
                                boxShadow: phase === "spinning" ? "0 6px 24px rgba(249,115,22,0.5)" : "none",
                            }}
                        >
                            {phase === "settling" ? "Останавливается…" : "СТОП"}
                        </button>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 12, textAlign: "center" }}>
                            {phase === "spinning"
                                ? (stopRequested && pending ? "Определяем приз…" : "Нажми «Стоп», чтобы остановить мячи")
                                : "Мяч останавливается на твоём призе"}
                        </div>
                    </>
                ) : reward && meta ? (
                    <div style={{
                        display: "flex", flexDirection: "column", alignItems: "center",
                        animation: "fwResultIn 0.4s ease-out 0.45s both",
                    }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>
                            Поздравляем!
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: meta.color, marginTop: 4, textShadow: `0 0 10px ${meta.color}88` }}>
                            {rewardResultText(reward)}
                        </div>
                        <button onClick={onClose} style={{
                            marginTop: 20, padding: "12px 44px", minHeight: 48, borderRadius: 14, border: "none", cursor: "pointer",
                            background: "linear-gradient(135deg, #FFB020, #F97316)", color: "#fff", fontSize: 16, fontWeight: 800,
                            boxShadow: "0 4px 22px rgba(249,115,22,0.55)",
                        }}>Забрать</button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
