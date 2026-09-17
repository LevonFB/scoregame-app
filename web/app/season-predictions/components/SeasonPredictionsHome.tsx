"use client";

import { useState, type CSSProperties } from "react";
import type {
  EuropeanCupCode,
  MyScoresResponse,
  SeasonPredictionEntry,
  SeasonPredictionSeason,
  SeasonPredictionTournament,
  TopLeagueCode,
} from "../types";
import { TopLeaguesInline } from "./TopLeaguesInline";
import { SeasonTopSummary } from "./SeasonTopSummary";
import { EuropeanCupsInline } from "./EuropeanCupsInline";
import { BallonDorInline } from "./BallonDorInline";
import { Pressable } from "@/app/components/ui/Pressable";
import { SeasonPredictionsTabs, type SeasonPredictionsTabId } from "./SeasonPredictionsTabs";

export function SeasonPredictionsHome({
  season,
  topLeagues,
  europeanCups,
  myScores,
  activeTab,
  onTabChange,
  visibleTabs,
  onTopLeagueEntryChange,
  onEuropeanEntryChange,
  onOpenTasks,
  onOpenLeaderboard,
  onOpenLeagueRating,
  onOpenLeagueTasks,
  onOpenCupRating,
  onOpenCupTasks,
}: {
  season: SeasonPredictionSeason | null;
  topLeagues: SeasonPredictionTournament[];
  europeanCups: SeasonPredictionTournament[];
  myScores: MyScoresResponse | null;
  activeTab: SeasonPredictionsTabId;
  onTabChange: (tab: SeasonPredictionsTabId) => void;
  // Admin-controlled tab visibility; undefined = all tabs visible.
  visibleTabs?: SeasonPredictionsTabId[];
  onTopLeagueEntryChange?: (code: TopLeagueCode, entry: SeasonPredictionEntry) => void;
  onEuropeanEntryChange?: (code: EuropeanCupCode, entry: SeasonPredictionEntry) => void;
  onOpenTasks?: () => void;
  onOpenLeaderboard?: () => void;
  // Deep links to a specific league/cup rating + tasks (from the selected hub card).
  onOpenLeagueRating?: (code: TopLeagueCode) => void;
  onOpenLeagueTasks?: (code: TopLeagueCode) => void;
  onOpenCupRating?: (code: EuropeanCupCode) => void;
  onOpenCupTasks?: (code: EuropeanCupCode) => void;
}) {
  // Currently-selected league/cup inside the inline hubs — drives the bottom
  // summary/action block's deep links (Рейтинг / Задания → that tournament).
  // A tab hidden by the admin renders neither its switch entry nor its content.
  const tabShown = (id: SeasonPredictionsTabId) => !visibleTabs || visibleTabs.includes(id);
  const [selTop, setSelTop] = useState<TopLeagueCode | null>(null);
  const [selCup, setSelCup] = useState<EuropeanCupCode | null>(null);
  const effectiveTop = selTop || (topLeagues[0]?.tournament_code as TopLeagueCode | undefined);
  const effectiveCup = selCup || (europeanCups[0]?.tournament_code as EuropeanCupCode | undefined);
  const selCupTitle = europeanCups.find((t) => t.tournament_code === effectiveCup)?.title || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Page header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>
            Прогнозы сезона
          </h1>
          {season && (
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              height: 20,
              padding: "0 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 850,
              color: "color-mix(in srgb, var(--tg-text) 65%, var(--tg-hint))",
              background: "rgba(255,255,255,0.10)",
              whiteSpace: "nowrap",
              letterSpacing: "0.01em",
            }}>
              {season.title}
            </span>
          )}
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", fontWeight: 650, lineHeight: 1.4 }}>
          Собери таблицы топ&#x2011;5 лиг и предскажи еврокубки.
        </p>
      </div>

      <SeasonPredictionsTabs value={activeTab} onChange={onTabChange} visibleTabs={visibleTabs} />

      {visibleTabs && visibleTabs.length === 0 && (
        <section style={{
          padding: 16,
          borderRadius: 16,
          background: "var(--tg-secondary-bg)",
          fontSize: 13,
          fontWeight: 750,
          color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
        }}>
          Подразделы временно недоступны.
        </section>
      )}

      {activeTab === "top-leagues" && tabShown("top-leagues") && (
        <>
          {/* League hub first (selector → hero → panels), so the selector is visible
              high up; one lightweight "Сезон" block carries progress + score +
              Rating/Tasks CTAs (no separate big cards below). */}
          <TopLeaguesInline
            tournaments={topLeagues}
            onEntryChange={onTopLeagueEntryChange}
            onSelectedCodeChange={setSelTop}
          />

          {/* Bottom summary/action block: overall progress + Рейтинг/Задания that
              deep-link to the currently-selected league (no top action row). */}
          <SeasonTopSummary
            tournaments={topLeagues}
            scores={myScores}
            onOpenLeaderboard={effectiveTop && onOpenLeagueRating ? () => onOpenLeagueRating(effectiveTop) : onOpenLeaderboard}
            onOpenTasks={effectiveTop && onOpenLeagueTasks ? () => onOpenLeagueTasks(effectiveTop) : onOpenTasks}
          />
        </>
      )}
      {activeTab === "european-cups" && tabShown("european-cups") && (
        <>
          <EuropeanCupsInline
            tournaments={europeanCups}
            onEntryChange={onEuropeanEntryChange}
            onSelectedCodeChange={setSelCup}
          />

          {/* Same bottom summary/action pattern as Top-5: summary of the selected
              cup + Рейтинг/Задания deep-linking to it. */}
          {europeanCups.length > 0 && (
            <section style={cupSummaryCardStyle}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--tg-text)" }}>Турнир</span>
                <span style={{ fontSize: 11.5, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))" }}>{selCupTitle}</span>
              </div>
              <div style={{ marginTop: 7, fontSize: 11, fontWeight: 750, color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))" }}>
                Рейтинг и задания выбранного еврокубка.
              </div>
              {(onOpenCupRating || onOpenCupTasks) && (
                <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                  {onOpenCupRating && (
                    <Pressable onClick={() => effectiveCup && onOpenCupRating(effectiveCup)} haptic="light" pressedScale={0.98} aria-label="Рейтинг еврокубка" style={pillStyle}>Рейтинг</Pressable>
                  )}
                  {onOpenCupTasks && (
                    <Pressable onClick={() => effectiveCup && onOpenCupTasks(effectiveCup)} haptic="light" pressedScale={0.98} aria-label="Задания еврокубка" style={pillStyle}>Задания</Pressable>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
      {activeTab === "ballon-dor" && tabShown("ballon-dor") && (
        // Единственный турнир — без хаба-селектора: сразу список номинантов.
        // Свои данные вкладка грузит сама, поэтому config-пейлоад ей не нужен.
        <BallonDorInline />
      )}
    </div>
  );
}

const cupSummaryCardStyle: CSSProperties = {
  borderRadius: 14,
  padding: "10px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  color: "var(--tg-text)",
};
const pillStyle: CSSProperties = {
  flex: "1 1 0",
  minHeight: 34,
  borderRadius: 10,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 900,
  color: "color-mix(in srgb, var(--tg-button) 80%, var(--tg-text))",
  background: "color-mix(in srgb, var(--tg-button) 10%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-button) 26%, transparent)",
};

