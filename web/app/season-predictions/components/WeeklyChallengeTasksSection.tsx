"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import { notifyClaimableChanged } from "@/app/components/ClaimableBadge";
import { AppIcon } from "@/app/components/ui/AppIcon";
import { pluralRu } from "@/lib/plural";
import { mergeWeeklyUnclaimedRewardsPage, shouldShowWeeklyUnclaimedArchive } from "./weeklyChallengeTasksUi";
import { deriveWeeklyGoals } from "../weeklyGoals";
import type {
  WeeklyChallengeTask,
  WeeklyChallengeTasksResponse,
  WeeklyChallengeTaskClaimResponse,
  WeeklyChallengeUnclaimedRewardsResponse,
  WeeklyTaskReward,
  WeeklyTaskStatus,
} from "../types";

const ACCENT = "var(--tg-button)";
const DONE = "#2ec060";

const STATUS_LABELS: Record<WeeklyTaskStatus, string> = {
  future: "Скоро",
  waiting_results: "Ждём результаты",
  void: "Отменён",
  in_progress: "В процессе",
  failed: "Не выполнено",
  completed: "Выполнено",
  claimable: "Можно забрать",
  claimed: "Получено",
};

const GROUP_TITLES: Record<WeeklyChallengeTask["group"], string> = {
  activity: "Участие",
  result: "Результат",
  series: "Серии",
};
const GROUP_ORDER: Array<WeeklyChallengeTask["group"]> = ["activity", "result", "series"];

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Russian plural for "награда", accusative (забрать 1 награду / 2-4 награды / 5+ наград).
function pluralAwards(n: number): string {
  return pluralRu(n, "награду", "награды", "наград");
}

// Russian plural for "награда", nominative (1 награда / 2-4 награды / 5+ наград).
function pluralAwardsNom(n: number): string {
  return pluralRu(n, "награда", "награды", "наград");
}

// "Забрана 1 награда." / "Забрано 2 награды." / "Забрано 5 наград."
function claimedPhrase(n: number): string {
  const verb = pluralRu(n, "Забрана", "Забрано", "Забрано");
  return `${verb} ${n} ${pluralAwardsNom(n)}`;
}

const BOOST_LABEL: Record<string, string> = { extra_joker: "джокер", double_chance: "двойной шанс" };

function formatReward(reward: WeeklyTaskReward | null): string | null {
  if (!reward) return null;
  const parts: string[] = [];
  if (reward.stars > 0) parts.push(`+${reward.stars} звёзд`);
  if (reward.balls > 0) parts.push(`+${reward.balls} мячей`);
  if (reward.case_count > 0 && reward.case_type) parts.push(`+${reward.case_count} кейс`);
  if ((reward.lucky_tokens || 0) > 0) parts.push(`+${reward.lucky_tokens} жетон`);
  if ((reward.boost_count || 0) > 0 && reward.boost_type) parts.push(`+${reward.boost_count} ${BOOST_LABEL[reward.boost_type] || "буст"}`);
  return parts.length ? parts.join("  ") : null;
}

function renderReward(reward: WeeklyTaskReward | null): ReactNode {
  if (!reward) return null;
  const parts: ReactNode[] = [];
  if (reward.stars > 0) parts.push(<RewardIconPart key="stars" icon="game_star" value={`+${reward.stars}`} />);
  if (reward.balls > 0) parts.push(<RewardIconPart key="balls" icon="ball" value={`+${reward.balls}`} />);
  if (reward.case_count > 0 && reward.case_type) parts.push(<RewardIconPart key="case" icon={reward.case_type === "premium" ? "case_premium" : "case_basic"} value={`+${reward.case_count}`} />);
  if ((reward.lucky_tokens || 0) > 0) parts.push(<RewardIconPart key="lucky_token" icon="lucky_token" value={`+${reward.lucky_tokens}`} />);
  if ((reward.boost_count || 0) > 0 && reward.boost_type) parts.push(<RewardIconPart key="boost" icon={reward.boost_type === "double_chance" ? "double_chance" : "joker"} value={`+${reward.boost_count}`} />);
  return parts.length ? parts : null;
}

function RewardIconPart({ icon, value }: { icon: "game_star" | "ball" | "case_basic" | "case_premium" | "lucky_token" | "joker" | "double_chance"; value: string }) {
  return (
    <span style={rewardIconPartStyle}>
      <span>{value}</span>
      <AppIcon name={icon} size={14} />
    </span>
  );
}

export function WeeklyChallengeTasksSection({
  onOpenWeeklyChallenge,
}: {
  onOpenWeeklyChallenge?: () => void;
}) {
  const [data, setData] = useState<WeeklyChallengeTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [unclaimed, setUnclaimed] = useState<WeeklyChallengeUnclaimedRewardsResponse | null>(null);
  const [unclaimedError, setUnclaimedError] = useState("");
  const [unclaimedLoadingMore, setUnclaimedLoadingMore] = useState(false);

  const loadCurrent = useCallback(async () => {
    const res = await apiFetch<WeeklyChallengeTasksResponse>("/weekly-challenge/tasks");
    setData(res);
  }, []);

  const loadUnclaimed = useCallback(async (cursor?: string | null) => {
    try {
      const url = cursor
        ? `/weekly-challenge/tasks/unclaimed?cursor=${encodeURIComponent(cursor)}`
        : "/weekly-challenge/tasks/unclaimed";
      const res = await apiFetch<WeeklyChallengeUnclaimedRewardsResponse>(url);
      setUnclaimed((prev) => mergeWeeklyUnclaimedRewardsPage(prev, res, cursor));
      setUnclaimedError("");
    } catch (e: unknown) {
      setUnclaimedError(getErrorMessage(e, "Не удалось загрузить незабранные награды"));
    }
  }, []);

  const loadMoreUnclaimed = useCallback(async () => {
    if (!unclaimed?.next_cursor || unclaimedLoadingMore) return;
    setUnclaimedLoadingMore(true);
    try {
      await loadUnclaimed(unclaimed.next_cursor);
    } finally {
      setUnclaimedLoadingMore(false);
    }
  }, [loadUnclaimed, unclaimed?.next_cursor, unclaimedLoadingMore]);

  useEffect(() => {
    let active = true;
    loadCurrent()
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e, "Не удалось загрузить задания"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void loadUnclaimed();
    return () => {
      active = false;
    };
  }, [loadCurrent, loadUnclaimed]);

  const grouped = useMemo(() => {
    // W5: hide deferred (series) tasks so users never see an unreachable goal.
    const tasks = (data?.tasks || []).filter((t) => !t.deferred);
    return GROUP_ORDER
      .map((group) => ({ group, tasks: tasks.filter((t) => t.group === group) }))
      .filter((g) => g.tasks.length > 0);
  }, [data?.tasks]);

  // Everything claimable on screen: current challenge first, then the archive
  // (only the pages already loaded — «Показать ещё» extends the queue).
  const claimableQueue = useMemo(() => {
    const queue: Array<{ task: WeeklyChallengeTask; challengeId: number | null }> = [];
    for (const task of data?.tasks || []) {
      if (task.claimable) queue.push({ task, challengeId: data?.active_challenge?.id ?? null });
    }
    for (const item of unclaimed?.items || []) {
      for (const task of item.tasks) {
        if (task.claimable) queue.push({ task, challengeId: item.challenge.id });
      }
    }
    return queue;
  }, [data?.tasks, data?.active_challenge?.id, unclaimed?.items]);
  const totalClaimable = claimableQueue.length;

  // Map the 3 backend reward tasks onto 5 user-facing goals (V2). Pure; no schema change.
  const goals = useMemo(() => deriveWeeklyGoals(data?.tasks || [], data?.progress), [data?.tasks, data?.progress]);

  // One claim request + local task patch. Callers own notices/refetch so the
  // bulk claim can run the whole queue before touching the network again.
  async function claimOne(task: WeeklyChallengeTask, challengeId?: number | null): Promise<WeeklyChallengeTaskClaimResponse> {
    const res = await apiFetch<WeeklyChallengeTaskClaimResponse>(`/weekly-challenge/tasks/${task.key}/claim`, {
      method: "POST",
      body: JSON.stringify({ challenge_id: challengeId ?? data?.active_challenge?.id ?? null }),
    });
    if (res.ok && res.task) {
      const updated = res.task;
      if (!challengeId || challengeId === data?.active_challenge?.id) {
        setData((prev) => prev ? { ...prev, tasks: prev.tasks.map((t) => (t.key === updated.key ? updated : t)) } : prev);
      }
    }
    return res;
  }

  async function claim(task: WeeklyChallengeTask, challengeId?: number | null) {
    if (!task.claimable || claiming || claimingAll) return;
    const claimKey = `${challengeId ?? data?.active_challenge?.id ?? "current"}:${task.key}`;
    setClaiming(claimKey);
    setNotice("");
    try {
      const res = await claimOne(task, challengeId);
      if (res.ok && res.task) {
        const rewardText = formatReward(res.reward ?? task.reward);
        setNotice(res.already_claimed ? "Награда уже была получена." : `Награда получена${rewardText ? `: ${rewardText}` : ""}.`);
        await Promise.all([loadCurrent(), loadUnclaimed()]);
        notifyClaimableChanged(); // refresh tab/menu badges
      } else {
        setNotice(res.error || "Не удалось забрать награду.");
      }
    } catch (e: unknown) {
      setNotice(getErrorMessage(e, "Не удалось забрать награду."));
    } finally {
      setClaiming(null);
    }
  }

  // Sequential on purpose: the claim endpoint writes to the economy ledger, so
  // fan-out would race. Failures stop nothing — the rest of the queue still runs.
  async function claimAll() {
    if (claiming || claimingAll || totalClaimable === 0) return;
    setClaimingAll(true);
    setNotice("");
    let done = 0;
    let failed = 0;
    try {
      for (const { task, challengeId } of claimableQueue) {
        try {
          const res = await claimOne(task, challengeId);
          if (res.ok && res.task) done += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await Promise.all([loadCurrent(), loadUnclaimed()]);
      notifyClaimableChanged();
      setNotice(
        done > 0
          ? `${claimedPhrase(done)}${failed > 0 ? `, не удалось: ${failed}.` : "."}`
          : "Не удалось забрать награды.",
      );
    } finally {
      setClaimingAll(false);
    }
  }

  function handleCta(task: WeeklyChallengeTask) {
    if (task.status === "claimable") {
      void claim(task, data?.active_challenge?.id ?? null);
      return;
    }
    if (task.status === "future" || task.status === "waiting_results") {
      setNotice(task.future_reason || "Задание откроется позже.");
      return;
    }
    // Final states have no action.
    if (task.status === "claimed" || task.status === "completed" || task.status === "failed" || task.status === "void") return;
    // in_progress → go participate.
    onOpenWeeklyChallenge?.();
  }

  if (loading) {
    return <section style={stateCardStyle}>Загрузка заданий…</section>;
  }
  if (error || !data) {
    return (
      <section style={stateCardStyle}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "var(--tg-text)" }}>Задания недоступны</div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.45 }}>
          {error || "Попробуй открыть раздел позже."}
        </div>
      </section>
    );
  }

  return (
    <section data-testid="weekly-tasks-section" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div data-testid="weekly-tasks-hero" style={heroStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={heroTitleStyle}>{data.active_challenge?.title || "Вызов недели"}</h2>
            <p data-testid="weekly-tasks-summary" style={heroTextStyle}>
              {goals.isV2
                ? `Выполни ${goals.goalsTotal} ${pluralRu(goals.goalsTotal, "задание", "задания", "заданий")} и получи до ${goals.rewardsTotal} ${pluralAwards(goals.rewardsTotal)}.`
                : "Награды за участие, подтверждение и результат."}
            </p>
          </div>
          <div data-testid="weekly-tasks-progress" style={progressRingStyle}>
            <span style={{ fontSize: 16, fontWeight: 950, color: "var(--tg-text)" }}>{goals.goalsDone}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--tg-hint)" }}>/{goals.goalsTotal}</span>
          </div>
        </div>
        <div data-testid="weekly-tasks-progress-bar" style={heroProgressTrackStyle}>
          <div style={heroProgressFillStyle(goals.goalsDone, goals.goalsTotal)} />
        </div>
        {goals.isV2 && (
          <div data-testid="weekly-tasks-goals" style={{ marginTop: 8, display: "grid", gap: 3 }}>
            {goals.goals.map((g) => (
              <div key={g.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 750 }}>
                <span aria-hidden style={{ color: g.done ? DONE : "var(--tg-hint)", fontWeight: 900 }}>{g.done ? "✓" : "○"}</span>
                <span style={{ color: g.done ? "var(--tg-text)" : "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))" }}>{g.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!data.active_challenge && (
        <div style={weeklyHintStyle}>Активного Вызова недели сейчас нет. Задания и награды появятся вместе с новым вызовом.</div>
      )}

      {totalClaimable > 0 && (
        <div style={claimAllRowStyle}>
          <span style={claimAllTextStyle}>Можно забрать {totalClaimable} {pluralAwards(totalClaimable)}.</span>
          <Pressable
            data-testid="weekly-tasks-claim-all"
            haptic="medium"
            pressedScale={0.98}
            onClick={() => void claimAll()}
            disabled={claimingAll || !!claiming}
            style={claimAllButtonStyle}
          >
            {claimingAll ? "Забираем…" : "Забрать все"}
          </Pressable>
        </div>
      )}

      {notice && <div style={noticeStyle}>{notice}</div>}

      {unclaimedError && <div style={noticeStyle}>{unclaimedError}</div>}

      {unclaimed && shouldShowWeeklyUnclaimedArchive(unclaimed) && (
        <div data-testid="weekly-tasks-archive" style={subsectionCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={eyebrowStyle}>Архив</div>
              <h3 style={subsectionTitleStyle}>Незабранные награды</h3>
            </div>
            <span style={archiveCountStyle}>{unclaimed.total_claimable}</span>
          </div>
          <div style={archiveListStyle}>
            {unclaimed.items.map((item) => (
              <div key={item.challenge.id} style={archiveChallengeStyle}>
                <div style={archiveHeaderStyle}>
                  <div style={{ minWidth: 0 }}>
                    <div style={archiveTitleStyle}>{item.challenge.title || item.challenge.code || `Вызов #${item.challenge.id}`}</div>
                    {item.challenge.deadline_at != null && (
                      <div style={archiveMetaStyle}>{new Date(Number(item.challenge.deadline_at) * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" })}</div>
                    )}
                  </div>
                  <span style={archiveMetaStyle}>{item.claimable_count} {pluralAwardsNom(item.claimable_count)}</span>
                </div>
                <div style={taskListStyle}>
                  {item.tasks.map((task) => (
                  <WeeklyTaskCard
                      key={`${item.challenge.id}:${task.key}`}
                      challengeId={item.challenge.id}
                      task={task}
                      claiming={claiming === `${item.challenge.id}:${task.key}`}
                      onCta={() => claim(task, item.challenge.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {unclaimed.next_cursor && (
            <Pressable
              haptic="selection"
              pressedScale={0.99}
              onClick={() => void loadMoreUnclaimed()}
              disabled={unclaimedLoadingMore}
              style={archiveMoreButtonStyle}
            >
              {unclaimedLoadingMore ? "…" : "Показать ещё"}
            </Pressable>
          )}
        </div>
      )}

      {grouped.map(({ group, tasks }) => (
        <div key={group} style={subsectionCardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={eyebrowStyle}>{group === "result" ? "После результатов" : group === "series" ? "Серии сезона" : "Активность"}</div>
              <h3 style={subsectionTitleStyle}>{GROUP_TITLES[group]}</h3>
            </div>
          </div>
          <div style={taskListStyle}>
            {tasks.map((task) => (
                <WeeklyTaskCard
                key={task.key}
                challengeId={data.active_challenge?.id ?? null}
                task={task}
                claiming={claiming === `${data.active_challenge?.id ?? "current"}:${task.key}`}
                onCta={() => handleCta(task)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ctaLabel(task: WeeklyChallengeTask): string {
  switch (task.status) {
    case "claimable": return "Забрать";
    case "claimed": return "Получено";
    case "completed": return "Выполнено";
    case "failed": return "Не выполнено";
    case "waiting_results": return "Ждём";
    case "void": return "Отменён";
    case "future": return "Скоро";
    default: return "Перейти";
  }
}

function WeeklyTaskCard({ task, challengeId, claiming, onCta }: { task: WeeklyChallengeTask; challengeId?: number | null; claiming: boolean; onCta: () => void }) {
  const pct = task.progress.target > 0
    ? Math.max(0, Math.min(100, Math.round((task.progress.current / task.progress.target) * 100)))
    : 0;
  const reward = renderReward(task.reward);
  const interactive = task.status === "claimable" || task.status === "in_progress" || task.status === "future" || task.status === "waiting_results";
  return (
    <Pressable
      data-testid={`weekly-task-card-${task.key}`}
      data-challenge-id={challengeId ?? ""}
      data-status={task.status}
      haptic="selection"
      pressedScale={interactive ? 0.99 : 1}
      onClick={onCta}
      style={taskCardStyle(task.status)}
      aria-label={`${task.title}. ${ctaLabel(task)}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h4 style={taskTitleStyle}>{task.title}</h4>
          <p style={taskDescriptionStyle}>{task.description}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span data-testid={`weekly-task-status-${task.key}`} style={statusPillStyle(task.status)}>{STATUS_LABELS[task.status]}</span>
          {reward && <span data-testid={`weekly-task-reward-${task.key}`} style={rewardPillStyle(task.status)}>{reward}</span>}
        </div>
      </div>

      <div style={progressRowStyle}>
        <div style={progressTrackStyle}>
          <div style={progressFillStyle(task.status, pct)} />
        </div>
        <div style={progressMetaStyle}>
          <span data-testid={`weekly-task-progress-${task.key}`} style={progressTextStyle}>{task.progress.current}/{task.progress.target}</span>
          <span data-testid={`weekly-task-cta-${task.key}`} style={ctaStyle(task.status)}>{claiming ? "…" : ctaLabel(task)}</span>
        </div>
      </div>

      {Array.isArray(task.steps) && task.steps.length > 0 && (
        <div data-testid={`weekly-task-steps-${task.key}`} style={stepsStyle}>
          {task.steps.map((step) => (
            <span key={step.key} style={stepPillStyle(step.completed)}>
              {step.completed ? "✓" : "•"} {step.title}
            </span>
          ))}
        </div>
      )}

      {(task.status === "future" || task.status === "waiting_results") && task.future_reason && (
        <div style={futureTextStyle}>{task.future_reason}</div>
      )}
    </Pressable>
  );
}

const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))";
const CARD_SHADOW = "0 7px 18px color-mix(in srgb, var(--tg-text) 9%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)";
const SOFT_BORDER = "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)";

const stateCardStyle = {
  padding: 18,
  borderRadius: 18,
  background: CARD_SURFACE,
  border: SOFT_BORDER,
  boxShadow: CARD_SHADOW,
  color: "var(--tg-hint)",
  textAlign: "center",
  fontSize: 13,
  fontWeight: 800,
} as const;

const heroStyle = {
  borderRadius: 16,
  padding: "9px 11px",
  background: CARD_SURFACE,
  border: SOFT_BORDER,
  boxShadow: CARD_SHADOW,
  color: "var(--tg-text)",
} as const;

const weeklyHintStyle = {
  borderRadius: 12,
  padding: "9px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.45,
} as const;

const eyebrowStyle = {
  fontSize: 10,
  fontWeight: 850,
  color: ACCENT,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
} as const;

const heroTitleStyle = {
  margin: 0,
  fontSize: 17,
  fontWeight: 950,
  lineHeight: 1.1,
  color: "var(--tg-text)",
} as const;

const heroTextStyle = {
  margin: "3px 0 0",
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.45,
  color: "color-mix(in srgb, var(--tg-text) 56%, var(--tg-hint))",
} as const;

const progressRingStyle = {
  flexShrink: 0,
  minWidth: 54,
  height: 30,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
  border: SOFT_BORDER,
} as const;

const heroProgressTrackStyle = {
  marginTop: 7,
  height: 4,
  borderRadius: 999,
  overflow: "hidden",
  background: "color-mix(in srgb, var(--tg-hint) 11%, transparent)",
} as const;

function heroProgressFillStyle(current: number, target: number) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((current / target) * 100))) : 0;
  return { width: `${pct}%`, height: "100%", borderRadius: 999, background: ACCENT } as const;
}

const subsectionCardStyle = {
  borderRadius: 16,
  padding: "9px",
  background: CARD_SURFACE,
  border: SOFT_BORDER,
  boxShadow: CARD_SHADOW,
} as const;

const subsectionTitleStyle = {
  margin: "2px 0 0",
  fontSize: 14,
  fontWeight: 950,
  color: "var(--tg-text)",
} as const;

const taskListStyle = {
  marginTop: 7,
  display: "flex",
  flexDirection: "column",
  gap: 5,
} as const;

const archiveCountStyle = {
  flexShrink: 0,
  minWidth: 28,
  height: 24,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 8px",
  background: `color-mix(in srgb, ${ACCENT} 13%, var(--tg-bg))`,
  border: `1px solid color-mix(in srgb, ${ACCENT} 24%, transparent)`,
  color: ACCENT,
  fontSize: 12,
  fontWeight: 950,
} as const;

const archiveListStyle = {
  marginTop: 8,
  display: "flex",
  flexDirection: "column",
  gap: 8,
} as const;

const archiveChallengeStyle = {
  borderRadius: 13,
  padding: 8,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, var(--tg-bg))",
  border: SOFT_BORDER,
} as const;

const archiveHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 8,
} as const;

const archiveTitleStyle = {
  color: "var(--tg-text)",
  fontSize: 12,
  fontWeight: 900,
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const archiveMetaStyle = {
  color: "var(--tg-hint)",
  fontSize: 10.5,
  fontWeight: 800,
  whiteSpace: "nowrap",
} as const;

const archiveMoreButtonStyle = {
  width: "100%",
  marginTop: 8,
  minHeight: 34,
  borderRadius: 12,
  border: SOFT_BORDER,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  color: ACCENT,
  fontSize: 12,
  fontWeight: 900,
  textAlign: "center" as const,
};

function taskCardStyle(status: WeeklyTaskStatus) {
  return {
    width: "100%",
    minHeight: 64,
    borderRadius: 13,
    padding: status === "future" || status === "waiting_results" || status === "void" ? "7px 9px" : "8px 10px",
    background: status === "future" || status === "void"
      ? "color-mix(in srgb, var(--tg-secondary-bg) 58%, var(--tg-bg))"
      : "color-mix(in srgb, var(--tg-secondary-bg) 76%, var(--tg-bg))",
    border: status === "claimable"
      ? `1px solid color-mix(in srgb, ${ACCENT} 40%, var(--tg-hint))`
      : status === "claimed" || status === "completed"
        ? "1px solid color-mix(in srgb, #34c759 22%, var(--tg-hint))"
        : status === "failed"
          ? "1px solid color-mix(in srgb, #d98a1a 22%, var(--tg-hint))"
          : status === "void"
            ? "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)"
            : SOFT_BORDER,
    opacity: status === "future" || status === "void" ? 0.72 : 1,
    cursor: "pointer",
    textAlign: "left" as const,
  } as const;
}

const taskTitleStyle = {
  margin: 0,
  fontSize: 12,
  fontWeight: 920,
  lineHeight: 1.2,
  color: "var(--tg-text)",
} as const;

const taskDescriptionStyle = {
  margin: "2px 0 0",
  fontSize: 11,
  fontWeight: 650,
  lineHeight: 1.28,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
} as const;

const FAILED = "color-mix(in srgb, #d98a1a 82%, var(--tg-text))";

function statusColor(status: WeeklyTaskStatus) {
  if (status === "claimed" || status === "completed") return DONE;
  if (status === "claimable") return ACCENT;
  if (status === "failed") return FAILED;
  if (status === "future" || status === "waiting_results" || status === "void") return "var(--tg-hint)";
  return "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))";
}

function statusPillStyle(status: WeeklyTaskStatus) {
  return {
    minHeight: 18,
    borderRadius: 999,
    padding: "0 6px",
    display: "inline-flex",
    alignItems: "center",
    background: status === "claimed" || status === "completed"
      ? "color-mix(in srgb, #34c759 12%, var(--tg-bg))"
      : status === "claimable"
        ? `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`
        : status === "failed"
          ? "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))"
          : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color: statusColor(status),
    border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    fontSize: 10,
    fontWeight: 850,
    whiteSpace: "nowrap" as const,
  } as const;
}

function rewardPillStyle(status: WeeklyTaskStatus) {
  return {
    minHeight: 17,
    borderRadius: 999,
    padding: "0 6px",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "color-mix(in srgb, #ffb020 14%, var(--tg-bg))",
    border: "1px solid color-mix(in srgb, #ffb020 22%, transparent)",
    color: status === "future" || status === "waiting_results" || status === "void" ? "var(--tg-hint)" : "color-mix(in srgb, #ffb020 82%, var(--tg-text))",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap" as const,
    opacity: status === "future" || status === "waiting_results" || status === "void" ? 0.7 : 1,
  } as const;
}

const rewardIconPartStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
} as const;

const progressRowStyle = {
  marginTop: 5,
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
} as const;

const progressTrackStyle = {
  height: 4,
  borderRadius: 999,
  overflow: "hidden",
  background: "color-mix(in srgb, var(--tg-hint) 12%, transparent)",
} as const;

function progressFillStyle(status: WeeklyTaskStatus, pct: number) {
  return {
    width: `${pct}%`,
    height: "100%",
    borderRadius: 999,
    background: status === "claimed" || status === "completed" ? DONE : status === "failed" ? "#d98a1a" : status === "future" || status === "waiting_results" || status === "void" ? "var(--tg-hint)" : ACCENT,
    transition: "width 180ms ease",
  } as const;
}

const progressTextStyle = {
  fontSize: 11,
  fontWeight: 850,
  color: "var(--tg-hint)",
} as const;

const progressMetaStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
} as const;

function ctaStyle(status: WeeklyTaskStatus) {
  const muted = status === "future" || status === "waiting_results" || status === "void" || status === "claimed" || status === "completed" || status === "failed";
  return {
    height: 20,
    borderRadius: 999,
    padding: "0 8px",
    display: "inline-flex",
    alignItems: "center",
    background: status === "claimable"
      ? ACCENT
      : muted
        ? "color-mix(in srgb, var(--tg-hint) 10%, transparent)"
        : `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`,
    border: status === "claimable"
      ? "1px solid transparent"
      : muted
        ? "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)"
        : `1px solid color-mix(in srgb, ${ACCENT} 26%, transparent)`,
    color: status === "claimable"
      ? "var(--tg-button-text)"
      : muted
        ? "var(--tg-hint)"
        : `color-mix(in srgb, ${ACCENT} 78%, var(--tg-text))`,
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap" as const,
  } as const;
}

const futureTextStyle = {
  marginTop: 4,
  fontSize: 11,
  fontWeight: 750,
  color: "var(--tg-hint)",
} as const;

const stepsStyle = {
  marginTop: 6,
  display: "flex",
  flexWrap: "wrap",
  gap: 5,
} as const;

function stepPillStyle(completed: boolean) {
  return {
    minHeight: 18,
    borderRadius: 999,
    padding: "0 7px",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: completed
      ? "color-mix(in srgb, #2ec060 12%, var(--tg-bg))"
      : "color-mix(in srgb, var(--tg-hint) 9%, transparent)",
    border: completed
      ? "1px solid color-mix(in srgb, #2ec060 20%, transparent)"
      : "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color: completed ? "color-mix(in srgb, #2ec060 82%, var(--tg-text))" : "var(--tg-hint)",
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: "nowrap" as const,
  } as const;
}

const noticeStyle = {
  minHeight: 30,
  borderRadius: 12,
  padding: "7px 9px",
  background: "color-mix(in srgb, #2ec060 14%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #2ec060 22%, transparent)",
  color: "color-mix(in srgb, #2ec060 82%, var(--tg-text))",
  fontSize: 12,
  fontWeight: 800,
} as const;

const claimAllRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderRadius: 12,
  padding: "8px 9px 8px 11px",
  background: `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`,
  border: `1px solid color-mix(in srgb, ${ACCENT} 24%, transparent)`,
} as const;

const claimAllTextStyle = {
  minWidth: 0,
  color: `color-mix(in srgb, ${ACCENT} 80%, var(--tg-text))`,
  fontSize: 12,
  fontWeight: 850,
} as const;

const claimAllButtonStyle = {
  flexShrink: 0,
  minHeight: 30,
  borderRadius: 999,
  padding: "0 14px",
  border: "1px solid transparent",
  background: ACCENT,
  color: "var(--tg-button-text)",
  fontSize: 12,
  fontWeight: 900,
  whiteSpace: "nowrap" as const,
} as const;
