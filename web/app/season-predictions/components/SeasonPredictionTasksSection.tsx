"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import { SegmentedControl } from "@/app/components/ui/SegmentedControl";
import { AppIcon } from "@/app/components/ui/AppIcon";
import { notifyClaimableChanged, CountBadge } from "@/app/components/ClaimableBadge";
import type {
  EuropeanCupCode,
  SeasonPredictionTask,
  SeasonPredictionTaskClaimableSummary,
  SeasonPredictionTaskClaimResponse,
  SeasonPredictionTaskNavigation,
  SeasonPredictionTaskReward,
  SeasonPredictionTaskSection,
  SeasonPredictionTaskSubsection,
  SeasonPredictionTasksResponse,
  SeasonPredictionTournament,
  TopLeagueCode,
} from "../types";

// E10.2b: claimable counts per level come from the backend `summaries` map (single
// source of truth, tested in api-worker). Tiny lookups keep the JSX readable.
function sectionClaimable(summary: SeasonPredictionTaskClaimableSummary | undefined, sectionId: string): number {
  return summary?.sections[sectionId] ?? 0;
}
function subsectionClaimable(summary: SeasonPredictionTaskClaimableSummary | undefined, sectionId: string, subId: string): number {
  // The "Все" chip represents the whole section; per-cup/league chips are exact.
  if (subId === "all") return sectionClaimable(summary, sectionId);
  return summary?.subsections[`${sectionId}:${subId}`] ?? 0;
}
function phaseClaimable(summary: SeasonPredictionTaskClaimableSummary | undefined, sectionId: string, subId: string, phase: string): number {
  return summary?.phases[`${sectionId}:${subId}:${phase}`] ?? 0;
}

// Sort: surface actionable rewards first (spec §5) — claimable → in_progress/
// available → completed(no claim) → claimed → future → failed. Mirrors the backend
// seasonTaskSortRank (tested in api-worker). Future is normally in its own block.
function taskSortPriority(task: SeasonPredictionTask): number {
  if (task.claim_status === "claimable") return 0;
  if (task.status === "in_progress" || task.status === "available") return 1;
  if (task.status === "completed" && task.claim_status !== "claimed") return 2;
  if (task.claim_status === "claimed") return 3;
  if (task.status === "future") return 4;
  return 5; // failed
}

// E10.2: compact reward label for text-only notices. null when the task carries no reward.
function formatTaskReward(reward: SeasonPredictionTaskReward | null | undefined): string | null {
  if (!reward) return null;
  const parts: string[] = [];
  if (reward.balls > 0) parts.push(`+${reward.balls} мячей`);
  if (reward.stars > 0) parts.push(`+${reward.stars} звёзд`);
  if (reward.case_count > 0 && reward.case_type) parts.push(`+${reward.case_count} кейс`);
  if ((reward.lucky_tokens || 0) > 0) parts.push(`+${reward.lucky_tokens} жетон`);
  return parts.length ? parts.join("  ") : null;
}

function renderTaskReward(reward: SeasonPredictionTaskReward | null | undefined): ReactNode {
  if (!reward) return null;
  const parts: ReactNode[] = [];
  if (reward.balls > 0) parts.push(<RewardIconPart key="balls" icon="ball" value={`+${reward.balls}`} />);
  if (reward.stars > 0) parts.push(<RewardIconPart key="stars" icon="game_star" value={`+${reward.stars}`} />);
  if (reward.case_count > 0 && reward.case_type) parts.push(<RewardIconPart key="case" icon={reward.case_type === "premium" ? "case_premium" : "case_basic"} value={`+${reward.case_count}`} />);
  if ((reward.lucky_tokens || 0) > 0) parts.push(<RewardIconPart key="lucky_token" icon="lucky_token" value={`+${reward.lucky_tokens}`} />);
  return parts.length ? parts : null;
}

function RewardIconPart({ icon, value }: { icon: "ball" | "game_star" | "case_basic" | "case_premium" | "lucky_token"; value: string }) {
  return (
    <span style={rewardIconPartStyle}>
      <span>{value}</span>
      <AppIcon name={icon} size={14} />
    </span>
  );
}

// Replace one task (by id) inside the nested sections→subsections tree.
function replaceTask(data: SeasonPredictionTasksResponse, updated: SeasonPredictionTask): SeasonPredictionTasksResponse {
  return {
    ...data,
    sections: data.sections.map((section) => ({
      ...section,
      subsections: section.subsections.map((sub) => ({
        ...sub,
        tasks: sub.tasks.map((task) => (task.id === updated.id ? updated : task)),
      })),
    })),
  };
}

// Native Telegram accent (was a hardcoded orange) so the Сезон / Вызов task
// cards match the rest of the «Задания» section in light and dark themes.
const ACCENT = "var(--tg-button)";
const DONE = "#2ec060";
const MISS = "#d98a1a"; // calm muted amber for failed (final negative) tasks

const STATUS_LABELS: Record<SeasonPredictionTask["status"], string> = {
  available: "Доступно",
  in_progress: "В процессе",
  completed: "Выполнено",
  future: "Скоро",
  failed: "Не выполнено",
};

type TaskFilter = "all" | "in_progress" | "completed" | "future";

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "in_progress", label: "Активные" },
  { id: "completed", label: "Готово" },
  { id: "future", label: "Скоро" },
];

// Short codes for the section tabs and league/cup chips (compact selector).
const SECTION_SHORT: Record<string, string> = { start: "Старт", top5: "Топ-5", europe: "ЕК", weekly: "Вызов" };
const SUBSECTION_SHORT: Record<string, string> = {
  all: "Все",
  PL: "АПЛ", PD: "ЛЛ", SA: "СА", BL1: "БЛ", FL1: "Л1",
  UCL: "ЛЧ", UEL: "ЛЕ", UECL: "ЛК",
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// Which task sections belong to each general-tasks tab. "weekly" → Вызов недели,
// everything else (start/top5/europe) → Прогнозы сезона.
type TasksMode = "season" | "weekly";
// Subsection keys the admin visibility settings use for the season task groups
// (third level: «Задания» → «Прогнозы сезона» → group). Ids mirror the section
// ids the tasks endpoint returns. The "weekly" section belongs to the «Вызов
// недели» tab and is gated one level up, so it has no key here.
export const SEASON_TASK_SECTION_SUBSECTION_KEY: Record<string, string> = {
  start: "tasks.season.start",
  top5: "tasks.season.top5",
  europe: "tasks.season.europe",
  ballon_dor: "tasks.season.ballon_dor",
};
export const SEASON_TASK_SECTION_SUBSECTION_KEYS = Object.values(SEASON_TASK_SECTION_SUBSECTION_KEY);

function sectionMatchesMode(sectionId: string, mode?: TasksMode): boolean {
  if (!mode) return true;
  return mode === "weekly" ? sectionId === "weekly" : sectionId !== "weekly";
}

const MODE_HERO: Record<TasksMode, { title: string; text: string }> = {
  season: { title: "Задания сезона", text: "Таблицы топ‑5 лиг, еврокубки и сезонный прогресс." },
  weekly: { title: "Вызов недели", text: "Выполняются за участие в еженедельном Вызове недели." },
};

export function SeasonPredictionTasksSection({
  topLeagues,
  europeanCups,
  onNavigate,
  mode,
  initialSectionId,
  initialSubsectionId,
  onBalanceChange,
  hiddenSubsections,
}: {
  topLeagues: SeasonPredictionTournament[];
  europeanCups: SeasonPredictionTournament[];
  onNavigate: (action: SeasonPredictionTaskNavigation) => void;
  mode?: TasksMode;
  // Deep-link: preselect a section (e.g. "europe"/"top5") + subsection (cup/league code).
  initialSectionId?: string;
  initialSubsectionId?: string;
  // E10.2 fix: push the fresh balls balance to the app header after a claim.
  onBalanceChange?: (balls: number) => void;
  // Task groups hidden by an admin (tasks.season.start / .top5 / .europe).
  hiddenSubsections?: string[];
}) {
  const [data, setData] = useState<SeasonPredictionTasksResponse | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<SeasonPredictionTaskSection["id"]>("start");
  const [activeSubsectionId, setActiveSubsectionId] = useState<string>("start");
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [futureExpanded, setFutureExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);

  useEffect(() => {
    let active = true;
    apiFetch<SeasonPredictionTasksResponse>("/season-predictions/tasks")
      .then((res) => {
        if (!active) return;
        setData(res);
        // Honour a deep-link preselection when valid; otherwise first visible section.
        const wantedSection = initialSectionId
          ? res.sections.find((s) => s.id === initialSectionId && sectionMatchesMode(s.id, mode))
          : null;
        const firstSection = wantedSection || res.sections.find((s) => sectionMatchesMode(s.id, mode)) || res.sections[0];
        if (firstSection) {
          setActiveSectionId(firstSection.id);
          const wantedSub = initialSubsectionId
            ? firstSection.subsections.find((ss) => ss.id === initialSubsectionId)
            : null;
          setActiveSubsectionId(wantedSub?.id || firstSection.subsections[0]?.id || firstSection.id);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(getErrorMessage(e, "Не удалось загрузить задания"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, initialSectionId, initialSubsectionId]);

  const hiddenKey = (hiddenSubsections || []).join(",");
  const visibleSections = useMemo(() => {
    return (data?.sections || [])
      .filter((section) => sectionMatchesMode(section.id, mode))
      // A group closed by an admin drops out of the switch, its progress and its
      // claimable counters — as if the season had no such group.
      .filter((section) => {
        const key = SEASON_TASK_SECTION_SUBSECTION_KEY[section.id];
        return !key || !hiddenSubsections?.includes(key);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sections, mode, hiddenKey]);
  const modeProgress = useMemo(() => {
    return visibleSections.reduce(
      (acc, section) => ({
        current: acc.current + Number(section.progress?.current || 0),
        target: acc.target + Number(section.progress?.target || 0),
      }),
      { current: 0, target: 0 },
    );
  }, [visibleSections]);
  // Every claimable task in the currently visible sections. Deduped by id: the
  // eurocups "Все" subsection repeats tasks that also live under each cup.
  const claimableTasks = useMemo(() => {
    const seen = new Set<string>();
    const list: SeasonPredictionTask[] = [];
    for (const section of visibleSections) {
      for (const subsection of section.subsections) {
        for (const task of subsection.tasks) {
          if (task.claim_status !== "claimable" || seen.has(task.id)) continue;
          seen.add(task.id);
          list.push(task);
        }
      }
    }
    return list;
  }, [visibleSections]);
  const activeSection = useMemo(() => {
    return visibleSections.find((section) => section.id === activeSectionId) || visibleSections[0] || null;
  }, [activeSectionId, visibleSections]);
  const activeSubsection = useMemo(() => {
    return activeSection?.subsections.find((subsection) => subsection.id === activeSubsectionId) || activeSection?.subsections[0] || null;
  }, [activeSection, activeSubsectionId]);

  function selectSection(section: SeasonPredictionTaskSection) {
    setActiveSectionId(section.id);
    setActiveSubsectionId(section.subsections[0]?.id || section.id);
    setFilter("all");
    setFutureExpanded(false);
    setNotice("");
  }

  function selectSubsection(subsectionId: string) {
    setActiveSubsectionId(subsectionId);
    setFilter("all");
    setFutureExpanded(false);
    setNotice("");
  }

  function navigateTask(task: SeasonPredictionTask) {
    // Claimable reward → claim instead of navigating.
    if (task.claim_status === "claimable") {
      void claimTask(task);
      return;
    }
    if (task.status === "future") {
      setNotice("Задание откроется позже.");
      return;
    }
    const action = resolveTaskNavigation(task, topLeagues, europeanCups);
    if (!action) {
      setNotice("Для этого задания пока нет быстрого перехода.");
      return;
    }
    setNotice("");
    onNavigate(action);
  }

  // Re-pull the whole task tree so reward statuses, progress AND the claimable
  // `summaries` (which drive every badge) stay consistent after a claim.
  async function refetchTasks() {
    try {
      const res = await apiFetch<SeasonPredictionTasksResponse>("/season-predictions/tasks");
      setData(res);
    } catch { /* keep the optimistic local state on a transient refetch error */ }
  }

  async function claimTask(task: SeasonPredictionTask) {
    if (task.claim_status !== "claimable" || claimingId || claimingAll) return;
    setClaimingId(task.id);
    setNotice("");
    try {
      const res = await apiFetch<SeasonPredictionTaskClaimResponse>(`/season-predictions/tasks/${task.id}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (res.ok && res.task) {
        // Optimistic local flip, then refetch to refresh summaries/progress.
        setData((prev) => (prev ? replaceTask(prev, res.task!) : prev));
        const rewardText = formatTaskReward(res.reward ?? task.reward);
        setNotice(res.already_claimed ? "Награда уже была получена." : `Награда получена${rewardText ? `: ${rewardText}` : ""}.`);
        // Push the fresh balance to the header immediately (was the stale 921 bug).
        if (res.balance && typeof res.balance.balls === "number") onBalanceChange?.(res.balance.balls);
        notifyClaimableChanged(); // refresh tab/menu badges
        await refetchTasks();
      } else {
        setNotice("Не удалось забрать награду.");
      }
    } catch (e: unknown) {
      setNotice(getErrorMessage(e, "Не удалось забрать награду."));
    } finally {
      setClaimingId(null);
    }
  }

  // Sequential on purpose: each claim writes to the economy ledger, so fan-out
  // would race. A single failure doesn't abort the rest of the queue.
  async function claimAll() {
    if (claimingId || claimingAll || claimableTasks.length === 0) return;
    setClaimingAll(true);
    setNotice("");
    let done = 0;
    let failed = 0;
    let balls: number | null = null;
    try {
      for (const task of claimableTasks) {
        try {
          const res = await apiFetch<SeasonPredictionTaskClaimResponse>(`/season-predictions/tasks/${task.id}/claim`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (res.ok && res.task) {
            done += 1;
            if (res.balance && typeof res.balance.balls === "number") balls = res.balance.balls;
          } else {
            failed += 1;
          }
        } catch {
          failed += 1;
        }
      }
      if (balls !== null) onBalanceChange?.(balls);
      notifyClaimableChanged();
      await refetchTasks();
      setNotice(
        done > 0
          ? `Забрано наград: ${done}${failed > 0 ? `, не удалось: ${failed}.` : "."}`
          : "Не удалось забрать награды.",
      );
    } finally {
      setClaimingAll(false);
    }
  }

  if (loading) {
    return <section style={stateCardStyle}>Загрузка заданий…</section>;
  }

  if (error || !data || !activeSection || !activeSubsection) {
    return (
      <section style={stateCardStyle}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "var(--tg-text)" }}>Задания недоступны</div>
        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.45 }}>
          {error || "Попробуй открыть раздел позже."}
        </div>
      </section>
    );
  }

  const summary = data.summaries;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={heroStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={heroTitleStyle}>{mode ? MODE_HERO[mode].title : "Задания режима"}</h2>
            <p style={heroTextStyle}>
              {mode ? MODE_HERO[mode].text : "Выполняются за активность в таблицах лиг, еврокубках и Вызове недели."}
            </p>
          </div>
          <ProgressBadge current={mode ? modeProgress.current : data.progress.current} target={mode ? modeProgress.target : data.progress.target} />
        </div>
        <div style={heroProgressTrackStyle}>
          <div style={heroProgressFillStyle(mode ? modeProgress.current : data.progress.current, mode ? modeProgress.target : data.progress.target)} />
        </div>
      </div>

      {mode === "weekly" && modeProgress.current === 0 && (
        <div style={weeklyHintStyle}>
          Ответы и подтверждение засчитаются, когда ты поучаствуешь в активном Вызове недели.
        </div>
      )}

      {visibleSections.length > 1 && (
      <SegmentedControl
        value={activeSection.id}
        onChange={(id) => {
          const next = visibleSections.find((section) => section.id === id);
          if (next) selectSection(next);
        }}
        ariaLabel="Разделы заданий"
        pressedScale={0.985}
        trackStyle={sectionTabsStyle}
        pillStyle={{
          borderRadius: 10,
          border: `1px solid color-mix(in srgb, ${ACCENT} 55%, var(--tg-hint))`,
          background: `linear-gradient(180deg, color-mix(in srgb, ${ACCENT} 17%, var(--tg-bg)), color-mix(in srgb, ${ACCENT} 9%, var(--tg-secondary-bg)))`,
        }}
        itemStyle={sectionTabStyle}
        items={visibleSections.map((section) => ({
          key: section.id,
          content: (active: boolean) => (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                {SECTION_SHORT[section.id] || section.title}
                <CountBadge count={sectionClaimable(summary, section.id)} style={badgeStyle} />
              </span>
              <span style={tabCounterStyle(active)}>
                {section.progress.current}/{section.progress.target}
              </span>
            </>
          ),
        }))}
      />
      )}

      {activeSection.subsections.length > 1 && (
        <SegmentedControl
          value={activeSubsection.id}
          onChange={selectSubsection}
          ariaLabel="Под-разделы заданий"
          pressedScale={0.985}
          className="season-task-chip-scroll"
          trackStyle={subsectionTabsStyle}
          pillStyle={{
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${ACCENT} 50%, var(--tg-hint))`,
            background: `color-mix(in srgb, ${ACCENT} 14%, var(--tg-bg))`,
          }}
          itemStyle={subsectionChipStyle}
          items={activeSection.subsections.map((subsection) => ({
            key: subsection.id,
            content: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                {SUBSECTION_SHORT[subsection.id] || subsection.title}
                <CountBadge count={subsectionClaimable(summary, activeSection.id, subsection.id)} style={badgeStyle} />
              </span>
            ),
          }))}
        />
      )}

      <FilterBar value={filter} onChange={setFilter} />

      {claimableTasks.length > 0 && (
        <div style={claimAllRowStyle}>
          <span style={claimAllTextStyle}>Можно забрать наград: {claimableTasks.length}</span>
          <Pressable
            data-testid="season-tasks-claim-all"
            haptic="medium"
            pressedScale={0.98}
            onClick={() => void claimAll()}
            disabled={claimingAll || !!claimingId}
            style={claimAllButtonStyle}
          >
            {claimingAll ? "Забираем…" : "Забрать все"}
          </Pressable>
        </div>
      )}

      {notice && <div style={noticeStyle}>{notice}</div>}

      {activeSection.id === "europe" && activeSubsection.id === "all" ? (
        // "Все" in eurocups: stack «Все еврокубки» + per-cup cards (each grouped by phase).
        activeSection.subsections.map((sub) => (
          <SubsectionCard
            key={sub.id}
            sectionId={activeSection.id}
            subsection={sub}
            summary={summary}
            filter={filter}
            futureExpanded={futureExpanded}
            claimingId={claimingId}
            onTaskNavigate={navigateTask}
            onFutureTask={() => setNotice("Задание откроется позже.")}
            onToggleFuture={() => setFutureExpanded((value) => !value)}
          />
        ))
      ) : (
        <SubsectionCard
          sectionId={activeSection.id}
          subsection={activeSubsection}
          summary={summary}
          filter={filter}
          futureExpanded={futureExpanded}
          claimingId={claimingId}
          onTaskNavigate={navigateTask}
          onFutureTask={() => setNotice("Задание откроется позже.")}
          onToggleFuture={() => setFutureExpanded((value) => !value)}
        />
      )}
      {/* global: the class sits on SegmentedControl's root, outside styled-jsx scoping */}
      <style jsx global>{`
        .season-task-chip-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
}

function FilterBar({ value, onChange }: { value: TaskFilter; onChange: (next: TaskFilter) => void }) {
  return (
    <SegmentedControl
      value={value}
      onChange={onChange}
      ariaLabel="Фильтр заданий"
      pressedScale={0.985}
      trackStyle={filterBarStyle}
      pillStyle={{
        borderRadius: 8,
        border: `1px solid color-mix(in srgb, ${ACCENT} 45%, var(--tg-hint))`,
        background: `color-mix(in srgb, ${ACCENT} 13%, var(--tg-bg))`,
      }}
      itemStyle={filterChipStyle}
      items={FILTERS.map((item) => ({ key: item.id, content: item.label }))}
    />
  );
}

function SubsectionCard({
  sectionId,
  subsection,
  summary,
  filter,
  futureExpanded,
  claimingId,
  onTaskNavigate,
  onFutureTask,
  onToggleFuture,
}: {
  sectionId: string;
  subsection: SeasonPredictionTaskSubsection;
  summary: SeasonPredictionTaskClaimableSummary | undefined;
  filter: TaskFilter;
  futureExpanded: boolean;
  claimingId: string | null;
  onTaskNavigate: (task: SeasonPredictionTask) => void;
  onFutureTask: () => void;
  onToggleFuture: () => void;
}) {
  const activeTasks = subsection.tasks.filter((task) => task.status !== "future");
  const futureTasks = subsection.tasks.filter((task) => task.status === "future");
  const filteredActive = filter === "all"
    ? activeTasks
    : activeTasks.filter((task) => task.status === filter);
  // In "Все" surface claimable rewards (then in-progress) first; keep order otherwise.
  const visibleActiveTasks = filter === "all"
    ? [...filteredActive].sort((a, b) => taskSortPriority(a) - taskSortPriority(b))
    : filteredActive;
  // Card badge = THIS subsection's own claimable (the «Все …» aggregate card shows
  // only its aggregate tasks, not the section total — per-cup cards badge separately).
  const cardClaimable = summary?.subsections[`${sectionId}:${subsection.id}`] ?? 0;
  const visibleFutureTasks = filter === "future"
    ? futureTasks
    : filter === "all"
      ? futureTasks
      : [];
  const compactFutureTasks = filter === "future" || futureExpanded ? visibleFutureTasks : visibleFutureTasks.slice(0, 3);
  const showFutureBlock = visibleFutureTasks.length > 0;
  const showEmpty = visibleActiveTasks.length === 0 && !showFutureBlock;
  // Eurocup tasks carry a phase (league/ties/bracket/result) → render phase
  // sub-headers inside the tournament card instead of separate top-level chips.
  const hasPhases = subsection.tasks.some((task) => !!task.phase);

  return (
    <div style={subsectionCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3 style={{ ...subsectionTitleStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {subsection.title}
          <CountBadge count={cardClaimable} style={badgeStyle} />
        </h3>
        <span style={summaryChipStyle}>{subsection.progress.current}/{subsection.progress.target}</span>
      </div>
      <div style={taskListStyle}>
        {hasPhases
          ? <PhaseGroups sectionId={sectionId} subId={subsection.id} summary={summary} tasks={visibleActiveTasks} claimingId={claimingId} onNavigate={onTaskNavigate} />
          : visibleActiveTasks.map((task) => (
            <TaskCard key={task.id} task={task} claiming={claimingId === task.id} onNavigate={onTaskNavigate} />
          ))}
        {showFutureBlock && (
          <FutureTasksBlock
            tasks={compactFutureTasks}
            total={visibleFutureTasks.length}
            expanded={filter === "future" || futureExpanded}
            onToggle={onToggleFuture}
            onFutureTask={onFutureTask}
            canToggle={filter === "all" && visibleFutureTasks.length > 2}
          />
        )}
        {showEmpty && <EmptyTasksState filter={filter} />}
      </div>
    </div>
  );
}

const PHASE_ORDER = ["league", "ties", "bracket", "result"] as const;
const PHASE_LABELS: Record<string, string> = {
  league: "Стадия лиги",
  ties: "Стыки",
  bracket: "Сетка",
  result: "Результаты",
};

// Group eurocup tasks by phase with a small sub-header for each non-empty phase.
function PhaseGroups({ sectionId, subId, summary, tasks, claimingId, onNavigate }: { sectionId: string; subId: string; summary: SeasonPredictionTaskClaimableSummary | undefined; tasks: SeasonPredictionTask[]; claimingId: string | null; onNavigate: (task: SeasonPredictionTask) => void }) {
  const groups = PHASE_ORDER
    .map((phase) => ({ phase, items: tasks.filter((task) => (task.phase || "league") === phase) }))
    .filter((group) => group.items.length > 0);
  return (
    <>
      {groups.map((group) => (
        <div key={group.phase} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ ...phaseHeaderStyle, display: "flex", alignItems: "center", gap: 6 }}>
            {PHASE_LABELS[group.phase] || group.phase}
            <CountBadge count={phaseClaimable(summary, sectionId, subId, group.phase)} style={badgeStyle} />
          </div>
          {group.items.map((task) => (
            <TaskCard key={task.id} task={task} claiming={claimingId === task.id} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </>
  );
}

// CTA label: claimable reward → "Забрать"; claimed → "Получено"; otherwise progress-based.
function taskCtaLabel(task: SeasonPredictionTask): string {
  if (task.claim_status === "claimable") return "Забрать";
  if (task.claim_status === "claimed") return "Получено";
  return getTaskCtaLabel(task.status);
}

function TaskCard({ task, claiming, onNavigate }: { task: SeasonPredictionTask; claiming: boolean; onNavigate: (task: SeasonPredictionTask) => void }) {
  const pct = task.progress.target > 0
    ? Math.max(0, Math.min(100, Math.round((task.progress.current / task.progress.target) * 100)))
    : 0;
  const reward = renderTaskReward(task.reward);
  const claimable = task.claim_status === "claimable";
  const claimed = task.claim_status === "claimed";
  return (
    <Pressable
      haptic="selection"
      pressedScale={0.99}
      onClick={() => onNavigate(task)}
      style={taskCardStyle(task.status, task.claim_status)}
      aria-label={`${task.title}. ${taskCtaLabel(task)}`}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h4 style={taskTitleStyle}>{task.title}</h4>
          <p style={taskDescriptionStyle}>{task.description}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <span style={statusPillStyle(task.status)}>{claimed ? "Получено" : STATUS_LABELS[task.status]}</span>
          {reward && <span style={rewardPillStyle(claimed)}>{reward}</span>}
        </div>
      </div>

      <div style={progressRowStyle}>
        <div style={progressTrackStyle}>
          <div style={progressFillStyle(task.status, pct)} />
        </div>
        <div style={progressMetaStyle}>
          <span style={progressTextStyle}>{task.progress.current}/{task.progress.target}</span>
          <span style={claimable ? claimCtaStyle : ctaStyle(task.status)}>{claiming ? "…" : taskCtaLabel(task)}</span>
        </div>
      </div>

      {task.status === "future" && (
        <div style={futureTextStyle}>{task.future_reason || "После подсчёта результатов"}</div>
      )}
    </Pressable>
  );
}

function FutureTasksBlock({
  tasks,
  total,
  expanded,
  canToggle,
  onToggle,
  onFutureTask,
}: {
  tasks: SeasonPredictionTask[];
  total: number;
  expanded: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onFutureTask: () => void;
}) {
  return (
    <div style={futureBlockStyle}>
      <div style={futureBlockHeaderStyle}>
        <span>После результатов</span>
        <span style={futureCountStyle}>{total}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {tasks.map((task) => (
          <Pressable key={task.id} haptic="light" pressedScale={0.99} onClick={onFutureTask} style={futureRowStyle}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {task.title}
            </span>
            <span style={futureMiniPillStyle}>Скоро</span>
          </Pressable>
        ))}
      </div>
      {canToggle && (
        <Pressable haptic="light" pressedScale={0.99} onClick={onToggle} style={futureToggleStyle}>
          {expanded ? "Свернуть" : `Показать ещё ${total - tasks.length}`}
        </Pressable>
      )}
    </div>
  );
}

function resolveTaskNavigation(
  task: SeasonPredictionTask,
  topLeagues: SeasonPredictionTournament[],
  europeanCups: SeasonPredictionTournament[],
): SeasonPredictionTaskNavigation | null {
  if (task.status === "future") return null;
  if (task.section === "weekly") return { type: "open_weekly_challenge" };
  if (task.section === "europe") {
    if (isEuropeanCupCode(task.subsection) && europeanCups.some((cup) => cup.tournament_code === task.subsection)) {
      return { type: "open_europe", code: task.subsection };
    }
    return { type: "switch_tab", tab: "european-cups" };
  }
  if (task.section === "top5") {
    if (isTopLeagueCode(task.subsection) && topLeagues.some((league) => league.tournament_code === task.subsection)) {
      return { type: "open_top_league", code: task.subsection };
    }
    return { type: "switch_tab", tab: "top-leagues" };
  }
  if (task.section === "ballon_dor") return { type: "switch_tab", tab: "ballon-dor" };
  if (task.section === "start") {
    if (task.id === "start_first_prediction") return { type: "open_weekly_or_top5" };
    if (task.id === "start_individual_pick") {
      const code = findFirstLeagueMissingAwards(topLeagues);
      return code ? { type: "open_top_league", code } : { type: "switch_tab", tab: "top-leagues" };
    }
    if (task.id === "start_full_league") {
      const code = findFirstIncompleteLeague(topLeagues);
      return code ? { type: "open_top_league", code } : { type: "switch_tab", tab: "top-leagues" };
    }
    return { type: "switch_tab", tab: "top-leagues" };
  }
  return null;
}

function isTopLeagueCode(value: string): value is TopLeagueCode {
  return value === "PL" || value === "PD" || value === "SA" || value === "BL1" || value === "FL1";
}

function isEuropeanCupCode(value: string): value is EuropeanCupCode {
  return value === "UCL" || value === "UEL" || value === "UECL";
}

function countAwards(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const awards = value as Record<string, unknown>;
  return ["top_scorer", "top_assistant", "golden_glove"].filter((key) => {
    const option = awards[key] ?? (key === "top_assistant" ? awards.top_assister : undefined);
    return !!option && typeof option === "object";
  }).length;
}

function tableCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value !== "object") return 0;
  const table = value as Record<string, unknown>;
  if (Array.isArray(table.ordered_team_ids)) return table.ordered_team_ids.length;
  if (Array.isArray(table.ordered_teams)) return table.ordered_teams.length;
  if (Array.isArray(table.teams)) return table.teams.length;
  return 0;
}

function findFirstLeagueMissingAwards(leagues: SeasonPredictionTournament[]): TopLeagueCode | null {
  const league = leagues.find((item) => countAwards(item.entry?.awards) < 3);
  const code = String(league?.tournament_code || "");
  return isTopLeagueCode(code) ? code : null;
}

function findFirstIncompleteLeague(leagues: SeasonPredictionTournament[]): TopLeagueCode | null {
  const league = leagues.find((item) => {
    const submitted = item.entry && ["submitted", "locked", "scoring", "completed"].includes(item.entry.status);
    const tableReady = tableCount(item.entry?.table) >= Math.max(1, Number(item.configured_team_count || item.team_count || 0));
    return !submitted || !tableReady || countAwards(item.entry?.awards) < 3;
  });
  const code = String(league?.tournament_code || "");
  return isTopLeagueCode(code) ? code : null;
}

function getTaskCtaLabel(status: SeasonPredictionTask["status"]) {
  if (status === "completed") return "Открыть";
  if (status === "in_progress") return "Продолжить";
  if (status === "future") return "Скоро";
  if (status === "failed") return "Открыть";
  return "Перейти";
}

function EmptyTasksState({ filter }: { filter: TaskFilter }) {
  return (
    <div style={emptyFilterStyle}>
      {filter === "all" ? "Здесь пока нет заданий" : "Нет заданий с таким статусом"}
    </div>
  );
}

function ProgressBadge({ current, target }: { current: number; target: number }) {
  return (
    <div style={progressRingStyle}>
      <span style={{ fontSize: 16, fontWeight: 950, color: "var(--tg-text)" }}>{current}</span>
      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--tg-hint)" }}>/{target}</span>
    </div>
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

const heroTitleStyle = {
  margin: 0,
  fontSize: 17,
  fontWeight: 950,
  letterSpacing: 0,
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
  return {
    width: `${pct}%`,
    height: "100%",
    borderRadius: 999,
    background: ACCENT,
  } as const;
}

// Active border/background live on the SegmentedControl pill; items keep layout+colors.
const sectionTabsStyle = {
  gap: 4,
  padding: 3,
  borderRadius: 12,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
  border: SOFT_BORDER,
} as const;

function sectionTabStyle(active: boolean) {
  return {
    minWidth: 0,
    minHeight: 30,
    borderRadius: 10,
    padding: "4px 7px",
    color: active ? `color-mix(in srgb, ${ACCENT} 75%, var(--tg-text))` : "var(--tg-text)",
    justifyContent: "space-between",
    gap: 6,
    fontSize: 10,
    fontWeight: 900,
    textAlign: "left" as const,
    transition: "color 180ms ease",
  } as const;
}

function tabCounterStyle(active: boolean) {
  return {
    flexShrink: 0,
    minWidth: 28,
    height: 17,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? "color-mix(in srgb, var(--tg-bg) 66%, transparent)" : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color: active ? `color-mix(in srgb, ${ACCENT} 75%, var(--tg-text))` : "var(--tg-hint)",
    fontSize: 10,
    fontWeight: 850,
  } as const;
}

// Scrollable rail: chips share one track so the pill can travel between them.
const subsectionTabsStyle = {
  display: "flex",
  gap: 5,
  padding: 3,
  borderRadius: 999,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 68%, var(--tg-bg))",
  border: SOFT_BORDER,
  overflowX: "auto",
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
} as const;

function subsectionChipStyle(active: boolean) {
  return {
    flexShrink: 0,
    height: 28,
    borderRadius: 999,
    padding: "0 9px",
    color: active ? `color-mix(in srgb, ${ACCENT} 76%, var(--tg-text))` : "color-mix(in srgb, var(--tg-text) 66%, var(--tg-hint))",
    fontSize: 11,
    fontWeight: 850,
    whiteSpace: "nowrap",
    transition: "color 180ms ease",
  } as const;
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
  letterSpacing: 0,
  color: "var(--tg-text)",
} as const;

const summaryChipStyle = {
  height: 22,
  borderRadius: 999,
  padding: "0 10px",
  display: "inline-flex",
  alignItems: "center",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 68%, var(--tg-bg))",
  border: SOFT_BORDER,
  color: "var(--tg-text)",
  fontSize: 12,
  fontWeight: 900,
} as const;

const taskListStyle = {
  marginTop: 7,
  display: "flex",
  flexDirection: "column",
  gap: 5,
} as const;

const phaseHeaderStyle = {
  marginTop: 2,
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: 0.02,
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
} as const;

// Compact claimable badge for tabs / chips / section headers (smaller than the menu one).
const badgeStyle = {
  minWidth: 15,
  height: 15,
  padding: "0 4px",
  fontSize: 9.5,
  background: "#d98a1a",
} as const;

function taskCardStyle(status: SeasonPredictionTask["status"], claimStatus?: SeasonPredictionTask["claim_status"]) {
  // Claimable reward → accent border to draw the eye to the "Забрать" CTA.
  const border = claimStatus === "claimable"
    ? `1px solid color-mix(in srgb, ${ACCENT} 40%, var(--tg-hint))`
    : status === "completed" || claimStatus === "claimed"
      ? "1px solid color-mix(in srgb, #34c759 22%, var(--tg-hint))"
      : status === "failed"
        ? `1px solid color-mix(in srgb, ${MISS} 16%, var(--tg-hint))`
        : SOFT_BORDER;
  return {
    width: "100%",
    minHeight: status === "completed" || status === "failed" ? 60 : 64,
    borderRadius: 13,
    padding: status === "future" ? "7px 9px" : status === "completed" || status === "failed" ? "8px 9px" : "8px 10px",
    background: status === "future"
      ? "color-mix(in srgb, var(--tg-secondary-bg) 58%, var(--tg-bg))"
      // failed = calm neutral surface (a final negative, kept quiet — not alarming).
      : status === "failed"
        ? "color-mix(in srgb, var(--tg-secondary-bg) 64%, var(--tg-bg))"
        : "color-mix(in srgb, var(--tg-secondary-bg) 76%, var(--tg-bg))",
    border,
    opacity: status === "future" ? 0.72 : status === "failed" ? 0.85 : 1,
    cursor: "pointer",
    textAlign: "left" as const,
  } as const;
}

function rewardPillStyle(claimed: boolean) {
  return {
    minHeight: 17,
    borderRadius: 999,
    padding: "0 6px",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "color-mix(in srgb, #ffb020 14%, var(--tg-bg))",
    border: "1px solid color-mix(in srgb, #ffb020 22%, transparent)",
    color: "color-mix(in srgb, #ffb020 82%, var(--tg-text))",
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap" as const,
    opacity: claimed ? 0.6 : 1,
  } as const;
}

const rewardIconPartStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
} as const;

// Filled accent CTA for the claimable "Забрать" action.
const claimCtaStyle = {
  height: 20,
  borderRadius: 999,
  padding: "0 8px",
  display: "inline-flex",
  alignItems: "center",
  background: ACCENT,
  border: "1px solid transparent",
  color: "var(--tg-button-text)",
  fontSize: 10,
  fontWeight: 900,
  whiteSpace: "nowrap" as const,
} as const;

const taskTitleStyle = {
  margin: 0,
  fontSize: 12,
  fontWeight: 920,
  letterSpacing: 0,
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

function statusPillStyle(status: SeasonPredictionTask["status"]) {
  const color = status === "completed" ? DONE
    : status === "failed" ? `color-mix(in srgb, ${MISS} 80%, var(--tg-text))`
    : status === "future" ? "var(--tg-hint)"
    : status === "in_progress" ? ACCENT
    : "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))";
  return {
    flexShrink: 0,
    minHeight: 18,
    borderRadius: 999,
    padding: "0 6px",
    display: "inline-flex",
    alignItems: "center",
    background: status === "completed"
      ? "color-mix(in srgb, #34c759 12%, var(--tg-bg))"
      : status === "failed"
        ? `color-mix(in srgb, ${MISS} 10%, var(--tg-bg))`
        : status === "in_progress"
          ? `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`
          : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    color,
    border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
    fontSize: 10,
    fontWeight: 850,
    whiteSpace: "nowrap",
  } as const;
}

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

function progressFillStyle(status: SeasonPredictionTask["status"], pct: number) {
  return {
    width: `${pct}%`,
    height: "100%",
    borderRadius: 999,
    background: status === "completed" ? DONE
      : status === "failed" ? `color-mix(in srgb, ${MISS} 55%, transparent)`
      : status === "future" ? "var(--tg-hint)"
      : ACCENT,
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

function ctaStyle(status: SeasonPredictionTask["status"]) {
  return {
    height: 20,
    borderRadius: 999,
    padding: "0 7px",
    display: "inline-flex",
    alignItems: "center",
    background: status === "future"
      ? "color-mix(in srgb, var(--tg-hint) 10%, transparent)"
      : `color-mix(in srgb, ${ACCENT} 12%, var(--tg-bg))`,
    border: status === "future"
      ? "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)"
      : `1px solid color-mix(in srgb, ${ACCENT} 26%, transparent)`,
    color: status === "future" ? "var(--tg-hint)" : `color-mix(in srgb, ${ACCENT} 78%, var(--tg-text))`,
    fontSize: 10,
    fontWeight: 900,
    whiteSpace: "nowrap",
  } as const;
}

const futureTextStyle = {
  marginTop: 4,
  fontSize: 11,
  fontWeight: 750,
  color: "var(--tg-hint)",
} as const;

const filterBarStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 3,
  padding: 2,
  borderRadius: 10,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 82%, var(--tg-bg))",
  border: SOFT_BORDER,
} as const;

function filterChipStyle(active: boolean) {
  return {
    height: 24,
    borderRadius: 8,
    color: active ? `color-mix(in srgb, ${ACCENT} 78%, var(--tg-text))` : "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))",
    fontSize: 10,
    fontWeight: 850,
    whiteSpace: "nowrap",
    transition: "color 180ms ease",
  } as const;
}

const futureBlockStyle = {
  borderRadius: 12,
  padding: "7px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 58%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
} as const;

const futureBlockHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 5,
  color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))",
  fontSize: 11,
  fontWeight: 850,
} as const;

const futureCountStyle = {
  flexShrink: 0,
  minWidth: 22,
  height: 18,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 10,
  fontWeight: 850,
} as const;

const futureRowStyle = {
  width: "100%",
  minHeight: 26,
  borderRadius: 10,
  padding: "0 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  background: "color-mix(in srgb, var(--tg-bg) 62%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
} as const;

const futureMiniPillStyle = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 850,
  color: "var(--tg-hint)",
} as const;

const futureToggleStyle = {
  width: "100%",
  marginTop: 5,
  minHeight: 26,
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))",
  color: "color-mix(in srgb, var(--tg-text) 64%, var(--tg-hint))",
  fontSize: 11,
  fontWeight: 850,
  cursor: "pointer",
} as const;

const emptyFilterStyle = {
  minHeight: 46,
  borderRadius: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 62%, var(--tg-bg))",
  border: "1px dashed color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  color: "var(--tg-hint)",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "center",
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

const noticeStyle = {
  minHeight: 30,
  borderRadius: 12,
  padding: "7px 9px",
  background: "color-mix(in srgb, #ffb020 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #ffb020 20%, transparent)",
  color: "color-mix(in srgb, #ffb020 82%, var(--tg-text))",
  fontSize: 12,
  fontWeight: 800,
} as const;
