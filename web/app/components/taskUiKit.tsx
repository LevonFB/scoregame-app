"use client";

import type { CSSProperties, ReactNode } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import { AppIcon } from "@/app/components/ui/AppIcon";

/**
 * Shared Task UI kit.
 *
 * The visual reference is the compact "Прогнозы сезона" / "Вызов недели" task
 * cards (web/app/season-predictions/components/SeasonPredictionTasksSection.tsx).
 * Every task surface in the general «Задания» section — daily, weekly, partner,
 * season, weekly-challenge — should share these tokens so they read as one
 * system. Tokens are mirrored from the season file so the two stay identical.
 */

// Accent is the Telegram button color so tabs/cards feel native in both themes
// (instead of a hardcoded orange). Completed=green and reward=gold are kept as
// semantic colors — Telegram exposes no theme variable for them — but they are
// always rendered through color-mix over theme surfaces so they read on light
// and dark alike.
export const TASK_ACCENT = "var(--tg-button)";
export const TASK_DONE = "#2ec060";
export const TASK_GREEN = "#34c759";
export const TASK_REWARD = "#ffb020";

export const TASK_CARD_SURFACE =
  "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))";
export const TASK_CARD_SHADOW =
  "0 7px 18px color-mix(in srgb, var(--tg-text) 9%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)";
export const TASK_SOFT_BORDER = "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)";

export type TaskStatusKind =
  | "available"
  | "in_progress"
  | "completed"
  | "received"
  | "future"
  | "unavailable";

const STATUS_META: Record<TaskStatusKind, { label: string; color: string; bg: string }> = {
  available: {
    label: "Доступно",
    color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))",
    bg: "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  },
  in_progress: {
    label: "В процессе",
    color: TASK_ACCENT,
    bg: `color-mix(in srgb, ${TASK_ACCENT} 12%, var(--tg-bg))`,
  },
  completed: {
    label: "Выполнено",
    color: TASK_DONE,
    bg: `color-mix(in srgb, ${TASK_GREEN} 12%, var(--tg-bg))`,
  },
  received: {
    label: "Получено",
    color: TASK_DONE,
    bg: `color-mix(in srgb, ${TASK_GREEN} 12%, var(--tg-bg))`,
  },
  future: {
    label: "Скоро",
    color: "var(--tg-hint)",
    bg: "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  },
  unavailable: {
    label: "Недоступно",
    color: "var(--tg-hint)",
    bg: "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  },
};

export function TaskStatusPill({ status, label }: { status: TaskStatusKind; label?: string }) {
  const meta = STATUS_META[status];
  return <span style={{ ...statusPillBaseStyle, background: meta.bg, color: meta.color }}>{label || meta.label}</span>;
}

const statusPillBaseStyle: CSSProperties = {
  flexShrink: 0,
  minHeight: 18,
  borderRadius: 999,
  padding: "0 7px",
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  fontSize: 10,
  fontWeight: 850,
  whiteSpace: "nowrap",
};

export function TaskRewardPill({ stars, balls, label }: { stars?: number; balls?: number; label?: string }) {
  if (label) {
    return <span style={rewardPillStyle}>{label}</span>;
  }
  const parts: ReactNode[] = [];
  if ((stars || 0) > 0) parts.push(<RewardIconPart key="stars" icon="game_star" value={stars || 0} />);
  if ((balls || 0) > 0) parts.push(<RewardIconPart key="balls" icon="ball" value={balls || 0} />);
  if (parts.length === 0) return null;
  return <span style={rewardPillStyle}>{parts.map((part, index) => <span key={index} style={rewardPartWrapStyle}>{part}</span>)}</span>;
}

function RewardIconPart({ icon, value }: { icon: "game_star" | "ball"; value: number }) {
  return (
    <>
      <span>{value}</span>
      <AppIcon name={icon} size={14} />
    </>
  );
}

const rewardPillStyle: CSSProperties = {
  flexShrink: 0,
  minHeight: 18,
  borderRadius: 999,
  padding: "0 8px",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: `color-mix(in srgb, ${TASK_REWARD} 14%, var(--tg-bg))`,
  border: `1px solid color-mix(in srgb, ${TASK_REWARD} 26%, transparent)`,
  color: `color-mix(in srgb, ${TASK_REWARD} 82%, var(--tg-text))`,
  fontSize: 10,
  fontWeight: 850,
  whiteSpace: "nowrap",
};

const rewardPartWrapStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
};

export type ProgressTone = "in_progress" | "completed" | "future";

export function TaskProgressBar({
  current,
  target,
  tone = "in_progress",
  showMeta = true,
  trailing,
}: {
  current: number;
  target: number;
  tone?: ProgressTone;
  showMeta?: boolean;
  trailing?: ReactNode;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
  const fill = tone === "completed" ? TASK_DONE : tone === "future" ? "var(--tg-hint)" : TASK_ACCENT;
  return (
    <div style={progressRowStyle}>
      <div style={progressTrackStyle}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: fill, transition: "width 180ms ease" }} />
      </div>
      {(showMeta || trailing) && (
        <div style={progressMetaStyle}>
          {showMeta && (
            <span style={progressTextStyle}>
              {Math.min(current, target)}/{target}
            </span>
          )}
          {trailing}
        </div>
      )}
    </div>
  );
}

const progressRowStyle: CSSProperties = {
  marginTop: 2,
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
};

const progressTrackStyle: CSSProperties = {
  height: 3,
  borderRadius: 999,
  overflow: "hidden",
  background: "color-mix(in srgb, var(--tg-hint) 12%, transparent)",
};

const progressMetaStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
};

const progressTextStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 850,
  color: "var(--tg-hint)",
};

/** Unified task card shell used by daily / weekly / partner lists. */
export function TaskCard({
  icon,
  title,
  badge,
  description,
  status,
  statusLabel,
  reward,
  progress,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  badge?: string;
  description?: string;
  status: TaskStatusKind;
  statusLabel?: string;
  reward?: { stars?: number; balls?: number; label?: string };
  progress?: { current: number; target: number; tone?: ProgressTone };
  footer?: ReactNode;
}) {
  const completed = status === "completed" || status === "received";
  const future = status === "future";
  const showProgress = !!progress && progress.target > 1;
  return (
    <div style={taskCardShellStyle(completed, future)}>
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
        {icon != null && <div style={taskIconStyle(completed)}>{icon}</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <h4 style={taskTitleStyle}>{title}</h4>
            {badge && <span style={taskBadgeStyle}>{badge}</span>}
          </div>
          {description && <p style={taskDescStyle}>{description}</p>}
        </div>
        <div style={taskRightColStyle}>
          {reward && <TaskRewardPill stars={reward.stars} balls={reward.balls} label={reward.label} />}
          <TaskStatusPill status={status} label={statusLabel} />
        </div>
      </div>
      {showProgress && (
        <TaskProgressBar current={progress!.current} target={progress!.target} tone={progress!.tone || "in_progress"} />
      )}
      {footer}
    </div>
  );
}

function taskCardShellStyle(completed: boolean, future: boolean): CSSProperties {
  return {
    width: "100%",
    borderRadius: 13,
    padding: "9px 10px",
    background: future
      ? "color-mix(in srgb, var(--tg-secondary-bg) 58%, var(--tg-bg))"
      : "color-mix(in srgb, var(--tg-secondary-bg) 76%, var(--tg-bg))",
    border: completed ? `1px solid color-mix(in srgb, ${TASK_GREEN} 22%, var(--tg-hint))` : TASK_SOFT_BORDER,
    opacity: future ? 0.72 : 1,
    textAlign: "left",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  };
}

function taskIconStyle(completed: boolean): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 10,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    background: completed
      ? `color-mix(in srgb, ${TASK_GREEN} 15%, var(--tg-bg))`
      : "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
    border: TASK_SOFT_BORDER,
  };
}

const taskRightColStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",
  gap: 5,
  flexShrink: 0,
};

const taskTitleStyle: CSSProperties = {
  margin: 0,
  minWidth: 0,
  fontSize: 12,
  fontWeight: 920,
  letterSpacing: 0,
  lineHeight: 1.2,
  color: "var(--tg-text)",
  // Keep titles to 1–2 lines so cards stay compact and predictable.
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  overflowWrap: "anywhere",
};

const taskBadgeStyle: CSSProperties = {
  flexShrink: 0,
  height: 16,
  borderRadius: 999,
  padding: "0 6px",
  display: "inline-flex",
  alignItems: "center",
  background: "color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 9,
  fontWeight: 850,
  whiteSpace: "nowrap",
};

const taskDescStyle: CSSProperties = {
  margin: "2px 0 0",
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.28,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

/** Per-tab summary header card. */
export function TaskSummaryCard({
  title,
  meta,
  description,
  statusPill,
  progress,
  children,
}: {
  title: string;
  meta?: ReactNode;
  description?: ReactNode;
  statusPill?: ReactNode;
  progress?: { current: number; target: number; tone?: ProgressTone };
  children?: ReactNode;
}) {
  return (
    <div style={summaryCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={summaryTitleStyle}>{title}</h2>
          {description && <p style={summaryDescStyle}>{description}</p>}
        </div>
        <div style={taskRightColStyle}>
          {meta != null && <span style={summaryMetaChipStyle}>{meta}</span>}
          {statusPill}
        </div>
      </div>
      {progress && (
        <div style={{ marginTop: 8 }}>
          <TaskProgressBar current={progress.current} target={progress.target} tone={progress.tone} showMeta={false} />
        </div>
      )}
      {children}
    </div>
  );
}

const summaryCardStyle: CSSProperties = {
  borderRadius: 15,
  padding: "10px 11px",
  background: TASK_CARD_SURFACE,
  border: TASK_SOFT_BORDER,
  boxShadow: TASK_CARD_SHADOW,
  color: "var(--tg-text)",
};

const summaryTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 950,
  letterSpacing: 0,
  lineHeight: 1.1,
  color: "var(--tg-text)",
};

const summaryDescStyle: CSSProperties = {
  margin: "3px 0 0",
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.45,
  color: "color-mix(in srgb, var(--tg-text) 56%, var(--tg-hint))",
};

const summaryMetaChipStyle: CSSProperties = {
  minWidth: 48,
  height: 26,
  borderRadius: 999,
  padding: "0 10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
  border: TASK_SOFT_BORDER,
  color: "var(--tg-text)",
  fontSize: 13,
  fontWeight: 950,
};

/** Section label above a group of task cards. */
export function TaskSectionIntro({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 2px" }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>{title}</div>
      {description && (
        <div style={{ fontSize: 11, fontWeight: 650, lineHeight: 1.4, color: "color-mix(in srgb, var(--tg-text) 54%, var(--tg-hint))" }}>
          {description}
        </div>
      )}
    </div>
  );
}

export function TaskEmptyCard({ text }: { text: string }) {
  return <div style={taskEmptyStyle}>{text}</div>;
}

const taskEmptyStyle: CSSProperties = {
  minHeight: 48,
  borderRadius: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: "12px 14px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 62%, var(--tg-bg))",
  border: "1px dashed color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.4,
};

export type ActionTone = "primary" | "secondary";

export function TaskActionButton({
  label,
  onClick,
  href,
  disabled,
  busy,
  tone = "primary",
  minWidth = 112,
}: {
  label: string;
  onClick?: () => void;
  /** Ссылка вместо кнопки: нужна там, где клиент не выполняет переход по событию. */
  href?: string;
  disabled?: boolean;
  busy?: boolean;
  tone?: ActionTone;
  minWidth?: number;
}) {
  const isDisabled = disabled || busy;
  if (href && !isDisabled) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        style={{
          ...actionButtonStyle(tone, false, minWidth),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textDecoration: "none",
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <Pressable
      haptic="light"
      pressedScale={0.98}
      onClick={onClick}
      disabled={isDisabled}
      style={actionButtonStyle(tone, !!isDisabled, minWidth)}
    >
      {label}
    </Pressable>
  );
}

function actionButtonStyle(tone: ActionTone, disabled: boolean, minWidth: number): CSSProperties {
  if (disabled) {
    return {
      minWidth,
      minHeight: 30,
      borderRadius: 10,
      padding: "0 10px",
      border: TASK_SOFT_BORDER,
      background: "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
      color: "var(--tg-hint)",
      fontSize: 11,
      fontWeight: 850,
      whiteSpace: "nowrap",
      cursor: "default",
    };
  }
  if (tone === "secondary") {
    return {
      minWidth,
      minHeight: 30,
      borderRadius: 10,
      padding: "0 10px",
      border: TASK_SOFT_BORDER,
      background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
      color: "var(--tg-text)",
      fontSize: 11,
      fontWeight: 850,
      whiteSpace: "nowrap",
      cursor: "pointer",
    };
  }
  return {
    minWidth,
    minHeight: 30,
    borderRadius: 10,
    padding: "0 10px",
    border: `1px solid color-mix(in srgb, ${TASK_ACCENT} 40%, transparent)`,
    background: `linear-gradient(180deg, color-mix(in srgb, ${TASK_ACCENT} 22%, var(--tg-bg)), color-mix(in srgb, ${TASK_ACCENT} 12%, var(--tg-secondary-bg)))`,
    color: `color-mix(in srgb, ${TASK_ACCENT} 82%, var(--tg-text))`,
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap",
    cursor: "pointer",
  };
}
