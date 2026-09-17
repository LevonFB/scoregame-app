"use client";

export type HapticSignal = "none" | "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

export function triggerHaptic(signal: HapticSignal = "selection") {
  if (signal === "none" || typeof window === "undefined") return;

  const feedback = (window as any).Telegram?.WebApp?.HapticFeedback;
  if (!feedback) return;

  try {
    if (signal === "selection") {
      feedback.selectionChanged?.();
      return;
    }

    if (signal === "success" || signal === "warning" || signal === "error") {
      feedback.notificationOccurred?.(signal);
      return;
    }

    feedback.impactOccurred?.(signal);
  } catch {
    // Telegram clients can expose partial WebApp APIs; haptics should never break UI.
  }
}
