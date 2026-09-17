"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import type {
  MyScoreResponse,
  SeasonPredictionAwardsJson,
  SeasonPredictionEntry,
  SeasonPredictionTeam,
  SeasonPredictionTournamentResponse,
  SeasonPredictionTableJson,
  TopLeagueCode,
} from "../types";
import { TOP_LEAGUE_ACCENTS, TOP_LEAGUE_COUNTRIES } from "../constants";
import { deadlineLine } from "../deadline";
import { LeagueTableOrderEditor, getTeamRef } from "./LeagueTableOrderEditor";
import { IndividualAwardsSelector } from "./IndividualAwardsSelector";
import { IndividualAwardsResults } from "./IndividualAwardsResults";
import { SaveSubmitBar } from "./SaveSubmitBar";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { LeagueZoneBadge } from "./LeagueZoneBadge";
import { LeagueTableCompactView } from "./LeagueTableCompactView";
import { TopLeagueSwitch } from "./TopLeagueSwitch";
import { TopLeagueHubCards } from "./TopLeagueHubCards";

// ─── helpers ──────────────────────────────────────────────────────────────────

function getErrorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}


function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function extractOrderedIds(table: unknown): string[] {
  if (Array.isArray(table)) return table.map(String);
  if (!isRecord(table)) return [];
  const direct = table.ordered_team_ids || table.teams || table.order;
  if (Array.isArray(direct)) {
    return direct.map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (isRecord(item)) return String(item.team_ref || item.team_id || item.teamId || item.id || "");
      return "";
    }).filter(Boolean);
  }
  if (Array.isArray(table.ordered_teams)) {
    return table.ordered_teams.map((item) => {
      if (!isRecord(item)) return "";
      return String(item.team_ref || item.team_id || item.teamId || item.id || "");
    }).filter(Boolean);
  }
  return [];
}

function normalizeAwards(awards: unknown): SeasonPredictionAwardsJson {
  if (!isRecord(awards)) return {};
  return awards as SeasonPredictionAwardsJson;
}

function compareTeamName(a: SeasonPredictionTeam, b: SeasonPredictionTeam) {
  const aName = a.team_name || a.short_name || a.team_id || a.id || "";
  const bName = b.team_name || b.short_name || b.team_id || b.id || "";
  return String(aName).localeCompare(String(bName), ["ru", "en"], { sensitivity: "base", numeric: true });
}

function alphabeticalTeams(teams: SeasonPredictionTeam[]) {
  return [...teams].sort((a, b) => compareTeamName(a, b) || String(getTeamRef(a)).localeCompare(String(getTeamRef(b))));
}

function buildInitialOrder(teams: SeasonPredictionTeam[], entry: SeasonPredictionEntry | null) {
  const warnings: string[] = [];
  const byRef = new Map(teams.map((t) => [getTeamRef(t), t]));
  const ids = extractOrderedIds(entry?.table || null);
  const used = new Set<string>();
  const ordered: SeasonPredictionTeam[] = [];

  for (const id of ids) {
    const team = byRef.get(id);
    if (!team || used.has(id)) continue;
    used.add(id);
    ordered.push(team);
  }
  const missing = alphabeticalTeams(teams.filter((t) => !used.has(getTeamRef(t))));
  if (ids.length > 0 && missing.length > 0) {
    warnings.push(`В сохранённом прогнозе не хватало команд: ${missing.length}. Они добавлены в конец таблицы.`);
  }
  const staleCount = ids.filter((id) => !byRef.has(id)).length;
  if (staleCount > 0) {
    warnings.push(`В старом прогнозе были команды, которых больше нет в турнире: ${staleCount}. Они скрыты.`);
  }
  return {
    order: ids.length > 0 ? [...ordered, ...missing] : alphabeticalTeams(teams),
    // Distinguishes "the user has a stored table" from "we are showing the alphabetical
    // default"; the latter must never be persisted as a prediction.
    hasStoredTable: ids.length > 0,
    warnings,
  };
}

function buildTableJson(teams: SeasonPredictionTeam[]): SeasonPredictionTableJson {
  return {
    ordered_team_ids: teams.map(getTeamRef),
    ordered_teams: teams.map((t, i) => ({ team_ref: getTeamRef(t), team_name: t.team_name, position: i + 1 })),
    updated_at: new Date().toISOString(),
  };
}

function stableTableSig(teams: SeasonPredictionTeam[]) {
  return teams.map(getTeamRef).join("|");
}
function stableAwardsSig(awards: SeasonPredictionAwardsJson) {
  return JSON.stringify({
    top_scorer: awards.top_scorer?.player_id || awards.top_scorer?.award_option_id || null,
    top_assister: awards.top_assister?.player_id || awards.top_assister?.award_option_id || awards.top_assistant?.player_id || awards.top_assistant?.award_option_id || null,
    golden_glove: awards.golden_glove?.player_id || awards.golden_glove?.award_option_id || null,
  });
}

// Zone helpers
const ZONE_LABEL_FULL: Record<string, string> = {
  champion: "Чемпион",
  champions_league: "Лига чемпионов",
  europa_league: "Лига Европы",
  conference_league: "Лига конференций",
  relegation: "Вылет",
  playoff_relegation: "Стыки",
  playoff: "Стыки",
};
const ZONE_LABEL_SHORT: Record<string, string> = {
  champion: "чемп.",
  champions_league: "ЛЧ",
  europa_league: "ЛЕ",
  conference_league: "ЛК",
  relegation: "вылет",
  playoff_relegation: "стыки",
  playoff: "стыки",
};
const ZONE_DISPLAY_ORDER = [
  "champion", "champions_league", "europa_league",
  "conference_league", "playoff_relegation", "playoff", "relegation",
];

function zoneValueStr(value: unknown): string {
  if (Array.isArray(value) && value.length >= 2) {
    return value[0] === value[1] ? `${value[0]} место` : `${value[0]}–${value[1]} места`;
  }
  return value === null ? "нет" : String(value ?? "—");
}

function buildZoneSummary(zones: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ZONE_DISPLAY_ORDER) {
    const v = zones[key];
    if (!Array.isArray(v) || v.length < 2) continue;
    const from = Number(v[0]);
    const to = Number(v[1]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const label = ZONE_LABEL_SHORT[key] || key;
    parts.push(from === to ? `${from} ${label}` : `${from}–${to} ${label}`);
  }
  return parts.join(" · ");
}

// ─── component ────────────────────────────────────────────────────────────────

export function LeaguePredictionEditor({
  data,
  availableCodes,
  onSwitch,
  onBack,
  onEntryChange,
}: {
  data: SeasonPredictionTournamentResponse;
  availableCodes?: TopLeagueCode[];
  onSwitch?: (code: TopLeagueCode) => void;
  onBack?: () => void;
  onEntryChange: (entry: SeasonPredictionEntry) => void;
}) {
  const { season, tournament, teams, award_options: awardOptions, entry } = data;
  const initial = useMemo(() => buildInitialOrder(teams, entry), [teams, entry]);
  const [orderedTeams, setOrderedTeams] = useState<SeasonPredictionTeam[]>(initial.order);
  const [awards, setAwards] = useState<SeasonPredictionAwardsJson>(() => normalizeAwards(entry?.awards));
  // Table and awards track their own saved signature: each side is saved/confirmed
  // separately, so a pending edit on one must never mark the other as dirty.
  const [savedTableSig, setSavedTableSig] = useState(() => stableTableSig(initial.order));
  const [savedAwardsSig, setSavedAwardsSig] = useState(() => stableAwardsSig(normalizeAwards(entry?.awards)));
  // The editor always shows a full list (alphabetical when nothing is stored), so the
  // rendered order alone says nothing about the user's intent. Only a stored table or a
  // deliberate edit counts as a real table prediction — anything else is never sent.
  const [tableTouched, setTableTouched] = useState(() => initial.hasStoredTable);
  const [warnings, setWarnings] = useState<string[]>(initial.warnings);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [myScore, setMyScore] = useState<MyScoreResponse | null>(null);

  useEffect(() => {
    setOrderedTeams(initial.order);
    setWarnings(initial.warnings);
    setTableTouched(initial.hasStoredTable);
    const nextAwards = normalizeAwards(entry?.awards);
    setAwards(nextAwards);
    setSavedTableSig(stableTableSig(initial.order));
    setSavedAwardsSig(stableAwardsSig(nextAwards));
  }, [initial, entry]);

  // Load the user's score once per league so the hero chip and the breakdown
  // share one request (scores only change via admin recalc, not user edits).
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiFetch<MyScoreResponse>(`/season-predictions/top-leagues/${tournament.tournament_code}/my-score`);
        if (active) setMyScore(res);
      } catch {
        if (active) setMyScore(null);
      }
    };
    void load();
    return () => { active = false; };
  }, [tournament.tournament_code]);

  const hasScore = !!myScore?.has_score;
  const officialStatus = myScore?.official_results_status ?? null;
  // Final/read-only once official results are confirmed/published OR a score exists.
  const isResultsLocked = hasScore || officialStatus === "confirmed" || officialStatus === "published";

  const deadline = tournament.deadline_at || season.deadline_at || null;
  const deadlinePassed = !!deadline && Math.floor(Date.now() / 1000) >= deadline;
  const entryStatus = entry?.status || null;
  const lockedByStatus =
    ["locked", "scoring", "completed"].includes(entryStatus || "") ||
    ["locked", "scoring", "completed", "archived"].includes(tournament.status);
  const canEdit = !deadlinePassed && !lockedByStatus;
  // The single gate for all editing UI: blocked by deadline/status OR by final results.
  const editable = canEdit && !isResultsLocked;

  // Individual awards have their OWN window, independent from the table. Prefer the
  // server-computed lock state; fall back to the table gate for older responses.
  const locks = data.locks;
  const awardsWindowStatus = locks?.awards_status ?? (canEdit ? "open" : "closed");
  const awardsOpenPending = awardsWindowStatus === "not_open"; // teaser: «Скоро»
  const awardsEditable = (locks ? !locks.awards_locked : canEdit) && !isResultsLocked;
  // Whole tournament teased as «Скоро» — visible but not enterable.
  const tournamentSoon = tournament.status === "soon";
  const hasFullTable = orderedTeams.length === teams.length && teams.length === tournament.team_count;
  const isSubmitted = entryStatus === "submitted";
  // Awards carry their own confirmation status server-side.
  const isAwardsSubmitted = (entry?.awards_status || "draft") === "submitted";
  const awardsFilled = [awards.top_scorer, awards.top_assister ?? awards.top_assistant, awards.golden_glove]
    .filter((item) => item?.player_name || item?.player_id || item?.award_option_id).length;
  const tableDirty = stableTableSig(orderedTeams) !== savedTableSig && tableTouched;
  const awardsDirty = stableAwardsSig(awards) !== savedAwardsSig;

  // hub = league overview + two panels; table/awards = detail views.
  const [view, setView] = useState<"hub" | "table" | "awards">("hub");

  // Notices/errors belong to the screen that produced them: table and awards are saved
  // separately, so an awards confirmation must not greet the user on the table screen.
  function openView(next: "hub" | "table" | "awards") {
    setView(next);
    setNotice("");
    setError("");
  }

  // Compact one-line table for screenshots. Available once the prediction is
  // submitted or locked; default ON there so the whole table fits one screen.
  const compactAvailable = (isSubmitted || isResultsLocked) && teams.length > 0;
  const [tableModeOverride, setTableModeOverride] = useState<"compact" | "detail" | null>(null);
  const compactActive = compactAvailable && (tableModeOverride ? tableModeOverride === "compact" : true);

  // Single coherent league status (no DRAFT-vs-confirmed conflict).
  const heroStatusDone = hasScore || isResultsLocked || isSubmitted;
  const heroStatusLabel = hasScore
    ? "Очки рассчитаны"
    : (officialStatus === "confirmed" || officialStatus === "published")
      ? "Итоги подтверждены"
      : isSubmitted
        ? "Подтверждено"
        : entryStatus === "draft"
          ? "Черновик"
          : "Не начато";
  const awardsStatusDone = !awardsOpenPending && (isAwardsSubmitted || hasScore);
  const awardsStatusLabel = awardsOpenPending
    ? "Скоро"
    : (isAwardsSubmitted || hasScore)
    ? "Подтверждено"
    : awardsFilled === 3
      ? "Выбрано"
      : awardsFilled > 0
        ? "Частично"
        : "Не выбрано";
  const scoreChip = hasScore && myScore?.score
    ? { total: myScore.score.total_points, max: myScore.score.max_possible_points, pct: myScore.score.points_pct }
    : null;
  // Awards results live in the "Награды" view (not in the league-table breakdown).
  const awardsResults = (hasScore && myScore?.score?.breakdown_json?.awards) || [];

  // Deadline lines for the hero: table deadline always; awards line only when
  // its independent window differs from the table one. Hidden once results land.
  const tableDeadlineInfo = isResultsLocked ? null : deadlineLine(deadline);
  const awardsDeadlineRaw = tournament.awards_deadline_at ?? null;
  const awardsDeadlineInfo = isResultsLocked || !awardsDeadlineRaw || awardsDeadlineRaw === deadline
    ? null
    : deadlineLine(awardsDeadlineRaw, "Награды: дедлайн");

  const accent = TOP_LEAGUE_ACCENTS[tournament.tournament_code];
  const tone = accent?.tone || "var(--tg-button)";
  const zones = tournament.rules?.zones || {};
  const zoneSummary = buildZoneSummary(zones);
  const zoneKeys = ZONE_DISPLAY_ORDER.filter((k) => {
    const v = zones[k];
    return Array.isArray(v) && v.length >= 2;
  });

  function changeOrder(next: SeasonPredictionTeam[]) {
    setOrderedTeams(next);
    // A deliberate reorder turns the shown default into a real table prediction.
    setTableTouched(true);
  }

  function resetOrder() {
    if (!editable) return;
    setOrderedTeams(alphabeticalTeams(teams));
    setTableTouched(true);
    setNotice("");
    setError("");
  }

  // Table and awards are saved through separate requests carrying ONLY their own side —
  // the omitted side is left untouched server-side. That is what keeps the awards screen
  // from silently persisting the alphabetical default table as a prediction.
  async function saveTableDraft() {
    if (!editable || !hasFullTable) return null;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ table_json: buildTableJson(orderedTeams) }) },
      );
      onEntryChange(res.entry);
      setSavedTableSig(stableTableSig(orderedTeams));
      setTableTouched(true);
      setNotice(isSubmitted ? "Изменения сохранены. До дедлайна таблицу можно подтвердить заново." : "Черновик таблицы сохранён.");
      return res.entry;
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось сохранить черновик"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitTable() {
    if (!editable || !hasFullTable) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ table_json: buildTableJson(orderedTeams) }) },
      );
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/submit`,
        { method: "POST", body: JSON.stringify({}) },
      );
      onEntryChange(res.entry);
      setSavedTableSig(stableTableSig(orderedTeams));
      setTableTouched(true);
      setNotice("Таблица подтверждена. До дедлайна её можно изменить и подтвердить заново.");
      // Back to the screenshot-friendly compact table after confirming.
      setTableModeOverride(null);
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось подтвердить прогноз"));
    } finally {
      setSaving(false);
    }
  }

  async function saveAwardsDraft() {
    if (!awardsEditable) return null;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ awards_json: awards }) },
      );
      onEntryChange(res.entry);
      setSavedAwardsSig(stableAwardsSig(awards));
      setNotice(isAwardsSubmitted ? "Изменения сохранены. До дедлайна награды можно подтвердить заново." : "Черновик наград сохранён.");
      return res.entry;
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось сохранить черновик"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitAwards() {
    if (!awardsEditable || awardsFilled === 0) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ awards_json: awards }) },
      );
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/top-leagues/${tournament.tournament_code}/awards/submit`,
        { method: "POST", body: JSON.stringify({}) },
      );
      onEntryChange(res.entry);
      setSavedAwardsSig(stableAwardsSig(awards));
      setNotice("Награды подтверждены. До дедлайна их можно изменить и подтвердить заново.");
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось подтвердить награды"));
    } finally {
      setSaving(false);
    }
  }

  const zonesDetails = zoneKeys.length > 0 ? (
    <details style={detailsStyle}>
      <summary style={detailsSummaryStyle}>
        <span style={{ color: "var(--tg-text)", fontWeight: 800 }}>Зоны турнира</span>
        {zoneSummary && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--tg-hint)", fontWeight: 650 }}>{zoneSummary}</span>
        )}
      </summary>
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
        {zoneKeys.map((key, i) => (
          <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderTop: i > 0 ? "1px solid rgba(128,128,128,0.08)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <LeagueZoneBadge zone={key} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--tg-text)" }}>{ZONE_LABEL_FULL[key] || key}</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 650, color: "var(--tg-hint)", whiteSpace: "nowrap" }}>{zoneValueStr(zones[key])}</span>
          </div>
        ))}
      </div>
    </details>
  ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Back to leagues list — only in drill-in mode; inline hub hides it. */}
      {onBack && (
        <Pressable onClick={onBack} haptic="light" style={backBtnStyle} aria-label="Назад к списку лиг">
          ← Назад
        </Pressable>
      )}

      {/* League selector — only on the hub. */}
      {view === "hub" && onSwitch && availableCodes && availableCodes.length > 1 && (
        <TopLeagueSwitch
          codes={availableCodes}
          activeCode={tournament.tournament_code as TopLeagueCode}
          onSelect={(c) => { if (c !== tournament.tournament_code) onSwitch(c); }}
        />
      )}

      {tournamentSoon ? (
        <section style={{ borderRadius: 16, overflow: "hidden", background: CARD_SURFACE, boxShadow: CARD_SHADOW }}>
          <div style={{ height: 3, background: tone, boxShadow: `0 0 12px ${tone}` }} />
          <div style={{ padding: "18px 16px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 19, fontWeight: 950, color: "var(--tg-text)", letterSpacing: "-0.02em" }}>{tournament.title}</div>
            <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", height: 24, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 900, color: tone, background: `color-mix(in srgb, ${tone} 14%, var(--tg-bg))`, border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)` }}>
              Скоро
            </div>
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.5 }}>
              Прогнозы этого турнира ещё не открыты — загляни позже.
            </div>
          </div>
        </section>
      ) : view === "hub" ? (
        <>
          {/* Compact league hero header */}
          <section style={{ borderRadius: 16, overflow: "hidden", background: CARD_SURFACE, boxShadow: CARD_SHADOW }}>
            <div style={{ height: 3, background: tone, boxShadow: `0 0 12px ${tone}` }} />
            <div style={{ padding: "11px 14px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 950, letterSpacing: "-0.03em", lineHeight: 1.1, color: "var(--tg-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tournament.title}
                </h1>
                <HeroStatusPill label={heroStatusLabel} done={heroStatusDone} />
              </div>
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))", letterSpacing: "0.01em" }}>
                {[
                  TOP_LEAGUE_COUNTRIES[tournament.tournament_code] || tournament.country,
                  `${tournament.team_count} команд`,
                  scoreChip ? `${scoreChip.total}/${scoreChip.max} · ${Math.round((scoreChip.pct || 0) * 100)}%` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {tableDeadlineInfo && (
                <div style={deadlineLineStyle(tableDeadlineInfo.urgent)}>{tableDeadlineInfo.text}</div>
              )}
              {awardsDeadlineInfo && (
                <div style={deadlineLineStyle(awardsDeadlineInfo.urgent)}>{awardsDeadlineInfo.text}</div>
              )}
            </div>
          </section>

          {/* Two panels: League table / Individual awards */}
          <TopLeagueHubCards
            tone={tone}
            table={{ statusLabel: heroStatusLabel, statusDone: heroStatusDone, count: orderedTeams.length, limit: tournament.team_count, score: scoreChip }}
            awards={{ statusLabel: awardsStatusLabel, statusDone: awardsStatusDone, filled: awardsFilled, total: 3 }}
            onOpen={openView}
          />
        </>
      ) : (
        <>
          {/* Compact detail header with back-to-hub. */}
          <div style={detailHeaderRowStyle}>
            <Pressable onClick={() => openView("hub")} haptic="light" pressedScale={0.98} style={backBtnStyle} aria-label="К лиге">
              ← К лиге
            </Pressable>
            <span style={detailHeaderTitleStyle}>{view === "table" ? "Таблица лиги" : "Индивидуальные награды"}</span>
          </div>

          {notice && <div style={successStyle}>{notice}</div>}
          {error && <div style={errorStyle}>{error}</div>}

          {view === "table" && compactAvailable && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>
                {compactActive ? "Компактный вид — вся таблица в один скрин" : "Редактирование таблицы"}
              </span>
              {compactActive ? (
                editable && (
                  <Pressable
                    onClick={() => setTableModeOverride("detail")}
                    haptic="light"
                    style={viewToggleStyle}
                    aria-label="Редактировать таблицу"
                  >
                    Редактировать
                  </Pressable>
                )
              ) : (
                <Pressable
                  onClick={() => setTableModeOverride(null)}
                  haptic="light"
                  style={viewToggleStyle}
                  aria-label="Вернуться к компактному виду"
                >
                  Компактно
                </Pressable>
              )}
            </div>
          )}

          {view === "table" && compactActive && (
            <>
              <LeagueTableCompactView
                title={tournament.title}
                subtitle={[
                  "Мой прогноз",
                  scoreChip ? `${scoreChip.total}/${scoreChip.max} очков` : null,
                ].filter(Boolean).join(" · ")}
                teams={orderedTeams}
                zones={zones}
                tone={tone}
              />
              {/* Once results are locked there is no detail view anymore — keep
                  the score breakdown reachable below the compact table. */}
              {hasScore && (
                <ScoreBreakdown code={tournament.tournament_code as TopLeagueCode} teams={teams} preloaded={myScore} />
              )}
            </>
          )}

          {view === "table" && !compactActive && (
            <>
              {deadlinePassed && !isResultsLocked && <div style={warningStyle}>Дедлайн прошёл · прогноз заблокирован</div>}
              {warnings.map((w) => <div key={w} style={warningStyle}>{w}</div>)}
              {isResultsLocked && (
                <div style={readOnlyNoticeStyle}>
                  {hasScore
                    ? "Прогноз завершён. Изменения недоступны после расчёта очков."
                    : "Итоги опубликованы. Очки появятся после пересчёта, прогноз закрыт для изменений."}
                </div>
              )}

              {/* Score breakdown FIRST when score exists — no scrolling past the table. */}
              {hasScore && (
                <ScoreBreakdown code={tournament.tournament_code as TopLeagueCode} teams={teams} preloaded={myScore} />
              )}

              {zonesDetails}

              {teams.length === 0 ? (
                <section style={cardStyle}>
                  <div style={sectionHeaderStyle}><h2 style={sectionTitleStyle}>Таблица лиги</h2></div>
                  <div style={emptyStyle}>Команды пока не заведены. Редактор откроется, когда появится состав турнира.</div>
                </section>
              ) : (
                <LeagueTableOrderEditor
                  teams={orderedTeams}
                  zones={zones}
                  readOnly={!editable}
                  onChange={changeOrder}
                  onReset={editable ? resetOrder : undefined}
                  canReset={editable}
                />
              )}

              {/* После дедлайна сервер сам подтверждает последний сохранённый черновик
                  (см. runSeasonPredictionAutoSubmit), поэтому предупреждаем заранее —
                  иначе автоподтверждение выглядит как неожиданность. */}
              {canEdit && !isResultsLocked && !isSubmitted && (
                <div style={readOnlyNoticeStyle}>
                  Если не успеешь подтвердить, после дедлайна засчитается последний сохранённый черновик.
                </div>
              )}

              {!isResultsLocked && (
                <SaveSubmitBar
                  canEdit={canEdit}
                  canSubmit={hasFullTable}
                  isSubmitted={isSubmitted}
                  saving={saving}
                  dirty={tableDirty}
                  onSave={saveTableDraft}
                  onSubmit={submitTable}
                  saveLabel="Сохранить таблицу"
                  submitLabel={isSubmitted ? "Подтвердить таблицу заново" : "Подтвердить таблицу"}
                />
              )}
            </>
          )}

          {view === "awards" && (
            awardsResults.length > 0 ? (
              <IndividualAwardsResults awards={awardsResults} awardsCorrect={myScore?.score?.awards_correct ?? 0} />
            ) : awardsOpenPending ? (
              <div style={{ ...readOnlyNoticeStyle, textAlign: "center", fontWeight: 900 }}>Скоро</div>
            ) : (
              <>
                {awardsEditable && deadlinePassed && (
                  <div style={successStyle}>Таблица уже закрыта, но награды ещё можно менять.</div>
                )}
                {!awardsEditable && !isResultsLocked && (
                  <div style={warningStyle}>Приём индивидуальных наград закрыт.</div>
                )}
                <IndividualAwardsSelector
                  tournamentCode={tournament.tournament_code as TopLeagueCode}
                  catalogVersion={data.players_catalog?.version ?? null}
                  teams={teams}
                  options={awardOptions}
                  value={awards}
                  readOnly={!awardsEditable}
                  onChange={setAwards}
                  footnote="Индивидуальные награды используются для заданий."
                />
                {isResultsLocked && (
                  <div style={readOnlyNoticeStyle}>Итоги индивидуальных наград появятся после их подтверждения.</div>
                )}
                {awardsEditable && !isAwardsSubmitted && awardsFilled > 0 && (
                  <div style={readOnlyNoticeStyle}>
                    Если не успеешь подтвердить, после дедлайна засчитаются последние сохранённые награды.
                  </div>
                )}
                {!isResultsLocked && (
                  <SaveSubmitBar
                    canEdit={awardsEditable}
                    canSubmit={awardsFilled > 0}
                    isSubmitted={isAwardsSubmitted}
                    saving={saving}
                    dirty={awardsDirty}
                    onSave={saveAwardsDraft}
                    onSubmit={submitAwards}
                    saveLabel="Сохранить награды"
                    submitLabel={isAwardsSubmitted ? "Подтвердить награды заново" : "Подтвердить награды"}
                    hint={awardsFilled === 0 ? "Выбери хотя бы одну награду, чтобы подтвердить." : undefined}
                  />
                )}
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

function HeroStatusPill({ label, done }: { label: string; done: boolean }) {
  return (
    <span style={{
      flexShrink: 0,
      display: "inline-flex",
      alignItems: "center",
      height: 22,
      padding: "0 10px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 850,
      whiteSpace: "nowrap",
      color: done ? "color-mix(in srgb, #2ec060 82%, var(--tg-text))" : "var(--tg-hint)",
      background: done ? "color-mix(in srgb, #2ec060 14%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-hint) 12%, transparent)",
      border: `1px solid ${done ? "color-mix(in srgb, #2ec060 26%, transparent)" : "color-mix(in srgb, var(--tg-hint) 16%, transparent)"}`,
    }}>
      {label}
    </span>
  );
}

const detailHeaderRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
} as const;

const detailHeaderTitleStyle = {
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.02em",
  color: "var(--tg-text)",
} as const;

// ─── Styles ───────────────────────────────────────────────────────────────────

// Elevated premium dark surface — lifts cards above the page background.
const CARD_SURFACE =
  "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)";
const CARD_SHADOW =
  "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)";

function deadlineLineStyle(urgent: boolean) {
  return {
    marginTop: 3,
    fontSize: 11,
    fontWeight: 750,
    color: urgent ? "#ffb020" : "var(--tg-hint)",
    letterSpacing: "0.01em",
  } as const;
}

const viewToggleStyle = {
  flexShrink: 0,
  height: 28,
  padding: "0 12px",
  border: "1px solid color-mix(in srgb, var(--tg-text) 14%, transparent)",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--tg-text) 6%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 68%, var(--tg-hint))",
  fontSize: 11,
  fontWeight: 850,
  cursor: "pointer",
  whiteSpace: "nowrap",
} as const;

const backBtnStyle = {
  alignSelf: "flex-start",
  height: 34,
  borderRadius: 999,
  border: "none",
  padding: "0 12px",
  background: "rgba(255,255,255,0.10)",
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.01em",
} as const;


const cardStyle = {
  borderRadius: 18,
  padding: "14px 14px 12px",
  background: CARD_SURFACE,
  color: "var(--tg-text)",
  boxShadow: CARD_SHADOW,
} as const;

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 10,
} as const;

const sectionTitleStyle = {
  margin: 0,
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.02em",
} as const;

const detailsStyle = {
  borderRadius: 16,
  padding: "11px 14px",
  background: CARD_SURFACE,
  boxShadow: CARD_SHADOW,
  color: "var(--tg-text)",
} as const;

const detailsSummaryStyle = {
  fontSize: 13,
  cursor: "pointer",
  listStyle: "none",
  userSelect: "none" as const,
  display: "flex",
  alignItems: "center",
  gap: 0,
} as const;

const emptyStyle = {
  borderRadius: 12,
  padding: 14,
  background: "rgba(128,128,128,0.07)",
  color: "var(--tg-hint)",
  fontSize: 13,
  lineHeight: 1.5,
  fontWeight: 650,
} as const;

const successStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "rgba(52,199,89,0.10)",
  color: "#2ec060",
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

const warningStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "rgba(255,176,32,0.10)",
  color: "#ffb020",
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

const readOnlyNoticeStyle = {
  padding: "10px 13px",
  borderRadius: 12,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 70%, var(--tg-hint))",
  fontWeight: 750,
  fontSize: 12.5,
  lineHeight: 1.45,
} as const;

const errorStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "rgba(255,59,48,0.10)",
  color: "var(--tg-destructive, #ff453a)",
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;
