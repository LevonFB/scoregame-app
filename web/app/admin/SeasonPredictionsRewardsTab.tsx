"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type RewardScope = "season_overall" | "top5_overall" | "eurocups_overall";

const SCOPES: Array<{ key: RewardScope; label: string }> = [
  { key: "season_overall", label: "Общий сезон" },
  { key: "top5_overall", label: "Топ-5 лиг" },
  { key: "eurocups_overall", label: "Еврокубки" },
];

const CASE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Без кейса" },
  { value: "premium", label: "Премиум-кейс" },
  { value: "daily_free", label: "Обычный кейс" },
];

type Rule = {
  id: number | null;
  scope: RewardScope;
  rank_from: number;
  rank_to: number;
  reward_balls: number;
  reward_stars: number;
  reward_case_type: string | null;
  reward_case_count: number;
  enabled: boolean;
  title: string | null;
  description: string | null;
  sort_order: number;
};

type RulesResponse = { ok: boolean; season_id: number; scopes: Record<string, { stored: boolean; rules: Rule[] }> };

type PreviewItem = {
  rank: number; user_id: number; display_name: string; total_points: number; max_possible_points: number;
  reward_balls: number; reward_case_type: string | null; reward_case_count: number; already_granted: boolean;
};
type PreviewResponse = {
  ok: boolean; scope: RewardScope; formula_version: string; items: PreviewItem[];
  summary: { recipients_count: number; already_granted_count: number; would_grant_count: number; total_balls: number; total_cases_by_type: Record<string, number> };
};
type DistributeResponse = {
  ok: boolean; scope: RewardScope; processed: number; granted: number; skipped_duplicates: number; failed: number;
  total_balls: number; total_cases_by_type: Record<string, number>;
};

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
  width: "100%", minHeight: 36, borderRadius: 8, padding: "0 8px",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)",
  background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text)", fontSize: 13, fontWeight: 700, outline: "none",
};

export function SeasonPredictionsRewardsTab({ fetchWithAuth }: { fetchWithAuth: FetchWithAuth }) {
  const [scope, setScope] = useState<RewardScope>("season_overall");
  const [rulesByScope, setRulesByScope] = useState<Record<string, { stored: boolean; rules: Rule[] }>>({});
  const [draft, setDraft] = useState<Rule[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<DistributeResponse | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadRules = useCallback(async () => {
    setError("");
    try {
      const res = await fetchWithAuth<RulesResponse>("/admin/season-predictions/rewards/rules");
      if (res) setRulesByScope(res.scopes || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить правила наград");
    }
  }, [fetchWithAuth]);

  useEffect(() => { void loadRules(); }, [loadRules]);

  // Sync the editable draft when scope or loaded rules change.
  useEffect(() => {
    setDraft((rulesByScope[scope]?.rules || []).map((r) => ({ ...r })));
    setPreview(null);
    setResult(null);
    setConfirmText("");
    setNotice("");
    setError("");
  }, [scope, rulesByScope]);

  function patchRule(idx: number, patch: Partial<Rule>) {
    setDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRule() {
    setDraft((prev) => [...prev, { id: null, scope, rank_from: 1, rank_to: 1, reward_balls: 0, reward_stars: 0, reward_case_type: null, reward_case_count: 0, enabled: true, title: null, description: null, sort_order: (prev.length + 1) * 10 }]);
  }
  function removeRule(idx: number) {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveRules() {
    setSaving("save");
    setError("");
    setNotice("");
    try {
      const payload = { scope, rules: draft.map((r) => ({ ...r, scope })) };
      const res = await fetchWithAuth<{ ok: boolean; rules: Rule[] }>("/admin/season-predictions/rewards/rules", { method: "PUT", body: JSON.stringify(payload) });
      if (!res) return;
      setNotice("Правила сохранены.");
      await loadRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить правила");
    } finally {
      setSaving("");
    }
  }

  async function runPreview() {
    setSaving("preview");
    setError("");
    setNotice("");
    setResult(null);
    try {
      const res = await fetchWithAuth<PreviewResponse>(`/admin/season-predictions/rewards/preview?scope=${scope}`);
      if (res) setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить предпросмотр");
    } finally {
      setSaving("");
    }
  }

  async function distribute() {
    setSaving("distribute");
    setError("");
    setNotice("");
    try {
      const res = await fetchWithAuth<DistributeResponse>("/admin/season-predictions/rewards/distribute", { method: "POST", body: JSON.stringify({ scope, confirm: true }) });
      if (!res) return;
      setResult(res);
      setConfirmText("");
      setNotice(`Выдача завершена: начислено ${res.granted}, пропущено дублей ${res.skipped_duplicates}, ошибок ${res.failed}.`);
      await runPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выдать награды");
    } finally {
      setSaving("");
    }
  }

  const isStored = rulesByScope[scope]?.stored;

  return (
    <AdminCard noPadding>
      <div style={{ padding: "14px 16px 4px" }}>
        <div style={{ fontSize: 16, fontWeight: 950, marginBottom: 4 }}>Награды сезона</div>
        <div style={{ fontSize: 12, color: "var(--tg-hint, #999)", fontWeight: 700, marginBottom: 10 }}>
          Ручная выдача наград за итоговые рейтинги. Балы и кейсы. Без авто-выдачи.
        </div>

        {/* Scope switch — shared by both sections, always visible */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 10 }}>
          {SCOPES.map((s) => {
            const active = scope === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setScope(s.key)}
                style={{
                  minHeight: 34, borderRadius: 10, padding: "0 6px", cursor: "pointer", fontSize: 12, fontWeight: active ? 900 : 700,
                  border: active ? "1px solid color-mix(in srgb, var(--tg-button) 50%, var(--tg-hint))" : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
                  background: active ? "color-mix(in srgb, var(--tg-button) 18%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
                  color: active ? "var(--tg-button)" : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {error && <div style={{ marginBottom: 8 }}><Notice tone="danger">{error}</Notice></div>}
        {notice && <div style={{ marginBottom: 8 }}><Notice tone="success">{notice}</Notice></div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 14px 14px" }}>
        {/* Правила выдачи наград — collapsed by default */}
        <AdminCollapsibleSection
          title="Правила выдачи наград"
          description="Правила рангов (мячи/кейсы), которые админ запускает отдельно"
          storageKey="admin:season-predictions:reward-rules"
        >
      {!isStored && (
        <div style={{ marginBottom: 8 }}><Notice tone="info">Показаны правила по умолчанию. Сохраните, чтобы зафиксировать/изменить.</Notice></div>
      )}

      {/* Rules editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {draft.map((r, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 8, borderRadius: 10, border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)", background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)" }}>
            <label style={labelStyle}>Места с
              <input type="number" min={1} value={r.rank_from} onChange={(e) => patchRule(idx, { rank_from: Number(e.target.value) })} style={inputStyle} />
            </label>
            <label style={labelStyle}>по
              <input type="number" min={1} value={r.rank_to} onChange={(e) => patchRule(idx, { rank_to: Number(e.target.value) })} style={inputStyle} />
            </label>
            <label style={labelStyle}>Мячи
              <input type="number" min={0} value={r.reward_balls} onChange={(e) => patchRule(idx, { reward_balls: Number(e.target.value) })} style={inputStyle} />
            </label>
            <label style={labelStyle}>Кейс
              <select value={r.reward_case_type || ""} onChange={(e) => patchRule(idx, { reward_case_type: e.target.value || null })} style={inputStyle}>
                {CASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Кол-во кейсов
              <input type="number" min={0} value={r.reward_case_count} onChange={(e) => patchRule(idx, { reward_case_count: Number(e.target.value) })} style={inputStyle} />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: "var(--tg-text)" }}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => patchRule(idx, { enabled: e.target.checked })} />
                Включено
              </label>
              <button onClick={() => removeRule(idx)} style={{ border: "none", background: "transparent", color: "#e5484d", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Удалить</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <AdminButton variant="secondary" onClick={addRule} className="flex-1">+ Правило</AdminButton>
        <AdminButton onClick={saveRules} disabled={saving !== ""} className="flex-1">{saving === "save" ? "Сохраняю..." : "Сохранить правила"}</AdminButton>
      </div>
        </AdminCollapsibleSection>

        {/* Ручная выдача наград — collapsed by default; nec irreversible action */}
        <AdminCollapsibleSection
          title="Ручная выдача наград"
          description="Необратимая выдача через reward_ledger"
          storageKey="admin:season-predictions:manual-awards"
          badge={<span style={dangerBadgeStyle}>необратимо</span>}
        >
      {/* Preview */}
      <div>
        <AdminButton variant="secondary" onClick={runPreview} disabled={saving !== ""} className="w-full">
          {saving === "preview" ? "Считаю..." : "Предпросмотр получателей"}
        </AdminButton>
      </div>

      {preview && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <Notice tone="info">
            Получателей: {preview.summary.recipients_count} · будет выдано: {preview.summary.would_grant_count} · уже выдано: {preview.summary.already_granted_count} · мячей: {preview.summary.total_balls} · формула: {preview.formula_version}
          </Notice>
          {preview.items.length === 0 ? (
            <Notice tone="amber">Нет получателей: пустой рейтинг или нет правил для занятых мест.</Notice>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {preview.items.slice(0, 60).map((it) => (
                <div key={it.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", borderRadius: 8, background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)", fontSize: 12 }}>
                  <span style={{ minWidth: 22, fontWeight: 900, color: "var(--tg-hint)" }}>{it.rank}.</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 700, color: "var(--tg-text)" }}>{it.display_name}</span>
                  <span style={{ fontWeight: 700, color: "var(--tg-hint)" }}>
                    {it.reward_balls} м{it.reward_case_type ? ` · ${it.reward_case_count}×${it.reward_case_type}` : ""}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: it.already_granted ? "#2ec060" : "color-mix(in srgb, var(--tg-button) 80%, var(--tg-text))" }}>
                    {it.already_granted ? "уже выдано" : "будет выдано"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Distribution */}
      <div style={{ marginTop: 14 }}>
        <Notice tone="danger">
          Выдача наград необратима. Повторный запуск не начислит дубли благодаря reward_ledger.
        </Notice>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Введите ВЫДАТЬ"
            style={{ ...inputStyle, flex: 1 }}
          />
          <AdminButton onClick={distribute} disabled={saving !== "" || confirmText.trim() !== "ВЫДАТЬ"}>
            {saving === "distribute" ? "Выдаю..." : "Выдать награды"}
          </AdminButton>
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="success">
            Начислено: {result.granted} · дубли: {result.skipped_duplicates} · ошибок: {result.failed} · мячей: {result.total_balls}
            {Object.keys(result.total_cases_by_type).length > 0 ? ` · кейсы: ${Object.entries(result.total_cases_by_type).map(([t, n]) => `${n}×${t}`).join(", ")}` : ""}
          </Notice>
        </div>
      )}
        </AdminCollapsibleSection>
      </div>
    </AdminCard>
  );
}

const labelStyle: CSSProperties = { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--tg-hint, #999)" };
const dangerBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 18,
  padding: "0 7px",
  borderRadius: 999,
  fontSize: 10.5,
  fontWeight: 900,
  background: "color-mix(in srgb, #e5484d 14%, var(--tg-bg))",
  color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))",
  border: "1px solid color-mix(in srgb, #e5484d 30%, transparent)",
};
