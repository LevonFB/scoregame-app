"use client";

import { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { AppIcon } from './ui/AppIcon';

// Only these categories navigate to the QuestsScreen when clicked.
// Hidden categories (global, league, seasonal, milestone, level) just dismiss.
const VISIBLE_QUEST_CATEGORIES = new Set(["daily", "weekly", "partner"]);

type ToastItem = {
    id: string;
    achievement_id?: string;
    scope_target_id?: string;
    period_key?: string;
    emoji: string;
    title: string;
    unlocked_at: number;
    scope?: string;
};

function isVisibleQuest(item: ToastItem): boolean {
    return VISIBLE_QUEST_CATEGORIES.has(item.scope || '');
}

// Helper to get first emoji from compound emoji strings
function getPrimaryEmoji(emojiStr: string) {
    if (!emojiStr) return <AppIcon name="achievement_medal" size={28} />;
    if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
        try {
            const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
            const segments = [...segmenter.segment(emojiStr)];
            if (segments.length > 0) return segments[0].segment;
        } catch (e) { }
    }
    return emojiStr.slice(0, 2);
}

// =========================================================
// Global dedup: tracks which achievement keys have been
// queued this SESSION. Survives re-renders, but not full
// page reloads (which is fine — backend mark-shown handles
// persistent dedup).
// =========================================================
const sessionShownKeys = new Set<string>();

function toKey(item: { achievement_id?: string; id?: string; scope_target_id?: string; period_key?: string }) {
    return `${item.achievement_id || item.id}:${item.scope_target_id || ''}:${item.period_key || 'all'}`;
}

// =========================================================
// Global buffer — lives OUTSIDE React so that multiple
// rapid `triggerAchievementToast()` calls from different
// page.tsx callbacks merge into a single batch.
// =========================================================
let globalBuffer: ToastItem[] = [];
let globalBufferTimer: ReturnType<typeof setTimeout> | null = null;
let globalFlushFn: (() => void) | null = null;

/**
 * Call from anywhere (page.tsx callbacks, etc.).
 * Items are deduplicated via sessionShownKeys and
 * accumulated in a 1.5 s window before being flushed
 * as ONE toast.
 */
export const triggerAchievementToast = (items: ToastItem[]) => {
    if (typeof window === 'undefined') return;

    // Deduplicate
    const fresh = items.filter(it => {
        const key = toKey(it);
        if (sessionShownKeys.has(key)) return false;
        sessionShownKeys.add(key);
        return true;
    });
    if (fresh.length === 0) return;

    globalBuffer.push(...fresh);

    // (Re)start 1.5 s accumulation window
    if (globalBufferTimer) clearTimeout(globalBufferTimer);
    globalBufferTimer = setTimeout(() => {
        globalBufferTimer = null;
        globalFlushFn?.();
    }, 1500);
};

/**
 * Force-clear the entire pending/visible queue.
 * Called when user clicks "Получить" so that nothing
 * else pops up afterwards.
 */
export const dismissAllToasts = () => {
    // Kill pending buffer
    globalBuffer = [];
    if (globalBufferTimer) {
        clearTimeout(globalBufferTimer);
        globalBufferTimer = null;
    }
    // Signal component to hide
    window.dispatchEvent(new CustomEvent('toast-dismiss-all'));
};

// =========================================================
// Component
// =========================================================
export default function AchievementToast() {
    const [displayItems, setDisplayItems] = useState<ToastItem[] | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const initDataRef = useRef<string>('');

    // Get initData
    useEffect(() => {
        const tick = () => {
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.initData) {
                initDataRef.current = tg.initData;
            } else {
                setTimeout(tick, 100);
            }
        };
        tick();
    }, []);

    // Ack multiple items on backend
    const markBulkAsShown = useCallback(async (items: ToastItem[]) => {
        if (!initDataRef.current || items.length === 0) return;
        try {
            await apiFetch('/api/achievements/mark-shown', {
                method: 'POST',
                body: JSON.stringify({
                    initData: initDataRef.current,
                    items: items.map(item => ({
                        achievement_id: item.achievement_id || item.id,
                        scope_target_id: item.scope_target_id || '',
                        period_key: item.period_key || 'all',
                    }))
                })
            });
        } catch (e) {
            console.error('Failed to mark achievements as shown:', e);
        }
    }, []);

    // Flush buffer → show one aggregated toast
    const flush = useCallback(() => {
        const items = [...globalBuffer];
        globalBuffer = [];

        if (items.length === 0) return;

        // If a toast is already visible, merge new items into it
        setDisplayItems(prev => {
            const merged = prev ? [...prev, ...items] : items;
            return merged;
        });

        // Ack all immediately (fire and forget)
        markBulkAsShown(items);

        // Show
        setTimeout(() => setIsVisible(true), 50);

        // Reset auto-hide timer
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        const displayMs = 5000;
        hideTimerRef.current = setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => setDisplayItems(null), 300);
        }, displayMs);
    }, [markBulkAsShown]);

    // Register flush function so the global trigger can call it
    useEffect(() => {
        globalFlushFn = flush;
        return () => { globalFlushFn = null; };
    }, [flush]);

    // Listen for force-dismiss
    useEffect(() => {
        const handler = () => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
            setIsVisible(false);
            setTimeout(() => setDisplayItems(null), 100);
        };
        window.addEventListener('toast-dismiss-all', handler);
        return () => window.removeEventListener('toast-dismiss-all', handler);
    }, []);

    // Click → ack, clear queue, navigate only for visible quest categories
    const handleClaim = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();

        const items = displayItems;
        const shouldNavigate = items ? items.some(isVisibleQuest) : false;

        // 1. Kill everything
        dismissAllToasts();

        // 2. Hide current toast
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        setIsVisible(false);
        setTimeout(() => setDisplayItems(null), 100);

        // 3. Open QuestsScreen only for visible quest categories (daily/weekly/partner)
        if (shouldNavigate) {
            window.dispatchEvent(new CustomEvent('open-achievements'));
        }
    }, [displayItems]);

    // Click toast body → same as claim button
    const handleClick = useCallback(() => {
        handleClaim();
    }, [handleClaim]);

    if (!displayItems || displayItems.length === 0) return null;

    const firstToast = displayItems[0];
    const isMultiple = displayItems.length > 1;
    const primaryEmoji = getPrimaryEmoji(firstToast.emoji);

    const hasVisibleQuests = displayItems.some(isVisibleQuest);
    const allHidden = !hasVisibleQuests;

    // Label: reflect what the toast actually represents
    let toastLabel: string;
    if (isMultiple) {
        toastLabel = hasVisibleQuests ? 'Награды получены' : 'Достижения получены';
    } else {
        toastLabel = isVisibleQuest(firstToast) ? 'Задание выполнено' : 'Достижение получено';
    }

    const buttonLabel = allHidden ? 'Ок' : 'К заданиям';

    return (
        <div
            onClick={handleClick}
            style={{
                position: 'fixed',
                bottom: 90,
                left: '50%',
                transform: `translateX(-50%) translateY(${isVisible ? '0' : '20px'})`,
                opacity: isVisible ? 1 : 0,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                zIndex: 1001,
                width: '90%',
                maxWidth: 360,
                cursor: 'pointer'
            }}
        >
            <div style={{
                background: 'rgba(30, 30, 30, 0.95)',
                backdropFilter: 'blur(10px)',
                borderRadius: 16,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,149,0,0.2)',
                border: '1px solid rgba(255,149,0,0.15)'
            }}>
                {/* Icon */}
                <div style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: 'rgba(255, 149, 0, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 24,
                    flexShrink: 0
                }}>
                    {isMultiple ? '📦' : primaryEmoji}
                </div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#FF9500',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: 2
                    }}>
                        {toastLabel}
                    </div>
                    <div style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#fff',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }}>
                        {firstToast.title}
                    </div>
                    {isMultiple && (
                        <div style={{
                            fontSize: 11,
                            color: 'rgba(255,255,255,0.5)',
                            marginTop: 2
                        }}>
                            +{displayItems.length - 1} ещё
                        </div>
                    )}
                </div>

                {/* Action button */}
                <button
                    onClick={handleClaim}
                    style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#fff',
                        padding: '7px 14px',
                        background: 'var(--tg-button, #007aff)',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0
                    }}
                >
                    {buttonLabel}
                </button>
            </div>
        </div>
    );
}
