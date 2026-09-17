"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary case assets need raw img with width:100% inside a fixed wrapper so closed/open states stay pixel-aligned. */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { pluralRu } from "@/lib/plural";
import { AppIcon } from "../ui/AppIcon";
import { APP_ICONS, type AppIconName } from "../ui/appIcons";

/* ====== REWARD ICON / META MAPPING ====== */
const REWARD_META: Record<string, { icon: AppIconName; label: string; color: string; glowColor: string; rarity: string }> = {
    stars: { icon: "game_star", label: "звёзд", color: "#FFD700", glowColor: "rgba(255,215,0,0.5)", rarity: "common" },
    balls: { icon: "ball", label: "мячей", color: "#4ECCA3", glowColor: "rgba(78,204,163,0.5)", rarity: "good" },
    extra_joker: { icon: "joker", label: "Дополнительный джокер", color: "#A855F7", glowColor: "rgba(168,85,247,0.5)", rarity: "good" },
    joker: { icon: "joker", label: "Джокер", color: "#A855F7", glowColor: "rgba(168,85,247,0.5)", rarity: "good" },
    double_chance: { icon: "double_chance", label: "Двойной шанс", color: "#F59E0B", glowColor: "rgba(245,158,11,0.5)", rarity: "rare" },
    premium_case: { icon: "case_premium", label: "Премиум-кейс", color: "#A855F7", glowColor: "rgba(168,85,247,0.5)", rarity: "rare" },
    case_premium: { icon: "case_premium", label: "Премиум-кейс", color: "#A855F7", glowColor: "rgba(168,85,247,0.5)", rarity: "rare" },
    basic_case: { icon: "case_basic", label: "Кейс", color: "#38bdf8", glowColor: "rgba(56,189,248,0.5)", rarity: "good" },
    case_basic: { icon: "case_basic", label: "Кейс", color: "#38bdf8", glowColor: "rgba(56,189,248,0.5)", rarity: "good" },
    extra_league: { icon: "extra_league_coupon", label: "Купон на доп. лигу", color: "#EF4444", glowColor: "rgba(239,68,68,0.6)", rarity: "legendary" },
    lucky_token: { icon: "lucky_token", label: "Жетон", color: "#F97316", glowColor: "rgba(249,115,22,0.55)", rarity: "rare" },
    fortune_spin: { icon: "lucky_token", label: "Жетон", color: "#F97316", glowColor: "rgba(249,115,22,0.55)", rarity: "rare" },
    extra_joker_double_chance: { icon: "joker", label: "Джокер + Двойной шанс", color: "#A855F7", glowColor: "rgba(168,85,247,0.55)", rarity: "legendary" },
};

const FALLBACK_META = { icon: "case_basic" as AppIconName, label: "Награда", color: "#FFD700", glowColor: "rgba(255,215,0,0.5)", rarity: "common" };

function getRewardText(type: string, amount: number): string {
    const meta = REWARD_META[type];
    if (!meta) return amount > 1 ? `${type} x${amount}` : type;
    if (type === "stars") return `${amount} ${pluralRu(amount, "звезда", "звезды", "звёзд")}`;
    if (type === "balls") return `${amount} ${pluralRu(amount, "мяч", "мяча", "мячей")}`;
    // Premium may drop ×2 boosts/tokens (economy-v1.md §12) — show the multiplier.
    return amount > 1 ? `${meta.label} ×${amount}` : meta.label;
}

/** Large drop art used only in the case reveal; null → fall back to the regular AppIcon. */
function getDropIconForReward(type: string | undefined): AppIconName | null {
    const t = (type || "").toLowerCase();
    if (["ball", "balls", "currency_ball", "coins"].includes(t)) return "drop_ball_large";
    if (["star", "stars", "game_star", "currency_star"].includes(t)) return "drop_game_star_large";
    if (["joker", "extra_joker"].includes(t)) return "drop_joker_large";
    if (["double_chance", "dc"].includes(t)) return "drop_double_chance_large";
    if (["extra_league", "extra_league_coupon", "league_coupon"].includes(t)) return "drop_extra_league_coupon_large";
    if (["lucky_token", "fortune_spin"].includes(t)) return "drop_lucky_token_large";
    return null;
}

/* ====== ASSET PRELOAD ====== */
const CASE_ANIM_ICONS = [
    "case_basic_anim_closed",
    "case_basic_anim_open",
    "case_premium_anim_closed",
    "case_premium_anim_open",
    "drop_ball_large",
    "drop_game_star_large",
    "drop_joker_large",
    "drop_double_chance_large",
    "drop_extra_league_coupon_large",
    "drop_lucky_token_large",
] as const;

let warmedUp = false;

/** Warm the browser cache for all case animation assets (call once, e.g. on shop mount). */
export function preloadCaseAnimationAssets() {
    if (warmedUp || typeof window === "undefined") return;
    warmedUp = true;
    for (const name of CASE_ANIM_ICONS) {
        const img = new Image();
        img.decoding = "async";
        img.src = APP_ICONS[name];
    }
}

function loadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`failed to load ${src}`));
        img.src = src;
    });
}

/* ====== PHASES ======
 * Only two case states (closed / open), no base or lid layers.
 * The timeline starts only after both images are preloaded (capped at 2.5s).
 *
 * 0–350ms      enter — closed case scales/fades in
 * 350–950ms    shake — closed case shakes (escalating)
 * 950–1150ms   flash — bright burst + smoke starts, closed case stays put
 * 1150–1550ms  open  — crossfade closed → open case, rarity beam starts rising
 * 1550–2850ms  beam  — open case fades away; the beam holds risen (~1s of suspense)
 * 2850–3500ms  pop   — beam fades, reward flies up from the beam and settles
 * 3500ms+      final — reward stays up, amount + text + collect button fade in
 */
const PHASE_ORDER = ["enter", "shake", "flash", "open", "beam", "pop", "final"] as const;
type Phase = (typeof PHASE_ORDER)[number];

const PHASE_TIMELINE: Array<{ phase: Phase; at: number }> = [
    { phase: "shake", at: 350 },
    { phase: "flash", at: 950 },
    { phase: "open", at: 1150 },
    { phase: "beam", at: 1550 },
    { phase: "pop", at: 2850 },
    { phase: "final", at: 3500 },
];

function phaseAtLeast(current: Phase, target: Phase): boolean {
    return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target);
}

/* ====== HAPTICS ======
 * Telegram WebApp haptics, fired per phase. Wrapped so a missing API (browser
 * preview, old client) or a thrown call never breaks the reveal. */
type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
function hapticImpact(style: ImpactStyle) {
    try { window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style); } catch { /* no-op */ }
}
function hapticSuccess() {
    try { window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("success"); } catch { /* no-op */ }
}

// Final resting offset of the reward above the open lid.
const REWARD_FINAL_LIFT = 72;

const CASE_OPENING_CSS = `
@keyframes coaEnter { 0% { transform: scale(0.85); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
/* A3: escalating shake — amplitude grows toward the burst, building anticipation. */
@keyframes coaShake {
  0% { transform: rotate(0deg) translateY(0); }
  20% { transform: rotate(-1deg) translateY(-1px); }
  38% { transform: rotate(1.5deg) translateY(-1px); }
  54% { transform: rotate(-2deg) translateY(-2px); }
  70% { transform: rotate(2.5deg) translateY(-3px); }
  84% { transform: rotate(-3.5deg) translateY(-4px); }
  94% { transform: rotate(3deg) translateY(-2px); }
  100% { transform: rotate(0deg) translateY(0); }
}
/* A3 (legendary): a more violent build-up with a little scale pump. */
@keyframes coaShakeBig {
  0% { transform: rotate(0deg) translateY(0) scale(1); }
  20% { transform: rotate(-2deg) translateY(-2px); }
  38% { transform: rotate(2.5deg) translateY(-2px); }
  54% { transform: rotate(-3.5deg) translateY(-4px) scale(1.02); }
  70% { transform: rotate(4.5deg) translateY(-5px); }
  84% { transform: rotate(-5.5deg) translateY(-7px) scale(1.035); }
  94% { transform: rotate(4deg) translateY(-3px); }
  100% { transform: rotate(0deg) translateY(0) scale(1); }
}
/* B1: rarity beam — shoots up from the mouth, then holds risen while the case fades. */
@keyframes coaBeamRise {
  0% { opacity: 0; transform: translateX(-50%) scaleY(0.12); }
  60% { opacity: 0.95; transform: translateX(-50%) scaleY(1.04); }
  100% { opacity: 0.85; transform: translateX(-50%) scaleY(1); }
}
@keyframes coaBeamIdle {
  0%, 100% { opacity: 0.78; transform: translateX(-50%) scaleY(1); }
  50% { opacity: 0.96; transform: translateX(-50%) scaleY(1.025); }
}
@keyframes coaBeamFade {
  0% { opacity: 0.85; transform: translateX(-50%) scaleY(1); }
  100% { opacity: 0; transform: translateX(-50%) scaleY(1.1); }
}
/* C2: brief screen shake of the whole stage on a big-reward burst. */
@keyframes coaScreenShake {
  0%, 100% { transform: translate(0, 0); }
  18% { transform: translate(-6px, 3px); }
  36% { transform: translate(6px, -3px); }
  54% { transform: translate(-4px, 2px); }
  72% { transform: translate(4px, -2px); }
  88% { transform: translate(-2px, 1px); }
}
@keyframes coaClosedOut { 0% { opacity: 1; } 100% { opacity: 0; } }
@keyframes coaOpenIn { 0% { opacity: 0; transform: scale(0.98); } 100% { opacity: 1; transform: scale(1); } }
@keyframes coaCaseOut { 0% { opacity: 1; transform: scale(1) translateY(0); } 100% { opacity: 0; transform: scale(0.82) translateY(30px); } }
@keyframes coaGlowPulse { 0%, 100% { opacity: 0.5; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 1; transform: translate(-50%, -50%) scale(1.12); } }
@keyframes coaFlash { 0% { opacity: 0; transform: scale(0.4); } 30% { opacity: 0.95; transform: scale(1); } 100% { opacity: 0; transform: scale(1.7); } }
@keyframes coaSmoke {
  0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  20% { opacity: 0.6; }
  100% { transform: translate(calc(-50% + var(--sx)), calc(-50% + var(--sy))) scale(1.5); opacity: 0; }
}
@keyframes coaSpark {
  0% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0); opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(85px); opacity: 0; }
}
@keyframes coaRewardPop {
  0% { transform: translateY(20px) scale(0.2); opacity: 0; }
  55% { transform: translateY(-95px) scale(1.15); opacity: 1; }
  100% { transform: translateY(-${REWARD_FINAL_LIFT}px) scale(1); opacity: 1; }
}
@keyframes coaRing { 0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes coaGlowPulseSoft { 0%, 100% { opacity: 0.35; transform: translate(-50%, -50%) scale(1); } 50% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.08); } }
@keyframes coaTextIn { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes coaRarityPulse { 0%, 100% { opacity: 0.8; } 50% { opacity: 1; } }
`;

// Closed and open assets share one canvas, so stacking them edge-to-edge
// inside one fixed wrapper guarantees a jump-free crossfade.
const caseImgStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: 0,
    transform: "translateX(-50%)",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    pointerEvents: "none",
    display: "block",
};

export function CaseOpeningAnimation({ caseType, reward, onClose }: {
    caseType: "basic" | "premium";
    reward: { type: string; amount: number } | null;
    onClose: () => void;
}) {
    const [reducedMotion] = useState(() =>
        typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    );
    const [phase, setPhase] = useState<Phase>(reducedMotion ? "final" : "enter");
    const [ready, setReady] = useState(reducedMotion);
    const [assetFallback, setAssetFallback] = useState(false);
    const [dropIconFailed, setDropIconFailed] = useState(false);

    const isPremium = caseType === "premium";
    const closedSrc = APP_ICONS[isPremium ? "case_premium_anim_closed" : "case_basic_anim_closed"];
    const openSrc = APP_ICONS[isPremium ? "case_premium_anim_open" : "case_basic_anim_open"];
    const dropIconName = getDropIconForReward(reward?.type);
    const dropSrc = dropIconName ? APP_ICONS[dropIconName] : null;

    // Rarity drives haptic intensity (a legendary drop should *feel* heavier).
    const rewardRarity = reward ? (REWARD_META[reward.type]?.rarity ?? FALLBACK_META.rarity) : FALLBACK_META.rarity;
    const isBigReward = rewardRarity === "rare" || rewardRarity === "legendary";

    // Phase timers live in a ref so a tap-to-skip can cancel the rest of the timeline.
    const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

    // Tap-to-skip: clear pending phase timers and jump straight to the reveal.
    const skipToFinal = useCallback(() => {
        if (reducedMotion) return;
        timersRef.current.forEach(clearTimeout);
        timersRef.current = [];
        setPhase("final");
    }, [reducedMotion]);

    // Preload the case states and the large drop art before the timeline runs —
    // otherwise the very first opening plays against an empty stage while images stream in.
    useEffect(() => {
        if (reducedMotion) return;
        let cancelled = false;
        const caseImages = Promise.all([loadImage(closedSrc), loadImage(openSrc)])
            .catch(() => { if (!cancelled) setAssetFallback(true); }); // play the same flow with regular case AppIcons
        const dropImage = dropSrc
            ? loadImage(dropSrc).catch(() => { if (!cancelled) setDropIconFailed(true); }) // reveal falls back to the regular reward AppIcon
            : Promise.resolve();
        Promise.all([caseImages, dropImage]).then(() => { if (!cancelled) setReady(true); });
        // Never block the reveal on a slow CDN for more than 2.5s.
        const cap = setTimeout(() => { if (!cancelled) setReady(true); }, 2500);
        return () => { cancelled = true; clearTimeout(cap); };
    }, [reducedMotion, closedSrc, openSrc, dropSrc]);

    useEffect(() => {
        if (reducedMotion || !ready) return;
        timersRef.current = PHASE_TIMELINE.map(({ phase: next, at }) => setTimeout(() => setPhase(next), at));
        return () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
    }, [ready, reducedMotion]);

    // Haptics per phase. Escalates with rarity; always confirms on the final reveal.
    useEffect(() => {
        if (phase === "final") { hapticSuccess(); return; }
        if (reducedMotion) return;
        if (phase === "shake") {
            // A3: ticks that intensify across the build-up (last one heavier for big drops).
            const ticks = [40, 260, 470].map((delay, i) =>
                setTimeout(() => hapticImpact(i === 2 ? (isBigReward ? "medium" : "light") : "light"), delay));
            return () => ticks.forEach(clearTimeout);
        }
        if (phase === "flash") hapticImpact(isBigReward ? "heavy" : "medium");
        else if (phase === "beam") hapticImpact("soft"); // the beam launches out of the case
        else if (phase === "pop") hapticImpact(isBigReward ? "heavy" : "medium"); // reward emerges
    }, [phase, reducedMotion, isBigReward]);

    // Single fixed-size centered wrapper for both case states — no size/position jump.
    const caseWidth = isPremium ? 224 : 200;
    const stageHeight = caseWidth + 40;

    // basic — orange/gold glow; premium — purple/gold glow
    const glowMain = isPremium ? "rgba(168,85,247,0.55)" : "rgba(255,170,60,0.55)";
    const glowSoft = isPremium ? "rgba(168,85,247,0.25)" : "rgba(255,170,60,0.25)";
    const flashTint = isPremium
        ? "radial-gradient(circle, rgba(255,255,255,0.92) 0%, rgba(216,180,254,0.55) 35%, rgba(250,204,21,0.25) 55%, transparent 75%)"
        : "radial-gradient(circle, rgba(255,255,255,0.92) 0%, rgba(253,186,116,0.55) 35%, rgba(255,210,120,0.25) 55%, transparent 75%)";
    const smokeColor = isPremium ? "rgba(196,150,255,0.5)" : "rgba(255,200,130,0.5)";
    const sparkColors = isPremium ? ["#FACC15", "#C084FC", "#E9D5FF"] : ["#FBBF24", "#FB923C", "#FFD27D"];
    const fallbackCaseIcon: AppIconName = isPremium ? "case_premium" : "case_basic";

    const meta = reward ? (REWARD_META[reward.type] || FALLBACK_META) : FALLBACK_META;
    const rarityLabel = meta.rarity === "rare" ? "🔥 Редкая награда!" : meta.rarity === "legendary" ? "💎 Очень редкая награда!" : null;
    const isBoostReward = ["joker", "extra_joker", "double_chance", "extra_league", "extra_joker_double_chance"].includes(reward?.type || "");
    const useDropArt = !!dropSrc && !dropIconFailed;
    // Large 512px drop art can take big sizes; the regular small AppIcons get
    // blurry when stretched, so the fallback stays compact.
    const rewardSize = useDropArt
        ? (isBoostReward ? 112 : 104)
        : (isBoostReward ? 76 : reward?.type === "stars" || reward?.type === "balls" ? 88 : 80);
    const rewardSrc = useDropArt && dropSrc ? dropSrc : APP_ICONS[meta.icon];

    const showClosed = ready && !phaseAtLeast(phase, "beam") && !reducedMotion;
    const showFlash = phase === "flash" || phase === "open";
    // Open case is only visible during open + the start of beam, then it fades away.
    const showOpen = ready && (phase === "open" || phase === "beam");
    const showSmoke = phase === "flash" || phase === "open" || phase === "beam";
    // Beam rises at open, holds through the long beam phase, fades out on pop.
    const showBeam = phase === "open" || phase === "beam" || phase === "pop";
    const showReward = phaseAtLeast(phase, "pop");
    const isFinal = phase === "final";
    const isCaseFading = phase === "beam"; // open case recedes while the beam holds

    // Mouth of the opened case — smoke and the reward launch point sit here.
    const mouthTop = stageHeight - caseWidth * 0.6;

    const smokeBlobs = 7;
    const sparkCount = 10;

    const renderCaseImg = (src: string) =>
        assetFallback ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <AppIcon name={fallbackCaseIcon} size={caseWidth * 0.7} loading="eager" />
            </div>
        ) : (
            <img src={src} alt="" style={caseImgStyle} draggable={false} />
        );

    // Tap anywhere before the reveal fast-forwards to the result (repeat openers).
    const canSkip = ready && !reducedMotion && !isFinal;

    return (
        <div
            onClick={canSkip ? skipToFinal : undefined}
            style={{
                position: "fixed", inset: 0, zIndex: 9998,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                cursor: canSkip ? "pointer" : "default",
            }}
        >
            <style>{CASE_OPENING_CSS}</style>
            {/* Skip hint — only while a tap can still fast-forward the reveal */}
            {canSkip && (
                <div style={{
                    position: "absolute", bottom: 28, left: 0, right: 0, zIndex: 7,
                    textAlign: "center", fontSize: 12, fontWeight: 600,
                    color: "rgba(255,255,255,0.5)", pointerEvents: "none",
                    animation: "coaTextIn 0.4s ease-out 0.3s both",
                }}>
                    Нажми, чтобы пропустить
                </div>
            )}

            {/* Layer 0: overlay background */}
            <div style={{
                position: "absolute", inset: 0, zIndex: 0,
                background: "#000",
            }} />

            {/* C1: rarity-tinted ambient wash for big drops — warms the whole screen from the burst on */}
            {isBigReward && (
                <div style={{
                    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
                    background: `radial-gradient(circle at 50% 54%, ${meta.glowColor} 0%, transparent 58%)`,
                    mixBlendMode: "screen",
                    opacity: phaseAtLeast(phase, "flash") ? (isFinal ? 0.45 : 0.7) : 0,
                    transition: "opacity 0.5s ease",
                }} />
            )}

            <div style={{
                position: "relative", zIndex: 2, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center",
                // C2: a quick screen shake on the big-reward burst (paired with the heavy haptic).
                animation: !reducedMotion && isBigReward && phase === "flash" ? "coaScreenShake 0.42s ease-in-out both" : undefined,
            }}>
                {/* ===== Case stage: one fixed centered wrapper, both states share it ===== */}
                <div style={{
                    position: "relative",
                    width: caseWidth,
                    height: stageHeight,
                    animation: reducedMotion || !ready ? undefined : "coaEnter 0.35s ease-out both",
                }}>
                    {/* Layer 1: ambient glow behind the case (also the short pre-reveal loading state) */}
                    {!isFinal && (
                        <div style={{
                            position: "absolute", top: "58%", left: "50%", width: caseWidth * 0.95, height: caseWidth * 0.95,
                            transform: "translate(-50%, -50%)", borderRadius: "50%",
                            background: `radial-gradient(circle, ${glowMain} 0%, ${glowSoft} 45%, transparent 70%)`,
                            animation: "coaGlowPulse 1.8s ease-in-out infinite",
                            pointerEvents: "none",
                            zIndex: 1,
                            opacity: phaseAtLeast(phase, "beam") ? 0.4 : 1, // dim once the beam takes over
                            transition: "opacity 0.4s",
                        }} />
                    )}

                    {/* B1: rarity beam — shoots up from the mouth, holds risen ~3s, then fades on pop */}
                    {showBeam && (
                        <div style={{
                            position: "absolute",
                            left: "50%",
                            top: mouthTop + 56 - (stageHeight + 30),
                            width: caseWidth * (isBigReward ? 0.62 : 0.5),
                            height: stageHeight + 30,
                            transformOrigin: "50% 100%",
                            background: `linear-gradient(to top, ${meta.color} 0%, ${meta.glowColor} 28%, transparent 82%)`,
                            filter: "blur(7px)",
                            mixBlendMode: "screen",
                            // open/beam → rise then a gentle idle hold; pop → fade away.
                            animation: phase === "pop"
                                ? "coaBeamFade 0.5s ease-out both"
                                : "coaBeamRise 0.7s ease-out both, coaBeamIdle 2.4s ease-in-out 0.7s infinite",
                            pointerEvents: "none",
                            zIndex: 1,
                        }} />
                    )}

                    {/* Layer 1: smoke + sparks rising from the centre of the case */}
                    {showSmoke && (
                        <div style={{ position: "absolute", inset: -30, pointerEvents: "none", zIndex: 1 }}>
                            {Array.from({ length: smokeBlobs }).map((_, i) => {
                                const angle = (Math.PI * 2 * i) / smokeBlobs;
                                const dist = 38 + (i % 3) * 15;
                                return (
                                    <div key={`smoke-${i}`} style={{
                                        position: "absolute",
                                        top: mouthTop + 56, // centre of the opened case
                                        left: "50%",
                                        width: 32 + (i % 3) * 10, height: 32 + (i % 3) * 10,
                                        borderRadius: "50%",
                                        background: `radial-gradient(circle, ${smokeColor} 0%, transparent 70%)`,
                                        filter: "blur(3px)",
                                        animation: `coaSmoke 0.9s ease-out ${i * 0.05}s both`,
                                        "--sx": `${Math.cos(angle) * dist * 0.7}px`,
                                        "--sy": `${-Math.abs(Math.sin(angle)) * dist - 30}px`, // drifts upward only
                                    } as CSSProperties} />
                                );
                            })}
                            {Array.from({ length: sparkCount }).map((_, i) => (
                                <div key={`spark-${i}`} style={{
                                    position: "absolute",
                                    top: mouthTop + 56,
                                    left: "50%",
                                    width: 5, height: 5, borderRadius: "50%",
                                    background: sparkColors[i % sparkColors.length],
                                    boxShadow: `0 0 6px ${sparkColors[i % sparkColors.length]}`,
                                    animation: `coaSpark 0.8s ease-out ${i * 0.04}s both`,
                                    "--angle": `${-20 - (140 / (sparkCount - 1)) * i}deg`, // fan upward only
                                } as CSSProperties} />
                            ))}
                        </div>
                    )}

                    {/* Layer 2: closed case — enter + shake, stays put through the flash, fades out at open */}
                    {showClosed && (
                        <div style={{
                            position: "absolute", inset: 0, zIndex: 2,
                            animation: phase === "enter" || phase === "flash"
                                ? undefined
                                : phase === "shake"
                                    ? `${isBigReward ? "coaShakeBig" : "coaShake"} 0.6s ease-in-out both`
                                    : "coaClosedOut 0.3s ease-out both", // open phase: 1150–1450ms crossfade
                        }}>
                            {renderCaseImg(closedSrc)}
                        </div>
                    )}

                    {/* Layer 2: open case — crossfades in at the same spot, recedes during fade */}
                    {showOpen && (
                        <div style={{
                            position: "absolute", inset: 0, zIndex: 2,
                            animation: reducedMotion
                                ? undefined
                                : isCaseFading
                                    ? "coaCaseOut 0.55s ease-in both"
                                    : "coaOpenIn 0.3s ease-out both",
                        }}>
                            {renderCaseImg(openSrc)}
                        </div>
                    )}

                    {/* Layer 3: flash burst at the moment of opening */}
                    {showFlash && (
                        <div style={{
                            position: "absolute",
                            top: "50%", left: "50%", width: caseWidth * 1.2, height: caseWidth * 1.2,
                            marginTop: -caseWidth * 0.6, marginLeft: -caseWidth * 0.6,
                            background: flashTint,
                            animation: "coaFlash 0.55s ease-out both",
                            pointerEvents: "none",
                            zIndex: 3,
                        }} />
                    )}

                    {/* Layer 5: reward — launches from the case mouth and settles above the open lid */}
                    {showReward && reward && (
                        <div style={{
                            position: "absolute",
                            top: mouthTop - rewardSize / 2,
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 5,
                        }}>
                            <div style={{
                                position: "relative",
                                animation: reducedMotion ? undefined : "coaRewardPop 0.75s cubic-bezier(0.175, 0.885, 0.32, 1.275) both",
                                transform: reducedMotion ? `translateY(-${REWARD_FINAL_LIFT}px)` : undefined,
                            }}>
                                {/* Soft halo behind the icon (separate layer, never blurs the icon itself) */}
                                <div style={{
                                    position: "absolute", top: "50%", left: "50%",
                                    width: rewardSize + 40, height: rewardSize + 40,
                                    transform: "translate(-50%, -50%)", borderRadius: "50%",
                                    background: `radial-gradient(circle, ${meta.glowColor} 0%, transparent 65%)`,
                                    animation: "coaGlowPulseSoft 2s ease-in-out infinite",
                                    pointerEvents: "none",
                                    zIndex: 0,
                                }} />
                                {/* Glow ring — compact, sits behind the icon */}
                                <div style={{
                                    position: "absolute", top: "50%", left: "50%",
                                    width: rewardSize + 32, height: rewardSize + 32,
                                    borderRadius: "50%",
                                    border: `2px solid ${meta.color}`,
                                    boxShadow: `0 0 12px ${meta.glowColor}, inset 0 0 8px ${meta.glowColor}`,
                                    animation: reducedMotion ? undefined : "coaRing 0.4s ease-out 0.4s both",
                                    transform: "translate(-50%, -50%)",
                                    pointerEvents: "none",
                                    zIndex: 1,
                                    opacity: 0.85,
                                }} />
                                {/* Reward icon on top — crisp, no filters */}
                                <img
                                    src={rewardSrc}
                                    alt=""
                                    width={rewardSize}
                                    height={rewardSize}
                                    draggable={false}
                                    onError={() => setDropIconFailed(true)}
                                    style={{
                                        position: "relative", zIndex: 2, display: "block",
                                        width: rewardSize, height: rewardSize, maxWidth: useDropArt ? 120 : 88,
                                        objectFit: "contain",
                                        imageRendering: "auto",
                                        backfaceVisibility: "hidden",
                                        transform: "translateZ(0)",
                                        pointerEvents: "none",
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* ===== Layer 6: final state — appears only after the case has faded away ===== */}
                {isFinal && reward && (
                    <div style={{
                        display: "flex", flexDirection: "column", alignItems: "center",
                        position: "relative", zIndex: 6,
                        // The reward rests REWARD_FINAL_LIFT above the (now hidden) case mouth,
                        // so pull the text block up into the freed space.
                        marginTop: -caseWidth * 0.45,
                    }}>
                        {(reward.type === "stars" || reward.type === "balls") && (
                            <div style={{
                                fontSize: 30, fontWeight: 800, color: meta.color,
                                textShadow: `0 0 20px ${meta.glowColor}`,
                                animation: reducedMotion ? undefined : "coaTextIn 0.35s ease-out both",
                            }}>x{reward.amount}</div>
                        )}
                        {rarityLabel && (
                            <div style={{
                                fontSize: 13, fontWeight: 700, color: meta.color, marginTop: 8,
                                textShadow: `0 0 10px ${meta.glowColor}`,
                                letterSpacing: 1, textTransform: "uppercase",
                                animation: "coaRarityPulse 1.5s ease-in-out infinite",
                            }}>{rarityLabel}</div>
                        )}
                        <div style={{
                            fontSize: 16, fontWeight: 600, color: "#fff", marginTop: 12,
                            animation: reducedMotion ? undefined : "coaTextIn 0.35s ease-out 0.1s both",
                        }}>
                            Получено: {getRewardText(reward.type, reward.amount)}
                        </div>
                        <button onClick={onClose} style={{
                            marginTop: 20, padding: "12px 44px", minHeight: 48,
                            borderRadius: 14, border: "none", cursor: "pointer",
                            background: "linear-gradient(135deg, #FFB020, #F97316)",
                            color: "#fff", fontSize: 16, fontWeight: 800, opacity: 1,
                            boxShadow: "0 4px 22px rgba(249,115,22,0.55)",
                            animation: reducedMotion ? undefined : "coaTextIn 0.3s ease-out 0.25s both",
                        }}>Забрать</button>
                    </div>
                )}
            </div>
        </div>
    );
}
