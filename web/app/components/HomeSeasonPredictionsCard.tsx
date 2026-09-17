"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AppIcon } from "./ui/AppIcon";
import { awardsCount, deriveOverall } from "../season-predictions/progress";
import {
  awardsDone,
  awardsPool,
  selectHomeSeasonPhases,
  type HomeSeasonPhase,
} from "../season-predictions/homePhase";
import { EUROPEAN_CUP_FULL_LABELS, TOP_LEAGUE_SUBLABELS } from "../season-predictions/constants";
import type { SeasonPredictionsTabId } from "../season-predictions/components/SeasonPredictionsTabs";
import type {
  EuropeanCupCode,
  MyScoresResponse,
  SeasonPredictionTournament,
  SeasonPredictionsConfigResponse,
} from "../season-predictions/types";

/* Home card surfacing "Прогнозы сезона" as a single phase-aware card:
 *  - top-5 leagues open → gather tables (progress + nearest deadline);
 *  - individual awards open → pick the three awards (own window, outlives tables);
 *  - eurocups open mid-season → predict the league stage («Новое» badge);
 *  - nothing actionable → compact mode with the viewer's season score.
 * Read-only; fetches its own data; renders nothing on error or when the
 * season isn't configured — home must stay resilient. */

// Season predictions identity = warm gold (trophy/season), distinct from the
// blue daily hero and the purple weekly challenge.
const SP_ACCENT = "#E8A33D";

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

// Human label for a tournament in card copy (top-league sublabel or cup name).
function tournamentLabel(t: SeasonPredictionTournament): string {
  return (
    TOP_LEAGUE_SUBLABELS[t.tournament_code]
    || EUROPEAN_CUP_FULL_LABELS[t.tournament_code as EuropeanCupCode]
    || t.title
  );
}

type PhaseView = {
  title: string;
  // Compact label for the secondary row, where the full sentence would not fit.
  shortTitle: string;
  stateText: string;
  shortStateText?: string;
  ctaLabel: string;
  targetTab: SeasonPredictionsTabId;
  badge: string | null;
  progressPct: number | null;
  deadlineAt: number | null;
};

export function HomeSeasonPredictionsCard({
  initData,
  nowMs,
  onOpen,
}: {
  initData: string;
  nowMs: number;
  onOpen: (tab: SeasonPredictionsTabId) => void;
}) {
  const [data, setData] = useState<SeasonPredictionsConfigResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [myScores, setMyScores] = useState<MyScoresResponse | null>(null);

  // Wait for initData before fetching (and refetch once it arrives) — otherwise a
  // cold-start request can race auth/maintenance, fail, and the card never retries.
  useEffect(() => {
    if (!initData) return;
    let active = true;
    apiFetch<SeasonPredictionsConfigResponse>("/season-predictions/config")
      .then((res) => { if (active) setData(res); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [initData]);

  const nowSec = Math.floor(nowMs / 1000);
  const topLeagues = useMemo(
    () => (data?.top_leagues || data?.tournaments || []),
    [data],
  );
  const europeanCups = useMemo(() => data?.european_tournaments || [], [data]);

  // Every actionable phase in priority order: the first drives the card, the
  // second rides along as a secondary task with its own CTA (e.g. awards are
  // due first, but the eurocup league stage is open too).
  const phases: HomeSeasonPhase[] = useMemo(
    () => (data?.season ? selectHomeSeasonPhases(topLeagues, europeanCups, nowSec) : []),
    [data, topLeagues, europeanCups, nowSec],
  );
  const anyOpened = useMemo(
    () => [...topLeagues, ...europeanCups].some((t) => t.status !== "draft" && t.status !== "soon"),
    [topLeagues, europeanCups],
  );
  const phase: HomeSeasonPhase | null = phases.length > 0
    ? phases[0]
    : data?.season && anyOpened
      ? { kind: "compact" }
      : null;
  const secondaryPhase: HomeSeasonPhase | null = phases.length > 1 ? phases[1] : null;

  // Compact mode is the only phase that needs scores — fetch lazily.
  const compact = phase?.kind === "compact";
  useEffect(() => {
    if (!initData || !compact) return;
    let active = true;
    apiFetch<MyScoresResponse>("/season-predictions/my-scores")
      .then((res) => { if (active) setMyScores(res); })
      .catch(() => { if (active) setMyScores(null); });
    return () => { active = false; };
  }, [initData, compact]);

  if (failed || !data || !phase) return null;

  const overall = deriveOverall(topLeagues);

  // One phase → one descriptor, so the primary block and the secondary row
  // render from the same rules instead of two divergent copies.
  function describePhase(p: HomeSeasonPhase): PhaseView {
    if (p.kind === "leagues") {
      return {
        title: "Собери таблицы топ-5 лиг",
        shortTitle: "Таблицы топ-5 лиг",
        stateText: `${overall.submittedLeagues} из ${overall.totalLeagues} таблиц подтверждено`,
        ctaLabel: overall.submittedLeagues > 0 || overall.filledTeams > 0 ? "Продолжить" : "Начать",
        targetTab: "top-leagues",
        badge: null,
        progressPct: overall.totalLeagues > 0
          ? Math.round((overall.submittedLeagues / overall.totalLeagues) * 100)
          : 0,
        deadlineAt: p.deadlineAt,
      };
    }
    if (p.kind === "awards") {
      // Progress counts every tournament whose awards are already visible to users,
      // not just the pending ones — otherwise the ratio shrinks as leagues get done.
      const pool = awardsPool([...topLeagues, ...europeanCups]);
      const doneCount = pool.filter(awardsDone).length;
      const single = p.tournaments.length === 1 ? p.tournaments[0] : null;
      return {
        title: single ? `Награды — ${tournamentLabel(single)}` : "Выбери индивидуальные награды",
        shortTitle: "Индивидуальные награды",
        stateText: pool.length > 0
          ? `${doneCount} из ${pool.length} лиг с наградами`
          : "Бомбардир · ассистент · вратарь",
        ctaLabel: doneCount > 0 || p.tournaments.some((t) => awardsCount(t.entry?.awards) > 0)
          ? "Продолжить"
          : "Выбрать",
        // Eurocup awards (once they exist) must open their own tab, not top-leagues.
        targetTab: p.tournaments.every((t) => t.tournament_type === "european")
          ? "european-cups"
          : "top-leagues",
        badge: null,
        progressPct: pool.length > 0 ? Math.round((doneCount / pool.length) * 100) : 0,
        deadlineAt: p.deadlineAt,
      };
    }
    if (p.kind === "eurocups") {
      const single = p.cups.length === 1 ? p.cups[0] : null;
      const singleLabel = single
        ? (EUROPEAN_CUP_FULL_LABELS[single.tournament_code as EuropeanCupCode] || single.title)
        : null;
      const submitted = p.cups.filter((t) => !!t.entry).length;
      return {
        title: singleLabel ? `Предскажи таблицу — ${singleLabel}` : "Открылись еврокубки",
        shortTitle: "Еврокубки",
        stateText: singleLabel
          ? "Стадия лиги открыта"
          : p.cups
              .map((t) => EUROPEAN_CUP_FULL_LABELS[t.tournament_code as EuropeanCupCode] || t.title)
              .join(" · "),
        shortStateText: `${submitted} из ${p.cups.length} турниров`,
        ctaLabel: "Предсказать",
        targetTab: "european-cups",
        badge: p.isNew ? "Новое" : null,
        progressPct: null,
        deadlineAt: p.deadlineAt,
      };
    }
    const hasScores = !!myScores && myScores.scored_leagues_count > 0;
    return {
      title: "Прогнозы сезона",
      shortTitle: "Прогнозы сезона",
      stateText: hasScores
        ? `Твой счёт: ${myScores!.total_points} из ${myScores!.max_possible_points}`
        : overall.submittedLeagues > 0
          ? "Прогнозы приняты — жди результатов"
          : "Приём прогнозов закрыт",
      ctaLabel: "Посмотреть",
      targetTab: "top-leagues",
      badge: null,
      progressPct: null,
      deadlineAt: null,
    };
  }

  const primary = describePhase(phase);
  const secondary = secondaryPhase ? describePhase(secondaryPhase) : null;
  const { title, stateText, ctaLabel, targetTab, badge, progressPct, deadlineAt } = primary;

  const secondsLeft = deadlineAt != null ? deadlineAt - nowSec : null;
  const secondarySecondsLeft = secondary?.deadlineAt != null ? secondary.deadlineAt - nowSec : null;
  const deadlineOpen = secondsLeft != null && secondsLeft > 0;

  // The eyebrow already says «Прогнозы сезона» — the chip carries only the
  // season years (e.g. "2026/27"); hidden when the title has no year part.
  const seasonShort = data.season?.title?.match(/\d{4}\/\d{2,4}/)?.[0] || null;

  return (
    <div
      data-testid="season-home-card"
      style={{
        position: "relative",
        overflow: "hidden",
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
        borderRadius: 20,
        padding: "13px 15px",
        color: "var(--tg-text)",
        background: `radial-gradient(circle at 88% 0%, color-mix(in srgb, ${SP_ACCENT} 26%, transparent), transparent 42%), linear-gradient(135deg, var(--tg-bg), color-mix(in srgb, var(--tg-bg) 78%, ${SP_ACCENT}))`,
        border: `1px solid color-mix(in srgb, ${SP_ACCENT} 30%, rgba(255,255,255,0.06))`,
        boxShadow: "0 12px 26px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", color: `color-mix(in srgb, ${SP_ACCENT} 78%, var(--tg-text))`, textTransform: "uppercase", minWidth: 0 }}>
          <AppIcon name="season_predictions" size={14} /> Прогнозы сезона
        </div>
        {badge ? (
          <span data-testid="season-home-badge" style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 999, background: `color-mix(in srgb, ${SP_ACCENT} 20%, transparent)`, color: `color-mix(in srgb, ${SP_ACCENT} 88%, var(--tg-text))`, border: `1px solid color-mix(in srgb, ${SP_ACCENT} 32%, transparent)` }}>{badge}</span>
        ) : seasonShort ? (
          <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 900, padding: "2px 8px", borderRadius: 999, background: "color-mix(in srgb, var(--tg-hint) 14%, transparent)", color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))" }}>{seasonShort}</span>
        ) : null}
      </div>

      <button
        onClick={() => onOpen(targetTab)}
        style={primaryBlockStyle}
      >
      <h3 style={{ margin: "7px 0 0", fontSize: 16, fontWeight: 950, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </h3>

      <div data-testid="season-home-state" style={{ marginTop: 4, fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)" }}>
        {stateText}
      </div>

      {progressPct != null && (
        <div style={{ marginTop: 7, height: 5, borderRadius: 999, overflow: "hidden", background: "color-mix(in srgb, var(--tg-hint) 16%, transparent)" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", borderRadius: 999, background: SP_ACCENT, transition: "width 200ms ease" }} />
        </div>
      )}

      <div style={{ marginTop: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.4 }}>
          <span>Таблицы · награды · рейтинг</span>
          {deadlineOpen && (
            <span data-testid="season-home-countdown" style={{ display: "block", whiteSpace: "nowrap" }}>До дедлайна {formatCountdown(secondsLeft!)}</span>
          )}
        </div>
        <span
          data-testid="season-home-cta"
          style={{ flexShrink: 0, minHeight: 36, display: "inline-flex", alignItems: "center", padding: "0 14px", borderRadius: 999, background: SP_ACCENT, color: "#1a1205", fontSize: 13, fontWeight: 900, boxShadow: `0 4px 12px color-mix(in srgb, ${SP_ACCENT} 42%, transparent)` }}
        >
          {ctaLabel}
        </span>
      </div>
      </button>

      {/* Second open task (e.g. eurocups while the awards deadline runs first) —
          its own CTA so the user is never one deadline away from the other. */}
      {secondary && (
        <button
          data-testid="season-home-secondary"
          onClick={() => onOpen(secondary.targetTab)}
          style={secondaryRowStyle}
        >
          <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {secondary.shortTitle}
              </span>
              {secondary.badge && (
                <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 900, padding: "1px 6px", borderRadius: 999, background: `color-mix(in srgb, ${SP_ACCENT} 20%, transparent)`, color: `color-mix(in srgb, ${SP_ACCENT} 88%, var(--tg-text))` }}>
                  {secondary.badge}
                </span>
              )}
            </span>
            <span style={{ fontSize: 11, fontWeight: 750, color: "var(--tg-hint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[
                secondary.shortStateText || secondary.stateText,
                secondarySecondsLeft != null && secondarySecondsLeft > 0
                  ? formatCountdown(secondarySecondsLeft)
                  : null,
              ].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span
            data-testid="season-home-secondary-cta"
            style={{ flexShrink: 0, minHeight: 30, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 999, background: `color-mix(in srgb, ${SP_ACCENT} 18%, transparent)`, border: `1px solid color-mix(in srgb, ${SP_ACCENT} 34%, transparent)`, color: `color-mix(in srgb, ${SP_ACCENT} 88%, var(--tg-text))`, fontSize: 12, fontWeight: 900 }}
          >
            {secondary.ctaLabel}
          </span>
        </button>
      )}
    </div>
  );
}

const primaryBlockStyle = {
  display: "block",
  width: "100%",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  textAlign: "left" as const,
  cursor: "pointer",
};

const secondaryRowStyle = {
  marginTop: 10,
  paddingTop: 10,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  border: "none",
  borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)",
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
};
