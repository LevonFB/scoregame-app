"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminInput } from "./components/AdminInput";
import { AdminSelect } from "./components/ui/AdminSelect";
import { ActionDialog } from "@/app/components/ui/ActionDialog";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type OfficialQuestion = {
  question_id: number;
  question_key: string;
  title: string;
  status: string;
  options: Array<{ id?: unknown; label?: unknown }>;
  official_status: string;
  official_answer_option_id: string | null;
  // Multi-answer questions (upset templates): every listed option counts as correct.
  official_answer_option_ids?: string[] | null;
  allow_multi_correct?: boolean;
  official_note: string | null;
  official_confirmed_at: number | null;
  // W-Builder: additive context for richer official-answers UI.
  template_key?: string | null;
  display_category?: string;
  config?: Record<string, unknown>;
};

function questionContextLines(q: OfficialQuestion): string[] {
  const cfg = (q.config || {}) as Record<string, unknown>;
  const lines: string[] = [];
  if (q.config && typeof cfg.match_ref === "string" && cfg.match_ref) {
    const home = String(cfg.home_team_name || "");
    const away = String(cfg.away_team_name || "");
    lines.push(home || away ? `Матч: ${home} — ${away}` : `Матч: ${cfg.match_ref}`);
  }
  if (Array.isArray(cfg.groups)) {
    for (const g of cfg.groups as Array<Record<string, unknown>>) {
      const ids = Array.isArray(g?.match_ids) ? (g.match_ids as unknown[]).length : 0;
      lines.push(`Группа «${String(g?.title || "")}»: ${ids} матч(ей)`);
    }
  }
  if (cfg.side_a || cfg.side_b) {
    const sideName = (s: unknown) => {
      const side = (s || {}) as Record<string, unknown>;
      return String(side.name || side.team_name || "");
    };
    lines.push(`Дуэль: ${sideName(cfg.side_a)} vs ${sideName(cfg.side_b)}`);
    if (cfg.void_if_player_did_not_play !== false) lines.push("Аннулируется, если игрок не сыграл ни минуты");
  }
  if (cfg.scope && typeof cfg.scope === "object") {
    const scope = cfg.scope as Record<string, unknown>;
    const refs = Array.isArray(scope.match_refs) ? (scope.match_refs as unknown[]).length : 0;
    lines.push(scope.type === "selected" ? `Событие по ${refs} выбранным матчам` : "Событие по всему пулу");
  }
  return lines;
}

type Lifecycle = {
  challenge_status: string;
  can_recalc: boolean;
  results_stale: boolean;
  scores_count: number;
  last_recalc_at: number | null;
  official_updated_at: number | null;
};

type OfficialResponse = {
  ok: boolean;
  questions: OfficialQuestion[];
  stats: { active_questions: number; confirmed: number; void: number; pending: number };
  lifecycle?: Lifecycle;
};

type Summary = {
  recalc_id: number; formula_version: string; entries_processed: number; entries_skipped: number;
  entries_failed: number; avg_points: number | null; max_points: number | null; scored_at: number | null;
  top10: Array<{ rank: number; user_id: number; display_name: string; total_points: number; max_possible_points: number; correct_answers: number }>;
};

type Draft = {
  official_status: string;
  official_answer_option_id: string | null;
  // Only meaningful for allow_multi_correct questions; single-answer ones keep it
  // in sync with official_answer_option_id so the payload stays unambiguous.
  official_answer_option_ids: string[];
  official_note: string;
};

const labelStyle: CSSProperties = { display: "grid", gap: 5, fontSize: 11, fontWeight: 900, color: "var(--tg-hint, #999)" };
const helperStyle: CSSProperties = { fontSize: 11, color: "var(--tg-hint, #999)", fontWeight: 700, lineHeight: 1.4 };

export function WeeklyChallengeOfficialAnswers({ fetchWithAuth, challengeId }: { fetchWithAuth: FetchWithAuth; challengeId: number }) {
  const [questions, setQuestions] = useState<OfficialQuestion[]>([]);
  const [stats, setStats] = useState<OfficialResponse["stats"] | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth<{ ok: boolean; summary: Summary | null }>(`/admin/season-predictions/weekly-challenges/${challengeId}/scores/summary`);
      if (res) setSummary(res.summary);
    } catch { /* best-effort */ }
  }, [fetchWithAuth, challengeId]);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetchWithAuth<OfficialResponse>(`/admin/season-predictions/weekly-challenges/${challengeId}/official-answers`);
      if (!res) return;
      setQuestions(res.questions || []);
      setStats(res.stats || null);
      setLifecycle(res.lifecycle || null);
      const next: Record<number, Draft> = {};
      for (const q of res.questions || []) {
        const many = Array.isArray(q.official_answer_option_ids) ? q.official_answer_option_ids.map(String).filter(Boolean) : [];
        const single = q.official_answer_option_id ?? null;
        next[q.question_id] = {
          official_status: q.official_status || "pending",
          official_answer_option_id: single,
          // Legacy rows carry only the single id — seed the set from it.
          official_answer_option_ids: many.length > 0 ? many : (single ? [single] : []),
          official_note: q.official_note ?? "",
        };
      }
      setDrafts(next);
      void loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить официальные ответы");
    }
  }, [fetchWithAuth, challengeId, loadSummary]);

  useEffect(() => { void load(); }, [load]);

  function patch(qid: number, p: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [qid]: { ...prev[qid], ...p } }));
  }

  async function save() {
    setSaving("save");
    setError("");
    setNotice("");
    try {
      const answers = questions
        .filter((q) => q.status !== "disabled")
        .map((q) => {
          const d = drafts[q.question_id];
          const isVoid = d?.official_status === "void";
          const multi = q.allow_multi_correct === true;
          const ids = multi ? (d?.official_answer_option_ids || []) : [];
          return {
            question_id: q.question_id,
            official_status: d?.official_status || "pending",
            // For multi questions the first checked option doubles as the singular
            // value the legacy column keeps storing.
            official_answer_option_id: isVoid ? null : (multi ? (ids[0] || null) : (d?.official_answer_option_id || null)),
            official_answer_option_ids: isVoid || !multi ? null : (ids.length > 0 ? ids : null),
            official_note: d?.official_note || null,
          };
        });
      const res = await fetchWithAuth<OfficialResponse>(`/admin/season-predictions/weekly-challenges/${challengeId}/official-answers`, { method: "PUT", body: JSON.stringify({ answers }) });
      if (!res) return;
      setNotice("Официальные ответы сохранены.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить официальные ответы");
    } finally {
      setSaving("");
    }
  }

  async function recalc() {
    setShowRecalcConfirm(false);
    setSaving("recalc");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; status?: string; processed: number; scored?: number; failed: number }>(`/admin/season-predictions/weekly-challenges/${challengeId}/recalculate`, { method: "POST", body: JSON.stringify({}) });
      if (!res) return;
      if (res.ok) {
        setNotice(`Пересчёт завершён: обработано ${res.processed}, посчитано ${res.scored ?? res.processed}, ошибок ${res.failed}. Вызов «${res.status ?? "completed"}». Награды не начислялись.`);
      } else {
        setError(`Частичный сбой: посчитано ${res.scored ?? 0}, ошибок ${res.failed}. Вызов остался в статусе «${res.status ?? "scoring"}». Повторите пересчёт.`);
      }
      await load();
      await loadSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось запустить пересчёт");
    } finally {
      setSaving("");
    }
  }

  // W4: recalc only when intake is closed, no pending official answers remain, and
  // the challenge lifecycle permits it. The server stays the source of truth.
  const lifecycleStatus = lifecycle?.challenge_status ?? null;
  const isActiveIntake = lifecycleStatus === "active" || lifecycleStatus === "draft";
  const canRecalc = !!stats && stats.pending === 0 && (lifecycle ? lifecycle.can_recalc : true) && !isActiveIntake;
  const resultsStale = lifecycle?.results_stale ?? false;
  // max_possible_points is constant across users for a recalc (= confirmed active
  // questions). Derive it from the top-10 rows so the summary shows total/max
  // (e.g. "4/5") instead of the bare max-among-users number — purely display.
  const summaryMaxPossible = summary?.top10?.[0]?.max_possible_points ?? null;

  return (
    <AdminCard>
      <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 4 }}>Итоги и правильные ответы</div>
      <div style={helperStyle}>
        Подтвердите официальный ответ для каждого активного вопроса (или отметьте void). Пересчёт доступен, когда нет pending. Награды не начисляются (W1).
      </div>
      {stats && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <Chip label="Активных" value={String(stats.active_questions)} />
          <Chip label="Подтверждено" value={String(stats.confirmed)} tone="ok" />
          <Chip label="Аннулировано" value={String(stats.void)} />
          <Chip label="Ожидают" value={String(stats.pending)} tone={stats.pending > 0 ? "warn" : "neutral"} />
          {lifecycleStatus && <Chip label="Статус вызова" value={weeklyStatusLabel(lifecycleStatus)} tone={lifecycleStatus === "completed" ? "ok" : "neutral"} />}
          {lifecycle && <Chip label="Результаты" value={String(lifecycle.scores_count)} />}
        </div>
      )}
      {resultsStale && (
        <div style={{ ...noticeBox("danger"), marginTop: 8 }}>
          Официальные ответы изменены — требуется повторный пересчёт. Текущие результаты неактуальны.
        </div>
      )}
      {isActiveIntake && (
        <div style={{ ...noticeBox("warn"), marginTop: 8 }}>
          Вызов ещё принимает ответы. Сначала закройте приём: переведите статус в «locked» (раздел «Основные настройки»).
        </div>
      )}
      {stats && stats.pending > 0 && (
        <div style={{ ...noticeBox("warn"), marginTop: 8 }}>
          Есть неподтверждённые официальные ответы ({stats.pending}). Подтвердите их (или void), чтобы запустить пересчёт.
        </div>
      )}
      {error && <div style={{ ...noticeBox("danger"), marginTop: 8 }}>{error}</div>}
      {notice && <div style={{ ...noticeBox("success"), marginTop: 8 }}>{notice}</div>}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {questions.map((q) => {
          const d = drafts[q.question_id] || { official_status: "pending", official_answer_option_id: null, official_answer_option_ids: [], official_note: "" };
          const disabled = q.status === "disabled";
          const multi = q.allow_multi_correct === true;
          return (
            <div key={q.question_id} style={{ border: "1px solid var(--tg-separator, rgba(128,128,128,0.16))", borderRadius: 8, padding: 12, background: "var(--tg-bg, rgba(255,255,255,0.04))", opacity: disabled ? 0.55 : 1 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "var(--tg-hint, #999)", marginBottom: 2 }}>
                {q.display_category || q.question_key}{q.template_key ? ` · ${q.template_key}` : " · legacy"}{disabled ? " · disabled" : ""}
              </div>
              <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 6 }}>{q.title}</div>
              {questionContextLines(q).length > 0 && (
                <div style={{ marginBottom: 8, display: "grid", gap: 2 }}>
                  {questionContextLines(q).map((line) => <div key={line} style={helperStyle}>· {line}</div>)}
                </div>
              )}
              {!disabled && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10 }}>
                  <AdminSelect
                    label="Статус итога"
                    value={d.official_status}
                    onChange={(value) => patch(q.question_id, { official_status: value })}
                    options={[
                      { value: "pending", label: "Ожидает" },
                      { value: "confirmed", label: "Подтверждён" },
                      { value: "void", label: "Аннулирован" },
                    ]}
                    className="!min-h-10 !rounded-xl !text-[14px]"
                  />
                  {multi ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={labelStyle}>Правильные варианты</span>
                      <div style={{ display: "grid", gap: 4, opacity: d.official_status === "void" ? 0.5 : 1 }}>
                        {(q.options || []).map((o) => {
                          const id = String(o?.id ?? "");
                          const checked = (d.official_answer_option_ids || []).includes(id);
                          return (
                            <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={d.official_status === "void"}
                                onChange={(e) => {
                                  const prev = d.official_answer_option_ids || [];
                                  const nextIds = e.target.checked ? [...prev, id] : prev.filter((x) => x !== id);
                                  patch(q.question_id, {
                                    official_answer_option_ids: nextIds,
                                    official_answer_option_id: nextIds[0] || null,
                                  });
                                }}
                              />
                              {String(o?.label ?? o?.id ?? "")}
                            </label>
                          );
                        })}
                      </div>
                      <span style={helperStyle}>
                        Можно отметить несколько — засчитывается любой из них.
                        {(q.options || []).some((o) => String(o?.id ?? "") === "equal")
                          ? " При ничьей выберите либо «Равенство», либо все совпавшие варианты: отметив варианты, вы делаете «Равенство» неверным ответом."
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <AdminSelect
                      label="Правильный вариант"
                      value={d.official_answer_option_id || ""}
                      disabled={d.official_status === "void"}
                      onChange={(value) => patch(q.question_id, { official_answer_option_id: value || null, official_answer_option_ids: value ? [value] : [] })}
                      options={[
                        { value: "", label: "Не выбран" },
                        ...(q.options || []).map((o) => ({ value: String(o?.id ?? ""), label: String(o?.label ?? o?.id ?? "") })),
                      ]}
                      className="!min-h-10 !rounded-xl !text-[14px]"
                    />
                  )}
                  <label style={labelStyle}>
                    Примечание
                    <AdminInput value={d.official_note} onChange={(e) => patch(q.question_id, { official_note: e.target.value })} placeholder="Напр. матч отменён" />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <AdminButton onClick={save} disabled={saving !== ""} className="flex-1">{saving === "save" ? "Сохраняю..." : "Сохранить итоги"}</AdminButton>
        <AdminButton variant="secondary" onClick={() => setShowRecalcConfirm(true)} disabled={saving !== "" || !canRecalc} className="flex-1">{saving === "recalc" ? "Пересчёт..." : lifecycleStatus === "completed" ? "Пересчитать снова" : "Запустить пересчёт"}</AdminButton>
      </div>
      {!canRecalc && stats?.pending === 0 && !isActiveIntake && (
        <div style={{ ...helperStyle, marginTop: 6 }}>Пересчёт недоступен в текущем статусе вызова.</div>
      )}

      {showRecalcConfirm && (
        <ActionDialog
          title={lifecycleStatus === "completed" ? "Повторно пересчитать результаты?" : "Запустить пересчёт?"}
          cancelLabel="Отмена"
          confirmLabel={lifecycleStatus === "completed" ? "Пересчитать снова" : "Запустить пересчёт"}
          onCancel={() => setShowRecalcConfirm(false)}
          onConfirm={recalc}
        >
          {lifecycleStatus === "completed"
            ? "Существующие результаты будут пересчитаны и обновлены. Уже полученные награды повторно не начисляются."
            : "Будут пересчитаны все отправленные ответы. Вызов перейдёт в статус «Подсчёт», а после успешного завершения — в «Завершён». Награды автоматически не выдаются."}
        </ActionDialog>
      )}

      {summary && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 6 }}>Результат пересчёта</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip label="Обработано" value={String(summary.entries_processed)} />
            <Chip label="Пропущено" value={String(summary.entries_skipped)} />
            <Chip label="Ошибок" value={String(summary.entries_failed)} tone={summary.entries_failed > 0 ? "warn" : "neutral"} />
            <Chip label="Средний" value={formatOutOfMax(summary.avg_points, summaryMaxPossible)} />
            <Chip label="Лучший результат" value={formatOutOfMax(summary.max_points, summaryMaxPossible)} />
            <Chip label="Формула" value={summary.formula_version} />
          </div>
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.45 }}>
            После пересчёта пользователи смогут забрать задания Вызова недели. Награды не выдаются автоматически — только по нажатию «Забрать».
          </div>
          {summary.top10.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {summary.top10.map((r) => (
                <div key={r.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", borderRadius: 8, background: "var(--tg-secondary-bg, rgba(128,128,128,0.10))", fontSize: 12 }}>
                  <span style={{ minWidth: 20, fontWeight: 900, color: "var(--tg-hint)" }}>{r.rank}.</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700 }}>{r.display_name}</span>
                  <span style={{ fontWeight: 900 }}>{r.total_points}/{r.max_possible_points}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminCard>
  );
}

// Render a points value as total/max (e.g. "4/5"); falls back to the bare number
// when max_possible is unknown (no scored entries yet), and "—" when value is null.
function formatOutOfMax(value: number | null, maxPossible: number | null): string {
  if (value == null) return "—";
  if (maxPossible == null) return String(value);
  return `${value}/${maxPossible}`;
}

function weeklyStatusLabel(status: string): string {
  switch (status) {
    case "draft": return "Черновик";
    case "active": return "Активен";
    case "locked": return "Приём закрыт";
    case "scoring": return "Идёт подсчёт";
    case "completed": return "Завершён";
    case "archived": return "В архиве";
    default: return status;
  }
}

function Chip({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" }) {
  const fg = tone === "ok" ? "color-mix(in srgb, #2ec060 82%, var(--tg-text))" : tone === "warn" ? "color-mix(in srgb, #d98a1a 82%, var(--tg-text))" : "var(--tg-text)";
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "5px 9px", borderRadius: 999, background: "color-mix(in srgb, var(--tg-secondary-bg) 64%, transparent)", border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)", fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
      {label}<b style={{ fontSize: 12, fontWeight: 900, color: fg }}>{value}</b>
    </span>
  );
}

function noticeBox(tone: "danger" | "success" | "warn"): CSSProperties {
  const c = tone === "danger"
    ? { fg: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", bg: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "color-mix(in srgb, #e5484d 30%, transparent)" }
    : tone === "warn"
      ? { fg: "color-mix(in srgb, #d98a1a 84%, var(--tg-text))", bg: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "color-mix(in srgb, #d98a1a 28%, transparent)" }
      : { fg: "color-mix(in srgb, #2ec060 80%, var(--tg-text))", bg: "color-mix(in srgb, #2ec060 13%, var(--tg-bg))", border: "color-mix(in srgb, #2ec060 28%, transparent)" };
  return { borderRadius: 12, padding: "10px 12px", background: c.bg, border: `1px solid ${c.border}`, color: c.fg, fontSize: 12.5, fontWeight: 700, lineHeight: 1.45 };
}
