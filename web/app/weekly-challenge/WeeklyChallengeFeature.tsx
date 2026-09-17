"use client";

import { WeeklyChallengeSection } from "../season-predictions/components/WeeklyChallengeSection";

// Standalone "Вызов недели" screen — a regular weekly mini-mode, separate from
// the long-term "Прогнозы сезона". Reuses the existing weekly challenge UI.
export function WeeklyChallengeFeature({
  embedded = false,
  onOpenTasks,
}: {
  embedded?: boolean;
  onOpenTasks?: () => void;
}) {
  return (
    <div
      style={{
        padding: embedded
          ? "18px 16px calc(58px + env(safe-area-inset-bottom, 0px))"
          : "calc(18px + env(safe-area-inset-top, 0px)) 16px calc(58px + env(safe-area-inset-bottom, 0px))",
        maxWidth: 600,
        margin: "0 auto",
        minHeight: embedded ? "auto" : "100dvh",
        background: "var(--tg-secondary-bg)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>
          Вызов недели
        </h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", fontWeight: 650, lineHeight: 1.4 }}>
          5 быстрых вопросов на ближайший футбольный уикенд.
        </p>
      </div>

      <WeeklyChallengeSection onOpenTasks={onOpenTasks} />
    </div>
  );
}
