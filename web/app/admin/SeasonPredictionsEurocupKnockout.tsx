"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

// Russian plural for pairs (1 матч / 2-4 пары / else пар).
function pairsWord(n: number): string {
  if (n === 1) return "матч";
  const d = n % 10;
  const dd = n % 100;
  if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return "пары";
  return "пар";
}

// E6 — eurocup playoff (knockout) admin foundation. Pairings + winners only.
// No scoring / recalc / leaderboard / rewards.

type KnockoutStageDef = { stage: string; label: string; count: number; keyPart: string };
type KnockoutMatch = {
  match_key: string;
  stage: string;
  match_order: number;
  team_a_id: string | null;
  team_b_id: string | null;
  winner_team_id: string | null;
  status: string;
  known: boolean;
};
type Team = { team_id?: string; id?: number; team_name?: string; short_name?: string };
type R16Eligibility = {
  top8: string[];
  playoff_winners: string[];
  eligible_team_ids: string[];
  top8_confirmed: boolean;
  winners_confirmed: boolean;
  ready: boolean;
};
type KnockoutResponse = {
  ok: boolean;
  teams: Team[];
  stages: KnockoutStageDef[];
  matches: KnockoutMatch[];
  official_league_stage: { confirmed: boolean; top8: string[]; playoff_9_24: string[]; eliminated: string[] };
  r16_eligibility?: R16Eligibility;
  downstream_diagnostics?: {
    r16_winners_found: number;
    qf_generated: number;
    generated_on_load: number;
  };
  bracket_sources?: Record<string, { stage: string; a: string; b: string }>;
  bootstrapped: boolean;
  notice: string;
};

type Draft = { team_a_id: string; team_b_id: string; winner_team_id: string; status: string };

function teamId(t: Team): string { return String(t.team_id ?? t.id ?? ""); }

export function SeasonPredictionsEurocupKnockout({
  fetchWithAuth,
  tournamentCode,
}: {
  fetchWithAuth: FetchWithAuth;
  tournamentCode: string;
}) {
  const [data, setData] = useState<KnockoutResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<{ stage: string; label: string; status: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth<KnockoutResponse>(`/admin/season-predictions/eurocups/${tournamentCode}/knockout`);
      if (res) {
        setData(res);
        const next: Record<string, Draft> = {};
        for (const m of res.matches) {
          next[m.match_key] = {
            team_a_id: m.team_a_id || "",
            team_b_id: m.team_b_id || "",
            winner_team_id: m.winner_team_id || "",
            status: m.status || "draft",
          };
        }
        setDrafts(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить плей-офф");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, tournamentCode]);

  useEffect(() => { void load(); }, [load]);

  const teamName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.teams || []) map.set(teamId(t), String(t.short_name || t.team_name || teamId(t)));
    return (id: string | null | undefined) => (id ? (map.get(id) || id) : "—");
  }, [data?.teams]);

  const zone924 = useMemo(() => new Set(data?.official_league_stage.playoff_9_24 || []), [data]);
  // 1/8 eligible pool = top-8 + playoff winners (never all 36 teams).
  const r16Eligible = useMemo(() => new Set(data?.r16_eligibility?.eligible_team_ids || []), [data]);

  async function bootstrap() {
    setSaving("bootstrap");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; created_total: number }>(
        `/admin/season-predictions/eurocups/${tournamentCode}/knockout/bootstrap`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (res?.ok) {
        setNotice(`Заготовка плей-офф готова: ${res.created_total} матчей.`);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать заготовку");
    } finally {
      setSaving("");
    }
  }

  async function saveMatches() {
    if (!data) return;
    setSaving("matches");
    setError("");
    setNotice("");
    try {
      const matches = data.matches.map((m) => {
        const d = drafts[m.match_key];
        return {
          match_key: m.match_key,
          team_a_id: d?.team_a_id || null,
          team_b_id: d?.team_b_id || null,
          winner_team_id: d?.winner_team_id || null,
          status: d?.status || "draft",
        };
      });
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>(
        `/admin/season-predictions/eurocups/${tournamentCode}/knockout/matches`,
        { method: "PUT", body: JSON.stringify({ matches }) },
      );
      if (res?.ok) {
        setNotice("Пары и победители сохранены.");
        await load();
      } else {
        setError(res?.error || "Не удалось сохранить");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving("");
    }
  }

  function setDraft(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  // Bulk: apply one status to every match of a stage (with a confirm step).
  function requestBulk(stage: string, label: string, status: string) {
    setError("");
    setNotice("");
    setConfirm({ stage, label, status });
  }

  async function applyBulk() {
    if (!confirm) return;
    const { stage, label, status } = confirm;
    setConfirm(null);
    setSaving("bulk");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{
        ok: boolean; error?: string; message?: string; missing_match_keys?: string[];
        updated?: number; skipped?: number; downstream_generated?: boolean; downstream_count?: number;
      }>(
        `/admin/season-predictions/eurocups/${tournamentCode}/knockout/stages/${stage}/status`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
      if (res?.ok) {
        let msg = `Статус «${EUROCUP_MATCH_STATUS_LABEL[status] || status}» применён к ${res.updated ?? 0} матчам стадии «${label}».`;
        if (res.downstream_generated) msg += " Пары следующей стадии сформированы автоматически.";
        setNotice(msg);
        await load();
      } else if (res) {
        const miss = res.missing_match_keys?.length ? ` (${res.missing_match_keys.join(", ")})` : "";
        setError((res.message || res.error || "Не удалось применить статус.") + miss);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить статус.");
    } finally {
      setSaving("");
    }
  }

  const matchesByStage = useMemo(() => {
    const groups: Array<{ def: KnockoutStageDef; matches: KnockoutMatch[] }> = [];
    for (const def of data?.stages || []) {
      groups.push({ def, matches: (data?.matches || []).filter((m) => m.stage === def.stage) });
    }
    return groups;
  }, [data]);

  // Per-stage status for the collapsible headers + which stage opens by default.
  // Pure derivation from saved matches (no scoring/path changes). A downstream stage
  // (QF/SF/Final) is "blocked" until its pairs are auto-generated from the previous
  // stage; "errored" if the previous stage is completed but pairs are still missing.
  const { stageInfos, firstActionStage } = useMemo(() => {
    let prevCompleted = true;
    let firstAction: string | null = null;
    const infos = matchesByStage.map(({ def, matches }) => {
      const liveMatches = matches.filter((m) => m.status !== "void");
      const pairs = liveMatches.length;
      const pairsReady = liveMatches.filter((m) => m.team_a_id && m.team_b_id).length;
      const winners = liveMatches.filter((m) => m.winner_team_id).length;
      const isDownstream = ["quarter_final", "semi_final", "final"].includes(def.stage);
      const allCompleted = pairs > 0 && liveMatches.every((m) => m.status === "completed");
      const ready = pairs > 0 && pairsReady === pairs;
      const confirmedReady = pairs > 0 && liveMatches.every((m) => m.team_a_id && m.team_b_id);
      const completedReady = pairs > 0 && liveMatches.every((m) => m.team_a_id && m.team_b_id && m.winner_team_id);
      const blocked = isDownstream && !ready;
      const errored = isDownstream && prevCompleted && !ready; // prev done but pairs not generated
      const actionable = !allCompleted && !blocked;
      if (!firstAction && (actionable || errored)) firstAction = def.stage;
      prevCompleted = allCompleted;
      return { def, matches, liveMatches, pairs, winners, allCompleted, ready, blocked, errored, actionable, confirmedReady, completedReady };
    });
    return { stageInfos: infos, firstActionStage: firstAction };
  }, [matchesByStage]);

  return (
    <AdminCard>
      <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 4 }}>Плей-офф</div>
      <div style={helperStyle}>
        Заготовка плей-офф: пары стыков (из официальной зоны 9–24), 1/8, 1/4, 1/2, финал. Очки не считаются — это подготовка к этапу E7.
      </div>

      {error && <div style={{ ...noticeBox("danger"), marginTop: 10 }}>{error}</div>}
      {notice && <div style={{ ...noticeBox("success"), marginTop: 10 }}>{notice}</div>}

      {loading && <div style={{ marginTop: 12, color: "var(--tg-hint)", fontSize: 13, fontWeight: 700 }}>Загрузка…</div>}

      {!loading && data && (
        <>
          {!data.official_league_stage.confirmed && (
            <div style={{ ...noticeBox("amber"), marginTop: 10 }}>
              Официальная таблица лиги не подтверждена. Зона 9–24 для стыков станет доступна после подтверждения.
            </div>
          )}

          {/* Step 1: eligibility summary for the 1/8 (top-8 + playoff winners). */}
          {data.r16_eligibility && (
            <div style={{ ...noticeBox(data.r16_eligibility.ready ? "success" : "amber"), marginTop: 10 }}>
              <div>Топ-8 стадии лиги: {data.r16_eligibility.top8.length}/8</div>
              <div>Победители стыков: {data.r16_eligibility.playoff_winners.length}/8</div>
              <div>Итого команд 1/8: {data.r16_eligibility.eligible_team_ids.length}/16</div>
              {!data.r16_eligibility.top8_confirmed && <div style={{ marginTop: 3 }}>Сначала подтвердите результаты стадии лиги.</div>}
              {data.r16_eligibility.top8_confirmed && !data.r16_eligibility.winners_confirmed && <div style={{ marginTop: 3 }}>Сначала подтвердите победителей стыков.</div>}
            </div>
          )}
          {data.downstream_diagnostics && data.downstream_diagnostics.generated_on_load > 0 && (
            <div style={{ ...noticeBox("success"), marginTop: 10 }}>
              Автоматически сформированы пары следующей стадии: {data.downstream_diagnostics.generated_on_load}.
            </div>
          )}
          {data.downstream_diagnostics && data.downstream_diagnostics.r16_winners_found >= 8 && data.downstream_diagnostics.qf_generated < 4 && (
            <div style={{ ...noticeBox("danger"), marginTop: 10 }}>
              R16 winners found: {data.downstream_diagnostics.r16_winners_found}/8 · QF generated: {data.downstream_diagnostics.qf_generated}/4. Обновите страницу или сохраните результаты ещё раз; если не поможет, это backend bug.
            </div>
          )}

          {!data.bootstrapped ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tg-hint)", marginBottom: 8 }}>
                Слоты плей-офф ещё не созданы.
              </div>
              <AdminButton onClick={bootstrap} disabled={saving !== ""}>
                {saving === "bootstrap" ? "Создаю…" : "Создать заготовку плей-офф"}
              </AdminButton>
            </div>
          ) : (
            <>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {stageInfos.map((info) => {
                  const { def, matches, liveMatches, confirmedReady, completedReady } = info;
                  const pw = pairsWord(def.count);
                  const statusWord = info.allCompleted ? "completed" : info.errored ? "ошибка" : info.blocked ? "ожидание" : "draft";
                  const subtitle = info.blocked && !info.errored
                    ? `${def.count} ${pw} · появится после подтверждения предыдущей стадии`
                    : def.stage === "final"
                      ? `1 матч · ${info.winners >= 1 ? "чемпион выбран" : "чемпион не выбран"} · ${statusWord}`
                      : `${def.count} ${pw} · победители ${info.winners}/${info.pairs || def.count} · ${statusWord}`;
                  return (
                  <AdminCollapsibleSection
                    key={def.stage}
                    title={def.label}
                    description={subtitle}
                    defaultOpen={def.stage === firstActionStage}
                    forceOpen={info.errored}
                    storageKey={`admin:season-predictions:eurocup:${tournamentCode}:${def.keyPart}`}
                    badge={
                      info.allCompleted ? <span style={stageBadgeStyle("done")}>завершено</span>
                        : info.errored ? <span style={stageBadgeStyle("error")}>Ошибка</span>
                          : info.blocked ? <span style={stageBadgeStyle("muted")}>Ожидание</span>
                            : <span style={stageBadgeStyle("action")}>Нужно действие</span>
                    }
                  >
                    {/* Bulk: apply one status to all matches of this stage. */}
                    <div style={bulkRowStyle}>
                      <span style={bulkCaptionStyle}>Статус для всей стадии:</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <BulkBtn label="Все draft" onClick={() => requestBulk(def.stage, def.label, "draft")} disabled={saving !== "" || liveMatches.length === 0} />
                        <BulkBtn label="Все confirmed" onClick={() => requestBulk(def.stage, def.label, "confirmed")} disabled={saving !== "" || !confirmedReady} />
                        <BulkBtn label="Все completed" onClick={() => requestBulk(def.stage, def.label, "completed")} disabled={saving !== "" || !completedReady} />
                      </div>
                      {!completedReady && (
                        <span style={bulkHintStyle}>Для completed выберите победителей во всех матчах стадии и сохраните.</span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {matches.map((m) => {
                        const d = drafts[m.match_key] || { team_a_id: "", team_b_id: "", winner_team_id: "", status: "draft" };
                        const teamOptions = m.stage === "knockout_playoffs"
                          ? (data.teams || []).filter((t) => zone924.has(teamId(t)))
                          : m.stage === "round_of_16"
                            ? (data.teams || []).filter((t) => r16Eligible.has(teamId(t)))
                            : (data.teams || []);
                        const autoDownstream = ["quarter_final", "semi_final", "final"].includes(m.stage);
                        return (
                          <div key={m.match_key} style={matchRowStyle}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--tg-hint)" }}>{m.match_key}</span>
                              <StatusPill status={d.status} />
                            </div>
                            {autoDownstream ? (
                              d.team_a_id && d.team_b_id ? (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                                  <TeamReadonly label="Команда A" value={teamName(d.team_a_id)} />
                                  <TeamReadonly label="Команда B" value={teamName(d.team_b_id)} />
                                </div>
                              ) : (
                                <div style={{ ...noticeBox("amber"), marginTop: 6 }}>
                                  Пары появятся после подтверждения победителей предыдущей стадии.
                                </div>
                              )
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                                <TeamSelect label="Команда A" value={d.team_a_id} options={teamOptions} onChange={(v) => setDraft(m.match_key, { team_a_id: v })} />
                                <TeamSelect label="Команда B" value={d.team_b_id} options={teamOptions} onChange={(v) => setDraft(m.match_key, { team_b_id: v })} />
                              </div>
                            )}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                              <label style={fieldLabelStyle}>
                                <span style={fieldCaptionStyle}>Победитель</span>
                                <select value={d.winner_team_id} onChange={(e) => setDraft(m.match_key, { winner_team_id: e.target.value })} style={selectStyle}>
                                  <option value="">—</option>
                                  {d.team_a_id && <option value={d.team_a_id}>{teamName(d.team_a_id)}</option>}
                                  {d.team_b_id && <option value={d.team_b_id}>{teamName(d.team_b_id)}</option>}
                                </select>
                              </label>
                              <label style={fieldLabelStyle}>
                                <span style={fieldCaptionStyle}>Статус</span>
                                <select value={d.status} onChange={(e) => setDraft(m.match_key, { status: e.target.value })} style={selectStyle}>
                                  <option value="draft">Черновик</option>
                                  <option value="confirmed">Подтверждён</option>
                                  <option value="completed">Завершён</option>
                                  <option value="void">Аннулирован</option>
                                </select>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </AdminCollapsibleSection>
                  );
                })}
              </div>
              <div style={{ marginTop: 14 }}>
                <AdminButton onClick={saveMatches} disabled={saving !== ""}>
                  {saving === "matches" ? "Сохраняю…" : "Сохранить пары и победителей"}
                </AdminButton>
              </div>
            </>
          )}
        </>
      )}

      {confirm && (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={modalCardStyle}>
            <div style={{ fontSize: 14, fontWeight: 950, marginBottom: 8, lineHeight: 1.35 }}>
              Применить статус «{EUROCUP_MATCH_STATUS_LABEL[confirm.status] || confirm.status}» ко всем матчам стадии «{confirm.label}»?
            </div>
            {confirm.status === "completed" && (
              <div style={{ ...noticeBox("amber"), marginBottom: 10 }}>
                Убедитесь, что у всех матчей выбран победитель. После completed могут сформироваться пары следующей стадии.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" style={modalCancelStyle} onClick={() => setConfirm(null)} disabled={saving !== ""}>Отмена</button>
              <button type="button" style={modalApplyStyle} onClick={applyBulk} disabled={saving !== ""}>
                {saving === "bulk" ? "Применяю…" : "Применить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminCard>
  );
}

function BulkBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...bulkBtnStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      {label}
    </button>
  );
}

function TeamSelect({ label, value, options, onChange }: { label: string; value: string; options: Team[]; onChange: (v: string) => void }) {
  return (
    <label style={fieldLabelStyle}>
      <span style={fieldCaptionStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        <option value="">—</option>
        {options.map((t) => {
          const id = String(t.team_id ?? t.id ?? "");
          return <option key={id} value={id}>{String(t.short_name || t.team_name || id)}</option>;
        })}
      </select>
    </label>
  );
}

function TeamReadonly({ label, value }: { label: string; value: string }) {
  return (
    <div style={fieldLabelStyle}>
      <span style={fieldCaptionStyle}>{label}</span>
      <div style={readonlyTeamStyle}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { fg: string; bg: string }> = {
    draft: { fg: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 14%, var(--tg-bg))" },
    confirmed: { fg: "color-mix(in srgb, #2ec060 82%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 15%, var(--tg-bg))" },
    completed: { fg: "color-mix(in srgb, #2ec060 82%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 15%, var(--tg-bg))" },
    void: { fg: "var(--tg-hint)", bg: "color-mix(in srgb, var(--tg-hint) 12%, transparent)" },
  };
  const c = map[status] || map.draft;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 850, color: c.fg, background: c.bg, border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)" }}>
      {EUROCUP_MATCH_STATUS_LABEL[status] || status}
    </span>
  );
}

const EUROCUP_MATCH_STATUS_LABEL: Record<string, string> = {
  draft: "Черновик", confirmed: "Подтверждён", completed: "Завершён", void: "Аннулирован",
};

const helperStyle: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.45 };

function noticeBox(tone: "amber" | "success" | "danger"): CSSProperties {
  const map = {
    amber: { fg: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "color-mix(in srgb, #d98a1a 28%, transparent)" },
    success: { fg: "color-mix(in srgb, #2ec060 80%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 13%, var(--tg-bg))", border: "color-mix(in srgb, #2ec060 28%, transparent)" },
    danger: { fg: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", bg: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "color-mix(in srgb, #e5484d 30%, transparent)" },
  } as const;
  const c = map[tone];
  return { borderRadius: 12, padding: "9px 12px", background: c.bg, border: `1px solid ${c.border}`, color: c.fg, fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 };
}

const matchRowStyle: CSSProperties = {
  borderRadius: 12,
  padding: "9px 11px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
};

// Stage status badge for the collapsible header.
function stageBadgeStyle(tone: "done" | "error" | "muted" | "action"): CSSProperties {
  const map = {
    done: { fg: "#2ec060", bg: "color-mix(in srgb, #2ec060 14%, var(--tg-bg))", border: "color-mix(in srgb, #2ec060 28%, transparent)" },
    error: { fg: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", bg: "color-mix(in srgb, #e5484d 14%, var(--tg-bg))", border: "color-mix(in srgb, #e5484d 30%, transparent)" },
    muted: { fg: "var(--tg-hint)", bg: "color-mix(in srgb, var(--tg-hint) 12%, transparent)", border: "color-mix(in srgb, var(--tg-hint) 20%, transparent)" },
    action: { fg: "color-mix(in srgb, #d98a1a 82%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 14%, var(--tg-bg))", border: "color-mix(in srgb, #d98a1a 30%, transparent)" },
  } as const;
  const c = map[tone];
  return {
    display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999,
    fontSize: 10.5, fontWeight: 900, whiteSpace: "nowrap", background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
  };
}

const bulkRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 8,
  padding: "7px 9px",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 45%, transparent)",
  border: "1px dashed color-mix(in srgb, var(--tg-hint) 16%, transparent)",
};
const bulkCaptionStyle: CSSProperties = { fontSize: 11, fontWeight: 850, color: "var(--tg-hint)" };
const bulkHintStyle: CSSProperties = { flexBasis: "100%", fontSize: 10.5, fontWeight: 700, color: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))", lineHeight: 1.35 };
const bulkBtnStyle: CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 850,
  color: "var(--tg-text)",
  background: "var(--tg-bg)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 22%, transparent)",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "color-mix(in srgb, #000 55%, transparent)",
};
const modalCardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 360,
  borderRadius: 16,
  padding: 16,
  background: "var(--tg-bg)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  boxShadow: "0 18px 42px rgba(0,0,0,0.32)",
  color: "var(--tg-text)",
};
const modalCancelStyle: CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 850,
  color: "var(--tg-text)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  cursor: "pointer",
};
const modalApplyStyle: CSSProperties = {
  height: 36,
  padding: "0 16px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 900,
  color: "var(--tg-button-text)",
  background: "var(--tg-button)",
  border: "1px solid transparent",
  cursor: "pointer",
};

const fieldLabelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 };
const fieldCaptionStyle: CSSProperties = { fontSize: 10, fontWeight: 800, color: "var(--tg-hint)" };
const selectStyle: CSSProperties = {
  width: "100%",
  height: 32,
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 700,
  color: "var(--tg-text)",
  background: "var(--tg-bg)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)",
};
const readonlyTeamStyle: CSSProperties = {
  minHeight: 32,
  display: "flex",
  alignItems: "center",
  borderRadius: 8,
  padding: "0 8px",
  fontSize: 12,
  fontWeight: 800,
  color: "var(--tg-text)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
};
