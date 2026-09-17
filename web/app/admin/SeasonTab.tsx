"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMsk, mskInputToMs, toMskInputValue } from "./mskTime";
import { AdminCard } from "./components/AdminCard";
import { AdminCollapsibleSection } from "./components/AdminCollapsibleSection";
import {
  AdminBadge,
  AdminButton,
  AdminDataRow,
  AdminInput,
  AdminMetricCard,
} from "./components/ui";

type FetchWithAuth = <T = unknown>(path: string, options?: RequestInit) => Promise<T | null>;

type SeasonStatus = "upcoming" | "active" | "finalizing" | "finished" | "archived";

type SeasonRecord = {
  id: number;
  name: string;
  slug: string | null;
  status: SeasonStatus;
  starts_at: string;
  ends_at: string;
  activated_at: string | null;
  finalized_at: string | null;
  archived_at: string | null;
  display_order: number;
  is_visible: number;
  notes: string | null;
};

type SeasonDetail = {
  season: SeasonRecord;
  matches: {
    total: number;
    finished: number;
    unfinished: number;
    pickMatches: number;
    missingResults: number;
    readyToFinalize: boolean;
    reason: string | null;
  };
  snapshot: {
    hasSnapshot: boolean;
    globalRows: number;
    leagueRows: number;
    awards: number;
  };
  permissions: {
    canFinalize: boolean;
    canRefinalize: boolean;
    canActivate: boolean;
    canArchive: boolean;
  };
  activation: {
    ok: boolean;
    reason: string | null;
    blockingSeason?: { id: number; name: string; status: SeasonStatus } | null;
  };
  topGlobal: Array<{
    user_id: number;
    final_rank: number;
    final_points: number;
    username?: string | null;
    first_name?: string | null;
  }>;
};

type DisplaySeasonPayload = {
  current: {
    id: number;
    name: string;
    slug: string | null;
    status: SeasonStatus;
    startsAt: string;
    endsAt: string;
    finalizedAt: string | null;
    activatedAt: string | null;
    archivedAt: string | null;
    isVisible: boolean;
    predictionsOpen: boolean;
  } | null;
  activeSeasonId: number | null;
  predictionsOpen: boolean;
  nextUpcoming: {
    id: number;
    name: string;
    slug: string | null;
    status: SeasonStatus;
    startsAt: string;
    endsAt: string;
  } | null;
};

type ErrorScope = "load" | "settings" | "recalc" | "rotation" | "levels" | null;

type SeasonActionResponse = {
  ok: boolean;
  error?: string;
  result?: {
    achDebug?: unknown;
    seasonAchievementsAwarded?: number;
  };
};

type DebugAchievementsResponse = unknown;

function fmtDate(iso?: string | null) {
  return formatMsk(iso, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSeasonError(error?: string | null) {
  if (!error) return "Request failed";
  if (error.startsWith("SEASON_OVERLAP")) return "Season dates overlap with an existing season.";
  if (error === "SEASON_NAME_REQUIRED") return "Season name is required.";
  if (error === "SEASON_DATES_REQUIRED") return "Season start and end are required.";
  if (error === "SEASON_BAD_DATES") return "Season dates are invalid.";
  if (error === "SEASON_BAD_RANGE") return "Season end must be after season start.";
  if (error === "SEASON_EDIT_NOT_ALLOWED") return "Only upcoming or active seasons can be edited.";
  if (error === "ACTIVE_SEASON_START_LOCKED") return "For an active season you can only edit the end date.";
  if (error === "ACTIVE_SEASON_END_REQUIRED") return "Active season end date is required.";
  if (error === "ACTIVE_SEASON_END_ONLY_EXTEND") return "Active season end date can only be extended.";
  if (error === "ACTIVE_SEASON_EXISTS") return "Another season is still active.";
  if (error === "PREVIOUS_SEASON_NOT_FINISHED") return "The previous season must be finished before activation.";
  if (error === "SEASON_FINALIZING") return "Another season is currently finalizing.";
  if (error === "SEASON_NOT_UPCOMING") return "Only upcoming seasons can be activated.";
  if (error === "SEASON_NOT_READY") return "Season is not ready for finalization yet.";
  if (error === "SEASON_NOT_FINISHED") return "Season must be finished before this action.";
  if (error === "ONLY_FINISHED_CAN_BE_ARCHIVED") return "Only finished seasons can be archived.";
  if (error === "SEASON_LEGACY_ENDPOINT_DISABLED") return "Legacy season editing is disabled. Use the season lifecycle actions below.";
  return error;
}

function formatFinalizeReason(reason?: string | null) {
  if (!reason) return "Ready";
  if (reason === "NO_MATCHES") return "No matches are linked to this season yet.";
  if (reason === "UNFINISHED_MATCHES") return "There are still unfinished matches in this season.";
  if (reason === "MISSING_RESULTS") return "Some finished matches still have no final result.";
  if (reason === "SEASON_RANGE_NOT_ENDED") return "Season end time has not passed yet.";
  return reason;
}

// Map season status to a UI Kit badge variant (status text itself is unchanged).
function statusVariant(status: SeasonStatus): "info" | "success" | "warning" | "danger" | "neutral" | "accent" {
  if (status === "active") return "success";
  if (status === "finalizing") return "warning";
  if (status === "finished") return "accent";
  if (status === "archived") return "neutral";
  return "info";
}

// datetime-local picker indicator: keep it visible on the dark theme.
const datePickerClass = "[&::-webkit-calendar-picker-indicator]:invert-[1] [&::-webkit-calendar-picker-indicator]:opacity-50";

export default function SeasonTab({
  fetchWithAuth,
  onGlobalSuccess,
  onGlobalError,
}: {
  fetchWithAuth: FetchWithAuth;
  onGlobalSuccess?: (message: string) => void;
  onGlobalError?: (message: string) => void;
}) {
  const [seasons, setSeasons] = useState<SeasonDetail[]>([]);
  const [displaySeason, setDisplaySeason] = useState<DisplaySeasonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingKey, setSubmittingKey] = useState<string>("");
  const [localError, setLocalError] = useState("");
  const [errorScope, setErrorScope] = useState<ErrorScope>(null);
  const [localSuccess, setLocalSuccess] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Inline date editing for upcoming seasons and active season end extension
  const [editingDatesId, setEditingDatesId] = useState<number | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error || "");

  const setSuccess = useCallback((message: string) => {
    setLocalSuccess(message);
    onGlobalSuccess?.(message);
    setTimeout(() => setLocalSuccess(""), 3500);
  }, [onGlobalSuccess]);

  const setError = useCallback((message: string, scope: ErrorScope = null) => {
    setLocalError(message);
    setErrorScope(scope);
    onGlobalError?.(message);
  }, [onGlobalError]);

  const loadSeasons = useCallback(async () => {
    setLoading(true);
    setLocalError("");
    setErrorScope(null);
    try {
      const res = await fetchWithAuth<{ ok: boolean; seasons: SeasonDetail[]; displaySeason: DisplaySeasonPayload }>("/admin/seasons");
      if (res?.ok) {
        setSeasons(res.seasons || []);
        setDisplaySeason(res.displaySeason || null);
        setExpandedId((currentExpandedId) => {
          if (currentExpandedId || !res.seasons?.length) return currentExpandedId;
          const preferred = res.displaySeason?.current?.id ?? res.seasons[0]?.season.id ?? null;
          return preferred;
        });
      } else {
        setError("Failed to load seasons.", "load");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to load seasons.", "load");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, setError]);

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  const upcomingCount = useMemo(
    () => seasons.filter((season) => season.season.status === "upcoming").length,
    [seasons]
  );

  const createSeason = async () => {
    setLocalError("");
    setErrorScope(null);
    if (!newName.trim()) {
      setError("Season name is required.", "settings");
      return;
    }
    const newStartMs = mskInputToMs(newStart);
    const newEndMs = mskInputToMs(newEnd);
    if (!newStartMs || !newEndMs) {
      setError("Season start and end are required.", "settings");
      return;
    }
    if (newStartMs >= newEndMs) {
      setError("Season end must be after season start.", "settings");
      return;
    }

    setSubmittingKey("create");
    try {
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>("/admin/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          startsAt: new Date(newStartMs).toISOString(),
          endsAt: new Date(newEndMs).toISOString(),
          notes: newNotes.trim() || null,
        }),
      });
      if (res?.ok) {
        setNewName("");
        setNewStart("");
        setNewEnd("");
        setNewNotes("");
        setSuccess("Upcoming season created.");
        await loadSeasons();
      } else {
        setError(formatSeasonError(res?.error), "settings");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to create season.", "settings");
    } finally {
      setSubmittingKey("");
    }
  };

  const runSeasonAction = async (
    seasonId: number,
    action: "recalculate-status" | "finalize" | "refinalize" | "activate" | "archive",
    opts?: { confirmText?: string; successText?: string; body?: Record<string, unknown> }
  ) => {
    if (opts?.confirmText && !window.confirm(opts.confirmText)) return;
    const actionScope: ErrorScope = action === "recalculate-status" || action === "refinalize" ? "recalc" : "rotation";
    setSubmittingKey(`${seasonId}:${action}`);
    setLocalError("");
    setErrorScope(null);
    try {
      const res = await fetchWithAuth<SeasonActionResponse>(`/admin/seasons/${seasonId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res?.ok) {
        const debugInfo = res.result?.achDebug;
        const awarded = res.result?.seasonAchievementsAwarded;
        let msg = opts?.successText || "Action completed.";
        if (debugInfo) {
          msg += `\n\nAch debug (awarded: ${awarded}):\n${JSON.stringify(debugInfo, null, 2)}`;
        }
        setSuccess(msg);
        await loadSeasons();
      } else {
        setError(formatSeasonError(res?.error), actionScope);
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Action failed.", actionScope);
    } finally {
      setSubmittingKey("");
    }
  };

  const startEditingDates = (season: SeasonRecord) => {
    setEditingDatesId(season.id);
    // Inputs are MSK wall time; slicing the raw UTC ISO here used to show the
    // Greenwich clock and shift the stored value by the device offset on save.
    setEditStart(toMskInputValue(season.starts_at));
    setEditEnd(toMskInputValue(season.ends_at));
  };

  const saveDates = async (seasonId: number) => {
    const targetSeason = seasons.find((entry) => entry.season.id === seasonId)?.season;
    const activeEndOnly = targetSeason?.status === "active";
    const editStartMs = mskInputToMs(editStart);
    const editEndMs = mskInputToMs(editEnd);
    if (!editStartMs || !editEndMs) { setError("Both dates are required.", "settings"); return; }
    if (editStartMs >= editEndMs) { setError("End must be after start.", "settings"); return; }
    setSubmittingKey(`${seasonId}:edit-dates`);
    setLocalError("");
    setErrorScope(null);
    try {
      const res = await fetchWithAuth<{ ok: boolean; error?: string }>(`/admin/seasons/${seasonId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(activeEndOnly ? {} : { startsAt: new Date(editStartMs).toISOString() }),
          endsAt: new Date(editEndMs).toISOString(),
        }),
      });
      if (res?.ok) {
        setEditingDatesId(null);
        setSuccess("Season dates updated.");
        await loadSeasons();
      } else {
        setError(formatSeasonError(res?.error), "settings");
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Failed to update dates.", "settings");
    } finally {
      setSubmittingKey("");
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {(localError || localSuccess) && (
        <div className="space-y-2">
          {localError && (
            <div className="rounded-2xl border border-[color-mix(in_srgb,#ff5a52_40%,transparent)] bg-[color-mix(in_srgb,#ff5a52_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,#fff))]">
              {localError}
            </div>
          )}
          {localSuccess && (
            <div className="whitespace-pre-wrap break-all rounded-2xl border border-[color-mix(in_srgb,#34c759_36%,transparent)] bg-[color-mix(in_srgb,#34c759_12%,transparent)] px-3 py-3 text-[13px] font-semibold leading-snug text-[color-mix(in_srgb,#34c759_88%,var(--tg-theme-text-color,#fff))]">
              {localSuccess}
            </div>
          )}
        </div>
      )}

      <AdminCard className="p-0 overflow-hidden shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
        <div className="p-5 border-b border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))] flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1 h-4 bg-indigo-500 rounded-full" />
              <h2 className="text-[17px] font-bold tracking-tight text-[var(--tg-theme-text-color,#fff)]">Season Lifecycle</h2>
            </div>
            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">
              Upcoming seasons can be edited freely. Active seasons can only extend their end date.
            </div>
          </div>
          <AdminButton
            variant="secondary"
            size="sm"
            disabled={loading || !!submittingKey}
            onClick={loadSeasons}
            className="shrink-0"
          >
            Refresh
          </AdminButton>
        </div>
      </AdminCard>

      <AdminCollapsibleSection
        key={`current-${errorScope === "load" ? "error" : "normal"}`}
        title="Текущий сезон"
        description={displaySeason?.current ? `${displaySeason.current.name} · ${displaySeason.current.status}` : "No public season"}
        defaultOpen
        forceOpen={errorScope === "load"}
        storageKey="admin:season:current"
      >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <AdminMetricCard
              label="Displayed Season"
              value={displaySeason?.current?.name || "No public season"}
              badge={displaySeason?.current
                ? <AdminBadge variant={statusVariant(displaySeason.current.status)} size="sm">{displaySeason.current.status}</AdminBadge>
                : <AdminBadge variant="neutral" size="sm">none</AdminBadge>}
            />
            <AdminMetricCard
              label="Predictions"
              value={displaySeason?.predictionsOpen ? "Open" : "Closed"}
              description={displaySeason?.predictionsOpen ? "Users can submit picks." : "No active season is accepting picks."}
            />
            <AdminMetricCard
              label="Upcoming Queue"
              value={upcomingCount}
              description={displaySeason?.nextUpcoming ? `Next: ${displaySeason.nextUpcoming.name}` : "No upcoming season prepared yet."}
            />
          </div>
      </AdminCollapsibleSection>

      <AdminCollapsibleSection
        key={`settings-${errorScope === "settings" ? "error" : "normal"}`}
        title="Настройки сезона"
        description={newName || displaySeason?.nextUpcoming?.name || "Создание upcoming season вручную"}
        defaultOpen={false}
        forceOpen={errorScope === "settings"}
        keepMounted
        storageKey="admin:season:settings"
      >
          <div className="rounded-2xl border border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] bg-[var(--tg-theme-bg-color,rgba(255,255,255,0.03))] p-4 space-y-3">
            <div>
              <div className="text-[15px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Create Upcoming Season</div>
              <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)] mt-1">
                Create the next season ahead of time. It stays inactive until you activate it manually.
              </div>
            </div>
            <AdminInput
              label="Название сезона"
              placeholder="Season name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <AdminInput
                label="Начало (МСК)"
                type="datetime-local"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                className={datePickerClass}
              />
              <AdminInput
                label="Конец (МСК)"
                type="datetime-local"
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
                className={datePickerClass}
              />
            </div>
            <AdminInput
              label="Заметки (необязательно)"
              placeholder="Notes (optional)"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
            <AdminButton
              onClick={createSeason}
              loading={submittingKey === "create"}
              fullWidth
            >
              Create Upcoming Season
            </AdminButton>
          </div>
      </AdminCollapsibleSection>

      <AdminCollapsibleSection
        title="История сезонов"
        description={`${seasons.length} сезонов · ${upcomingCount} upcoming`}
        defaultOpen
        keepMounted
        storageKey="admin:season:history"
      >
      {loading ? (
        <AdminCard className="text-center text-[var(--tg-theme-hint-color,#999)] py-12 animate-pulse shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]">
          Loading seasons...
        </AdminCard>
      ) : (
        <div className="space-y-3">
          {seasons.map((detail) => {
            const season = detail.season;
            const expanded = expandedId === season.id;
            const busy = (action: string) => submittingKey === `${season.id}:${action}`;
            const canEditDates = season.status === "upcoming" || season.status === "active";
            const activeEndOnly = season.status === "active";
            return (
              <AdminCard
                key={season.id}
                className="p-0 overflow-hidden shadow-xl shadow-black/20 border-[var(--tg-theme-hint-color,rgba(255,255,255,0.05))]"
              >
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[16px] font-bold text-[var(--tg-theme-text-color,#fff)]">{season.name}</div>
                        <AdminBadge variant={statusVariant(season.status)} size="sm">{season.status}</AdminBadge>
                        {displaySeason?.current?.id === season.id && (
                          <AdminBadge variant="info" size="sm">displayed</AdminBadge>
                        )}
                      </div>
                      {editingDatesId === season.id ? (
                        <div className="mt-2 space-y-2">
                          {activeEndOnly ? (
                            <AdminDataRow label="Start (locked)" value={fmtDate(season.starts_at)} />
                          ) : (
                            <AdminInput
                              label="Start (МСК)"
                              type="datetime-local"
                              value={editStart}
                              onChange={e => setEditStart(e.target.value)}
                              className={datePickerClass}
                            />
                          )}
                          <AdminInput
                            label="End (МСК)"
                            type="datetime-local"
                            value={editEnd}
                            onChange={e => setEditEnd(e.target.value)}
                            className={datePickerClass}
                          />
                          {activeEndOnly && (
                            <div className="text-[11px] text-[var(--tg-theme-hint-color,#999)]">
                              Active season start is locked. You can only extend the end date here.
                            </div>
                          )}
                          <div className="flex gap-2">
                            <AdminButton size="sm" variant="primary" loading={submittingKey === `${season.id}:edit-dates`}
                              onClick={() => saveDates(season.id)}>
                              Save
                            </AdminButton>
                            <AdminButton size="sm" variant="ghost" onClick={() => setEditingDatesId(null)}>
                              Cancel
                            </AdminButton>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-[var(--tg-theme-hint-color,#999)]">
                          <span>{fmtDate(season.starts_at)} → {fmtDate(season.ends_at)}</span>
                          {canEditDates && (
                            <AdminButton variant="ghost" size="sm" onClick={() => startEditingDates(season)}>
                              {activeEndOnly ? "Extend end" : "Edit"}
                            </AdminButton>
                          )}
                        </div>
                      )}
                    </div>
                    <AdminButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expanded ? null : season.id)}
                      className="shrink-0"
                    >
                      {expanded ? "Hide" : "Details"}
                    </AdminButton>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                    <AdminMetricCard size="sm" label="Matches" value={`${detail.matches.finished}/${detail.matches.total}`} />
                    <AdminMetricCard size="sm" label="Snapshot" value={detail.snapshot.hasSnapshot ? "Yes" : "No"} />
                    <AdminMetricCard size="sm" label="Finalize" value={detail.matches.readyToFinalize ? "Ready" : "Blocked"} />
                    <AdminMetricCard size="sm" label="Finalized" value={season.finalized_at ? fmtDate(season.finalized_at) : "—"} />
                  </div>

                  {expanded && (
                    <div className="mt-4 space-y-4 border-t border-[var(--tg-theme-hint-color,rgba(255,255,255,0.06))] pt-4">
                      <div className="space-y-2">
                        <div className="text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Season State</div>
                        <AdminDataRow label="Finalize state" value={formatFinalizeReason(detail.matches.reason)} />
                        {detail.activation?.reason && season.status === "upcoming" && (
                          <AdminDataRow label="Activation gate" value={formatSeasonError(detail.activation.reason)} />
                        )}
                        {season.notes && (
                          <AdminDataRow label="Notes" value={season.notes} />
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Snapshot Totals</div>
                          <AdminDataRow label="Global rows" value={detail.snapshot.globalRows} />
                          <AdminDataRow label="League rows" value={detail.snapshot.leagueRows} />
                          <AdminDataRow label="Awards" value={detail.snapshot.awards} />
                          <AdminDataRow label="Missing results" value={detail.matches.missingResults} />
                        </div>

                        <div className="space-y-2">
                          <div className="text-[13px] font-extrabold text-[var(--tg-theme-text-color,#fff)]">Top Global Snapshot</div>
                          {detail.topGlobal.length > 0 ? (
                            detail.topGlobal.map((entry) => (
                              <AdminDataRow
                                key={`${season.id}:${entry.user_id}`}
                                label={`#${entry.final_rank} ${entry.username || entry.first_name || `User ${entry.user_id}`}`}
                                value={entry.final_points}
                              />
                            ))
                          ) : (
                            <div className="text-[12px] text-[var(--tg-theme-hint-color,#999)]">No final snapshot yet.</div>
                          )}
                        </div>
                      </div>

                      <AdminCollapsibleSection
                        title="Пересчёты и обслуживание"
                        description="Пересчёт, восстановление и служебная диагностика"
                        badge={<AdminBadge variant="warning" size="sm">служебное</AdminBadge>}
                        defaultOpen={false}
                        forceOpen={errorScope === "recalc"}
                        keepMounted
                        storageKey="admin:season:recalc"
                      >
                      <div className="flex flex-col gap-2">
                        <AdminButton
                          variant="secondary"
                          loading={busy("recalculate-status")}
                          onClick={() => runSeasonAction(season.id, "recalculate-status", { successText: "Season status refreshed." })}
                          fullWidth
                        >
                          Recalculate Season Status
                        </AdminButton>

                        {detail.permissions.canRefinalize && (
                          <>
                            <AdminButton
                              variant="warning"
                              loading={busy("refinalize")}
                              onClick={() => runSeasonAction(season.id, "refinalize", {
                                confirmText: `Recalculate final snapshot for ${season.name}? This will re-run standings, awards, and season achievements.`,
                                successText: "Season final snapshot recalculated + achievements awarded.",
                                body: { force: true },
                              })}
                              fullWidth
                            >
                              Recalculate Final Snapshot
                            </AdminButton>
                            <AdminButton
                              variant="warning"
                              onClick={async () => {
                                try {
                                  const res = await fetchWithAuth<DebugAchievementsResponse>(`/admin/seasons/${season.id}/debug-achievements`);
                                  setSuccess(JSON.stringify(res, null, 2));
                                } catch (e: unknown) {
                                  setError(e instanceof Error ? e.message : "Debug failed", "recalc");
                                }
                              }}
                              fullWidth
                            >
                              Debug Achievements
                            </AdminButton>
                          </>
                        )}
                      </div>
                      </AdminCollapsibleSection>

                      <AdminCollapsibleSection
                        title="Завершение и ротация сезона"
                        description="Необратимые операции жизненного цикла сезона"
                        badge={<AdminBadge variant="danger" size="sm">опасно</AdminBadge>}
                        defaultOpen={false}
                        forceOpen={errorScope === "rotation"}
                        keepMounted
                        storageKey="admin:season:rotation"
                      >
                      <div className="flex flex-col gap-2">
                        {detail.permissions.canFinalize && (
                          <AdminButton
                            variant="warning"
                            loading={busy("finalize")}
                            onClick={() => runSeasonAction(season.id, "finalize", {
                              confirmText: `Finalize ${season.name}? This will freeze final standings, awards, and snapshots for the season.`,
                              successText: "Season finalized.",
                            })}
                            fullWidth
                          >
                            {season.status === "finalizing" ? "Retry Finalization" : "Finalize Season"}
                          </AdminButton>
                        )}

                        {!detail.permissions.canFinalize && (season.status === "active" || season.status === "finalizing") && (
                          <AdminButton
                            variant="danger"
                            loading={busy("finalize")}
                            onClick={() => runSeasonAction(season.id, "finalize", {
                              confirmText: `FORCE finalize ${season.name}? There are ${detail.matches.total - detail.matches.finished} unfinished matches. This will freeze standings as-is, ignoring missing results.`,
                              successText: "Season force-finalized.",
                              body: { force: true },
                            })}
                            fullWidth
                          >
                            {`Force Finalize (${detail.matches.total - detail.matches.finished} unfinished)`}
                          </AdminButton>
                        )}

                        {season.status === "upcoming" && (
                          <AdminButton
                            variant="primary"
                            disabled={!detail.permissions.canActivate}
                            loading={busy("activate")}
                            onClick={() => runSeasonAction(season.id, "activate", {
                              confirmText: `Activate ${season.name}? This will open predictions for the new season and keep the finished season in history.`,
                              successText: "Season activated.",
                            })}
                            fullWidth
                          >
                            Activate Season
                          </AdminButton>
                        )}

                        {detail.permissions.canArchive && (
                          <AdminButton
                            variant="danger"
                            loading={busy("archive")}
                            onClick={() => runSeasonAction(season.id, "archive", {
                              confirmText: `Archive ${season.name}? It will remain in history but stop being used as the default display season.`,
                              successText: "Season archived.",
                            })}
                            fullWidth
                          >
                            Archive Season
                          </AdminButton>
                        )}
                      </div>
                      </AdminCollapsibleSection>
                    </div>
                  )}
                </div>
              </AdminCard>
            );
          })}

          {seasons.length === 0 && (
            <AdminCard className="text-center text-[var(--tg-theme-hint-color,#999)] py-12 border-dashed">
              No seasons found.
            </AdminCard>
          )}
        </div>
      )}
      </AdminCollapsibleSection>
    </div>
  );
}
