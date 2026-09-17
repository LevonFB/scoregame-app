"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type {
  MyScoreResponse,
  SeasonPredictionTeam,
  TopLeagueCode,
  UserScoreBonus,
  UserScoreTeamBreakdown,
} from "../types";

const ACCENT = "#3ddc6f";

const REASON_TEXT: Record<string, string> = {
  no_submitted_entry: "Сначала подтверди прогноз — без этого очки не начисляются.",
  official_results_not_confirmed: "Очки появятся после подтверждения итогов сезона.",
  recalc_not_run: "Итоги подтверждены. Очки появятся после пересчёта.",
  not_available_yet: "Очки пока недоступны.",
};

const BONUS_LABELS: Record<string, string> = {
  ucl_zone_full: "Зона ЛЧ угадана полностью",
  ucl_zone_almost: "Зона ЛЧ почти угадана",
  relegation_zone_full: "Зона вылета угадана полностью",
  relegation_zone_partial: "Зона вылета угадана частично",
  consistency_le2: "10+ команд с ошибкой ≤2",
};

type TeamMeta = { name: string; crest: string | null };

function teamRefOf(team: SeasonPredictionTeam): string {
  return String(team.team_id || team.id);
}

function buildTeamMetaMap(teams: SeasonPredictionTeam[] | undefined): Map<string, TeamMeta> {
  const map = new Map<string, TeamMeta>();
  for (const team of teams || []) {
    map.set(teamRefOf(team), { name: team.team_name || team.short_name || teamRefOf(team), crest: team.crest_url || null });
  }
  return map;
}

function formatScoredAt(ts: number | null): string {
  if (!ts) return "—";
  return `${new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })} МСК`;
}

export function ScoreBreakdown({
  code,
  teams,
  preloaded,
}: {
  code: TopLeagueCode;
  teams?: SeasonPredictionTeam[];
  preloaded?: MyScoreResponse | null;
}) {
  // When the parent already fetched my-score, reuse it (no double request).
  const usePreloaded = preloaded !== undefined;
  const [data, setData] = useState<MyScoreResponse | null>(preloaded ?? null);
  const [loading, setLoading] = useState(!usePreloaded);
  const [error, setError] = useState("");

  useEffect(() => {
    if (usePreloaded) { setData(preloaded ?? null); return; }
    let active = true;
    const load = async () => {
      try {
        const res = await apiFetch<MyScoreResponse>(`/season-predictions/top-leagues/${code}/my-score`);
        if (active) setData(res);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [code, usePreloaded, preloaded]);

  const teamMeta = buildTeamMetaMap(teams);

  if (loading) {
    return <section style={cardStyle}><div style={{ color: "var(--tg-hint)", fontWeight: 700, fontSize: 13 }}>Загрузка очков…</div></section>;
  }
  if (error) return null; // breakdown is optional — don't surface transient errors loudly
  if (!data) return null;

  if (!data.has_score || !data.score) {
    const reasonText = (data.reason && REASON_TEXT[data.reason]) || REASON_TEXT.not_available_yet;
    return (
      <section style={cardStyle}>
        <h2 style={titleStyle}>Разбор очков</h2>
        <div style={mutedStyle}>{reasonText}</div>
      </section>
    );
  }

  const score = data.score;
  const pct = Math.round((score.points_pct || 0) * 100);
  const warnings = score.breakdown_json?.warnings || [];
  const breakdownTeams = score.breakdown_json?.teams || [];
  const bonuses = score.breakdown_json?.bonuses || [];

  // Champion hit/miss explanation, using real team names from the map.
  const championInfo = score.breakdown_json?.champion;
  const officialChampionName = championInfo?.team_id
    ? (teamMeta.get(championInfo.team_id)?.name || championInfo.team_id)
    : null;
  const userTopTeam = breakdownTeams.find((t) => t.pos_user === 1);
  const userTopName = userTopTeam ? (teamMeta.get(userTopTeam.team_id)?.name || userTopTeam.team_name || userTopTeam.team_id) : null;
  const championExplanation: { headline: string; detail: string | null } | null = score.champion_correct
    ? { headline: `Чемпион: угадан +${score.champion_points}`, detail: null }
    : officialChampionName
      ? { headline: "Чемпион: мимо", detail: `Итог: ${officialChampionName}${userTopName ? ` · у тебя: ${userTopName}` : ""}` }
      : null;

  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>Разбор очков</h2>

      {/* Headline total */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>{score.total_points}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" }}>/ {score.max_possible_points}</span>
        <span style={pctChipStyle}>{pct}%</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
        Посчитано: {formatScoredAt(score.scored_at)}
      </div>

      {warnings.length > 0 && (
        <div style={warnStyle}>
          {warnings.map((w) => <div key={w}>{humanWarning(w)}</div>)}
        </div>
      )}

      {/* Category rows */}
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 1 }}>
        <CategoryRow label="Позиции" value={score.table_points} />
        <CategoryRow label="Зоны" value={score.zone_points} />
        <CategoryRow label="Чемпион" value={score.champion_points} muted={score.champion_points === 0} />
        <CategoryRow label="Бонусы" value={score.bonus_points} />
      </div>

      {/* Champion hit/miss — compact one/two-line */}
      {championExplanation && (
        <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 850, color: score.champion_correct ? ACCENT : "color-mix(in srgb, #d98a1a 82%, var(--tg-text))" }}>
            {championExplanation.headline}
          </span>
          {championExplanation.detail && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))", lineHeight: 1.4 }}>
              {championExplanation.detail}
            </span>
          )}
        </div>
      )}

      {/* Individual awards are shown in the dedicated "Индивидуальные награды" view,
          not here — "Таблица лиги" разбирает только таблицу/позиции/зоны/чемпион/бонусы. */}

      {/* Metrics chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        <MetricChip label="Точные позиции" value={String(score.exact_positions)} />
        <MetricChip label="Ошибка ≤1" value={String(score.errors_le_1)} />
        <MetricChip label="Ошибка ≤2" value={String(score.errors_le_2)} />
        <MetricChip label="Зона ЛЧ" value={`${score.ucl_zone_correct}${score.ucl_zone_full ? " ✓" : ""}`} />
        <MetricChip label="Вылет" value={`${score.relegation_zone_correct}${score.relegation_zone_full ? " ✓" : ""}`} />
        <MetricChip label="Чемпион" value={score.champion_correct ? "угадан" : "мимо"} ok={score.champion_correct === 1} />
      </div>

      {/* Bonuses */}
      {bonuses.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={sectionLabelStyle}>Бонусы</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {bonuses.map((bonus: UserScoreBonus) => (
              <div key={bonus.key} style={bonusRowStyle}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tg-text)" }}>
                  {bonusLabel(bonus)}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 900, color: ACCENT }}>+{bonus.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Teams accordion (native <details>) */}
      {breakdownTeams.length > 0 && (
        <details style={detailsStyle}>
          <summary style={summaryStyle}>
            <span style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>Команды · {breakdownTeams.length}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>раскрыть</span>
          </summary>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {breakdownTeams.map((team: UserScoreTeamBreakdown) => (
              <TeamRow key={team.team_id} team={team} meta={teamMeta.get(team.team_id) ?? null} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function bonusLabel(bonus: UserScoreBonus): string {
  const base = BONUS_LABELS[bonus.key] || bonus.key;
  if (bonus.matched != null && bonus.total != null) return `${base} (${bonus.matched}/${bonus.total})`;
  if (bonus.matched != null) return `${base} (${bonus.matched})`;
  return base;
}

function humanWarning(code: string): string {
  if (code.startsWith("USER_TABLE_DUPLICATES")) return "В прогнозе были повторы команд — учтена первая позиция.";
  if (code.startsWith("USER_TEAMS_NOT_IN_OFFICIAL")) return "Часть команд из твоего прогноза не попала в итоговую таблицу.";
  if (code === "USER_TABLE_EMPTY") return "Таблица прогноза пуста.";
  if (code === "TEAM_IDS_SNAPSHOT_MISMATCH") return "Состав турнира изменился после того, как ты сделал прогноз.";
  if (code.startsWith("OFFICIAL_TABLE_INCOMPLETE")) return "Итоговая таблица заполнена не полностью.";
  return code;
}

function CategoryRow({ label, value, muted, hint, valueText }: { label: string; value?: number; muted?: boolean; hint?: string; valueText?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid color-mix(in srgb, var(--tg-hint) 8%, transparent)" }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: muted ? "var(--tg-hint)" : "var(--tg-text)", minWidth: 0 }}>
        {label}
        {hint && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--tg-hint)" }}>{hint}</span>}
      </span>
      <span style={{ fontSize: 14, fontWeight: 900, color: muted ? "var(--tg-hint)" : "var(--tg-text)" }}>
        {valueText !== undefined ? valueText : (value !== undefined && value > 0 ? `+${value}` : value)}
      </span>
    </div>
  );
}

function MetricChip({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 5, padding: "5px 9px", borderRadius: 999,
      background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, transparent)",
      border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
      fontSize: 11, fontWeight: 700, color: "var(--tg-hint)",
    }}>
      {label}
      <b style={{ fontSize: 12, fontWeight: 900, color: ok ? ACCENT : "var(--tg-text)" }}>{value}</b>
    </span>
  );
}

function TeamRow({ team, meta }: { team: UserScoreTeamBreakdown; meta: TeamMeta | null }) {
  const positionPts = team.position_points || 0;
  const zonePts = team.zone_points || 0;
  const total = positionPts + zonePts;
  const status = team.missing
    ? { label: "нет", color: "var(--tg-hint)" }
    : team.error === 0
      ? { label: "точно", color: ACCENT }
      : (team.error != null && team.error <= 2)
        ? { label: "близко", color: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))" }
        : { label: "мимо", color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))" };
  const displayName = meta?.name || team.team_name || team.team_id;
  return (
    <div style={teamRowStyle}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: status.color, flexShrink: 0 }} />
      {meta?.crest && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={meta.crest} alt="" width={18} height={18} style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0, opacity: 0.92 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
          Твой {team.pos_user ?? "—"} · Итог {team.pos_official ?? "—"}
        </div>
        {!team.missing && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3 }}>
            <span style={teamChipStyle(positionPts > 0)}>позиция {positionPts > 0 ? `+${positionPts}` : "0"}</span>
            <span style={teamChipStyle(zonePts > 0)}>зона {zonePts > 0 ? `+${zonePts}` : "0"}</span>
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: total > 0 ? "var(--tg-text)" : "var(--tg-hint)" }}>
          {total > 0 ? `+${total}` : "0"}
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: status.color }}>{status.label}</div>
      </div>
    </div>
  );
}

const cardStyle = {
  borderRadius: 18,
  padding: 16,
  background: "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 84%, var(--tg-secondary-bg)))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  boxShadow: "0 7px 18px color-mix(in srgb, var(--tg-text) 10%, transparent)",
  color: "var(--tg-text)",
} as const;

const titleStyle = { margin: 0, fontSize: 15, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)" } as const;

const mutedStyle = {
  marginTop: 8, fontSize: 12.5, fontWeight: 700, lineHeight: 1.45,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
} as const;

const pctChipStyle = {
  marginLeft: "auto", display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px",
  borderRadius: 999, fontSize: 12, fontWeight: 900,
  background: "color-mix(in srgb, #34c759 16%, var(--tg-bg))", color: ACCENT,
  border: "1px solid color-mix(in srgb, #34c759 26%, transparent)",
} as const;

const warnStyle = {
  marginTop: 10, padding: "9px 11px", borderRadius: 10,
  background: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #d98a1a 26%, transparent)",
  color: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))",
  fontSize: 11.5, fontWeight: 700, lineHeight: 1.4,
  display: "flex", flexDirection: "column", gap: 3,
} as const;

const sectionLabelStyle = { fontSize: 12, fontWeight: 900, color: "var(--tg-hint)", marginBottom: 6 } as const;

const bonusRowStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  padding: "7px 10px", borderRadius: 8,
  background: "color-mix(in srgb, #34c759 8%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #34c759 16%, transparent)",
} as const;

const detailsStyle = {
  marginTop: 14, borderRadius: 12, padding: "10px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
} as const;

const summaryStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  cursor: "pointer", listStyle: "none", userSelect: "none" as const,
} as const;

const teamRowStyle = {
  display: "flex", alignItems: "center", gap: 8, padding: "7px 0",
  borderBottom: "1px solid color-mix(in srgb, var(--tg-hint) 8%, transparent)",
} as const;

function teamChipStyle(positive: boolean) {
  return {
    display: "inline-flex", alignItems: "center", height: 17, padding: "0 7px", borderRadius: 999,
    fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" as const,
    background: positive ? "color-mix(in srgb, #34c759 12%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-hint) 9%, transparent)",
    color: positive ? ACCENT : "var(--tg-hint)",
    border: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)",
  } as const;
}
