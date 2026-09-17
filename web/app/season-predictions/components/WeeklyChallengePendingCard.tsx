"use client";

import { Pressable } from "@/app/components/ui/Pressable";
import { AppIcon } from "@/app/components/ui/AppIcon";
import type { WeeklyChallengePendingResult } from "../types";

/* Read-only companion card for the previous week's challenge that is closed but not
 * yet scored/archived while a new one is open. Surfaces the pending result so the user
 * doesn't lose sight of it. Never interactive beyond an optional "view" CTA — rewards
 * for it live in the "Незабранные награды" archive on the tasks screen. */

const WC_ACCENT = "#A855F7"; // shared weekly-challenge identity (purple/gold)

export function WeeklyChallengePendingCard({
  data,
  onOpen,
}: {
  data: WeeklyChallengePendingResult;
  onOpen?: () => void;
}) {
  const { challenge, score, has_score, results_stale, status } = data;

  const stateText =
    has_score && !results_stale && score
      ? `Результат: ${score.total_points} из ${score.max_possible_points}`
      : has_score && results_stale
        ? "Результаты обновляются"
        : status === "completed"
          ? "Вызов завершён"
          : "Приём закрыт — идёт подсчёт";

  const showResultAccent = has_score && !results_stale && !!score;

  const inner = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={eyebrowStyle}>
          <AppIcon name="weekly_challenge" size={12} /> Прошлый вызов
        </span>
        <span style={pendingPillStyle}>{status === "completed" ? "Итог" : "Подсчёт"}</span>
      </div>

      <div style={titleStyle}>{challenge.title}</div>

      <div style={{ ...stateStyle, color: showResultAccent ? `color-mix(in srgb, ${WC_ACCENT} 86%, var(--tg-text))` : "var(--tg-hint)" }}>
        {stateText}
      </div>

      {onOpen && (
        <div style={ctaRowStyle}>
          <span style={ctaLabelStyle}>Посмотреть результат</span>
        </div>
      )}
    </>
  );

  if (onOpen) {
    return (
      <Pressable onClick={onOpen} haptic="light" pressedScale={0.99} aria-label={`${challenge.title} — результат`} style={cardStyle}>
        {inner}
      </Pressable>
    );
  }
  return <div style={cardStyle}>{inner}</div>;
}

const cardStyle = {
  width: "100%",
  display: "flex",
  flexDirection: "column" as const,
  textAlign: "left" as const,
  color: "var(--tg-text)",
  background: `linear-gradient(180deg, color-mix(in srgb, ${WC_ACCENT} 8%, var(--tg-secondary-bg)), color-mix(in srgb, var(--tg-bg) 88%, var(--tg-secondary-bg)))`,
  border: `1px solid color-mix(in srgb, ${WC_ACCENT} 22%, transparent)`,
  borderRadius: 16,
  padding: "11px 13px 12px",
  cursor: "pointer",
  boxShadow: "0 6px 18px color-mix(in srgb, var(--tg-text) 10%, transparent)",
};

const eyebrowStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  color: `color-mix(in srgb, ${WC_ACCENT} 78%, var(--tg-text))`,
};

const pendingPillStyle = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 900,
  padding: "2px 8px",
  borderRadius: 999,
  background: `color-mix(in srgb, ${WC_ACCENT} 14%, transparent)`,
  color: `color-mix(in srgb, ${WC_ACCENT} 84%, var(--tg-text))`,
  border: `1px solid color-mix(in srgb, ${WC_ACCENT} 26%, transparent)`,
};

const titleStyle = {
  marginTop: 7,
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.01em",
  lineHeight: 1.15,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

const stateStyle = {
  marginTop: 4,
  fontSize: 12.5,
  fontWeight: 800,
};

const ctaRowStyle = {
  marginTop: "auto",
  paddingTop: 9,
  display: "flex",
  justifyContent: "flex-end",
};

const ctaLabelStyle = {
  fontSize: 12.5,
  fontWeight: 900,
  color: `color-mix(in srgb, ${WC_ACCENT} 88%, var(--tg-text))`,
};
