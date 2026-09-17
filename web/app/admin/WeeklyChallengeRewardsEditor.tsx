"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { AdminButton } from "./components/AdminButton";
import { AdminInput } from "./components/AdminInput";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type RewardComponent = { stars: number; balls: number; case_type: string | null; case_count: number; lucky_tokens: number; boost_type: string | null; boost_count: number };
type RewardsConfig = {
  version: number;
  participation: RewardComponent;
  bonus: Record<string, RewardComponent>;
  result: Record<string, RewardComponent>;
};
type Limits = { stars: { min: number; max: number }; balls: { min: number; max: number }; case_count: { min: number; max: number }; lucky_tokens: { min: number; max: number }; boost_count: { min: number; max: number } };
type MaxReward = { stars: number; balls: number; cases: Record<string, number>; lucky_tokens: number; boosts: Record<string, number> };

type GetResponse = {
  ok: boolean;
  task_schema_version: number;
  editable: boolean;
  source: "default" | "custom";
  malformed: boolean;
  locked: boolean;
  lock_reason: string | null;
  limits: Limits;
  defaults: RewardsConfig;
  case_options: string[];
  rewards: RewardsConfig;
  bonus_question_key: "match" | "league" | "duel" | "upset" | "event" | null;
  max_reward: MaxReward;
  boost_options?: string[];
};

const CASE_LABEL: Record<string, string> = { basic: "Базовый", premium: "Премиум", daily_free: "Ежедневный" };
function caseLabel(code: string): string { return CASE_LABEL[code] || code; }

const BOOST_LABEL: Record<string, string> = { extra_joker: "Экстра-джокер", double_chance: "Двойной шанс" };
function boostLabel(code: string): string { return BOOST_LABEL[code] || code; }

const BONUS_KEYS = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"] as const;
const BONUS_LABEL: Record<string, string> = {
  match_of_week: "Матч недели", league_of_week: "Расклад недели", duel_of_week: "Дуэль недели", upset_of_week: "Сенсация недели", event_of_week: "Событие недели",
};
const BONUS_SHORT_TO_FULL: Record<string, string> = { match: "match_of_week", league: "league_of_week", duel: "duel_of_week", upset: "upset_of_week", event: "event_of_week" };
const RESULT_KEYS = ["start", "bronze", "silver", "gold", "perfect"] as const;
const RESULT_LABEL: Record<string, string> = { start: "Старт", bronze: "Бронза", silver: "Серебро", gold: "Золото", perfect: "Идеально" };
const RESULT_COND: Record<string, string> = { start: "от 20%", bronze: "от 40%", silver: "от 60%", gold: "от 80%", perfect: "100%, минимум 4 вопроса" };

const labelStyle: CSSProperties = { display: "grid", gap: 4, fontSize: 11, fontWeight: 800, color: "var(--tg-hint, #999)" };
const cardStyle: CSSProperties = { border: "1px solid var(--tg-separator, rgba(128,128,128,0.18))", borderRadius: 10, padding: 11, background: "var(--tg-bg, rgba(255,255,255,0.04))" };

function maxSummary(cfg: RewardsConfig, bonusShort: string | null): MaxReward {
  const full = bonusShort ? BONUS_SHORT_TO_FULL[bonusShort] : null;
  const parts = [cfg.participation, full ? cfg.bonus[full] : null, cfg.result.perfect].filter(Boolean) as RewardComponent[];
  const cases: Record<string, number> = {};
  const boosts: Record<string, number> = {};
  let stars = 0; let balls = 0; let luckyTokens = 0;
  for (const p of parts) {
    stars += p.stars || 0; balls += p.balls || 0; luckyTokens += p.lucky_tokens || 0;
    if (p.case_count > 0 && p.case_type) cases[p.case_type] = (cases[p.case_type] || 0) + p.case_count;
    if ((p.boost_count || 0) > 0 && p.boost_type) boosts[p.boost_type] = (boosts[p.boost_type] || 0) + p.boost_count;
  }
  return { stars, balls, cases, lucky_tokens: luckyTokens, boosts };
}

function fmtMax(m: MaxReward): string {
  const parts: string[] = [];
  if (m.stars > 0) parts.push(`${m.stars}⭐`);
  if (m.balls > 0) parts.push(`${m.balls} мяч`);
  if (m.lucky_tokens > 0) parts.push(`${m.lucky_tokens} жетон`);
  for (const [type, count] of Object.entries(m.cases)) if (count > 0) parts.push(`${count} кейс «${caseLabel(type)}»`);
  for (const [type, count] of Object.entries(m.boosts || {})) if (count > 0) parts.push(`${count} × ${boostLabel(type)}`);
  return parts.length ? parts.join(" + ") : "0";
}

export function WeeklyChallengeRewardsEditor({ fetchWithAuth, challengeId }: { fetchWithAuth: FetchWithAuth; challengeId: number }) {
  const [data, setData] = useState<GetResponse | null>(null);
  const [config, setConfig] = useState<RewardsConfig | null>(null);
  const [saved, setSaved] = useState<RewardsConfig | null>(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetchWithAuth<GetResponse>(`/admin/season-predictions/weekly-challenges/${challengeId}/task-rewards`);
      if (!res) return;
      setData(res);
      setConfig(JSON.parse(JSON.stringify(res.rewards)));
      setSaved(JSON.parse(JSON.stringify(res.rewards)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить награды");
    }
  }, [fetchWithAuth, challengeId]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(saved), [config, saved]);
  const locked = data?.locked ?? false;
  const limits = data?.limits;

  const caseOptions = data?.case_options ?? ["basic"];
  const defaultCase = caseOptions[0] || "basic";
  const boostOptions = data?.boost_options ?? ["extra_joker", "double_chance"];
  const defaultBoost = boostOptions[0] || "extra_joker";

  function clamp(field: "stars" | "balls" | "case_count" | "lucky_tokens" | "boost_count", raw: string): number {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || !limits) return 0;
    return Math.max(limits[field].min, Math.min(limits[field].max, n));
  }

  function mutate(section: "participation" | "bonus" | "result", key: string | null, fn: (c: RewardComponent) => void) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as RewardsConfig;
      const comp = section === "participation" ? next.participation : section === "bonus" && key ? next.bonus[key] : section === "result" && key ? next.result[key] : null;
      if (comp) fn(comp);
      return next;
    });
    setNotice("");
  }

  function setNum(section: "participation" | "bonus" | "result", key: string | null, field: "stars" | "balls" | "case_count" | "lucky_tokens" | "boost_count", raw: string) {
    mutate(section, key, (c) => {
      c[field] = clamp(field, raw);
      // Keep case_type consistent: count>0 needs a type; count 0 clears it.
      if (field === "case_count") c.case_type = c.case_count > 0 ? (c.case_type || defaultCase) : null;
      // Same for boosts.
      if (field === "boost_count") c.boost_type = c.boost_count > 0 ? (c.boost_type || defaultBoost) : null;
    });
  }

  function setCaseType(section: "participation" | "bonus" | "result", key: string | null, value: string) {
    mutate(section, key, (c) => {
      if (!value) { c.case_type = null; c.case_count = 0; return; }
      c.case_type = value;
      // Choosing a specific case for this task makes it grant at least one.
      if (c.case_count <= 0) c.case_count = 1;
    });
  }

  function setBoostType(section: "participation" | "bonus" | "result", key: string | null, value: string) {
    mutate(section, key, (c) => {
      if (!value) { c.boost_type = null; c.boost_count = 0; return; }
      c.boost_type = value;
      // Choosing a specific boost for this tier makes it grant at least one.
      if (c.boost_count <= 0) c.boost_count = 1;
    });
  }

  async function save() {
    if (!config) return;
    setSaving("save"); setError(""); setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; rewards: RewardsConfig; error?: string }>(`/admin/season-predictions/weekly-challenges/${challengeId}/task-rewards`, { method: "PUT", body: JSON.stringify({ rewards: config }) });
      if (!res) return;
      setNotice("Награды сохранены.");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg.includes("LOCKED") ? "Награды заблокированы: вызов опубликован или есть участники." : msg.includes("EMPTY") ? "Награда не может быть полностью пустой." : msg.includes("OVER_MAX") ? "Значение превышает лимит." : msg.includes("NEGATIVE") || msg.includes("INVALID") ? "Недопустимое значение." : (msg || "Не удалось сохранить награды"));
    } finally { setSaving(""); }
  }

  async function reset() {
    setSaving("reset"); setError(""); setNotice("");
    try {
      const res = await fetchWithAuth<{ ok: boolean }>(`/admin/season-predictions/weekly-challenges/${challengeId}/task-rewards/reset`, { method: "POST", body: JSON.stringify({}) });
      if (!res) return;
      setNotice("Возвращены стандартные значения.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сбросить награды");
    } finally { setSaving(""); }
  }

  function restoreDefaultsLocal() {
    if (data) { setConfig(JSON.parse(JSON.stringify(data.defaults))); setNotice(""); }
  }

  if (!data || !config) {
    return <div data-testid="weekly-rewards-editor" style={{ fontSize: 12, fontWeight: 700, color: "var(--tg-hint)" }}>{error || "Загрузка наград…"}</div>;
  }

  if (!data.editable) {
    return (
      <div data-testid="weekly-rewards-editor" style={{ ...cardStyle, color: "var(--tg-hint)", fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>
        В старой системе награды фиксированы. Для настраиваемых наград используйте V2.
      </div>
    );
  }

  const max = maxSummary(config, data.bonus_question_key);

  function fieldInputs(section: "participation" | "bonus" | "result", key: string | null, comp: RewardComponent, allowBoost = false) {
    const tid = `${section}${key ? `-${key}` : ""}`;
    const hasCase = comp.case_count > 0 && !!comp.case_type;
    const hasBoost = comp.boost_count > 0 && !!comp.boost_type;
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {(["stars", "balls", "lucky_tokens"] as const).map((f) => (
            <label key={f} style={labelStyle}>
              {f === "stars" ? "Звёзды" : f === "balls" ? "Мячи" : "Жетоны"}
              <AdminInput type="number" data-testid={`weekly-rewards-input-${tid}-${f}`} value={String(comp[f] ?? 0)} disabled={locked} onChange={(e) => setNum(section, key, f, e.target.value)} />
            </label>
          ))}
        </div>
        {/* Specific case for THIS task — independent of every other task. */}
        <div style={{ display: "grid", gridTemplateColumns: hasCase ? "1fr 90px" : "1fr", gap: 8 }}>
          <label style={labelStyle}>
            Кейс этого задания
            <select
              data-testid={`weekly-rewards-case-type-${tid}`}
              value={comp.case_type || ""}
              disabled={locked}
              onChange={(e) => setCaseType(section, key, e.target.value)}
              style={{ minHeight: 40, borderRadius: 12, padding: "0 12px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text)", border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))", fontSize: 13, fontWeight: 700 }}
            >
              <option value="">— без кейса —</option>
              {caseOptions.map((c) => <option key={c} value={c}>{caseLabel(c)}</option>)}
            </select>
          </label>
          {hasCase && (
            <label style={labelStyle}>
              Кол-во
              <AdminInput type="number" data-testid={`weekly-rewards-input-${tid}-case_count`} value={String(comp.case_count)} disabled={locked} onChange={(e) => setNum(section, key, "case_count", e.target.value)} />
            </label>
          )}
        </div>
        {/* Boosts — result tiers only. Each unit is a separate paid boost granted on claim. */}
        {allowBoost && (
          <div style={{ display: "grid", gridTemplateColumns: hasBoost ? "1fr 90px" : "1fr", gap: 8 }}>
            <label style={labelStyle}>
              Буст этого уровня
              <select
                data-testid={`weekly-rewards-boost-type-${tid}`}
                value={comp.boost_type || ""}
                disabled={locked}
                onChange={(e) => setBoostType(section, key, e.target.value)}
                style={{ minHeight: 40, borderRadius: 12, padding: "0 12px", background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))", color: "var(--tg-text)", border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))", fontSize: 13, fontWeight: 700 }}
              >
                <option value="">— без буста —</option>
                {boostOptions.map((b) => <option key={b} value={b}>{boostLabel(b)}</option>)}
              </select>
            </label>
            {hasBoost && (
              <label style={labelStyle}>
                Кол-во
                <AdminInput type="number" data-testid={`weekly-rewards-input-${tid}-boost_count`} value={String(comp.boost_count)} disabled={locked} onChange={(e) => setNum(section, key, "boost_count", e.target.value)} />
              </label>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="weekly-rewards-editor" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.5 }}>
        Настройки действуют только для этого вызова. После публикации изменить их будет нельзя.
      </div>

      {locked && (
        <div data-testid="weekly-rewards-lock" style={{ padding: "10px 12px", borderRadius: 10, background: "color-mix(in srgb, #d98a1a 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #d98a1a 28%, transparent)", color: "color-mix(in srgb, #d98a1a 86%, var(--tg-text))", fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>
          <b>Награды заблокированы.</b> {data.lock_reason}
        </div>
      )}
      {error && <div style={{ padding: "9px 11px", borderRadius: 10, background: "color-mix(in srgb, #e5484d 12%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #e5484d 28%, transparent)", color: "color-mix(in srgb, #e5484d 82%, var(--tg-text))", fontSize: 12.5, fontWeight: 700 }}>{error}</div>}
      {notice && <div style={{ padding: "9px 11px", borderRadius: 10, background: "color-mix(in srgb, #2ec060 13%, var(--tg-bg))", border: "1px solid color-mix(in srgb, #2ec060 24%, transparent)", color: "color-mix(in srgb, #2ec060 82%, var(--tg-text))", fontSize: 12.5, fontWeight: 800 }}>{notice}</div>}
      {!locked && dirty && <div style={{ fontSize: 12, fontWeight: 800, color: "#d98a1a" }}>● Есть несохранённые изменения.</div>}

      {/* Max economy preview */}
      <div data-testid="weekly-rewards-max" style={{ ...cardStyle, background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))" }}>
        <div style={{ fontSize: 12.5, fontWeight: 950 }}>Максимальная награда за неделю</div>
        <div style={{ marginTop: 3, fontSize: 16, fontWeight: 950, color: "var(--tg-text)" }}>{fmtMax(max)}</div>
        <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.4 }}>
          Участие + выбранный бонус ({data.bonus_question_key ? BONUS_LABEL[BONUS_SHORT_TO_FULL[data.bonus_question_key]] : "не выбран"}) + «Идеально».
          Награды итоговых уровней не складываются — игрок получает только лучший достигнутый уровень.
        </div>
      </div>

      {/* Participation */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 950 }}>Заверши Вызов недели</div>
        {fieldInputs("participation", null, config.participation)}
      </div>

      {/* Bonus per category */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 950, marginBottom: 2 }}>Бонусный вопрос — награда по категориям</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>Выбор бонусной категории и размер награды — разные настройки.</div>
        {BONUS_KEYS.map((bk) => {
          const isSelected = data.bonus_question_key && BONUS_SHORT_TO_FULL[data.bonus_question_key] === bk;
          return (
            <div key={bk} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)" }}>
              <div style={{ fontSize: 12.5, fontWeight: 900 }}>{BONUS_LABEL[bk]}{isSelected && <span style={{ color: "#ff8a3c", fontWeight: 800 }}> · бонус этого вызова</span>}</div>
              {isSelected && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>Этот размер награды будет использован в текущем вызове.</div>}
              {fieldInputs("bonus", bk, config.bonus[bk])}
            </div>
          );
        })}
      </div>

      {/* Result tiers */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 950 }}>Итог недели</div>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {RESULT_KEYS.map((rk) => (
            <div key={rk} style={{ borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 10%, transparent)", paddingTop: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900 }}>{RESULT_LABEL[rk]} <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>· {RESULT_COND[rk]}</span></div>
              {fieldInputs("result", rk, config.result[rk], true)}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>Условия уровней изменить нельзя.</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <AdminButton data-testid="weekly-rewards-save" onClick={save} disabled={locked || saving !== "" || !dirty} className="flex-1">{saving === "save" ? "Сохраняю…" : "Сохранить награды"}</AdminButton>
        <AdminButton variant="secondary" onClick={restoreDefaultsLocal} disabled={locked || saving !== ""}>Вернуть стандартные</AdminButton>
        <AdminButton data-testid="weekly-rewards-reset" variant="secondary" onClick={reset} disabled={locked || saving !== "" || data.source !== "custom"}>{saving === "reset" ? "Сброс…" : "Сбросить к стандартным"}</AdminButton>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>Источник: {data.source === "custom" ? "настроено для вызова" : "стандартные значения"}.</div>
    </div>
  );
}
