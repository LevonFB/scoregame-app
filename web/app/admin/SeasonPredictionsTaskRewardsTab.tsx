"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type RewardSpec = { enabled: boolean; balls: number; stars: number; case_type: string | null; case_count: number; lucky_tokens: number; boost_type: string | null; boost_count: number };

type TaskRewardItem = {
  task_key: string;
  title: string;
  category: "top5" | "europe" | "ballon_dor";
  tournament: string;
  phase: "league" | "ties" | "bracket" | "result";
  stored: boolean;
  enabled: boolean;
  balls: number;
  stars: number;
  case_type: string | null;
  case_count: number;
  lucky_tokens: number;
  boost_type: string | null;
  boost_count: number;
  admin_note: string | null;
  title_override: string | null;
  updated_at: number | null;
  active: boolean;
  default: RewardSpec;
};

type TaskRewardsResponse = {
  ok: boolean;
  items: TaskRewardItem[];
  summary: {
    enabled_count: number; max_balls: number; max_stars: number; max_cases: number; max_lucky_tokens?: number; cases_by_type: Record<string, number>;
    by_category?: Record<"top5" | "europe" | "ballon_dor", RewardBucket>;
    by_group?: Record<"activity" | "result" | "aggregate", RewardBucket>;
  };
  warnings: string[];
  case_options: string[];
  boost_options?: string[];
};

type RewardBucket = { enabled_count: number; balls: number; stars: number; cases: number; lucky_tokens?: number };

function bucketLine(b: RewardBucket | undefined): string {
  if (!b) return "—";
  const parts = [`${b.balls} мячей`, `${b.stars} звёзд`];
  if (b.cases > 0) parts.push(`${b.cases} кейс.`);
  if ((b.lucky_tokens || 0) > 0) parts.push(`${b.lucky_tokens} жет.`);
  return parts.join(" · ");
}

const CATEGORY_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Все" },
  { key: "top5", label: "Топ-5" },
  { key: "europe", label: "Еврокубки" },
  { key: "ballon_dor", label: "Золотой мяч" },
];
const TOURNAMENT_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Все" },
  { key: "UCL", label: "ЛЧ" },
  { key: "UEL", label: "ЛЕ" },
  { key: "UECL", label: "ЛК" },
];
const PHASE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Все" },
  { key: "league", label: "Стадия лиги" },
  { key: "ties", label: "Стыки" },
  { key: "bracket", label: "Сетка" },
  { key: "result", label: "Результаты" },
];
const ENABLED_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "Все" },
  { key: "on", label: "Включены" },
  { key: "off", label: "Выключены" },
];

const CASE_LABELS: Record<string, string> = { "": "Без кейса", premium: "Премиум-кейс", daily_free: "Обычный кейс" };

function caseLabel(value: string): string {
  return CASE_LABELS[value] ?? value;
}

const BOOST_LABELS: Record<string, string> = { "": "Без буста", extra_joker: "Джокер", double_chance: "Двойной шанс" };

function boostLabel(value: string): string {
  return BOOST_LABELS[value] ?? value;
}

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

const inputStyle: CSSProperties = {
  width: "100%", minHeight: 34, borderRadius: 8, padding: "0 8px",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)",
  background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text)", fontSize: 13, fontWeight: 700, outline: "none",
};
const labelStyle: CSSProperties = { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--tg-hint, #999)" };

function filterChip(active: boolean): CSSProperties {
  return {
    minHeight: 30, borderRadius: 999, padding: "0 11px", cursor: "pointer", fontSize: 12, fontWeight: active ? 900 : 700,
    border: active ? "1px solid color-mix(in srgb, var(--tg-button) 50%, var(--tg-hint))" : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
    background: active ? "color-mix(in srgb, var(--tg-button) 16%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
    color: active ? "var(--tg-button)" : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
    whiteSpace: "nowrap",
  };
}

function FilterRow({ label, options, value, onChange }: { label: string; options: Array<{ key: string; label: string }>; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--tg-hint)", minWidth: 64 }}>{label}</span>
      {options.map((o) => (
        <button key={o.key} onClick={() => onChange(o.key)} style={filterChip(value === o.key)}>{o.label}</button>
      ))}
    </div>
  );
}

export function SeasonPredictionsTaskRewardsTab({
  fetchWithAuth,
  // Жёсткий фильтр по разделу: компонент встраивается внутрь вкладки турнира
  // («Золотой мяч»), и там переключатель разделов лишний — показываем только его
  // задания. Без пропа компонент работает как раньше, со всеми фильтрами.
  lockCategory,
}: {
  fetchWithAuth: FetchWithAuth;
  lockCategory?: string;
}) {
  const [data, setData] = useState<TaskRewardsResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, TaskRewardItem>>({});
  const [catFilter, setCatFilter] = useState(lockCategory || "all");
  const [tourFilter, setTourFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [savingKey, setSavingKey] = useState<string>("");
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetchWithAuth<TaskRewardsResponse>("/admin/season-predictions/task-rewards");
      if (res) {
        setData(res);
        const map: Record<string, TaskRewardItem> = {};
        for (const it of res.items) map[it.task_key] = { ...it };
        setDraft(map);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить настройки наград");
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const caseOptions = data?.case_options ?? ["", "premium", "daily_free"];
  const boostOptions = ["", ...(data?.boost_options ?? ["extra_joker", "double_chance"])];

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((it) => {
      if (catFilter !== "all" && it.category !== catFilter) return false;
      if (tourFilter !== "all" && it.tournament !== tourFilter) return false;
      if (phaseFilter !== "all" && it.phase !== phaseFilter) return false;
      // Filter by the SAVED (server) enabled state, not the unsaved checkbox draft —
      // otherwise ticking «Награда» reclassifies the row live and it vanishes from a
      // "Выключены"/"Включены" view before the admin can press «Сохранить».
      if (enabledFilter === "on" && !it.enabled) return false;
      if (enabledFilter === "off" && it.enabled) return false;
      return true;
    });
  }, [data?.items, catFilter, tourFilter, phaseFilter, enabledFilter]);

  function patch(taskKey: string, p: Partial<TaskRewardItem>) {
    setDraft((prev) => ({ ...prev, [taskKey]: { ...prev[taskKey], ...p } }));
  }

  async function save(item: TaskRewardItem) {
    setSavingKey(item.task_key);
    setError("");
    setNotice("");
    try {
      const payload = {
        enabled: item.enabled,
        balls: item.balls,
        stars: item.stars,
        case_type: item.case_type || null,
        case_count: item.case_count,
        lucky_tokens: item.lucky_tokens || 0,
        boost_type: item.boost_type || null,
        boost_count: item.boost_count || 0,
        title_override: item.title_override || null,
        admin_note: item.admin_note || null,
      };
      const res = await fetchWithAuth<{ ok: boolean }>(`/admin/season-predictions/task-rewards/${item.task_key}`, { method: "PUT", body: JSON.stringify(payload) });
      if (res?.ok) {
        setNotice(`Сохранено: ${item.title}`);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить награду");
    } finally {
      setSavingKey("");
    }
  }

  function disableReward(item: TaskRewardItem) {
    void save({ ...item, enabled: false });
  }
  function resetToDefault(item: TaskRewardItem) {
    void save({
      ...item,
      enabled: item.default.enabled,
      balls: item.default.balls,
      stars: item.default.stars,
      case_type: item.default.case_type,
      case_count: item.default.case_count,
      lucky_tokens: item.default.lucky_tokens || 0,
      boost_type: item.default.boost_type,
      boost_count: item.default.boost_count || 0,
      title_override: null,
    });
  }

  async function seedDefaults() {
    setSeeding(true);
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; seeded: number }>("/admin/season-predictions/task-rewards/seed-defaults", { method: "POST", body: JSON.stringify({}) });
      if (res?.ok) {
        setNotice(`Засеяно недостающих настроек: ${res.seeded}.`);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось засеять дефолты");
    } finally {
      setSeeding(false);
    }
  }

  const summary = data?.summary;
  const summaryDesc = summary
    ? `${summary.enabled_count} включено · максимум ${summary.max_balls} мячей · ${summary.max_stars} звёзд · ${summary.max_cases} кейс.${(summary.max_lucky_tokens || 0) > 0 ? ` · ${summary.max_lucky_tokens} жет.` : ""}`
    : "Сводка по включённым наградам";
  const hasWarnings = (data?.warnings ?? []).length > 0;

  return (
    <AdminCard noPadding>
      <div style={{ padding: "14px 16px 4px" }}>
        <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 4 }}>
          {lockCategory ? "Задания и награды" : "Награды заданий"}
        </div>
        <div style={{ fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700, marginBottom: 10 }}>
          {lockCategory
            ? "Задания этого турнира. Игрок забирает награду сам кнопкой «Забрать»; пересчёт её не выдаёт."
            : "Награды за задания сезона (топ-5, еврокубки, Золотой мяч). Игрок забирает их сам кнопкой «Забрать». Пересчёт награды не выдаёт."}
        </div>
        {error && <div style={{ marginBottom: 8 }}><Notice tone="danger">{error}</Notice></div>}
        {notice && <div style={{ marginBottom: 8 }}><Notice tone="success">{notice}</Notice></div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 14px 14px" }}>
        {/* Summary — open by default (default open is informative + carries warnings).
            Во вкладке турнира сводка НЕ показывается: она про весь режим сразу и
            к конкретному турниру не относится. Живёт в глобальных настройках. */}
        {!lockCategory && (
        <AdminCollapsibleSection
          title="Награды заданий"
          description={summaryDesc}
          defaultOpen
          storageKey="admin:season-predictions:task-reward-summary"
          badge={hasWarnings ? <span style={warnBadgeStyle}>⚠ {data!.warnings.length}</span> : undefined}
        >
          {(data?.warnings ?? []).map((w) => (
            <div key={w} style={{ marginBottom: 8 }}><Notice tone="amber">{w}</Notice></div>
          ))}
          {summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Notice tone="info">
                Включено наград: <b>{summary.enabled_count}</b> · максимум: <b>{summary.max_balls}</b> мячей · <b>{summary.max_stars}</b> звёзд · <b>{summary.max_cases}</b> кейс.{(summary.max_lucky_tokens || 0) > 0 ? <> · <b>{summary.max_lucky_tokens}</b> жет.</> : null}
                {Object.keys(summary.cases_by_type).length > 0 ? ` (${Object.entries(summary.cases_by_type).map(([t, n]) => `${n}×${caseLabel(t)}`).join(", ")})` : ""}
              </Notice>
              {summary.by_category && (
                <Notice tone="info">
                  <b>По разделам:</b> Топ-5 — {bucketLine(summary.by_category.top5)} · Еврокубки — {bucketLine(summary.by_category.europe)} · Золотой мяч — {bucketLine(summary.by_category.ballon_dor)}
                </Notice>
              )}
              {summary.by_group && (
                <Notice tone="info">
                  <b>По типам:</b> Действия — {bucketLine(summary.by_group.activity)} · Результаты — {bucketLine(summary.by_group.result)} · Агрегаты — {bucketLine(summary.by_group.aggregate)}
                </Notice>
              )}
            </div>
          )}
        </AdminCollapsibleSection>
        )}

        {/* Settings — collapsed by default (long editable list). Встроенный в
            турнир список открыт сразу: там он и есть содержимое вкладки. */}
        <AdminCollapsibleSection
          title={lockCategory ? "Задания и награды" : "Настройки наград заданий"}
          description={lockCategory ? "Список заданий турнира и их награды" : "Изменение наград по task_key без JSON"}
          defaultOpen={!!lockCategory}
          storageKey={lockCategory
            ? `admin:season-predictions:task-reward-settings:${lockCategory}`
            : "admin:season-predictions:task-reward-settings"}
        >
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        {/* Раздел и турнир зафиксированы, когда список встроен во вкладку
            конкретного турнира — переключать их оттуда некуда. */}
        {!lockCategory && <FilterRow label="Категория" options={CATEGORY_FILTERS} value={catFilter} onChange={setCatFilter} />}
        {!lockCategory && <FilterRow label="Турнир" options={TOURNAMENT_FILTERS} value={tourFilter} onChange={setTourFilter} />}
        <FilterRow label="Этап" options={PHASE_FILTERS} value={phaseFilter} onChange={setPhaseFilter} />
        <FilterRow label="Статус" options={ENABLED_FILTERS} value={enabledFilter} onChange={setEnabledFilter} />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        {/* «Засеять дефолты» действует на ВЕСЬ режим — из вкладки одного турнира
            такую кнопку показывать нельзя, её нажали бы не глядя. */}
        {!lockCategory && (
          <AdminButton variant="secondary" onClick={seedDefaults} disabled={seeding}>
            {seeding ? "Засеиваю..." : "Засеять дефолты"}
          </AdminButton>
        )}
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>
          {lockCategory ? `Заданий: ${filtered.length}` : `Показано: ${filtered.length} из ${data?.items.length ?? 0}`}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((srvItem) => {
          const item = draft[srvItem.task_key] || srvItem;
          const dirty = JSON.stringify(item) !== JSON.stringify(srvItem);
          return (
            <div key={item.task_key} style={{ padding: 10, borderRadius: 12, border: `1px solid ${item.active ? "color-mix(in srgb, var(--tg-button) 30%, transparent)" : "color-mix(in srgb, var(--tg-hint) 14%, transparent)"}`, background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: "var(--tg-text)" }}>{item.title}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint)", marginTop: 2 }}>
                    {item.task_key}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint)", marginTop: 1 }}>
                    {CATEGORY_FILTERS.find((c) => c.key === item.category)?.label || item.category} · {item.tournament === "aggregate" ? "Агрегат" : item.tournament} · {PHASE_FILTERS.find((p) => p.key === item.phase)?.label || item.phase}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--tg-text)", flexShrink: 0 }}>
                  <input type="checkbox" checked={item.enabled} onChange={(e) => patch(item.task_key, { enabled: e.target.checked })} />
                  Награда
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                <label style={labelStyle}>Мячики
                  <input type="number" min={0} value={item.balls} onChange={(e) => patch(item.task_key, { balls: Math.max(0, Number(e.target.value)) })} style={inputStyle} />
                </label>
                <label style={labelStyle}>Звёзды
                  <input type="number" min={0} value={item.stars} onChange={(e) => patch(item.task_key, { stars: Math.max(0, Number(e.target.value)) })} style={inputStyle} />
                </label>
                <label style={labelStyle}>Кейс
                  <select value={item.case_type || ""} onChange={(e) => patch(item.task_key, { case_type: e.target.value || null, case_count: e.target.value ? Math.max(item.case_count, 1) : 0 })} style={inputStyle}>
                    {caseOptions.map((o) => <option key={o} value={o}>{caseLabel(o)}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Кол-во кейсов
                  <input type="number" min={0} value={item.case_count} disabled={!item.case_type} onChange={(e) => patch(item.task_key, { case_count: Math.max(0, Number(e.target.value)) })} style={{ ...inputStyle, opacity: item.case_type ? 1 : 0.5 }} />
                </label>
                <label style={labelStyle}>Жетоны
                  <input type="number" min={0} value={item.lucky_tokens} onChange={(e) => patch(item.task_key, { lucky_tokens: Math.max(0, Number(e.target.value)) })} style={inputStyle} />
                </label>
                <label style={labelStyle}>Буст
                  <select value={item.boost_type || ""} onChange={(e) => patch(item.task_key, { boost_type: e.target.value || null, boost_count: e.target.value ? Math.max(item.boost_count, 1) : 0 })} style={inputStyle}>
                    {boostOptions.map((o) => <option key={o} value={o}>{boostLabel(o)}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>Кол-во бустов
                  <input type="number" min={0} value={item.boost_count} disabled={!item.boost_type} onChange={(e) => patch(item.task_key, { boost_count: Math.max(0, Number(e.target.value)) })} style={{ ...inputStyle, opacity: item.boost_type ? 1 : 0.5 }} />
                </label>
              </div>

              <label style={{ ...labelStyle, marginTop: 6 }}>Заметка администратора
                <input type="text" value={item.admin_note || ""} onChange={(e) => patch(item.task_key, { admin_note: e.target.value || null })} style={inputStyle} placeholder="—" />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <AdminButton size="sm" onClick={() => save(item)} disabled={savingKey === item.task_key || !dirty}>
                  {savingKey === item.task_key ? "Сохраняю..." : dirty ? "Сохранить" : "Сохранено"}
                </AdminButton>
                <AdminButton size="sm" variant="secondary" onClick={() => disableReward(item)} disabled={savingKey === item.task_key || !item.enabled}>
                  Отключить
                </AdminButton>
                <AdminButton size="sm" variant="secondary" onClick={() => resetToDefault(item)} disabled={savingKey === item.task_key}>
                  Сбросить к дефолту
                </AdminButton>
                {dirty && <span style={{ fontSize: 11, fontWeight: 800, color: "color-mix(in srgb, #d98a1a 80%, var(--tg-text))", alignSelf: "center" }}>есть несохранённые изменения</span>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <Notice tone="info">Нет заданий с такими фильтрами.</Notice>}
      </div>
        </AdminCollapsibleSection>
      </div>
    </AdminCard>
  );
}

const warnBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 7px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 900,
  background: "color-mix(in srgb, #d98a1a 16%, var(--tg-bg))",
  color: "color-mix(in srgb, #d98a1a 82%, var(--tg-text))",
  border: "1px solid color-mix(in srgb, #d98a1a 28%, transparent)",
};
