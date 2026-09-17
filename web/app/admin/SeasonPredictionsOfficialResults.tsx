"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatMsk } from "./mskTime";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { LeagueTableOrderEditor, getTeamRef } from "../season-predictions/components/LeagueTableOrderEditor";
import type {
  OfficialAward,
  OfficialAwardType,
  OfficialResultStatus,
  OfficialResultsResponse,
  RecalcRunResult,
  ScoresSummary,
  ScoresSummaryResponse,
  SeasonPredictionAwardCandidate,
  SeasonPredictionTeam,
} from "../season-predictions/types";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

// ── Theme-aware notices & status pill (no hardcoded yellow/blue debug colors) ──

type NoticeTone = "neutral" | "amber" | "success" | "danger" | "info";

function noticeStyle(tone: NoticeTone): CSSProperties {
  const map: Record<NoticeTone, { fg: string; bg: string; border: string }> = {
    neutral: {
      fg: "color-mix(in srgb, var(--tg-text) 70%, var(--tg-hint))",
      bg: "color-mix(in srgb, var(--tg-secondary-bg) 70%, transparent)",
      border: "color-mix(in srgb, var(--tg-hint) 18%, transparent)",
    },
    amber: {
      fg: "color-mix(in srgb, #d98a1a 78%, var(--tg-text))",
      bg: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))",
      border: "color-mix(in srgb, #d98a1a 28%, transparent)",
    },
    success: {
      fg: "color-mix(in srgb, #2ec060 80%, var(--tg-text))",
      bg: "color-mix(in srgb, #2ec060 13%, var(--tg-bg))",
      border: "color-mix(in srgb, #2ec060 28%, transparent)",
    },
    danger: {
      fg: "color-mix(in srgb, #e5484d 82%, var(--tg-text))",
      bg: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))",
      border: "color-mix(in srgb, #e5484d 30%, transparent)",
    },
    info: {
      fg: "color-mix(in srgb, var(--tg-text) 78%, var(--tg-hint))",
      bg: "color-mix(in srgb, var(--tg-secondary-bg) 80%, transparent)",
      border: "color-mix(in srgb, var(--tg-hint) 16%, transparent)",
    },
  };
  const c = map[tone];
  return {
    borderRadius: 12,
    padding: "10px 12px",
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.fg,
    fontSize: 12.5,
    fontWeight: 700,
    lineHeight: 1.45,
  };
}

function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
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
    <span style={{
      padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 900,
      background: c.bg, color: c.fg, whiteSpace: "nowrap",
      border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
    }}>
      {c.label}
    </span>
  );
}

const AWARD_TYPES: Array<{ key: OfficialAwardType; label: string }> = [
  { key: "top_scorer", label: "Лучший бомбардир" },
  { key: "top_assistant", label: "Лучший ассистент" },
  { key: "golden_glove", label: "Золотая перчатка" },
];

function normalizeAwardType(type: string): OfficialAwardType {
  return (type === "top_assister" ? "top_assistant" : type) as OfficialAwardType;
}

function extractOrderedIds(table: unknown): string[] {
  if (Array.isArray(table)) return table.map(String);
  if (!table || typeof table !== "object") return [];
  const t = table as Record<string, unknown>;
  if (Array.isArray(t.ordered_team_ids)) return (t.ordered_team_ids as unknown[]).map(String);
  if (Array.isArray(t.ordered_teams)) {
    return (t.ordered_teams as Array<Record<string, unknown>>)
      .map((item) => String(item.team_ref ?? item.team_id ?? item.id ?? ""))
      .filter(Boolean);
  }
  return [];
}

function buildInitialOrder(teams: SeasonPredictionTeam[], table: unknown): SeasonPredictionTeam[] {
  const byRef = new Map(teams.map((t) => [getTeamRef(t), t]));
  const ids = extractOrderedIds(table);
  const used = new Set<string>();
  const ordered: SeasonPredictionTeam[] = [];
  for (const id of ids) {
    const team = byRef.get(id);
    if (team && !used.has(id)) {
      used.add(id);
      ordered.push(team);
    }
  }
  const rest = teams.filter((t) => !used.has(getTeamRef(t)));
  return [...ordered, ...rest];
}

function buildTableJson(teams: SeasonPredictionTeam[]) {
  return {
    ordered_team_ids: teams.map(getTeamRef),
    ordered_teams: teams.map((t, i) => ({ team_ref: getTeamRef(t), team_name: t.team_name, position: i + 1 })),
    updated_at: new Date().toISOString(),
  };
}

export function SeasonPredictionsOfficialResults({
  fetchWithAuth,
  tournamentCode,
  teamCount,
}: {
  fetchWithAuth: FetchWithAuth;
  tournamentCode: string;
  teamCount: number;
}) {
  const [data, setData] = useState<OfficialResultsResponse | null>(null);
  const [orderedTeams, setOrderedTeams] = useState<SeasonPredictionTeam[]>([]);
  const [awards, setAwards] = useState<Record<OfficialAwardType, string>>({
    top_scorer: "",
    top_assistant: "",
    golden_glove: "",
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [summary, setSummary] = useState<ScoresSummary | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth<ScoresSummaryResponse>(
        `/admin/season-predictions/tournaments/${tournamentCode}/scores/summary`,
      );
      if (res) setSummary(res.summary);
    } catch {
      // Summary is best-effort; ignore load failures.
    }
  }, [fetchWithAuth, tournamentCode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<OfficialResultsResponse>(
        `/admin/season-predictions/tournaments/${tournamentCode}/official-results`,
      );
      if (!res) return;
      setData(res);
      setOrderedTeams(buildInitialOrder(res.teams || [], res.official_result?.table));
      const nextAwards: Record<OfficialAwardType, string> = { top_scorer: "", top_assistant: "", golden_glove: "" };
      for (const award of res.official_awards || []) {
        const key = normalizeAwardType(award.award_type);
        nextAwards[key] = award.award_option_id ? String(award.award_option_id) : (award.player_id ? String(award.player_id) : "");
      }
      setAwards(nextAwards);
      void loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить official results");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, tournamentCode, loadSummary]);

  async function runRecalculate() {
    setSaving("recalc");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<RecalcRunResult>(
        `/admin/season-predictions/tournaments/${tournamentCode}/recalculate`,
        { method: "POST", body: JSON.stringify({ trigger_reason: "manual" }) },
      );
      if (!res) return;
      setNotice(`Пересчёт выполнен: обработано ${res.entries_processed}, пропущено ${res.entries_skipped}, ошибок ${res.entries_failed}. Награды не начислялись.`);
      await loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить пересчёт");
    } finally {
      setSaving("");
    }
  }

  useEffect(() => { void load(); }, [load]);

  const groupedOptions = useMemo(() => {
    const grouped: Record<string, SeasonPredictionAwardCandidate[]> = {};
    const players = data?.players || [];
    const fieldGroups = new Set(["defender", "midfielder", "forward"]);
    if (players.length > 0) {
      for (const { key } of AWARD_TYPES) {
        grouped[key] = players
          .filter((player) => key === "golden_glove" ? player.position_group === "goalkeeper" : fieldGroups.has(player.position_group))
          .map((player) => ({
            id: player.id,
            player_id: player.player_id || player.provider_player_id,
            player_name: player.player_name,
            team_id: player.team_id,
            team_name: player.team_name,
            position: player.position,
            position_group: player.position_group,
            photo_url: player.photo_url,
            source: "players_catalog",
          }));
      }
      return grouped;
    }
    for (const option of data?.award_options || []) {
      const key = normalizeAwardType(option.award_type);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        id: option.id,
        award_option_id: option.id,
        player_id: option.player_id,
        player_name: option.player_name,
        team_id: option.team_id,
        team_name: option.team_name,
        position: null,
        position_group: "unknown",
        photo_url: null,
        source: "award_options",
      });
    }
    return grouped;
  }, [data?.award_options, data?.players]);

  const official = data?.official_result || null;
  const isConfirmed = official?.status === "confirmed";
  const tableComplete = orderedTeams.length === teamCount && teamCount > 0;

  function buildAwardsPayload(): Array<Partial<OfficialAward>> {
    const out: Array<Partial<OfficialAward>> = [];
    for (const { key } of AWARD_TYPES) {
      const optionId = awards[key];
      if (!optionId) continue;
      const option = (groupedOptions[key] || []).find((o) => String(o.award_option_id || o.player_id || o.id) === optionId);
      if (!option) continue;
      out.push({
        award_type: key,
        award_option_id: option.award_option_id ?? null,
        player_id: option.player_id,
        player_name: option.player_name,
        team_id: option.team_id,
        team_name: option.team_name,
      });
    }
    return out;
  }

  async function saveDraft() {
    setSaving("draft");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<OfficialResultsResponse>(
        `/admin/season-predictions/tournaments/${tournamentCode}/official-results`,
        {
          method: "PUT",
          body: JSON.stringify({
            table_json: buildTableJson(orderedTeams),
            awards: buildAwardsPayload(),
            source: "admin_manual",
          }),
        },
      );
      if (!res) return;
      setNotice("Черновик official results сохранён.");
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
      // Persist current draft first so the confirm validates the latest table.
      await fetchWithAuth<OfficialResultsResponse>(
        `/admin/season-predictions/tournaments/${tournamentCode}/official-results`,
        {
          method: "PUT",
          body: JSON.stringify({
            table_json: buildTableJson(orderedTeams),
            awards: buildAwardsPayload(),
            source: "admin_manual",
          }),
        },
      );
      const res = await fetchWithAuth<{ ok: boolean; scoring_triggered: boolean }>(
        `/admin/season-predictions/tournaments/${tournamentCode}/official-results/confirm`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!res) return;
      setNotice("Official results подтверждены. Теперь можно запустить пересчёт scores вручную.");
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
            <div style={{ fontSize: 16, fontWeight: 950 }}>Официальные результаты</div>
            <div style={{ marginTop: 2, fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              {tournamentCode} · нужно ровно {teamCount} команд
            </div>
          </div>
          <StatusPill status={(official?.status as OfficialResultStatus) || "не создано"} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Notice tone="amber">
            Scoring доступен после подтверждения official results. Пересчёт запускается вручную админом — награды и рейтинги не начисляются.
          </Notice>
        </div>
        {error && <div style={{ marginTop: 8 }}><Notice tone="danger">{error}</Notice></div>}
        {notice && <div style={{ marginTop: 8 }}><Notice tone="success">{notice}</Notice></div>}
        {isConfirmed && (
          <div style={{ marginTop: 8 }}>
            <Notice tone="success">
              Результат подтверждён. Чтобы изменить — потребуется supersede.
              <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--tg-hint)" }}>
                Supersede будет добавлен отдельным этапом.
              </div>
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
            Команды турнира не настроены. Сначала заведите команды, потом официальную таблицу.
          </Notice>
        </AdminCard>
      ) : (
        <>
          <AdminCollapsibleSection
            title="Итоговая таблица лиги"
            description={`${orderedTeams.length}/${teamCount} команд · ${String(official?.status || "не создано")}`}
            defaultOpen={!isConfirmed}
            keepMounted
            storageKey={`admin:season-predictions:official-top5:${tournamentCode}:table`}
          >
            <LeagueTableOrderEditor
              teams={orderedTeams}
              zones={(data?.rules_zones as Record<string, unknown>) || {}}
              readOnly={isConfirmed}
              onChange={setOrderedTeams}
            />
          </AdminCollapsibleSection>

          <AdminCollapsibleSection
            title="Официальные награды"
            description={`выбрано ${Object.values(awards).filter(Boolean).length}/${AWARD_TYPES.length}`}
            defaultOpen={!isConfirmed}
            keepMounted
            storageKey={`admin:season-predictions:official-top5:${tournamentCode}:awards`}
          >
            <div style={{ display: "grid", gap: 10 }}>
              {AWARD_TYPES.map(({ key, label }) => {
                const options = groupedOptions[key] || [];
                return (
                  <label key={key} style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 900, color: "var(--tg-hint, #999)" }}>
                    {label}
                    <select
                      value={awards[key]}
                      disabled={isConfirmed || options.length === 0}
                      onChange={(event) => setAwards((prev) => ({ ...prev, [key]: event.target.value }))}
                      style={{
                        width: "100%", minHeight: 44, borderRadius: 12, padding: "0 12px",
                        border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
                        background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))",
                        color: "var(--tg-text, #fff)", fontSize: 13, fontWeight: 700, outline: "none",
                      }}
                    >
                      <option value="">{options.length === 0 ? "Нет кандидатов" : "Не выбрано"}</option>
                      {options.map((option) => (
                          <option key={option.id || option.player_id || option.player_name} value={String(option.award_option_id || option.player_id || option.id)}>
                          {option.player_name}{option.team_name ? ` · ${option.team_name}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700 }}>
              Кандидаты берутся из award_options турнира. Награды необязательны — golden glove может не присуждаться.
            </div>
            <div style={{ marginTop: 8 }}>
              <Notice tone="info">
                Индивидуальные награды на этапе top5_v1 не дают рейтинговые очки и не влияют на максимум (163 для PL). Учитывается только awards_correct для будущих заданий.
              </Notice>
            </div>
          </AdminCollapsibleSection>

          {!isConfirmed && (
            <div style={{ display: "flex", gap: 8 }}>
              <AdminButton variant="secondary" onClick={saveDraft} disabled={saving !== ""} className="flex-1">
                {saving === "draft" ? "Сохраняю..." : "Сохранить draft"}
              </AdminButton>
              <AdminButton onClick={confirm} disabled={saving !== "" || !tableComplete} className="flex-1">
                {saving === "confirm" ? "Подтверждаю..." : "Подтвердить official results"}
              </AdminButton>
            </div>
          )}
          {!isConfirmed && !tableComplete && (
            <Notice tone="amber">
              В таблице должно быть ровно {teamCount} команд для подтверждения (сейчас {orderedTeams.length}).
            </Notice>
          )}

          {/* Stage S2: manual recalculate */}
          <AdminCollapsibleSection
            title="Пересчёт scores"
            description={isConfirmed ? "доступен · награды/рейтинги не начисляются" : "доступен после подтверждения результатов"}
            defaultOpen={isConfirmed}
            storageKey={`admin:season-predictions:official-top5:${tournamentCode}:recalc`}
          >
            <Notice tone="info">
              Пересчёт создаёт/обновляет внутренние scores по формуле <b>top5_v1</b>. Награды и рейтинги не начисляются.
            </Notice>
            {!isConfirmed ? (
              <div style={{ marginTop: 10 }}>
                <AdminButton disabled className="w-full">Запустить пересчёт</AdminButton>
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, textAlign: "center" }}>
                  Сначала подтвердите official results.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <AdminButton onClick={runRecalculate} disabled={saving !== ""} className="w-full">
                  {saving === "recalc" ? "Пересчитываю..." : "Запустить пересчёт"}
                </AdminButton>
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
                          background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)",
                          fontSize: 12,
                        }}>
                          <span style={{ minWidth: 20, fontWeight: 900, color: "var(--tg-hint)" }}>{row.rank}.</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, color: "var(--tg-text)" }}>
                            {row.display_name}
                          </span>
                          <span style={{ fontWeight: 900, color: "var(--tg-text)" }}>{row.total_points}</span>
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
  const fg = tone === "danger"
    ? "color-mix(in srgb, #e5484d 82%, var(--tg-text))"
    : "var(--tg-text)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 5,
      padding: "5px 9px", borderRadius: 999,
      background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, transparent)",
      border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
      fontSize: 11, fontWeight: 700, color: "var(--tg-hint)",
    }}>
      {label}
      <b style={{ fontSize: 12, fontWeight: 900, color: fg }}>{value}</b>
    </span>
  );
}
