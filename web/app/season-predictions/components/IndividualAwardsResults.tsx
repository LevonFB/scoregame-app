"use client";

import { type CSSProperties } from "react";
import type { UserScoreAward } from "../types";

const ACCENT = "#3ddc6f";

// Read-only results of individual awards (твой выбор · итог · угадано/мимо).
// Lives in the "Индивидуальные награды" detail view — NOT in the league-table
// breakdown. Display-only: reads the existing score breakdown awards.
export function IndividualAwardsResults({
  awards,
  awardsCorrect,
}: {
  awards: UserScoreAward[];
  awardsCorrect: number;
}) {
  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>Индивидуальные награды</h2>
      <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 650, color: "var(--tg-hint)", lineHeight: 1.4 }}>
        Угадано {awardsCorrect}/3 · используются для заданий
      </div>
      <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
        {awards.map((a) => <AwardRow key={a.award_type} award={a} />)}
      </div>
    </section>
  );
}

function awardPlayerLine(player: string | null, team: string | null): string {
  if (!player) return "—";
  return team ? `${player} · ${team}` : player;
}

function awardStatusOf(award: UserScoreAward): { label: string; tone: "ok" | "miss" | "muted" | "neutral" } {
  if (!award.official_confirmed) return { label: "Итог не подтверждён", tone: "neutral" };
  if (!award.user_player_name) return { label: "Не выбрано", tone: "muted" };
  return award.correct ? { label: "Угадано", tone: "ok" } : { label: "Мимо", tone: "miss" };
}

function AwardRow({ award }: { award: UserScoreAward }) {
  const status = awardStatusOf(award);
  const toneColor = status.tone === "ok"
    ? ACCENT
    : status.tone === "miss"
      ? "color-mix(in srgb, #d98a1a 82%, var(--tg-text))"
      : "var(--tg-hint)";
  const officialText = award.official_confirmed
    ? awardPlayerLine(award.official_player_name, award.official_team_name)
    : "будет позже";
  return (
    <div style={{
      borderRadius: 10, padding: "7px 10px",
      background: status.tone === "ok"
        ? "color-mix(in srgb, #34c759 9%, var(--tg-bg))"
        : "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
      border: status.tone === "ok"
        ? "1px solid color-mix(in srgb, #34c759 18%, transparent)"
        : "1px solid color-mix(in srgb, var(--tg-hint) 11%, transparent)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--tg-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{award.label}</span>
        <span style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px",
          borderRadius: 999, fontSize: 10, fontWeight: 850, color: toneColor,
          background: status.tone === "ok" ? "color-mix(in srgb, #34c759 14%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-hint) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
        }}>
          {status.label}
        </span>
      </div>
      <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))", lineHeight: 1.35 }}>
        Твой: {awardPlayerLine(award.user_player_name, award.user_team_name)}
      </div>
      <div style={{ marginTop: 1, fontSize: 11, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))", lineHeight: 1.35 }}>
        Итог: {officialText}
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  borderRadius: 16,
  padding: "12px 13px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "var(--tg-text)",
};

const titleStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)" };
