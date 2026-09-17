"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminBadge } from "./components/AdminBadge";
import { AdminButton } from "./components/AdminButton";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import { AdminInput } from "./components/AdminInput";
import PartnerCampaignsTab from "./PartnerCampaignsTab";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type QuestRecord = {
  task_key: string;
  task_type: string;
  scope: string;
  emoji: string;
  title: string;
  description: string;
  reward_stars: number;
  reward_balls?: number;
  progress_target: number | null;
  progress_kind: string;
  reset_scope: string;
  phase: string;
  league_only: number;
  rarity: string;
  sort_order: number;
  period_type?: string;
  claim_mode?: string;
  ranking_based?: number;
  is_enabled?: number;
  season_id?: number | null;
};

type QuestPeriod = "daily" | "weekly" | "seasonal";
type VisibleQuestPeriod = "daily" | "weekly";

const RARITY_COLORS: Record<string, string> = {
  common: "var(--tg-theme-hint-color,#999)",
  rare: "#5b8def",
  epic: "#a855f7",
};

export default function QuestsTab({
  fetchWithAuth,
  onGlobalSuccess,
  onGlobalError,
}: {
  fetchWithAuth: FetchWithAuth;
  onGlobalSuccess?: (msg: string) => void;
  onGlobalError?: (msg: string) => void;
}) {
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<QuestRecord>>({});
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");

  // Stable callbacks so loadQuests (and its effect) don't re-create every render.
  const setSuccess = useCallback((msg: string) => {
    setLocalSuccess(msg);
    onGlobalSuccess?.(msg);
    setTimeout(() => setLocalSuccess(""), 3500);
  }, [onGlobalSuccess]);
  const setError = useCallback((msg: string) => {
    setLocalError(msg);
    onGlobalError?.(msg);
  }, [onGlobalError]);

  const loadQuests = useCallback(async () => {
    setLoading(true);
    setLocalError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; quests: QuestRecord[] }>("/admin/quests");
      if (res?.ok) setQuests(res.quests || []);
      else setError("Failed to load quests.");
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to load quests.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, setError]);

  useEffect(() => { loadQuests(); }, [loadQuests]);

  // Effective UI period for grouping (same rules as before, just per-section now).
  const periodOf = (q: QuestRecord): QuestPeriod => {
    if (q.task_type === "daily" || q.scope === "daily" || q.period_type === "daily") return "daily";
    if (q.task_type === "weekly" || q.scope === "weekly" || q.period_type === "weekly") return "weekly";
    // Legacy seasonal quests are intentionally hidden from admin UI after levels/seasonal system removal.
    return "seasonal";
  };
  const questsForPeriod = (period: VisibleQuestPeriod) => quests.filter((q) => periodOf(q) === period);

  const startEdit = (q: QuestRecord) => {
    setEditingKey(q.task_key);
    setEditDraft({
      title: q.title,
      description: q.description,
      emoji: q.emoji,
      reward_stars: q.reward_stars,
      reward_balls: q.reward_balls ?? 0,
      progress_target: q.progress_target,
      sort_order: q.sort_order,
      phase: q.phase,
      rarity: q.rarity,
      is_enabled: q.is_enabled ?? 1,
      claim_mode: q.claim_mode ?? "auto",
      ranking_based: q.ranking_based ?? 0,
      league_only: q.league_only,
    });
  };

  const saveEdit = async () => {
    if (!editingKey) return;
    setSaving(true);
    setLocalError("");
    try {
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>(
        `/admin/quests/${encodeURIComponent(editingKey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editDraft),
        }
      );
      if (res?.ok) {
        setSuccess("Quest updated ✅");
        setEditingKey(null);
        await loadQuests();
      } else {
        setError(res?.error || "Failed to update quest.");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to update quest.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (q: QuestRecord) => {
    const newVal = (q.is_enabled ?? 1) === 1 ? 0 : 1;
    try {
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>(
        `/admin/quests/${encodeURIComponent(q.task_key)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_enabled: newVal }),
        }
      );
      if (res?.ok) {
        setSuccess(`${q.task_key} ${newVal ? "enabled" : "disabled"}`);
        await loadQuests();
      } else {
        setError(res?.error || "Failed to toggle quest.");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Toggle failed.");
    }
  };

  // Section header subtitle: "N заданий · включено X".
  const sectionSubtitle = (period: VisibleQuestPeriod) => {
    const list = questsForPeriod(period);
    const on = list.filter((q) => (q.is_enabled ?? 1) === 1).length;
    return `${list.length} заданий · включено ${on}`;
  };

  // Render the quest list for one period (same rows + inline edit as before).
  const renderList = (period: VisibleQuestPeriod) => {
    const list = questsForPeriod(period);
    if (loading) return <div className="text-center text-[var(--tg-theme-hint-color,#999)] py-12 animate-pulse">Loading quests...</div>;
    if (list.length === 0) return <div className="text-center text-[var(--tg-theme-hint-color,#999)] py-12">No quests in this category.</div>;
    return (
      <div className="space-y-3">
        {list.map((q) => {
              const isEditing = editingKey === q.task_key;
              const isDisabled = (q.is_enabled ?? 1) === 0;
              return (
                <div
                  key={q.task_key}
                  className="rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.03))] overflow-hidden"
                  style={{ opacity: isDisabled ? 0.5 : 1 }}
                >
                  {/* Quest header */}
                  <div className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="text-xl flex-shrink-0">{q.emoji}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-[14px] font-bold text-[var(--tg-theme-text-color,#fff)] truncate">{q.title}</div>
                          <AdminBadge variant={isDisabled ? "danger" : "success"} className="text-[9px] px-1.5 py-0.5">
                            {isDisabled ? "OFF" : "ON"}
                          </AdminBadge>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: RARITY_COLORS[q.rarity] || RARITY_COLORS.common }}>
                            {q.rarity}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)] font-mono mt-0.5">{q.task_key}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-[13px] font-bold text-yellow-400">⭐ {q.reward_stars}</div>
                        {q.progress_target && (
                          <div className="text-[10px] text-[var(--tg-theme-hint-color,#999)]">Target: {q.progress_target}</div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <AdminButton
                          variant="ghost"
                          size="sm"
                          onClick={() => isEditing ? setEditingKey(null) : startEdit(q)}
                          className="!rounded-lg !text-[11px] !px-2 !py-1"
                        >
                          {isEditing ? "Cancel" : "Edit"}
                        </AdminButton>
                        <button
                          onClick={() => toggleEnabled(q)}
                          className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
                          style={{
                            background: isDisabled ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
                            border: `1px solid ${isDisabled ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                          }}
                          title={isDisabled ? "Enable" : "Disable"}
                        >
                          <span className="text-sm">{isDisabled ? "🔴" : "🟢"}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Edit form */}
                  {isEditing && (
                    <div className="px-4 pb-4 pt-2 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Title</label>
                          <AdminInput
                            value={editDraft.title ?? ""}
                            onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Emoji</label>
                          <AdminInput
                            value={editDraft.emoji ?? ""}
                            onChange={(e) => setEditDraft({ ...editDraft, emoji: e.target.value })}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Description</label>
                        <AdminInput
                          value={editDraft.description ?? ""}
                          onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">⭐ Stars</label>
                          <AdminInput
                            type="number"
                            value={String(editDraft.reward_stars ?? 0)}
                            onChange={(e) => setEditDraft({ ...editDraft, reward_stars: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">🔵 Balls</label>
                          <AdminInput
                            type="number"
                            value={String(editDraft.reward_balls ?? 0)}
                            onChange={(e) => setEditDraft({ ...editDraft, reward_balls: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Target</label>
                          <AdminInput
                            type="number"
                            value={String(editDraft.progress_target ?? "")}
                            onChange={(e) => setEditDraft({ ...editDraft, progress_target: e.target.value ? Number(e.target.value) : null })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Sort Order</label>
                          <AdminInput
                            type="number"
                            value={String(editDraft.sort_order ?? 100)}
                            onChange={(e) => setEditDraft({ ...editDraft, sort_order: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Phase</label>
                          <select
                            value={editDraft.phase ?? "pick_saved"}
                            onChange={(e) => setEditDraft({ ...editDraft, phase: e.target.value })}
                            className="w-full rounded-xl px-3 py-2.5 text-[13px] font-medium bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.06))] border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] text-[var(--tg-theme-text-color,#fff)] outline-none"
                          >
                            <option value="pick_saved">pick_saved</option>
                            <option value="scores_updated">scores_updated</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Rarity</label>
                          <select
                            value={editDraft.rarity ?? "common"}
                            onChange={(e) => setEditDraft({ ...editDraft, rarity: e.target.value })}
                            className="w-full rounded-xl px-3 py-2.5 text-[13px] font-medium bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.06))] border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] text-[var(--tg-theme-text-color,#fff)] outline-none"
                          >
                            <option value="common">Common</option>
                            <option value="rare">Rare</option>
                            <option value="epic">Epic</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold text-[var(--tg-theme-hint-color,#999)] uppercase tracking-wider block mb-1">Claim Mode</label>
                          <select
                            value={editDraft.claim_mode ?? "auto"}
                            onChange={(e) => setEditDraft({ ...editDraft, claim_mode: e.target.value })}
                            className="w-full rounded-xl px-3 py-2.5 text-[13px] font-medium bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.06))] border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.08))] text-[var(--tg-theme-text-color,#fff)] outline-none"
                          >
                            <option value="auto">Auto</option>
                            <option value="manual">Manual</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 pt-1">
                        <label className="flex items-center gap-2 text-[12px] text-[var(--tg-theme-text-color,#fff)]">
                          <input
                            type="checkbox"
                            checked={(editDraft.league_only ?? 0) === 1}
                            onChange={(e) => setEditDraft({ ...editDraft, league_only: e.target.checked ? 1 : 0 })}
                            className="accent-blue-500"
                          />
                          League Only
                        </label>
                        <label className="flex items-center gap-2 text-[12px] text-[var(--tg-theme-text-color,#fff)]">
                          <input
                            type="checkbox"
                            checked={(editDraft.ranking_based ?? 0) === 1}
                            onChange={(e) => setEditDraft({ ...editDraft, ranking_based: e.target.checked ? 1 : 0 })}
                            className="accent-blue-500"
                          />
                          Ranking Based
                        </label>
                      </div>
                      <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)] leading-relaxed bg-[var(--tg-theme-secondary-bg-color,#111)] rounded-xl p-3">
                        <strong>Read-only:</strong> task_key = <code>{q.task_key}</code>, progress_kind = <code>{q.progress_kind}</code>, scope = <code>{q.scope}</code>
                      </div>
                      <AdminButton
                        onClick={saveEdit}
                        disabled={saving}
                        className="w-full !rounded-xl !py-3 font-bold"
                      >
                        {saving ? "Saving..." : "Save Changes"}
                      </AdminButton>
                    </div>
                  )}
                </div>
              );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
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

      {/* Header — always visible */}
      <AdminCard className="overflow-hidden shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 bg-amber-500 rounded-full" />
              <h2 className="text-[17px] font-bold tracking-tight text-[var(--tg-theme-text-color,#fff)]">Quests Management</h2>
            </div>
            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
              Edit quests: rewards, targets, sorting, and enable/disable.
            </div>
          </div>
          <AdminButton variant="secondary" size="sm" disabled={loading} onClick={loadQuests} className="!rounded-xl">
            Refresh
          </AdminButton>
        </div>
      </AdminCard>

      {/* Stacked collapsible sections per category */}
      <AdminCollapsibleSection
        title="Ежедневные задания"
        description={sectionSubtitle("daily")}
        defaultOpen
        keepMounted
        storageKey="admin:quests:daily"
      >
        {renderList("daily")}
      </AdminCollapsibleSection>

      <AdminCollapsibleSection
        title="Еженедельные задания"
        description={sectionSubtitle("weekly")}
        keepMounted
        storageKey="admin:quests:weekly"
      >
        {renderList("weekly")}
      </AdminCollapsibleSection>

      {/* Partner — lazy mount on open (preserves its own fetch-on-mount). */}
      <AdminCollapsibleSection
        title="Партнёрские задания"
        description="кампании и партнёрские задания"
        storageKey="admin:quests:partner"
      >
        <PartnerCampaignsTab
          fetchWithAuth={fetchWithAuth}
          onGlobalSuccess={onGlobalSuccess}
          onGlobalError={onGlobalError}
        />
      </AdminCollapsibleSection>
    </div>
  );
}
