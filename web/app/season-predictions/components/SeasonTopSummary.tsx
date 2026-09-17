import type { CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import type { MyScoresResponse, SeasonPredictionTournament } from "../types";
import { deriveOverall } from "../progress";

// Single lightweight "Сезон" block: merges progress + top‑5 score + the
// Rating/Tasks CTAs (was four separate cards). Secondary weight — must not
// compete with the league panels above. Display-only — no logic/data changes.
export function SeasonTopSummary({
  tournaments,
  scores,
  onOpenLeaderboard,
  onOpenTasks,
}: {
  tournaments: SeasonPredictionTournament[];
  scores: MyScoresResponse | null;
  onOpenLeaderboard?: () => void;
  onOpenTasks?: () => void;
}) {
  if (tournaments.length === 0) return null;
  const o = deriveOverall(tournaments);
  const hasScores = !!scores && scores.scored_leagues_count > 0;
  const pct = scores ? Math.round((scores.points_pct || 0) * 100) : 0;
  const barPct = hasScores
    ? Math.min(100, Math.max(0, pct))
    : (o.totalLeagues > 0 ? Math.round((o.submittedLeagues / o.totalLeagues) * 100) : 0);

  // "5/5 лиг · 690/793 · 87%"
  const metrics = [
    `${o.submittedLeagues}/${o.totalLeagues} лиг`,
    hasScores ? `${scores!.total_points}/${scores!.max_possible_points}` : null,
    hasScores ? `${pct}%` : null,
  ].filter(Boolean).join(" · ");

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--tg-text)" }}>Сезон</span>
        <span style={{ fontSize: 11.5, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))" }}>{metrics}</span>
      </div>

      <div style={{ marginTop: 7, height: 5, borderRadius: 999, background: "color-mix(in srgb, var(--tg-hint) 16%, transparent)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${barPct}%`, background: hasScores ? "#3ddc6f" : "color-mix(in srgb, var(--tg-button) 70%, transparent)", borderRadius: 999, transition: "width 0.3s" }} />
      </div>

      <div style={{ marginTop: 7, fontSize: 11, fontWeight: 750, color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))" }}>
        Таблицы <b style={{ color: "var(--tg-text)", fontWeight: 900 }}>{o.filledTeams}/{o.totalTeams}</b>
        {" · "}
        Награды <b style={{ color: "var(--tg-text)", fontWeight: 900 }}>{o.filledAwards}/{o.totalAwards}</b>
      </div>

      {!o.nextActionDone && o.nextActionText && (
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>Следующее: {o.nextActionText}</div>
      )}

      {(onOpenLeaderboard || onOpenTasks) && (
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
          {onOpenLeaderboard && (
            <Pressable onClick={onOpenLeaderboard} haptic="light" pressedScale={0.98} aria-label="Открыть рейтинг сезона" style={pillStyle}>Рейтинг</Pressable>
          )}
          {onOpenTasks && (
            <Pressable onClick={onOpenTasks} haptic="light" pressedScale={0.98} aria-label="Открыть задания сезона" style={pillStyle}>Задания</Pressable>
          )}
        </div>
      )}
    </section>
  );
}

const cardStyle: CSSProperties = {
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
