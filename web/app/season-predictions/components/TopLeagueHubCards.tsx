"use client";

import { type CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";

// Two compact panels inside a selected top-5 league: League table + Individual
// awards. Tapping a panel opens its detail view. No scoring/logic — display only.

type LeagueHubView = "table" | "awards";

export function TopLeagueHubCards({
  tone,
  table,
  awards,
  onOpen,
}: {
  tone: string;
  table: { statusLabel: string; statusDone: boolean; count: number; limit: number; score: { total: number; max: number; pct: number } | null };
  awards: { statusLabel: string; statusDone: boolean; filled: number; total: number };
  onOpen: (view: LeagueHubView) => void;
}) {
  const tableValue = table.score
    ? `${table.score.total}/${table.score.max} · ${Math.round((table.score.pct || 0) * 100)}%`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <HubRow
        title="Таблица лиги"
        info={`Команды ${table.count}/${table.limit}`}
        tone={tone}
        statusLabel={table.statusLabel}
        statusDone={table.statusDone}
        value={tableValue}
        onOpen={() => onOpen("table")}
      />
      <HubRow
        title="Индивидуальные награды"
        info={`Выбрано ${awards.filled}/${awards.total} · для заданий`}
        tone={tone}
        statusLabel={awards.statusLabel}
        statusDone={awards.statusDone}
        value={null}
        onOpen={() => onOpen("awards")}
      />
    </div>
  );
}

function HubRow({
  title, info, tone, statusLabel, statusDone, value, onOpen,
}: {
  title: string;
  info: string;
  tone: string;
  statusLabel: string;
  statusDone: boolean;
  value: string | null;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onClick={onOpen}
      haptic="light"
      pressedScale={0.99}
      aria-label={`${title}. Открыть`}
      style={rowStyle(tone)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, flexShrink: 0, marginTop: 5 }} />
          {/* Title may wrap to 2 lines — never truncate (e.g. "Индивидуальные награды"). */}
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950, color: "var(--tg-text)", letterSpacing: "-0.02em", minWidth: 0, lineHeight: 1.2 }}>{title}</h3>
        </div>
        <span style={statusPillStyle(statusDone)}>{statusLabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {info}
        </span>
        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
          {value && <span style={{ fontSize: 11, fontWeight: 900, color: "#3ddc6f" }}>{value}</span>}
          <span style={{ fontSize: 12.5, fontWeight: 900, color: `color-mix(in srgb, ${tone} 82%, var(--tg-text))` }}>Открыть</span>
        </span>
      </div>
    </Pressable>
  );
}

function rowStyle(tone: string): CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    borderRadius: 13,
    padding: "9px 12px",
    background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
    border: `1px solid color-mix(in srgb, ${tone} 20%, color-mix(in srgb, var(--tg-hint) 14%, transparent))`,
    cursor: "pointer",
  };
}

function statusPillStyle(done: boolean): CSSProperties {
  return {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    height: 19,
    padding: "0 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 850,
    whiteSpace: "nowrap",
    color: done ? "color-mix(in srgb, #2ec060 82%, var(--tg-text))" : "var(--tg-hint)",
    background: done ? "color-mix(in srgb, #2ec060 14%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-hint) 12%, transparent)",
    border: `1px solid ${done ? "color-mix(in srgb, #2ec060 26%, transparent)" : "color-mix(in srgb, var(--tg-hint) 16%, transparent)"}`,
  };
}
