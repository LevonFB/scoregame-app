"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { formatMsk } from "./mskTime";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { LeagueTableOrderEditor, getTeamRef } from "../season-predictions/components/LeagueTableOrderEditor";
import type { OfficialResultStatus, SeasonPredictionTeam } from "../season-predictions/types";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

// E1 — eurocup league-stage official results (admin foundation, no scoring).
const EUROCUP_TEAM_COUNT = 36;

// League-stage zones as position ranges, so LeagueTableOrderEditor highlights them.
const EUROCUP_ZONE_RANGES: Record<string, [number, number]> = {
  top8: [1, 8],
  playoff_9_24: [9, 24],
  eliminated: [25, 36],
};

type EurocupOfficialResult = {
  status: OfficialResultStatus;
  table: unknown;
  zones_snapshot: unknown;
  confirmed_at: number | null;
} | null;

type EurocupOfficialResponse = {
  ok: boolean;
  tournament: { tournament_code: string; title: string };
  official_result: EurocupOfficialResult;
  teams: SeasonPredictionTeam[];
  team_count: number;
  scoring_enabled: boolean;
};

type EurocupScoresSummary = {
  recalc_id: number;
  formula_version: string;
  trigger_reason?: string | null;
  entries_processed: number;
  entries_skipped: number;
  entries_failed: number;
  avg_points: number | null;
  max_points: number | null;
  scored_at: number | null;
  top10: Array<{ rank: number; user_id: number; display_name: string; total_points: number; max_possible_points: number; points_pct: number }>;
};

type EurocupRecalcStage = "league" | "ties" | "r16" | "qf" | "sf" | "final" | "full";

type StageRecalcResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  formula_version: string;
  stage: EurocupRecalcStage;
  processed: number;
  skipped: number;
  failed: number;
  avg_score: number;
  max_score: number;
  max_possible_points: number;
  recalc_id: number;
  rewards_triggered: false;
};

type KnockoutMatch = {
  stage: string;
  status?: string | null;
  winner_team_id?: string | null;
};

type KnockoutResponse = {
  ok: boolean;
  matches: KnockoutMatch[];
};

const RECALC_STAGE_DEFS: Array<{
  stage: EurocupRecalcStage;
  officialStage: string | null;
  title: string;
  button: string;
  required: number;
}> = [
  { stage: "league", officialStage: null, title: "Стадия лиги", button: "Пересчитать стадию лиги", required: 0 },
  { stage: "ties", officialStage: "knockout_playoffs", title: "Стыки", button: "Пересчитать стыки", required: 8 },
  { stage: "r16", officialStage: "round_of_16", title: "1/8 финала", button: "Пересчитать после 1/8", required: 8 },
  { stage: "qf", officialStage: "quarter_final", title: "1/4 финала", button: "Пересчитать после 1/4", required: 4 },
  { stage: "sf", officialStage: "semi_final", title: "1/2 финала", button: "Пересчитать после 1/2", required: 2 },
  { stage: "final", officialStage: "final", title: "Финал", button: "Финальный пересчёт", required: 1 },
  { stage: "full", officialStage: null, title: "Полный progressive", button: "Полный пересчёт", required: 0 },
];

function noticeStyle(tone: "amber" | "success" | "danger" | "info"): CSSProperties {
  const map = {
    amber: { fg: "color-mix(in srgb, #d98a1a 78%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "color-mix(in srgb, #d98a1a 28%, transparent)" },
    success: { fg: "color-mix(in srgb, #2ec060 80%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 13%, var(--tg-bg))", border: "color-mix(in srgb, #2ec060 28%, transparent)" },
    danger: { fg: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", bg: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "color-mix(in srgb, #e5484d 30%, transparent)" },
    info: { fg: "color-mix(in srgb, var(--tg-text) 78%, var(--tg-hint))", bg: "color-mix(in srgb, var(--tg-secondary-bg) 80%, transparent)", border: "color-mix(in srgb, var(--tg-hint) 16%, transparent)" },
  } as const;
  const c = map[tone];
  return { borderRadius: 12, padding: "10px 12px", background: c.bg, border: `1px solid ${c.border}`, color: c.fg, fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 };
}

function Notice({ tone, children }: { tone: "amber" | "success" | "danger" | "info"; children: ReactNode }) {
  return <div style={noticeStyle(tone)}>{children}</div>;
}

function StatusPill({ status }: { status: OfficialResultStatus | "не создано" }) {
  const map: Record<string, { fg: string; bg: string; label: string }> = {
    draft: { fg: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 14%, var(--tg-bg))", label: "draft" },
    confirmed: { fg: "color-mix(in srgb, #2ec060 82%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 15%, var(--tg-bg))", label: "confirmed" },
    published: { fg: "color-mix(in srgb, #2ec060 82%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 15%, var(--tg-bg))", label: "published" },
    superseded: { fg: "var(--tg-hint)", bg: "color-mix(in srgb, var(--tg-hint) 12%, transparent)", label: "superseded" },
    "не создано": { fg: "var(--tg-hint)", bg: "color-mix(in srgb, var(--tg-hint) 12%, transparent)", label: "не создано" },
  };
  const c = map[status] || map["не создано"];
  return (
    <span style={{ padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 900, background: c.bg, color: c.fg, whiteSpace: "nowrap", border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)" }}>
      {c.label}
    </span>
  );
}

function extractOrderedIds(table: unknown): string[] {
  if (Array.isArray(table)) return table.map((it) => (typeof it === "object" && it ? String((it as Record<string, unknown>).team_ref ?? (it as Record<string, unknown>).team_id ?? (it as Record<string, unknown>).id ?? "") : String(it))).filter(Boolean);
  if (!table || typeof table !== "object") return [];
  const t = table as Record<string, unknown>;
  if (Array.isArray(t.ordered_team_ids)) return (t.ordered_team_ids as unknown[]).map(String);
  if (Array.isArray(t.ordered_teams)) {
    return (t.ordered_teams as Array<Record<string, unknown>>).map((item) => String(item.team_ref ?? item.team_id ?? item.id ?? "")).filter(Boolean);
  }
  return [];
}

function buildInitialOrder(teams: SeasonPredictionTeam[], table: unknown): SeasonPredictionTeam[] {
  const byRef = new Map(teams.map((t) => [getTeamRef(t), t]));
  const used = new Set<string>();
  const ordered: SeasonPredictionTeam[] = [];
  for (const id of extractOrderedIds(table)) {
    const team = byRef.get(id);
    if (team && !used.has(id)) { used.add(id); ordered.push(team); }
  }
  return [...ordered, ...teams.filter((t) => !used.has(getTeamRef(t)))];
}

function buildTableJson(teams: SeasonPredictionTeam[]) {
  return {
    ordered_team_ids: teams.map(getTeamRef),
    ordered_teams: teams.map((t, i) => ({ team_ref: getTeamRef(t), team_name: t.team_name, position: i + 1 })),
    updated_at: new Date().toISOString(),
  };
}

function stageLabel(stage: EurocupRecalcStage) {
  return RECALC_STAGE_DEFS.find((item) => item.stage === stage)?.title || stage;
}

function countConfirmedStageWinners(matches: KnockoutMatch[] | undefined, officialStage: string) {
  return (matches || []).filter((m) =>
    m.stage === officialStage &&
    m.status !== "void" &&
    !!m.winner_team_id,
  ).length;
}

export function SeasonPredictionsEurocupOfficialResults({
  fetchWithAuth,
  tournamentCode,
}: {
  fetchWithAuth: FetchWithAuth;
  tournamentCode: string;
}) {
  const [data, setData] = useState<EurocupOfficialResponse | null>(null);
  const [knockout, setKnockout] = useState<KnockoutResponse | null>(null);
  const [orderedTeams, setOrderedTeams] = useState<SeasonPredictionTeam[]>([]);
  const [summary, setSummary] = useState<EurocupScoresSummary | null>(null);
  const [stageResult, setStageResult] = useState<StageRecalcResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth<{ ok: boolean; summary: EurocupScoresSummary | null }>(
        `/admin/season-predictions/eurocups/${tournamentCode}/scores/summary`,
      );
      if (res) setSummary(res.summary);
    } catch {
      // Summary is best-effort.
    }
  }, [fetchWithAuth, tournamentCode]);

  const loadKnockout = useCallback(async () => {
    try {
      const res = await fetchWithAuth<KnockoutResponse>(
        `/admin/season-predictions/eurocups/${tournamentCode}/knockout`,
      );
      if (res) setKnockout(res);
    } catch {
      // Knockout status is best-effort for disabling stage recalc buttons.
    }
  }, [fetchWithAuth, tournamentCode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<EurocupOfficialResponse>(
        `/admin/season-predictions/eurocups/${tournamentCode}/official-results`,
      );
      if (!res) return;
      setData(res);
      setOrderedTeams(buildInitialOrder(res.teams || [], res.official_result?.table));
      void loadSummary();
      void loadKnockout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить official results");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, tournamentCode, loadSummary, loadKnockout]);

  useEffect(() => { void load(); }, [load]);

  async function runRecalculateStage(stage: EurocupRecalcStage) {
    setSaving(`recalc_stage:${stage}`);
    setError("");
    setNotice("");
    setStageResult(null);
    try {
      const res = await fetchWithAuth<StageRecalcResponse>(
        `/admin/season-predictions/eurocups/${tournamentCode}/recalculate-stage`,
        { method: "POST", body: JSON.stringify({ stage }) },
      );
      if (!res) return;
      setStageResult(res);
      setNotice(`Пересчёт выполнен: ${stageLabel(stage)} · обработано ${res.processed}, пропущено ${res.skipped}, ошибок ${res.failed}. Награды не начислялись.`);
      await loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить поэтапный пересчёт");
    } finally {
      setSaving("");
    }
  }

  const official = data?.official_result || null;
  const isConfirmed = official?.status === "confirmed";
  const tableComplete = orderedTeams.length === EUROCUP_TEAM_COUNT;

  async function saveDraft() {
    setSaving("draft");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<EurocupOfficialResponse>(
        `/admin/season-predictions/eurocups/${tournamentCode}/official-results`,
        { method: "PUT", body: JSON.stringify({ table_json: buildTableJson(orderedTeams), source: "admin_manual" }) },
      );
      if (!res) return;
      setNotice("Черновик official results стадии лиги сохранён.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить черновик");
    } finally {
      setSaving("");
    }
  }

  async function confirm() {
    setSaving("confirm");
    setError("");
    setNotice("");
    try {
      await fetchWithAuth<EurocupOfficialResponse>(
        `/admin/season-predictions/eurocups/${tournamentCode}/official-results`,
        { method: "PUT", body: JSON.stringify({ table_json: buildTableJson(orderedTeams), source: "admin_manual" }) },
      );
      const res = await fetchWithAuth<{ ok: boolean; status: string; scoring_triggered: boolean }>(
        `/admin/season-predictions/eurocups/${tournamentCode}/official-results/confirm`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!res) return;
      setNotice("Official results стадии лиги подтверждены. Scoring на этапе E1 не запускается.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось подтвердить official results");
    } finally {
      setSaving("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <AdminCard>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Официальные результаты (стадия лиги)</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              {tournamentCode} · нужно ровно {EUROCUP_TEAM_COUNT} команд
            </div>
          </div>
          <StatusPill status={(official?.status as OfficialResultStatus) || "не создано"} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Notice tone="amber">
            Scoring еврокубков пока не запускается на этапе E1. Подтверждение фиксирует только официальную таблицу стадии лиги.
          </Notice>
        </div>
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          <ZoneLegend label="Топ-8" range="1–8" color="#45caff" />
          <ZoneLegend label="Стыки" range="9–24" color="#ffb020" />
          <ZoneLegend label="Вылет" range="25–36" color="#ff5b57" />
        </div>
        {error && <div style={{ marginTop: 8 }}><Notice tone="danger">{error}</Notice></div>}
        {notice && <div style={{ marginTop: 8 }}><Notice tone="success">{notice}</Notice></div>}
        {isConfirmed && (
          <div style={{ marginTop: 8 }}>
            <Notice tone="success">
              Результат подтверждён и доступен только для чтения. Чтобы изменить — потребуется supersede (отдельный этап).
            </Notice>
          </div>
        )}
      </AdminCard>

      {loading && !data ? (
        <AdminCard>
          <div style={{ padding: 12, textAlign: "center", color: "var(--tg-hint, #999)", fontWeight: 800 }}>Загрузка...</div>
        </AdminCard>
      ) : (data?.teams || []).length === 0 ? (
        <AdminCard>
          <Notice tone="amber">
            Команды турнира не настроены. Сначала заведите 36 команд стадии лиги, потом официальную таблицу.
          </Notice>
        </AdminCard>
      ) : (
        <>
          <AdminCollapsibleSection
            title="Итоговая таблица стадии лиги"
            description={`${orderedTeams.length}/${EUROCUP_TEAM_COUNT} команд · ${String(official?.status || "не создано")}`}
            defaultOpen={!isConfirmed}
            keepMounted
            storageKey={`admin:season-predictions:official-eurocup:${tournamentCode}:table`}
          >
            <LeagueTableOrderEditor
              teams={orderedTeams}
              zones={EUROCUP_ZONE_RANGES}
              readOnly={isConfirmed}
              onChange={setOrderedTeams}
            />
          </AdminCollapsibleSection>

          {!isConfirmed && (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                <AdminButton variant="secondary" onClick={saveDraft} disabled={saving !== ""} className="flex-1">
                  {saving === "draft" ? "Сохраняю..." : "Сохранить draft"}
                </AdminButton>
                <AdminButton onClick={confirm} disabled={saving !== "" || !tableComplete} className="flex-1">
                  {saving === "confirm" ? "Подтверждаю..." : "Подтвердить official results"}
                </AdminButton>
              </div>
              {!tableComplete && (
                <Notice tone="amber">
                  В таблице должно быть ровно {EUROCUP_TEAM_COUNT} команд для подтверждения (сейчас {orderedTeams.length}).
                </Notice>
              )}
            </>
          )}

          {/* Stage E8: staged recalculation controls. */}
          <AdminCollapsibleSection
            title="Пересчёт очков"
            description={isConfirmed ? "поэтапный · награды не начисляются" : "доступен после подтверждения результатов"}
            defaultOpen={isConfirmed}
            storageKey={`admin:season-predictions:official-eurocup:${tournamentCode}:recalc`}
          >
            <Notice tone="info">
              Поэтапный пересчёт считает только выбранный подтверждённый scope: лига, стыки, 1/8, 1/4, 1/2 или финал. Full остаётся progressive и берёт всё подтверждённое. Награды не начисляются.
            </Notice>
            {!isConfirmed ? (
              <div style={{ marginTop: 10 }}>
                <AdminButton disabled className="w-full">Запустить пересчёт</AdminButton>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, textAlign: "center" }}>
                  Сначала подтвердите official results.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
                {RECALC_STAGE_DEFS.map((def) => {
                  const done = def.officialStage ? countConfirmedStageWinners(knockout?.matches, def.officialStage) : 0;
                  const ready = def.stage === "league" || def.stage === "full" ? isConfirmed : done >= def.required;
                  const lastThisStage = summary?.trigger_reason === `eurocups_full:${def.stage}`;
                  const busy = saving === `recalc_stage:${def.stage}`;
                  return (
                    <div key={def.stage} style={recalcStageCardStyle(ready)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 950, color: "var(--tg-text)" }}>{def.title}</div>
                          <div style={{ marginTop: 2, fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>
                            {def.required > 0 ? `Результаты: ${done}/${def.required}` : def.stage === "full" ? "Всё подтверждённое" : "Таблица лиги"}
                          </div>
                        </div>
                        <span style={stageStatusPillStyle(ready, lastThisStage)}>
                          {lastThisStage ? "Уже пересчитано" : ready ? "Готово" : "Нет результатов"}
                        </span>
                      </div>
                      <AdminButton
                        onClick={() => runRecalculateStage(def.stage)}
                        disabled={saving !== "" || !ready}
                        className="w-full"
                      >
                        {busy ? "Пересчитываю..." : def.button}
                      </AdminButton>
                    </div>
                  );
                })}
              </div>
            )}

            {stageResult && (
              <div style={{ marginTop: 12 }}>
                <Notice tone={stageResult.failed > 0 ? "amber" : "success"}>
                  <b>{stageLabel(stageResult.stage)}</b>: processed {stageResult.processed}, skipped {stageResult.skipped}, failed {stageResult.failed}, avg {stageResult.avg_score}, max score {stageResult.max_score}, max possible {stageResult.max_possible_points}, formula {stageResult.formula_version}, rewards_triggered:false.
                </Notice>
              </div>
            )}

            {summary && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <SummaryChip label="Обработано" value={String(summary.entries_processed)} />
                  <SummaryChip label="Пропущено" value={String(summary.entries_skipped)} />
                  <SummaryChip label="Ошибок" value={String(summary.entries_failed)} tone={summary.entries_failed > 0 ? "danger" : "neutral"} />
                  <SummaryChip label="Средний балл" value={summary.avg_points == null ? "—" : String(summary.avg_points)} />
                  <SummaryChip label="Максимум" value={summary.max_points == null ? "—" : String(summary.max_points)} />
                  <SummaryChip label="Формула" value={summary.formula_version} />
                  <SummaryChip label="Этап" value={summary.trigger_reason?.replace("eurocups_full:", "") || "—"} />
                </div>
                <div style={{ fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
                  Последний пересчёт: {summary.scored_at ? formatMsk(summary.scored_at) : "—"}
                </div>
                {summary.top10.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)", marginBottom: 6 }}>Топ-10 (sanity preview)</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {summary.top10.map((row) => (
                        <div key={row.user_id} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          padding: "6px 10px", borderRadius: 8,
                          background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)", fontSize: 12,
                        }}>
                          <span style={{ minWidth: 20, fontWeight: 900, color: "var(--tg-hint)" }}>{row.rank}.</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, color: "var(--tg-text)" }}>
                            {row.display_name}
                          </span>
                          <span style={{ fontWeight: 900, color: "var(--tg-text)" }}>{row.total_points}/{row.max_possible_points}</span>
                          <span style={{ fontSize: 11, color: "var(--tg-hint)", fontWeight: 700 }}>{Math.round(row.points_pct * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </AdminCollapsibleSection>
        </>
      )}
    </div>
  );
}

function SummaryChip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  const fg = tone === "danger" ? "color-mix(in srgb, #e5484d 82%, var(--tg-text))" : "var(--tg-text)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 5, padding: "5px 9px", borderRadius: 999,
      background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, transparent)",
      border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
      fontSize: 11, fontWeight: 700, color: "var(--tg-hint)",
    }}>
      {label}
      <b style={{ fontSize: 12, fontWeight: 900, color: fg }}>{value}</b>
    </span>
  );
}

function recalcStageCardStyle(ready: boolean): CSSProperties {
  return {
    borderRadius: 12,
    padding: "10px 11px",
    display: "flex",
    flexDirection: "column",
    gap: 9,
    background: ready
      ? "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))"
      : "color-mix(in srgb, var(--tg-secondary-bg) 48%, var(--tg-bg))",
    border: ready
      ? "1px solid color-mix(in srgb, #2ec060 18%, var(--tg-hint))"
      : "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
    opacity: ready ? 1 : 0.72,
  };
}

function stageStatusPillStyle(ready: boolean, lastThisStage: boolean): CSSProperties {
  const color = lastThisStage ? "#2ec060" : ready ? "#d98a1a" : "var(--tg-hint)";
  return {
    flexShrink: 0,
    minHeight: 20,
    display: "inline-flex",
    alignItems: "center",
    padding: "0 8px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 900,
    color: `color-mix(in srgb, ${color} 82%, var(--tg-text))`,
    background: `color-mix(in srgb, ${color} 12%, var(--tg-bg))`,
    border: `1px solid color-mix(in srgb, ${color} 22%, transparent)`,
    whiteSpace: "nowrap",
  };
}

function ZoneLegend({ label, range, color }: { label: string; range: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", borderRadius: 999,
      background: `color-mix(in srgb, ${color} 14%, var(--tg-bg))`,
      border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      fontSize: 11, fontWeight: 850, color: `color-mix(in srgb, ${color} 82%, var(--tg-text))`, whiteSpace: "nowrap",
    }}>
      {label} · {range}
    </span>
  );
}
