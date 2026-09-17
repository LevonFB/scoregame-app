"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppIcon } from "./ui/AppIcon";
import { pluralRu } from "@/lib/plural";
import { WeeklyChallengePendingCard } from "../season-predictions/components/WeeklyChallengePendingCard";
import type { WeeklyChallengeActiveResponse, WeeklyChallengeMyScoreResponse } from "../season-predictions/types";

/* Home card surfacing the active "Вызов недели": title, the viewer's participation
 * state, deadline countdown, and a CTA into the mode. Read-only; fetches its own
 * lightweight status. Renders nothing when there's no active challenge. */

// Weekly challenge identity = purple/gold, distinct from the blue daily hero.
const WC_ACCENT = "#A855F7";

function formatCountdown(secondsLeft: number): string {
  const total = Math.max(0, Math.floor(secondsLeft));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d >= 1) return h >= 1 ? `${d} д ${h} ч` : `${d} д`;
  if (h >= 1) return m >= 1 ? `${h} ч ${m} м` : `${h} ч`;
  if (m >= 1) return `${m} м`;
  return "меньше минуты";
}

export function HomeWeeklyChallengeCard({ initData, nowMs, onOpen }: { initData: string; nowMs: number; onOpen: () => void }) {
  const [data, setData] = useState<WeeklyChallengeActiveResponse | null>(null);
  const [scoreData, setScoreData] = useState<WeeklyChallengeMyScoreResponse | null>(null);

  // Wait for initData before fetching (and refetch once it arrives) — otherwise a
  // cold-start request can race auth/maintenance, fail, and the card never retries.
  useEffect(() => {
    if (!initData) return;
    let active = true;
    apiFetch<WeeklyChallengeActiveResponse>("/season-predictions/weekly-challenges/active")
      .then((res) => { if (active) setData(res); })
      .catch(() => { /* silently hide on error — home must stay resilient */ });
    return () => { active = false; };
  }, [initData]);

  const challenge = data?.challenge ?? null;
  const status = data?.status ?? "unavailable";
  const challengeId = challenge?.id ?? null;
  const challengeStatus = challenge?.status ?? null;

  useEffect(() => {
    if (!initData || !challengeId || !challengeStatus) return;
    const terminalChallenge = ["locked", "scoring", "completed", "archived"].includes(challengeStatus);
    if (status !== "locked" && !terminalChallenge) {
      return;
    }
    let active = true;
    apiFetch<WeeklyChallengeMyScoreResponse>(`/season-predictions/weekly-challenges/${challengeId}/my-score`)
      .then((res) => { if (active) setScoreData(res); })
      .catch(() => { if (active) setScoreData(null); });
    return () => { active = false; };
  }, [initData, challengeId, challengeStatus, status]);

  if (!challenge || status === "unavailable") return null;

  const deadlineSec = challenge.deadline_at;
  const secondsLeft = deadlineSec != null ? deadlineSec - Math.floor(nowMs / 1000) : null;
  const deadlineOpen = secondsLeft != null && secondsLeft > 0;

  const mode = challenge.competition_mode;
  const modeLabel = mode === "club" ? "Клубный футбол" : mode === "national_team" ? "Матчи сборных" : null;

  const activeQuestions = (data?.questions || []).filter((q) => q.status === "active");
  const total = activeQuestions.length || (challenge.question_count ?? 5);
  const answers = data?.entry?.answers || {};
  const filled = activeQuestions.reduce((c, q) => (answers[q.question_key] ? c + 1 : c), 0);
  const progressPct = total > 0 ? Math.round((filled / total) * 100) : 0;

  const scoreMatchesChallenge = scoreData?.challenge?.id === challenge.id;
  const score = scoreMatchesChallenge && scoreData?.has_score && !scoreData.results_stale ? scoreData.score : null;

  // Primary state line (progress / submitted / result).
  const stateText = score
    ? `Результат: ${score.total_points} из ${score.max_possible_points}`
    : scoreMatchesChallenge && scoreData?.has_score && scoreData.results_stale
      ? "Результаты обновляются"
      : status === "submitted" ? "Прогноз подтверждён"
        : status === "locked" ? "Приём закрыт — идёт подсчёт"
          : challenge.status === "completed" ? "Вызов завершён"
            : `${filled} из ${total} ответов`;

  const ctaLabel =
    status === "not_started" ? "Начать вызов"
      : status === "draft" ? "Продолжить"
        : status === "submitted" ? "Изменить прогноз"
          : score || challenge.status === "completed" ? "Посмотреть результат"
            : "Посмотреть";

  const showProgressBar = !score && (status === "not_started" || status === "draft");

  // With a pending-result companion, lay the two cards out as a horizontal
  // scroll-snap carousel (matching "Матчи дня") instead of stacking them.
  const hasPending = !!data?.pending_result;
  // display:flex on the wrapper makes the inner card stretch to the row height so
  // both carousel cards render at equal size (alignItems:stretch on the container).
  const itemStyle = { flex: hasPending ? "0 0 88%" : "0 0 100%", scrollSnapAlign: "center" as const, minWidth: 0, display: "flex" };

  return (
    <div
      className="sg-hide-scrollbar"
      style={hasPending
        ? { display: "flex", gap: 10, alignItems: "stretch", overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", paddingBottom: 2 }
        : { display: "block" }}
    >
    <div style={itemStyle}>
    <button
      data-testid="weekly-home-card"
      onClick={onOpen}
      style={{
        position: "relative",
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        borderRadius: 20,
        padding: "13px 15px",
        color: "var(--tg-text)",
        background: `radial-gradient(circle at 88% 0%, color-mix(in srgb, ${WC_ACCENT} 28%, transparent), transparent 42%), linear-gradient(135deg, var(--tg-bg), color-mix(in srgb, var(--tg-bg) 76%, ${WC_ACCENT}))`,
        border: `1px solid color-mix(in srgb, ${WC_ACCENT} 30%, rgba(255,255,255,0.06))`,
        boxShadow: "0 12px 26px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", color: `color-mix(in srgb, ${WC_ACCENT} 78%, var(--tg-text))`, textTransform: "uppercase", minWidth: 0 }}>
          <AppIcon name="weekly_challenge" size={14} /> Вызов недели
        </div>
        {modeLabel && (
          <span data-testid="weekly-home-mode" style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 999, background: `color-mix(in srgb, ${WC_ACCENT} 16%, transparent)`, color: `color-mix(in srgb, ${WC_ACCENT} 86%, var(--tg-text))`, border: `1px solid color-mix(in srgb, ${WC_ACCENT} 28%, transparent)` }}>{modeLabel}</span>
        )}
      </div>

      <h3 style={{ margin: "7px 0 0", fontSize: 16, fontWeight: 950, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {challenge.title}
      </h3>

      <div data-testid="weekly-home-progress" style={{ marginTop: 4, fontSize: 12.5, fontWeight: 800, color: score ? "color-mix(in srgb, " + WC_ACCENT + " 86%, var(--tg-text))" : "var(--tg-text)" }}>
        {stateText}
      </div>

      {showProgressBar && (
        <div style={{ marginTop: 7, height: 5, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--tg-hint) 16%, transparent)" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 999, background: WC_ACCENT, transition: "width 200ms ease" }} />
        </div>
      )}

      <div style={{ marginTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.4 }}>
          <span>{total} {pluralRu(total, "вопрос", "вопроса", "вопросов")} · награды за участие и результат</span>
          {deadlineOpen && (status === "not_started" || status === "draft") && (
            <span data-testid="weekly-home-countdown" style={{ display: "block", whiteSpace: "nowrap" }}>До дедлайна {formatCountdown(secondsLeft!)}</span>
          )}
        </div>
        <span
          data-testid="weekly-home-cta"
          style={{ flexShrink: 0, minHeight: 36, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 999, background: WC_ACCENT, color: "#fff", fontSize: 13, fontWeight: 900, boxShadow: `0 4px 12px color-mix(in srgb, ${WC_ACCENT} 42%, transparent)` }}
        >
          {ctaLabel}
        </span>
      </div>
    </button>
    </div>
    {data?.pending_result && (
      <div style={itemStyle}>
        <WeeklyChallengePendingCard data={data.pending_result} onOpen={onOpen} />
      </div>
    )}
    </div>
  );
}
