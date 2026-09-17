"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import type { SeasonPredictionTeam } from "../types";

// E6 stage hub: three compact stage rows (League stage / Play-offs / Bracket)
// replacing the small segmented tabs. Tapping a row opens that stage.
// No scoring/logic here — reads already-available data + a read-only knockout GET.

type StageView = "league" | "playoffs" | "bracket";

type KnockoutMatch = { stage: string; team_a_id: string | null; team_b_id: string | null; winner_team_id?: string | null; status: string; known: boolean };
type StageLock = { pairs_confirmed: boolean; results_confirmed: boolean; can_edit: boolean };
type KnockoutResponse = {
  matches: KnockoutMatch[];
  bracket: { status: string; picks: Record<string, unknown> } | null;
  stage_locks?: Record<string, StageLock>;
  available: boolean;
};

const BRACKET_STAGES = ["round_of_16", "quarter_final", "semi_final", "final"];

type LeagueSummary = {
  statusLabel: string;
  statusDone: boolean;
  top8: number;
  top8Limit: number;
  zone: number;
  zoneLimit: number;
  score: { total: number; max: number; pct: number } | null;
};

type StageScore = { total: number; max: number; pct: number } | null;

export function EurocupStageHubCards({
  code,
  tone,
  teams,
  league,
  stageScores,
  onOpenStage,
}: {
  code: string;
  tone: string;
  teams: SeasonPredictionTeam[];
  league: LeagueSummary;
  stageScores?: { playoffs?: StageScore; bracket?: StageScore };
  onOpenStage: (view: StageView) => void;
}) {
  const [ko, setKo] = useState<KnockoutResponse | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<KnockoutResponse>(`/season-predictions/europe/${code}/knockout`)
      .then((res) => { if (active) setKo(res); })
      .catch(() => { if (active) setKo(null); });
    return () => { active = false; };
  }, [code]);

  const teamName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) {
      const id = String((t as { team_id?: string; id?: number }).team_id ?? (t as { id?: number }).id ?? "");
      map.set(id, String(t.short_name || t.team_name || id));
    }
    return (id: string | null | undefined) => (id ? (map.get(id) || id) : null);
  }, [teams]);

  // Knockout-derived summaries (read-only).
  const ko_playoffs = useMemo(() => (ko?.matches || []).filter((m) => m.stage === "knockout_playoffs"), [ko]);
  const ko_bracket = useMemo(() => (ko?.matches || []).filter((m) => BRACKET_STAGES.includes(m.stage)), [ko]);
  const playoffsKnown = ko_playoffs.filter((m) => m.known).length;
  const bracketKnown = ko_bracket.filter((m) => m.known).length;
  const bracketStatus = ko?.bracket?.status || "draft";
  const picks = (ko?.bracket?.picks || {}) as Record<string, unknown>;

  const pickCount = (stageKey: string): number => {
    const obj = picks[stageKey];
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 0;
    return Object.values(obj as Record<string, unknown>).filter(Boolean).length;
  };
  const playoffsPicks = pickCount("knockout_playoffs");
  const bracketPicks = BRACKET_STAGES.reduce((n, s) => n + pickCount(s), 0);

  const submitted = ["submitted", "locked", "completed"].includes(bracketStatus);
  const championId = (() => {
    const fin = picks.final;
    if (fin && typeof fin === "object" && !Array.isArray(fin)) {
      const v = Object.values(fin as Record<string, unknown>)[0];
      return v ? String(v) : null;
    }
    return null;
  })();

  // Results-confirmed (locked) detection: backend stage_locks first, else winner set.
  const stageLocked = (stages: string[]): boolean => stages.some((st) => {
    const lock = ko?.stage_locks?.[st];
    if (lock) return lock.results_confirmed;
    return (ko?.matches || []).some((m) => m.stage === st && String(m.status) !== "void" && !!m.winner_team_id);
  });
  const playoffsLocked = stageLocked(["knockout_playoffs"]);
  const bracketLocked = stageLocked(BRACKET_STAGES);

  function koStatus(known: number, picksMade: number, locked: boolean): { label: string; done: boolean } {
    if (known === 0) return { label: "Не открыто", done: false };
    if (locked) return { label: "Закрыто", done: true };
    if (submitted) return { label: "Подтверждено", done: true };
    if (picksMade > 0) return { label: "Черновик", done: false };
    return { label: "Не начато", done: false };
  }
  const playoffsSt = koStatus(playoffsKnown, playoffsPicks, playoffsLocked);
  const bracketSt = koStatus(bracketKnown, bracketPicks, bracketLocked);

  const leagueInfo = `Топ-8 ${league.top8}/${league.top8Limit} · 9–24 ${league.zone}/${league.zoneLimit}`;
  const leagueValue = league.score
    ? `${league.score.total}/${league.score.max} · ${Math.round((league.score.pct || 0) * 100)}%`
    : null;
  const playoffsValue = stageScores?.playoffs
    ? `${stageScores.playoffs.total}/${stageScores.playoffs.max} · ${Math.round((stageScores.playoffs.pct || 0) * 100)}%`
    : null;
  const bracketValue = stageScores?.bracket
    ? `${stageScores.bracket.total}/${stageScores.bracket.max} · ${Math.round((stageScores.bracket.pct || 0) * 100)}%`
    : null;
  const championName = championId ? teamName(championId) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <StageRow
        title="Стадия лиги"
        info={leagueInfo}
        tone={tone}
        statusLabel={league.statusLabel}
        statusDone={league.statusDone}
        value={leagueValue}
        enabled
        onOpen={() => onOpenStage("league")}
      />

      <StageRow
        title="Стыки"
        info={playoffsKnown === 0
          ? "8 пар из зоны 9–24"
          : playoffsLocked && playoffsPicks === 0
            ? "8 пар · прогноз не отправлен"
            : `8 пар · прогноз ${playoffsPicks}/${playoffsKnown}`}
        tone={tone}
        statusLabel={playoffsSt.label}
        statusDone={playoffsSt.done}
        value={playoffsValue}
        enabled={playoffsKnown > 0}
        onOpen={() => onOpenStage("playoffs")}
      />

      <StageRow
        title="Сетка"
        info={bracketKnown === 0
          ? "1/8 · 1/4 · 1/2 · Финал"
          : `Прогноз ${bracketPicks}/${bracketKnown}${championName ? ` · 🏆 ${championName}` : ""}`}
        tone={tone}
        statusLabel={bracketSt.label}
        statusDone={bracketSt.done}
        value={bracketValue}
        enabled={bracketKnown > 0}
        onOpen={() => onOpenStage("bracket")}
      />
    </div>
  );
}

function StageRow({
  title, info, tone, statusLabel, statusDone, value, enabled, onOpen,
}: {
  title: string;
  info: string;
  tone: string;
  statusLabel: string;
  statusDone: boolean;
  value: string | null;
  enabled: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onClick={() => { if (enabled) onOpen(); }}
      haptic="light"
      pressedScale={enabled ? 0.99 : 1}
      aria-label={`${title}. ${enabled ? "Открыть" : "Скоро"}`}
      style={rowStyle(enabled, tone)}
    >
      {/* Row 1: dot + title · status pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: tone, flexShrink: 0 }} />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 950, color: "var(--tg-text)", letterSpacing: "-0.02em" }}>{title}</h3>
        </div>
        <span style={statusPillStyle(statusDone)}>{statusLabel}</span>
      </div>

      {/* Row 2: info · value + CTA */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {info}
        </span>
        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
          {value && <span style={{ fontSize: 11, fontWeight: 900, color: "#3ddc6f" }}>{value}</span>}
          <span style={{ fontSize: 12.5, fontWeight: 900, color: enabled ? `color-mix(in srgb, ${tone} 82%, var(--tg-text))` : "var(--tg-hint)" }}>
            {enabled ? "Открыть" : "Скоро"}
          </span>
        </span>
      </div>
    </Pressable>
  );
}

function rowStyle(enabled: boolean, tone: string): CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    borderRadius: 13,
    padding: "9px 12px",
    background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
    border: `1px solid color-mix(in srgb, ${tone} ${enabled ? 20 : 8}%, color-mix(in srgb, var(--tg-hint) 14%, transparent))`,
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.72,
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
