"use client";

import { useCallback, useEffect, useState } from "react";
import { mskInputToMs, toMskInputValue } from "./mskTime";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminInput } from "./components/AdminInput";
import { AdminToggle } from "./components/AdminToggle";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type PartnerCampaignAdmin = {
  id: number;
  title: string;
  description: string;
  sponsor_name: string;
  badge_text?: string | null;
  ad_badge_text?: string | null;
  task_type: string;
  source_type: string;
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
  bot_username?: string | null;
  deep_link?: string | null;
  verification_secret?: string | null;
  reward_type: string;
  reward_amount: number;
  reward_payload?: Record<string, unknown> | null;
  hold_hours: number;
  starts_at?: number | null;
  ends_at?: number | null;
  max_total_claims?: number | null;
  max_claims_per_user?: number | null;
  status: string;
  is_visible: number;
  sort_order: number;
  last_validation_error?: string | null;
  validation_payload?: Record<string, unknown> | null;
  stats?: {
    started: number;
    pending_hold: number;
    completed: number;
    failed: number;
    revoked: number;
    expired: number;
  };
  recent_errors?: Array<{ failed_reason?: string | null; updated_at?: number | null }>;
};

type PartnerCampaignDraft = {
  title: string;
  description: string;
  sponsor_name: string;
  badge_text: string;
  ad_badge_text: string;
  task_type: string;
  source_type: string;
  telegram_chat_id: string;
  telegram_username: string;
  bot_username: string;
  deep_link: string;
  verification_secret: string;
  reward_type: string;
  reward_amount: string;
  reward_payload: Record<string, unknown>;
  hold_hours: string;
  starts_at: string;
  ends_at: string;
  max_total_claims: string;
  max_claims_per_user: string;
  status: string;
  is_visible: boolean;
  sort_order: string;
};

type ErrorScope = "list" | "editor" | null;

const TASK_TYPE_OPTIONS = [
  { value: "telegram_channel_subscribe", label: "Подписка на Telegram-канал" },
  { value: "telegram_group_join", label: "Вступление в Telegram-группу" },
  { value: "telegram_bot_start", label: "Запуск партнёрского бота" },
  { value: "external_callback_confirm", label: "External callback confirm" },
  { value: "miniapp_open_confirm", label: "Mini App open confirm" },
];

const REWARD_TYPE_OPTIONS = [
  { value: "balls", label: "Мячи" },
  { value: "case", label: "Кейс" },
];

const STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "active", label: "Активна" },
  { value: "paused", label: "На паузе" },
  { value: "ended", label: "Завершена" },
  { value: "archived", label: "Архив" },
];

function getCampaignStatusLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function getCampaignStatusVariant(status: string): "default" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    case "ended":
    case "archived":
      return "default";
    case "draft":
    default:
      return "info";
  }
}

// datetime-local inputs are MSK wall time; stored values are unix millis.
function formatDateTimeLocal(value?: number | null) {
  if (!value) return "";
  return toMskInputValue(Number(value));
}

function emptyDraft(): PartnerCampaignDraft {
  return {
    title: "",
    description: "",
    sponsor_name: "",
    badge_text: "Партнерское",
    ad_badge_text: "Реклама",
    task_type: "telegram_channel_subscribe",
    source_type: "telegram",
    telegram_chat_id: "",
    telegram_username: "",
    bot_username: "",
    deep_link: "",
    verification_secret: "",
    reward_type: "case",
    reward_amount: "1",
    reward_payload: { caseType: "premium" },
    hold_hours: "24",
    starts_at: "",
    ends_at: "",
    max_total_claims: "",
    max_claims_per_user: "1",
    status: "draft",
    is_visible: true,
    sort_order: "100",
  };
}

function campaignToDraft(campaign: PartnerCampaignAdmin): PartnerCampaignDraft {
  return {
    title: campaign.title || "",
    description: campaign.description || "",
    sponsor_name: campaign.sponsor_name || "",
    badge_text: campaign.badge_text || "Партнерское",
    ad_badge_text: campaign.ad_badge_text || "",
    task_type: campaign.task_type || "telegram_channel_subscribe",
    source_type: campaign.source_type || "telegram",
    telegram_chat_id: campaign.telegram_chat_id || "",
    telegram_username: campaign.telegram_username || "",
    bot_username: campaign.bot_username || "",
    deep_link: campaign.deep_link || "",
    verification_secret: campaign.verification_secret || "",
    reward_type: campaign.reward_type || "case",
    reward_amount: String(campaign.reward_amount ?? 1),
    reward_payload: campaign.reward_payload || {},
    hold_hours: String(campaign.hold_hours ?? 24),
    starts_at: formatDateTimeLocal(campaign.starts_at),
    ends_at: formatDateTimeLocal(campaign.ends_at),
    max_total_claims: campaign.max_total_claims == null ? "" : String(campaign.max_total_claims),
    max_claims_per_user: String(campaign.max_claims_per_user ?? 1),
    status: campaign.status || "draft",
    is_visible: Number(campaign.is_visible ?? 1) === 1,
    sort_order: String(campaign.sort_order ?? 100),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function buildPayload(draft: PartnerCampaignDraft) {
  const payload: Record<string, unknown> = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    sponsor_name: draft.sponsor_name.trim(),
    badge_text: draft.badge_text.trim(),
    ad_badge_text: draft.ad_badge_text.trim(),
    task_type: draft.task_type,
    source_type: draft.source_type,
    reward_type: draft.reward_type,
    reward_amount: Number(draft.reward_amount || 0),
    reward_payload: draft.reward_payload,
    hold_hours: Number(draft.hold_hours || 0),
    // Send unix millis: raw datetime-local strings would be parsed as UTC server-side.
    starts_at: mskInputToMs(draft.starts_at),
    ends_at: mskInputToMs(draft.ends_at),
    max_total_claims: draft.max_total_claims ? Number(draft.max_total_claims) : null,
    max_claims_per_user: 1,
    status: draft.status,
    is_visible: draft.is_visible ? 1 : 0,
    sort_order: Number(draft.sort_order || 100),
  };

  if (draft.telegram_chat_id.trim()) payload.telegram_chat_id = draft.telegram_chat_id.trim();
  if (draft.telegram_username.trim()) payload.telegram_username = draft.telegram_username.trim();
  if (draft.bot_username.trim()) payload.bot_username = draft.bot_username.trim();
  if (draft.deep_link.trim()) payload.deep_link = draft.deep_link.trim();
  if (draft.verification_secret.trim()) payload.verification_secret = draft.verification_secret.trim();

  return payload;
}

function Textarea({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "var(--tg-secondary-bg)",
        border: "1px solid var(--tg-separator, rgba(128,128,128,0.1))",
        borderRadius: 12,
        padding: "12px 16px",
        color: "var(--tg-text)",
        outline: "none",
        fontSize: 14,
        width: "100%",
        resize: "vertical",
      }}
    />
  );
}

export default function PartnerCampaignsTab({
  fetchWithAuth,
  onGlobalSuccess,
  onGlobalError,
}: {
  fetchWithAuth: FetchWithAuth;
  onGlobalSuccess?: (msg: string) => void;
  onGlobalError?: (msg: string) => void;
}) {
  const [campaigns, setCampaigns] = useState<PartnerCampaignAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PartnerCampaignDraft>(emptyDraft());
  const [rewardPayloadInput, setRewardPayloadInput] = useState<string>(() => JSON.stringify(emptyDraft().reward_payload || {}, null, 2));
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");
  const [errorScope, setErrorScope] = useState<ErrorScope>(null);

  const setSuccess = (msg: string) => {
    setLocalSuccess(msg);
    onGlobalSuccess?.(msg);
    setTimeout(() => setLocalSuccess(""), 3500);
  };

  const setError = useCallback((msg: string, scope: ErrorScope = null) => {
    setLocalError(msg);
    setErrorScope(scope);
    onGlobalError?.(msg);
  }, [onGlobalError]);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    setLocalError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; campaigns: PartnerCampaignAdmin[]; error?: string }>("/admin/partner-campaigns");
      if (res?.ok) {
        setCampaigns(res.campaigns || []);
      } else {
        setError(res?.error || "Не удалось загрузить партнёрские кампании.", "list");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Не удалось загрузить партнёрские кампании.", "list");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, setError]);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  const applyRewardPreset = (rewardType: string) => {
    setDraft((prev) => {
      let nextPayload = { ...(prev.reward_payload || {}) };
      if (rewardType === "balls") nextPayload = {};
      if (rewardType === "case" && !nextPayload.caseType) nextPayload.caseType = "premium";
      setRewardPayloadInput(JSON.stringify(nextPayload, null, 2));
      return { ...prev, reward_type: rewardType, reward_payload: nextPayload };
    });
  };

  const resetForm = () => {
    setSelectedId(null);
    const nextDraft = emptyDraft();
    setDraft(nextDraft);
    setRewardPayloadInput(JSON.stringify(nextDraft.reward_payload || {}, null, 2));
    setLocalError("");
    setErrorScope(null);
  };

  const selectCampaign = (campaign: PartnerCampaignAdmin) => {
    const nextDraft = campaignToDraft(campaign);
    setSelectedId(campaign.id);
    setDraft(nextDraft);
    setRewardPayloadInput(JSON.stringify(nextDraft.reward_payload || {}, null, 2));
    setLocalError("");
    setErrorScope(null);
  };

  const saveCampaign = async () => {
    setSaving(true);
    setLocalError("");
    try {
      const trimmedPayload = rewardPayloadInput.trim();
      if (trimmedPayload) JSON.parse(trimmedPayload);
      const payload = buildPayload(draft);
      const path = selectedId ? `/admin/partner-campaigns/${selectedId}` : "/admin/partner-campaigns";
      const method = selectedId ? "PUT" : "POST";
      const res = await fetchWithAuth<{ ok: boolean; error?: string; campaign?: PartnerCampaignAdmin }>(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res?.ok) {
        setError(res?.error || "Не удалось сохранить кампанию.", "editor");
        return;
      }
      setSuccess(selectedId ? "Кампания обновлена." : "Кампания создана.");
      await loadCampaigns();
      if (res.campaign) {
        setSelectedId(res.campaign.id);
        const nextDraft = campaignToDraft(res.campaign);
        setDraft(nextDraft);
        setRewardPayloadInput(JSON.stringify(nextDraft.reward_payload || {}, null, 2));
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Не удалось сохранить кампанию.", "editor");
    } finally {
      setSaving(false);
    }
  };

  // Быстрое скрытие из списка: PUT принимает частичный payload и добирает остальные поля из существующей строки.
  const toggleVisibility = async (campaign: PartnerCampaignAdmin) => {
    const nextVisible = Number(campaign.is_visible ?? 1) === 1 ? 0 : 1;
    setSaving(true);
    setLocalError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/admin/partner-campaigns/${campaign.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_visible: nextVisible }),
      });
      if (!res?.ok) {
        setError(res?.error || "Не удалось изменить видимость кампании.", "list");
        return;
      }
      setSuccess(nextVisible ? "Кампания снова видна пользователям." : "Кампания скрыта от пользователей.");
      await loadCampaigns();
      if (selectedId === campaign.id) {
        setDraft((prev) => ({ ...prev, is_visible: nextVisible === 1 }));
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Не удалось изменить видимость кампании.", "list");
    } finally {
      setSaving(false);
    }
  };

  const updateRewardPayload = (nextValue: string) => {
    setRewardPayloadInput(nextValue);
    try {
      setDraft((prev) => ({ ...prev, reward_payload: nextValue.trim() ? JSON.parse(nextValue) : {} }));
      setLocalError("");
      setErrorScope(null);
    } catch {
      setLocalError("Reward payload должен быть валидным JSON.");
      setErrorScope("editor");
    }
  };

  const activeCampaignsCount = campaigns.filter((campaign) => campaign.status === "active").length;
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId);
  const editorDescription = selectedCampaign
    ? selectedCampaign.title
    : "Кампания не выбрана. Можно создать новую или выбрать из списка.";

  return (
    <div className="space-y-4">
      {(localError || localSuccess) && (
        <div className="space-y-2">
          {localError && (
            <AdminBadge variant="danger" className="w-full p-3 justify-start font-normal text-sm leading-normal whitespace-normal h-auto text-left">
              {localError}
            </AdminBadge>
          )}
          {localSuccess && (
            <AdminBadge variant="success" className="w-full p-3 justify-start font-normal text-sm leading-normal whitespace-normal h-auto text-left">
              {localSuccess}
            </AdminBadge>
          )}
        </div>
      )}

      <AdminCard className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="text-[17px] font-bold text-[var(--tg-theme-text-color,#fff)]">Партнерские задания</div>
            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] mt-1">
              Рекламные кампании с hold-периодом, серверной проверкой и безопасными наградами.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AdminButton variant="secondary" size="sm" onClick={loadCampaigns} disabled={loading}>Обновить</AdminButton>
            <AdminButton variant="ghost" size="sm" onClick={resetForm}>Новая кампания</AdminButton>
          </div>
        </div>
      </AdminCard>

      <AdminCollapsibleSection
        key={`editor-${selectedId ?? "new"}-${errorScope === "editor" ? "error" : "normal"}`}
        title="Создание / редактирование кампании"
        description={editorDescription}
        badge={<AdminBadge variant={selectedId ? "info" : "success"}>{selectedId ? "редактирование" : "новая"}</AdminBadge>}
        defaultOpen={false}
        forceOpen={errorScope === "editor" || selectedId !== null}
        keepMounted
        storageKey="admin:partner-campaigns:editor"
      >
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Название</div>
                <AdminInput value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Партнёр</div>
                <AdminInput value={draft.sponsor_name} onChange={(e) => setDraft((prev) => ({ ...prev, sponsor_name: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Описание</div>
              <Textarea value={draft.description} onChange={(value) => setDraft((prev) => ({ ...prev, description: value }))} rows={3} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Бейдж задания</div>
                <AdminInput value={draft.badge_text} onChange={(e) => setDraft((prev) => ({ ...prev, badge_text: e.target.value }))} placeholder="Партнерское" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Рекламный бейдж</div>
                <AdminInput value={draft.ad_badge_text} onChange={(e) => setDraft((prev) => ({ ...prev, ad_badge_text: e.target.value }))} placeholder="Реклама или пусто, чтобы скрыть" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Тип задания</div>
                <select
                  value={draft.task_type}
                  onChange={(e) => setDraft((prev) => ({ ...prev, task_type: e.target.value }))}
                  style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)", borderRadius: 12, padding: "12px 16px", width: "100%" }}
                >
                  {TASK_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Статус</div>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((prev) => ({ ...prev, status: e.target.value }))}
                  style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)", borderRadius: 12, padding: "12px 16px", width: "100%" }}
                >
                  {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Видимо пользователю</div>
                <div className="h-[48px] flex items-center">
                  <AdminToggle checked={draft.is_visible} onChange={(checked) => setDraft((prev) => ({ ...prev, is_visible: checked }))} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Telegram chat ID</div>
                <AdminInput value={draft.telegram_chat_id} onChange={(e) => setDraft((prev) => ({ ...prev, telegram_chat_id: e.target.value }))} placeholder="-100..." />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Telegram username</div>
                <AdminInput value={draft.telegram_username} onChange={(e) => setDraft((prev) => ({ ...prev, telegram_username: e.target.value }))} placeholder="@partner_channel" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Партнёрский бот</div>
                <AdminInput value={draft.bot_username} onChange={(e) => setDraft((prev) => ({ ...prev, bot_username: e.target.value }))} placeholder="@partner_bot" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Deep link / URL</div>
                <AdminInput value={draft.deep_link} onChange={(e) => setDraft((prev) => ({ ...prev, deep_link: e.target.value }))} placeholder="https://t.me/..." />
              </div>
            </div>

            {(draft.task_type === "external_callback_confirm" || draft.task_type === "miniapp_open_confirm") && (
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Callback secret</div>
                <AdminInput value={draft.verification_secret} onChange={(e) => setDraft((prev) => ({ ...prev, verification_secret: e.target.value }))} placeholder="генерируется автоматически при сохранении" />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Награда</div>
                <select
                  value={draft.reward_type}
                  onChange={(e) => applyRewardPreset(e.target.value)}
                  style={{ background: "var(--tg-secondary-bg)", color: "var(--tg-text)", borderRadius: 12, padding: "12px 16px", width: "100%" }}
                >
                  {REWARD_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Количество</div>
                <AdminInput type="number" value={draft.reward_amount} onChange={(e) => setDraft((prev) => ({ ...prev, reward_amount: e.target.value }))} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Hold (часы)</div>
                <AdminInput type="number" value={draft.hold_hours} onChange={(e) => setDraft((prev) => ({ ...prev, hold_hours: e.target.value }))} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Sort</div>
                <AdminInput type="number" value={draft.sort_order} onChange={(e) => setDraft((prev) => ({ ...prev, sort_order: e.target.value }))} />
              </div>
            </div>

            {draft.reward_type === "balls" ? (
              <div className="rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] p-4 text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                Для награды <b>мячики</b> поле `Reward payload JSON` не требуется.
              </div>
            ) : (
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Reward payload JSON</div>
                <Textarea
                  value={rewardPayloadInput}
                  onChange={updateRewardPayload}
                  rows={4}
                  placeholder='{"caseType":"premium"}'
                />
                <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)] mt-2">
                  Для `case` используйте `caseType`.
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Старт (МСК)</div>
                <AdminInput type="datetime-local" value={draft.starts_at} onChange={(e) => setDraft((prev) => ({ ...prev, starts_at: e.target.value }))} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Конец (МСК)</div>
                <AdminInput type="datetime-local" value={draft.ends_at} onChange={(e) => setDraft((prev) => ({ ...prev, ends_at: e.target.value }))} />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider mb-1">Общий лимит</div>
                <AdminInput type="number" value={draft.max_total_claims} onChange={(e) => setDraft((prev) => ({ ...prev, max_total_claims: e.target.value }))} placeholder="без лимита" />
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] p-4 text-[12px] text-[var(--tg-theme-hint-color,#999)]">
              На пользователя жёстко действует один reward на одну кампанию. Season points и league points для партнёрских заданий не поддерживаются намеренно.
            </div>

            <div className="flex gap-2">
              <AdminButton variant="primary" onClick={saveCampaign} disabled={saving}>
                {selectedId ? "Сохранить кампанию" : "Создать кампанию"}
              </AdminButton>
              <AdminButton variant="secondary" onClick={resetForm}>Сбросить</AdminButton>
            </div>
        </div>
      </AdminCollapsibleSection>

      <AdminCollapsibleSection
        key={`list-${errorScope === "list" ? "error" : "normal"}`}
        title="Партнёрские кампании"
        description={`Всего ${campaigns.length} · активно ${activeCampaignsCount}`}
        defaultOpen
        forceOpen={errorScope === "list"}
        keepMounted
        storageKey="admin:partner-campaigns:list"
      >
        <div className="space-y-3">
            {loading ? (
              <AdminCard>Загрузка кампаний...</AdminCard>
            ) : campaigns.length === 0 ? (
              <AdminCard>Пока нет ни одной партнёрской кампании.</AdminCard>
            ) : (
              campaigns.map((campaign) => (
                <AdminCard
                  key={campaign.id}
                  onClick={() => selectCampaign(campaign)}
                  className={selectedId === campaign.id ? "ring-2 ring-[var(--tg-theme-button-color,#2481cc)]" : ""}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-bold text-[var(--tg-theme-text-color,#fff)]">{campaign.title}</div>
                      <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] mt-1">{campaign.sponsor_name || "Без бренда"}</div>
                      <div className="flex gap-2 flex-wrap mt-2">
                        <AdminBadge variant={getCampaignStatusVariant(campaign.status)}>{getCampaignStatusLabel(campaign.status)}</AdminBadge>
                        <AdminBadge variant="info">{campaign.task_type}</AdminBadge>
                        <AdminBadge variant="info">{campaign.reward_type}</AdminBadge>
                        {Number(campaign.is_visible ?? 1) !== 1 && <AdminBadge variant="warning">Скрыта</AdminBadge>}
                      </div>
                    </div>
                    <div className="text-right text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                      <div>Done: {campaign.stats?.completed ?? 0}</div>
                      <div>Hold: {campaign.stats?.pending_hold ?? 0}</div>
                    </div>
                  </div>

                  <div
                    className="mt-3 flex justify-end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <AdminButton
                      size="sm"
                      variant={Number(campaign.is_visible ?? 1) === 1 ? "danger" : "secondary"}
                      disabled={saving}
                      onClick={() => toggleVisibility(campaign)}
                    >
                      {Number(campaign.is_visible ?? 1) === 1 ? "Скрыть от пользователей" : "Показать пользователям"}
                    </AdminButton>
                  </div>

                  {campaign.last_validation_error && (
                    <div className="mt-3 text-[12px] leading-normal text-[#ff9500]">
                      Validation: {campaign.last_validation_error}
                    </div>
                  )}

                  {!!campaign.recent_errors?.length && (
                    <div className="mt-3 text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                      Последние ошибки: {campaign.recent_errors.map((item) => item.failed_reason).filter(Boolean).join(", ")}
                    </div>
                  )}
                </AdminCard>
              ))
            )}
        </div>
      </AdminCollapsibleSection>
    </div>
  );
}
