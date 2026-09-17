"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import {
  EUROPEAN_CUP_ACCENTS,
  EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT,
  EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT,
} from "../constants";
import {
  deriveEuropean,
  leagueStageEqualsSig,
  readLeagueStage,
} from "../europe";
import type {
  EurocupMyScoreResponse,
  EuropeanCupCode,
  SeasonPredictionEntry,
  SeasonPredictionEuropeanResponse,
  SeasonPredictionLeagueStageJson,
} from "../types";
import { SaveSubmitBar } from "./SaveSubmitBar";
import { LeagueStageEditor } from "./LeagueStageEditor";
import { LeagueStageCompactView } from "./LeagueStageCompactView";
import { EurocupScoreBreakdown } from "./EurocupScoreBreakdown";
import { EurocupKnockoutSection } from "./EurocupKnockoutSection";
import { EurocupTournamentSwitch } from "./EurocupTournamentSwitch";
import { EurocupStageHubCards } from "./EurocupStageHubCards";
import { deadlineLine } from "../deadline";

function getErrorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}


export function EuropeanCupEditor({
  data,
  availableCodes,
  onSwitch,
  onBack,
  onEntryChange,
}: {
  data: SeasonPredictionEuropeanResponse;
  availableCodes?: EuropeanCupCode[];
  onSwitch?: (code: EuropeanCupCode) => void;
  onBack?: () => void;
  onEntryChange: (entry: SeasonPredictionEntry) => void;
}) {
  const { season, tournament, teams, entry } = data;
  const code = tournament.tournament_code as EuropeanCupCode;
  const accent = EUROPEAN_CUP_ACCENTS[code];
  const tone = accent?.tone || "var(--tg-button)";
  // Whole tournament teased as «Скоро» — visible but not enterable.
  const tournamentSoon = tournament.status === "soon";

  const initial = useMemo(() => readLeagueStage(entry?.table), [entry?.table]);
  const [stage, setStage] = useState<SeasonPredictionLeagueStageJson>(initial);
  const [savedStage, setSavedStage] = useState<SeasonPredictionLeagueStageJson>(initial);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scoreResp, setScoreResp] = useState<EurocupMyScoreResponse | null>(null);
  const [stageView, setStageView] = useState<EurocupStageView>("hub");

  useEffect(() => {
    setStage(initial);
    setSavedStage(initial);
  }, [initial]);

  // Stage E3: load the personal eurocup score (read-only). Re-runs when the entry
  // changes (e.g. after submit). Failures are silent — score is an enhancement.
  useEffect(() => {
    let active = true;
    apiFetch<EurocupMyScoreResponse>(`/season-predictions/europe/${code}/my-score`)
      .then((res) => { if (active) setScoreResp(res); })
      .catch(() => { if (active) setScoreResp(null); });
    return () => { active = false; };
  }, [code, entry?.status, entry?.last_submitted_at]);

  const hasScore = !!scoreResp?.has_score;
  const score = scoreResp?.score || null;
  const scoreBreakdown = score?.breakdown_json || null;
  const leagueStageScore = hasScore && score
    ? {
        total: Number(scoreBreakdown?.league_stage?.points ?? score.total_points),
        max: Number(scoreBreakdown?.league_stage?.max ?? score.max_possible_points),
        pct: Number(scoreBreakdown?.league_stage?.max ?? score.max_possible_points) > 0
          ? Number(scoreBreakdown?.league_stage?.points ?? score.total_points) / Number(scoreBreakdown?.league_stage?.max ?? score.max_possible_points)
          : 0,
      }
    : null;
  const playoffStageScore = hasScore && scoreBreakdown?.playoffs && Number(scoreBreakdown.playoffs.max || 0) > 0
    ? {
        total: Number(scoreBreakdown.playoffs.points || 0),
        max: Number(scoreBreakdown.playoffs.max || 0),
        pct: Number(scoreBreakdown.playoffs.max || 0) > 0 ? Number(scoreBreakdown.playoffs.points || 0) / Number(scoreBreakdown.playoffs.max || 0) : 0,
      }
    : null;
  const bracketStageScore = hasScore && scoreBreakdown?.bracket && Number(scoreBreakdown.bracket.max || 0) > 0
    ? {
        total: Number(scoreBreakdown.bracket.points || 0),
        max: Number(scoreBreakdown.bracket.max || 0),
        pct: Number(scoreBreakdown.bracket.max || 0) > 0 ? Number(scoreBreakdown.bracket.points || 0) / Number(scoreBreakdown.bracket.max || 0) : 0,
      }
    : null;
  const officialConfirmed = scoreResp?.official_results_status === "confirmed" || scoreResp?.official_results_status === "published";

  const derived = deriveEuropean({ ...tournament, entry: entry ? { ...entry } : null });
  const deadline = tournament.deadline_at || season.deadline_at || null;
  const deadlinePassed = !!deadline && Math.floor(Date.now() / 1000) >= deadline;
  // Deadline line in the hero: date + time left; hidden once scores/results land.
  const deadlineInfo = hasScore || officialConfirmed ? null : deadlineLine(deadline);
  const lockedByStatus = derived.locked;
  // Once scores are calculated the prediction is locked (read-only) for the user.
  const canEdit = !deadlinePassed && !lockedByStatus && teams.length > 0 && !hasScore;
  const isSubmitted = derived.isSubmitted;
  // Single coherent hero status (league-stage oriented). Knockout stages show
  // their own status inside their section — never mixed into this line.
  const heroStatusDone = hasScore || officialConfirmed || isSubmitted;
  const heroStatusLabel = hasScore
    ? "Очки рассчитаны"
    : officialConfirmed
      ? "Итоги подтверждены"
      : isSubmitted
        ? "Стадия лиги подтверждена"
        : derived.entryStatus === "draft"
          ? "Черновик"
          : "Не начато";
  const top8Done = stage.league_stage.top8_team_ids.length === EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT;
  const zoneDone = stage.league_stage.zone_9_24_team_ids.length === EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT;
  const canSubmit = top8Done && zoneDone && teams.length > 0;
  const dirty = !leagueStageEqualsSig(stage, savedStage);
  // Confirmed pick reads as a compact table first (same as top-5 leagues);
  // editing is one tap away while the deadline is still open.
  const compactAvailable = (isSubmitted || hasScore || officialConfirmed) && teams.length > 0;
  const [stageModeOverride, setStageModeOverride] = useState<"compact" | "detail" | null>(null);
  const compactActive = compactAvailable && !dirty && (stageModeOverride ? stageModeOverride === "compact" : true);

  // Wipe both buckets so the table can be rebuilt from scratch. The predicted
  // winner belongs to the bracket stage and is deliberately left untouched.
  function resetStage() {
    if (!canEdit) return;
    setStage({
      stage: "league_stage",
      league_stage: {
        top8_team_ids: [],
        zone_9_24_team_ids: [],
        winner_team_id: stage.league_stage.winner_team_id,
      },
    });
    setNotice("");
    setError("");
  }

  async function saveDraft() {
    if (!canEdit) return null;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/europe/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ table_json: stage }) },
      );
      onEntryChange(res.entry);
      setSavedStage(stage);
      setNotice(isSubmitted ? "Изменения сохранены. До дедлайна прогноз можно подтвердить заново." : "Черновик сохранён.");
      return res.entry;
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось сохранить черновик"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function submitPrediction() {
    if (!canEdit || !canSubmit) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/europe/${tournament.tournament_code}/draft`,
        { method: "PUT", body: JSON.stringify({ table_json: stage }) },
      );
      const res = await apiFetch<{ ok: boolean; entry: SeasonPredictionEntry }>(
        `/season-predictions/europe/${tournament.tournament_code}/submit`,
        { method: "POST", body: JSON.stringify({}) },
      );
      onEntryChange(res.entry);
      setSavedStage(stage);
      setStageModeOverride(null);
      setNotice("Прогноз подтверждён. До дедлайна его можно изменить и подтвердить заново.");
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось подтвердить прогноз"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Back button — only in drill-in mode; inline tab view hides it. */}
      {onBack && (
        <Pressable onClick={onBack} haptic="light" style={backBtnStyle} aria-label="Назад к списку еврокубков">
          ← Назад
        </Pressable>
      )}

      {/* Tournament switch — only on the stage hub. */}
      {stageView === "hub" && onSwitch && availableCodes && availableCodes.length > 1 && (
        <EurocupTournamentSwitch codes={availableCodes} activeCode={code} onSelect={(c) => { if (c !== code) onSwitch(c); }} />
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
      ) : stageView === "hub" ? (
        <>
          {/* Tournament hero header — compact */}
          <section style={{ borderRadius: 16, overflow: "hidden", background: CARD_SURFACE, boxShadow: CARD_SHADOW }}>
            <div style={{ height: 3, background: tone, boxShadow: `0 0 12px ${tone}` }} />
            <div style={{ padding: "11px 14px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 950, letterSpacing: "-0.03em", lineHeight: 1.1, color: "var(--tg-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tournament.title}
                </h1>
                <HeroStatusPill label={heroStatusLabel} done={heroStatusDone} />
              </div>
              {/* Compact meta: code · teams · score (no "Активный этап", deadline only if set). */}
              <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: META_COLOR, letterSpacing: "0.01em" }}>
                {[
                  accent?.short || code,
                  `${tournament.team_count || 36} команд`,
                  hasScore && score ? `${score.total_points}/${score.max_possible_points} · ${Math.round((score.points_pct || 0) * 100)}%` : null,
                ].filter(Boolean).join(" · ")}
              </div>
              {deadlineInfo && (
                <div style={{ marginTop: 2, fontSize: 11, fontWeight: 750, color: deadlineInfo.urgent ? "#ffb020" : "var(--tg-hint)", letterSpacing: "0.01em" }}>
                  {deadlineInfo.text}
                </div>
              )}
            </div>
          </section>

          {/* Stage hub: three large stage panels (replaces the small tabs). */}
          <EurocupStageHubCards
            code={code}
            tone={tone}
            teams={teams}
            league={{
              statusLabel: heroStatusLabel,
              statusDone: heroStatusDone,
              top8: stage.league_stage.top8_team_ids.length,
              top8Limit: EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT,
              zone: stage.league_stage.zone_9_24_team_ids.length,
              zoneLimit: EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT,
              score: leagueStageScore,
            }}
            stageScores={{ playoffs: playoffStageScore, bracket: bracketStageScore }}
            onOpenStage={setStageView}
          />
        </>
      ) : (
        <>
          {/* Compact stage header with back-to-hub. */}
          <div style={stageHeaderRowStyle}>
            <Pressable onClick={() => setStageView("hub")} haptic="light" pressedScale={0.98} style={backBtnStyle} aria-label="К этапам">
              ← К этапам
            </Pressable>
            <span style={stageHeaderTitleStyle}>{STAGE_VIEW_TITLES[stageView]}</span>
          </div>

          {stageView === "league" && (
            <>
              {isSubmitted && canEdit && !compactActive && <div style={successStyle}>Прогноз подтверждён · можно изменить до дедлайна</div>}
              {deadlinePassed && <div style={warningStyle}>Дедлайн прошёл · прогноз заблокирован</div>}
              {notice && <div style={successStyle}>{notice}</div>}
              {error && <div style={errorStyle}>{error}</div>}
              {hasScore && <div style={successStyle}>Прогноз завершён. Изменения недоступны после расчёта очков.</div>}
              {!hasScore && officialConfirmed && <div style={warningStyle}>Итоги подтверждены. Очки появятся после пересчёта.</div>}

              {/* Score breakdown first (eurocups_v2) so the result is visible without
                  scrolling past the editor. Belongs to "League stage" only. */}
              {(hasScore || officialConfirmed) && (
                <EurocupScoreBreakdown code={code} teams={teams} preloaded={scoreResp} stage="league" />
              )}

              {compactAvailable && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>
                    {compactActive ? "Компактный вид — весь прогноз в один скрин" : "Редактирование прогноза"}
                  </span>
                  {compactActive ? (
                    canEdit && (
                      <Pressable
                        onClick={() => setStageModeOverride("detail")}
                        haptic="light"
                        style={viewToggleStyle}
                        aria-label="Редактировать прогноз"
                      >
                        Редактировать
                      </Pressable>
                    )
                  ) : (
                    <Pressable
                      onClick={() => setStageModeOverride(null)}
                      haptic="light"
                      style={viewToggleStyle}
                      aria-label="Вернуться к компактному виду"
                    >
                      Компактно
                    </Pressable>
                  )}
                </div>
              )}

              {teams.length === 0 ? (
                <section style={cardStyle}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: "var(--tg-text)", marginBottom: 6 }}>Команды ещё не настроены</div>
                  <div style={{ fontSize: 13, fontWeight: 650, color: "var(--tg-hint)", lineHeight: 1.5 }}>
                    Команды турнира ещё не заведены. Прогноз откроется позже.
                  </div>
                </section>
              ) : compactActive ? (
                <LeagueStageCompactView
                  title={tournament.title}
                  subtitle={[
                    "Мой прогноз",
                    leagueStageScore ? `${leagueStageScore.total}/${leagueStageScore.max} очков` : null,
                  ].filter(Boolean).join(" · ")}
                  teams={teams}
                  value={stage}
                  tone={tone}
                />
              ) : (
                <LeagueStageEditor
                  teams={teams}
                  value={stage}
                  readOnly={!canEdit}
                  tone={tone}
                  onChange={setStage}
                  onReset={canEdit ? resetStage : undefined}
                  canReset={canEdit && (stage.league_stage.top8_team_ids.length > 0 || stage.league_stage.zone_9_24_team_ids.length > 0)}
                />
              )}

              {/* После дедлайна сервер сам подтверждает последний сохранённый черновик, но
                  только полностью заполненный (неполная таблица ломает подсчёт очков),
                  поэтому текст зависит от готовности черновика. */}
              {canEdit && !hasScore && !isSubmitted && (
                <div style={autoSubmitNoticeStyle}>
                  {canSubmit
                    ? "Если не успеешь подтвердить, после дедлайна засчитается последний сохранённый черновик."
                    : "Черновик засчитается после дедлайна автоматически, только если он заполнен полностью: 8 команд в топ-8 и 16 в зоне плей-офф."}
                </div>
              )}

              {!hasScore && !compactActive && (
                <SaveSubmitBar canEdit={canEdit} canSubmit={canSubmit} isSubmitted={isSubmitted} saving={saving} dirty={dirty} onSave={saveDraft} onSubmit={submitPrediction} />
              )}
            </>
          )}

          {stageView === "playoffs" && (
            <>
              <EurocupScoreBreakdown code={code} teams={teams} preloaded={scoreResp} stage="playoffs" />
              <EurocupKnockoutSection code={code} teams={teams} tone={tone} mode="playoffs" />
            </>
          )}
          {stageView === "bracket" && (
            <>
              <EurocupScoreBreakdown code={code} teams={teams} preloaded={scoreResp} stage="bracket" />
              <EurocupKnockoutSection code={code} teams={teams} tone={tone} mode="bracket" />
            </>
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

type EurocupStageView = "hub" | "league" | "playoffs" | "bracket";

const STAGE_VIEW_TITLES: Record<Exclude<EurocupStageView, "hub">, string> = {
  league: "Стадия лиги",
  playoffs: "Стыки",
  bracket: "Сетка",
};

const stageHeaderRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
} as const;

const stageHeaderTitleStyle = {
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.02em",
  color: "var(--tg-text)",
} as const;

const CARD_SURFACE = "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)";
const CARD_SHADOW = "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";

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
  padding: 16,
  background: CARD_SURFACE,
  color: "var(--tg-text)",
  boxShadow: CARD_SHADOW,
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

const autoSubmitNoticeStyle = {
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
