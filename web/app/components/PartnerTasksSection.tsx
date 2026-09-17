"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { isUnreliableTelegramPlatform, openTelegramDeepLink } from "@/lib/telegramLinks";
import { Pressable } from "@/app/components/ui/Pressable";
import {
  TaskStatusPill,
  TaskRewardPill,
  TaskActionButton,
  TaskEmptyCard,
  TASK_SOFT_BORDER,
  TASK_CARD_SURFACE,
  type TaskStatusKind,
} from "./taskUiKit";

type PartnerTaskCard = {
  id: number;
  badge: string;
  adBadge: string;
  title: string;
  description: string;
  sponsorName: string;
  taskType: string;
  reward: {
    type: string;
    amount: number;
    label: string;
    payload?: Record<string, unknown> | null;
  };
  status: "available" | "in_progress" | "pending_hold" | "completed" | "expired" | "unavailable";
  statusText: string;
  holdHours: number;
  holdUntil?: number | null;
  actionUrl?: string;
  claim?: {
    id: number;
    status: string;
    failedReason?: string | null;
  } | null;
  verificationError?: string | null;
  canVerify?: boolean;
  source?: {
    telegramUsername?: string | null;
    botUsername?: string | null;
    deepLink?: string | null;
  };
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatHoldCountdown(holdUntil: number | null | undefined, nowMs: number) {
  if (!holdUntil) return "";
  const diffMs = Math.max(0, Number(holdUntil) - nowMs);
  const totalMinutes = Math.ceil(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
}

function getStatusChip(status: PartnerTaskCard["status"]) {
  switch (status) {
    case "completed":
      return { label: "Выполнено", color: "#34c759", bg: "rgba(52,199,89,0.14)" };
    case "pending_hold":
      return { label: "Проверяем", color: "#A855F7", bg: "rgba(168,85,247,0.16)" };
    case "expired":
      return { label: "Завершено", color: "#ff9500", bg: "rgba(255,149,0,0.14)" };
    case "unavailable":
      return { label: "Недоступно", color: "var(--tg-hint)", bg: "rgba(128,128,128,0.12)" };
    case "in_progress":
      return { label: "В процессе", color: "#0A84FF", bg: "rgba(10,132,255,0.14)" };
    default:
      return { label: "Доступно", color: "var(--tg-button, #007aff)", bg: "rgba(0,122,255,0.14)" };
  }
}

function getActionLabel(task: PartnerTaskCard, isChecking: boolean, nowMs: number) {
  if (isChecking) return "Проверяем…";
  if (task.status === "completed") return "Награда получена";
  if (task.status === "pending_hold") {
    const remaining = formatHoldCountdown(task.holdUntil, nowMs);
    return remaining ? `Проверка через ${remaining}` : "Проверить повторно";
  }
  if (task.status === "expired") return "Кампания завершена";
  if (task.status === "unavailable") return task.claim ? "Проверка закрыта" : "Недоступно";
  if (task.claim && !task.canVerify) return "Проверка закрыта";
  return task.claim ? "Проверить" : "Перейти";
}

function EmptyState({ text }: { text: string }) {
  return <TaskEmptyCard text={text} />;
}

function mapPartnerStatus(status: PartnerTaskCard["status"]): TaskStatusKind {
  switch (status) {
    case "completed":
      return "received";
    case "in_progress":
    case "pending_hold":
      return "in_progress";
    case "expired":
    case "unavailable":
      return "unavailable";
    default:
      return "available";
  }
}

function mapVerificationError(task: PartnerTaskCard) {
  const raw = task.verificationError || task.claim?.failedReason || "";
  if (!raw || task.status === "completed") return "";
  if (raw === "NOT_VERIFIED_YET") {
    return "Мы пока не видим, что задание выполнено. Выполни действие партнёра и попробуй ещё раз.";
  }
  if (raw === "BOT_CANNOT_VERIFY_MEMBERSHIP") {
    return "Бот сейчас не может подтвердить подписку. Попробуй позже — мы уже разбираемся.";
  }
  if (raw === "HOLD_RECHECK_FAILED") {
    return "Подписка не продержалась до конца проверки. Награда по этой кампании больше недоступна.";
  }
  return raw;
}

function PartnerCard({
  task,
  busy,
  nowMs,
  onAction,
}: {
  task: PartnerTaskCard;
  busy: boolean;
  nowMs: number;
  onAction: (task: PartnerTaskCard) => void;
}) {
  const statusChip = getStatusChip(task.status);
  const actionLabel = getActionLabel(task, busy, nowMs);
  const completed = task.status === "completed";

  // Show the full partner condition: clamp to 4 lines, and reveal a
  // "Подробнее" / "Свернуть" toggle only when the text actually overflows.
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = descRef.current;
    if (!el || expanded) return;
    setCanExpand(el.scrollHeight - el.clientHeight > 2);
  }, [task.description, expanded]);

  const holdActive = task.status === "pending_hold" && !!task.holdUntil && task.holdUntil > nowMs;
  const disabled =
    task.status === "completed"
    || task.status === "expired"
    || task.status === "unavailable"
    || (!!task.claim && !task.canVerify)
    || holdActive;
  const canRepeatAction =
    !!task.actionUrl
    && task.status !== "completed"
    && task.status !== "expired"
    && task.status !== "unavailable"
    && !holdActive;
  const verificationErrorText = mapVerificationError(task);
  const unreliablePlatform = isUnreliableTelegramPlatform();
  const linkAsAnchor = !!task.actionUrl && unreliablePlatform;
  /**
   * Ссылка, известная до создания заявки. У подписки на канал или вступления в
   * группу адрес не зависит от заявки, поэтому на десктопе первый «Перейти»
   * тоже может быть настоящей ссылкой: заявка создаётся тем же нажатием, а
   * переход выполняет клиент. У заданий с ботом адрес содержит токен заявки,
   * там первый шаг остаётся кнопкой.
   */
  const staticActionUrl = task.taskType === "telegram_channel_subscribe" || task.taskType === "telegram_group_join"
    ? (task.source?.deepLink || (task.source?.telegramUsername ? `https://t.me/${task.source.telegramUsername}` : ""))
    : "";
  const primaryHref = unreliablePlatform && !task.claim && staticActionUrl ? staticActionUrl : undefined;
  const handle = task.source?.telegramUsername
    ? `@${task.source.telegramUsername}`
    : task.source?.botUsername
      ? `@${task.source.botUsername}`
      : "";

  return (
    <div style={partnerCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
            {task.badge ? <span style={partnerTagStyle("amber")}>{task.badge}</span> : null}
            {task.adBadge ? <span style={partnerTagStyle("red")}>{task.adBadge}</span> : null}
            <TaskStatusPill status={mapPartnerStatus(task.status)} label={statusChip.label} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 920, lineHeight: 1.2, color: "var(--tg-text)" }}>{task.title}</div>
          <div style={{ fontSize: 11, fontWeight: 650, color: "var(--tg-hint)", marginTop: 2 }}>{task.sponsorName || "Партнёр"}</div>
        </div>
        <TaskRewardPill label={task.reward.label} />
      </div>

      <div ref={descRef} style={expanded ? partnerDescExpandedStyle : partnerDescClampStyle}>{task.description}</div>
      {canExpand ? (
        <Pressable haptic="light" pressedScale={0.99} onClick={() => setExpanded((v) => !v)} style={partnerMoreStyle}>
          {expanded ? "Свернуть" : "Подробнее"}
        </Pressable>
      ) : null}
      {task.statusText ? <div style={partnerStatusTextStyle}>{task.statusText}</div> : null}

      {verificationErrorText ? <div style={partnerErrorStyle}>{verificationErrorText}</div> : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={partnerHandleStyle}>{handle}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {canRepeatAction && task.claim ? (
            // На десктопе и в вебе это настоящая ссылка: там переход по событию
            // SDK может молча не сработать, а клик по `<a>` клиент выполняет сам.
            <TaskActionButton
              label={linkAsAnchor ? "Открыть" : "Повторить"}
              tone="secondary"
              busy={busy}
              minWidth={82}
              href={linkAsAnchor ? task.actionUrl : undefined}
              onClick={linkAsAnchor ? undefined : () => task.actionUrl && openTelegramDeepLink(task.actionUrl)}
            />
          ) : null}
          <TaskActionButton
            label={actionLabel}
            tone={completed ? "secondary" : "primary"}
            disabled={disabled}
            busy={busy}
            minWidth={completed ? 104 : 100}
            href={primaryHref}
            onClick={() => onAction(task)}
          />
        </div>
      </div>
    </div>
  );
}

const partnerCardStyle: CSSProperties = {
  background: TASK_CARD_SURFACE,
  borderRadius: 13,
  padding: "9px 10px",
  border: TASK_SOFT_BORDER,
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const partnerDescBaseStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.4,
  color: "color-mix(in srgb, var(--tg-text) 72%, var(--tg-hint))",
};

const partnerDescClampStyle: CSSProperties = {
  ...partnerDescBaseStyle,
  display: "-webkit-box",
  WebkitLineClamp: 4,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const partnerDescExpandedStyle: CSSProperties = {
  ...partnerDescBaseStyle,
};

const partnerMoreStyle: CSSProperties = {
  alignSelf: "flex-start",
  minHeight: 22,
  padding: "0 2px",
  background: "transparent",
  border: "none",
  color: "var(--tg-button)",
  fontSize: 11,
  fontWeight: 850,
  cursor: "pointer",
};

const partnerStatusTextStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  lineHeight: 1.35,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
};

const partnerHandleStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 650,
  color: "var(--tg-hint)",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const partnerErrorStyle: CSSProperties = {
  padding: "7px 9px",
  borderRadius: 10,
  background: "color-mix(in srgb, #ff9500 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #ff9500 22%, transparent)",
  color: "color-mix(in srgb, #ff9500 82%, var(--tg-text))",
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.32,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

function partnerTagStyle(kind: "amber" | "red"): CSSProperties {
  const color = kind === "amber" ? "#ff9500" : "#ff375f";
  return {
    fontSize: 10,
    fontWeight: 850,
    color,
    background: `color-mix(in srgb, ${color} 14%, var(--tg-bg))`,
    border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
    padding: "2px 7px",
    borderRadius: 999,
    whiteSpace: "nowrap",
  };
}

export function PartnerTasksSection() {
  const [tasks, setTasks] = useState<PartnerTaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; campaigns?: PartnerTaskCard[]; error?: string }>("/quests/partner");
      if (res?.ok) {
        setTasks(res.campaigns || []);
      } else {
        setError(res?.error || "Не удалось загрузить партнёрские задания.");
      }
    } catch (e: unknown) {
      setError(errorMessage(e, "Не удалось загрузить партнёрские задания."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedTasks = useMemo(() => tasks, [tasks]);

  const updateSingleCampaign = useCallback((campaign: PartnerTaskCard) => {
    setTasks((prev) => prev.map((item) => (item.id === campaign.id ? campaign : item)));
  }, []);

  const handleAction = useCallback(async (task: PartnerTaskCard) => {
    setWorkingId(task.id);
    setError("");
    try {
      if (!task.claim) {
        const start = await apiFetch<{ ok: boolean; campaign?: PartnerTaskCard; error?: string }>(`/quests/partner/${task.id}/start`, {
          method: "POST",
        });
        if (!start?.ok || !start.campaign) {
          setError(start?.error || "Не удалось запустить задание.");
          return;
        }
        updateSingleCampaign(start.campaign);
        // На десктопе не открываем сами: там переход по событию SDK может не
        // состояться, и карточка вместо этого показывает ссылку «Открыть».
        if (start.campaign.actionUrl && !isUnreliableTelegramPlatform()) {
          openTelegramDeepLink(start.campaign.actionUrl);
        }
        return;
      }

      if (!task.canVerify) {
        return;
      }

      const verify = await apiFetch<{ ok: boolean; campaign?: PartnerTaskCard; error?: string }>(`/quests/partner/${task.id}/verify`, {
        method: "POST",
      });
      if (verify?.campaign) {
        updateSingleCampaign(verify.campaign);
      }
      if (!verify?.ok) {
        setError(verify?.error || "Не удалось подтвердить выполнение.");
      }
    } catch (e: unknown) {
      setError(errorMessage(e, "Не удалось обработать партнёрское задание."));
    } finally {
      setWorkingId(null);
    }
  }, [updateSingleCampaign]);

  if (loading) {
    return <EmptyState text="Загрузка партнёрских заданий…" />;
  }

  if (!sortedTasks.length) {
    return <EmptyState text="Сейчас активных партнёрских заданий нет." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {error ? (
        <div
          style={{
            background: "rgba(255,149,0,0.12)",
            color: "#ff9500",
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          {error}
        </div>
      ) : null}

      {sortedTasks.map((task) => (
        <PartnerCard
          key={task.id}
          task={task}
          busy={workingId === task.id}
          nowMs={nowMs}
          onAction={handleAction}
        />
      ))}
    </div>
  );
}
