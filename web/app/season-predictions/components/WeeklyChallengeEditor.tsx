"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Pressable } from "@/app/components/ui/Pressable";
import { ActionDialog } from "@/app/components/ui/ActionDialog";
import type {
  WeeklyChallenge,
  WeeklyChallengeActiveResponse,
  WeeklyChallengeDetailResponse,
  WeeklyChallengeEntry,
  WeeklyChallengeMatch,
  WeeklyChallengeMyScoreResponse,
  WeeklyChallengeScoreQuestion,
} from "../types";
import { SeasonPredictionStatusPill } from "./SeasonPredictionStatusPill";
import { WEEKLY_COMPETITION_MODE_LABEL } from "../weeklyTemplates";
import { WeeklyChallengeQuestionCard } from "./WeeklyChallengeQuestionCard";
import { WeeklyChallengeLeaderboard } from "./WeeklyChallengeLeaderboard";
import { useWeeklyClaimableCount, notifyClaimableChanged } from "@/app/components/ClaimableBadge";
import { formatTimeLeft } from "../deadline";

const ACCENT = "#ff8a3c";
const DONE = "#2ec060";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDeadline(ts: number | null | undefined) {
  if (!ts) return "Дедлайн не задан";
  const date = `${new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  })} МСК`;
  const left = ts - Math.floor(Date.now() / 1000);
  if (left <= 0) return `Дедлайн прошёл · ${date}`;
  return `${date} · осталось ${formatTimeLeft(left)}`;
}

function formatKickoff(ts: number | null | undefined) {
  if (!ts) return "Время не указано";
  return `${new Date(ts * 1000).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  })} МСК`;
}

export function WeeklyChallengeEditor({
  data,
  onBack,
  onEntryChange,
  onOpenTasks,
}: {
  data: WeeklyChallengeActiveResponse | WeeklyChallengeDetailResponse;
  onBack: () => void;
  onEntryChange: (entry: WeeklyChallengeEntry) => void;
  onOpenTasks?: () => void;
}) {
  const challenge = data.challenge as WeeklyChallenge;
  const matches: WeeklyChallengeMatch[] = data.match_pool || [];
  // W3: only active questions, ordered by sort_order (then id) — these become steps.
  const activeQuestions = useMemo(
    () => (data.questions || [])
      .filter((q) => q.status === "active")
      .sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || (Number(a.id ?? 0) - Number(b.id ?? 0))),
    [data.questions],
  );

  const initialAnswers = useMemo<Record<string, string>>(() => ({ ...(data.entry?.answers || {}) }), [data.entry?.answers]);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>(initialAnswers);
  const [saving, setSaving] = useState(false);        // draft save in flight
  const [submitting, setSubmitting] = useState(false); // submit in flight (double-submit guard)
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [scoreResp, setScoreResp] = useState<WeeklyChallengeMyScoreResponse | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [mode, setMode] = useState<"fill" | "review">("fill");
  const [showConfirm, setShowConfirm] = useState(false);
  // W3: a server 423 flips the editor to read-only without waiting for a reload.
  const [serverLocked, setServerLocked] = useState(false);

  // W3: guard async setState after unmount / against a stale challenge id.
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  useEffect(() => {
    setAnswers(initialAnswers);
    setSavedAnswers(initialAnswers);
  }, [initialAnswers]);

  // Reset stepper + local lock whenever the challenge itself changes.
  // If answers were already submitted, re-open on the review screen instead of
  // the first question (the user is returning to inspect/update, not to start over).
  useEffect(() => {
    const submitted = ["submitted", "locked", "scoring", "completed"].includes(String(data.entry?.status || ""));
    setStepIndex(0);
    setMode(submitted ? "review" : "fill");
    setServerLocked(false);
    setShowConfirm(false);
  }, [challenge.id, data.entry?.status]);

  // W1: load personal weekly-challenge result (read-only). Re-runs after submit.
  useEffect(() => {
    let active = true;
    apiFetch<WeeklyChallengeMyScoreResponse>(`/season-predictions/weekly-challenges/${challenge.id}/my-score`)
      .then((res) => { if (active) setScoreResp(res); })
      .catch(() => { if (active) setScoreResp(null); });
    return () => { active = false; };
  }, [challenge.id, data.entry?.status, data.entry?.last_submitted_at]);

  const hasScore = !!scoreResp?.has_score;
  // W4: a stale score (official answers changed after recalc) must not be shown as final.
  const resultsStale = !!scoreResp?.results_stale;
  const score = scoreResp?.score || null;
  const claimable = useWeeklyClaimableCount();

  const entryStatus = data.entry?.status || null;
  const isSubmitted = ["submitted", "locked", "scoring", "completed"].includes(entryStatus || "");
  const deadline = challenge.deadline_at || null;
  const deadlinePassed = !!deadline && Math.floor(Date.now() / 1000) >= deadline;
  const lockedByStatus = ["locked", "scoring", "completed"].includes(entryStatus || "")
    || ["locked", "scoring", "completed", "archived", "draft"].includes(challenge.status);
  // Once scored / locked / past the deadline, the challenge is read-only for the user.
  const canEdit = !deadlinePassed && !lockedByStatus && !serverLocked && activeQuestions.length > 0 && !hasScore;

  const total = activeQuestions.length;
  const filledCount = activeQuestions.reduce((count, question) => (answers[question.question_key] ? count + 1 : count), 0);
  const allAnswered = total > 0 && filledCount === total;
  const dirty = JSON.stringify(answers) !== JSON.stringify(savedAnswers);

  // Keep the step in range if the active set shrinks (e.g. a question was voided).
  useEffect(() => {
    if (stepIndex > Math.max(0, total - 1)) setStepIndex(Math.max(0, total - 1));
  }, [total, stepIndex]);

  function optionLabelFor(questionKey: string, optionId: string | undefined | null): string {
    if (!optionId) return "";
    const q = activeQuestions.find((x) => x.question_key === questionKey);
    const opt = (q?.options || []).find((o) => o.id === optionId);
    return opt ? String(opt.label ?? opt.id) : optionId;
  }

  function selectOption(questionKey: string, optionId: string) {
    setAnswers((prev) => (prev[questionKey] === optionId ? prev : { ...prev, [questionKey]: optionId }));
    setNotice("");
    setError("");
  }

  // W3: a 423 (challenge locked / deadline passed) → local read-only, hide submit.
  function handleLockError(e: unknown): boolean {
    const msg = getErrorMessage(e, "");
    if (msg.includes("WEEKLY_CHALLENGE_LOCKED") || msg.includes("HTTP 423")) {
      setServerLocked(true);
      setShowConfirm(false);
      setError("Приём ответов завершён — вызов закрыт. Ответы больше нельзя изменить.");
      return true;
    }
    return false;
  }

  // Manual draft save. Local answers are NEVER cleared on failure.
  async function saveDraft(opts?: { silent?: boolean }) {
    if (!canEdit || saving || submitting) return null;
    const cid = challenge.id;
    setSaving(true);
    if (!opts?.silent) setNotice("");
    setError("");
    try {
      const res = await apiFetch<{ ok: boolean; entry: WeeklyChallengeEntry }>(
        `/season-predictions/weekly-challenges/${cid}/draft`,
        { method: "PUT", body: JSON.stringify({ answers }) },
      );
      if (!aliveRef.current || cid !== challenge.id) return res.entry; // stale: don't apply
      onEntryChange(res.entry);
      setSavedAnswers({ ...answers });
      if (!opts?.silent) setNotice(isSubmitted ? "Изменения сохранены. До дедлайна вызов можно подтвердить заново." : "Черновик сохранён.");
      return res.entry;
    } catch (e) {
      if (aliveRef.current && cid === challenge.id && !handleLockError(e)) {
        setError(getErrorMessage(e, "Не удалось сохранить черновик"));
      }
      return null;
    } finally {
      if (aliveRef.current && cid === challenge.id) setSaving(false);
    }
  }

  // W3: confirm → submit. Single in-flight guard; save-then-submit; abort if save fails.
  async function submitChallenge() {
    if (submitting || !canEdit || !allAnswered) return;
    const cid = challenge.id;
    setShowConfirm(false);
    setSubmitting(true);
    setNotice("");
    setError("");
    try {
      await apiFetch<{ ok: boolean; entry: WeeklyChallengeEntry }>(
        `/season-predictions/weekly-challenges/${cid}/draft`,
        { method: "PUT", body: JSON.stringify({ answers }) },
      );
      const res = await apiFetch<{ ok: boolean; entry: WeeklyChallengeEntry }>(
        `/season-predictions/weekly-challenges/${cid}/submit`,
        { method: "POST", body: JSON.stringify({ answers }) },
      );
      if (!aliveRef.current || cid !== challenge.id) return; // stale: ignore late response
      onEntryChange(res.entry);
      setSavedAnswers({ ...answers });
      setMode("fill");
      setNotice("Ответы подтверждены. До дедлайна их можно изменить и подтвердить заново.");
      // Submit can complete the "Подтвердить прогноз" goal → the participation
      // reward becomes claimable; refresh menu/home/tab badges.
      notifyClaimableChanged();
    } catch (e) {
      if (aliveRef.current && cid === challenge.id && !handleLockError(e)) {
        setError(getErrorMessage(e, "Не удалось подтвердить ответы"));
      }
    } finally {
      if (aliveRef.current && cid === challenge.id) setSubmitting(false);
    }
  }

  const currentQuestion = total > 0 ? activeQuestions[Math.min(stepIndex, total - 1)] : null;
  const submitLabel = isSubmitted ? "Обновить отправленные ответы" : "Отправить ответы";
  const lifecycleBanner = deadlinePassed || serverLocked
    ? { text: "Приём ответов завершён — вызов закрыт.", style: warningStyle }
    : !hasScore && challenge.status === "scoring"
      ? { text: "Идёт подсчёт результатов.", style: warningStyle }
      : !hasScore && challenge.status === "completed"
        ? { text: "Результаты подведены.", style: warningStyle }
        : isSubmitted && canEdit
          ? { text: "Ответы отправлены. Можно изменить до дедлайна.", style: successStyle }
          : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <Pressable onClick={onBack} haptic="light" style={backBtnStyle} aria-label="Назад в Прогнозы сезона">
        ← Назад
      </Pressable>

      {/* Hero — compact (screen title lives in the standalone header above) */}
      <section style={{ borderRadius: 16, overflow: "hidden", background: CARD_SURFACE, boxShadow: CARD_SHADOW, border: SOFT_BORDER }}>
        <div style={{ height: 3, background: ACCENT, boxShadow: `0 0 12px color-mix(in srgb, ${ACCENT} 70%, transparent)` }} />
        <div style={{ padding: "12px 14px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950, letterSpacing: 0, lineHeight: 1.12, color: "var(--tg-text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {challenge.title}
            </h2>
            <SeasonPredictionStatusPill status={entryStatus} />
          </div>

          {challenge.description && (
            <p style={{ margin: "5px 0 0", fontSize: 12.5, fontWeight: 650, color: META_COLOR, lineHeight: 1.45 }}>
              {challenge.description}
            </p>
          )}

          {challenge.competition_mode && challenge.competition_mode !== "unspecified" && (
            <div style={{ marginTop: 8 }}>
              <span data-testid="weekly-mode-badge" style={modeBadgeStyle}>
                {WEEKLY_COMPETITION_MODE_LABEL[challenge.competition_mode as "club" | "national_team"]}
              </span>
            </div>
          )}

          <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: META_COLOR, letterSpacing: "0.01em" }}>
            {formatDeadline(deadline)} · {matches.length} {pluralRu(matches.length, "матч", "матча", "матчей")} в пуле
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <ProgressChip label="Ответы" value={`${filledCount}/${total}`} done={allAnswered} />
            {dirty && <span style={dirtyChipStyle}>● несохранено</span>}
          </div>
          {total > 0 && (
            <div style={progressTrackStyle} aria-hidden>
              <div style={{ ...progressFillStyle, width: `${Math.round((filledCount / total) * 100)}%`, background: allAnswered ? DONE : ACCENT }} />
            </div>
          )}
        </div>
      </section>

      {lifecycleBanner && !notice && !error && <div style={lifecycleBanner.style}>{lifecycleBanner.text}</div>}
      {notice && <div style={successStyle}>{notice}</div>}
      {error && <div style={errorStyle}>{error}</div>}
      {hasScore && resultsStale && <div style={warningStyle}>Результаты обновляются — итоговый счёт появится после пересчёта.</div>}
      {hasScore && !resultsStale && <div style={successStyle}>Вызов завершён. Ответы заблокированы после подсчёта.</div>}

      {/* W1: result card + per-question breakdown (read-only). Hidden while stale. */}
      {hasScore && score && !resultsStale && <WeeklyResultCard score={score} />}

      {/* W2: compact action row to the weekly-challenge tasks once a result exists */}
      {hasScore && onOpenTasks && (
        <Pressable onClick={onOpenTasks} haptic="selection" pressedScale={0.99} style={taskRowStyle} aria-label="Открыть задания Вызова недели">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 850, color: "var(--tg-text)" }}>Задания Вызова недели</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: META_COLOR, marginTop: 1 }}>
              {claimable > 0 ? `Можно забрать: ${claimable}` : "Награды за участие и результат"}
            </div>
          </div>
          <span style={taskRowCtaStyle}>Открыть</span>
        </Pressable>
      )}

      {/* No questions configured yet */}
      {!hasScore && total === 0 && (
        <section style={emptyStyle}>
          <div style={{ fontSize: 14, fontWeight: 900, color: "var(--tg-text)", marginBottom: 6 }}>Вопросы ещё не настроены</div>
          <div style={{ fontSize: 12, fontWeight: 650, color: "var(--tg-hint)", lineHeight: 1.5 }}>
            Вопросы вызова ещё не готовы. Ответить можно будет позже.
          </div>
        </section>
      )}

      {/* W3: step-based editor — one question at a time, then a review screen */}
      {!hasScore && canEdit && total > 0 && mode === "fill" && currentQuestion && (
        <>
          <div style={stepDotsRowStyle}>
            {activeQuestions.map((q, i) => {
              const answered = !!answers[q.question_key];
              const current = i === stepIndex;
              return (
                <Pressable
                  key={q.question_key}
                  onClick={() => setStepIndex(i)}
                  haptic="selection"
                  aria-label={`Вопрос ${i + 1}${answered ? ", отвечен" : ", без ответа"}`}
                  style={stepDotStyle(current, answered)}
                />
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: META_COLOR, textAlign: "center" }}>
            Вопрос {stepIndex + 1} из {total}
          </div>

          <WeeklyChallengeQuestionCard
            key={currentQuestion.id}
            question={currentQuestion}
            selectedId={answers[currentQuestion.question_key] || null}
            readOnly={false}
            onSelect={(optionId) => selectOption(currentQuestion.question_key, optionId)}
            index={stepIndex}
            matches={matches}
          />

          <div style={navRowStyle}>
            <Pressable onClick={() => setStepIndex((i) => Math.max(0, i - 1))} disabled={stepIndex === 0} haptic="light" style={navBtnStyle(stepIndex === 0, "ghost")}>
              ← Назад
            </Pressable>
            <Pressable onClick={() => saveDraft()} disabled={saving || !dirty} haptic="light" style={navBtnStyle(saving || !dirty, "ghost")}>
              {saving ? "Сохраняю…" : "Черновик"}
            </Pressable>
            {stepIndex < total - 1 ? (
              <Pressable onClick={() => setStepIndex((i) => Math.min(total - 1, i + 1))} haptic="selection" style={navBtnStyle(false, "primary")}>
                Далее →
              </Pressable>
            ) : (
              <Pressable onClick={() => setMode("review")} haptic="selection" style={navBtnStyle(false, "primary")}>
                К проверке
              </Pressable>
            )}
          </div>
        </>
      )}

      {/* W3: review screen */}
      {!hasScore && canEdit && total > 0 && mode === "review" && (
        <section style={matchPoolStyle}>
          <h2 style={sectionTitleStyle}>Проверка ответов</h2>
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
            {activeQuestions.map((q, i) => {
              const label = optionLabelFor(q.question_key, answers[q.question_key]);
              return (
                <div key={q.question_key} style={reviewRowStyle(!label)}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 850, color: "var(--tg-text)", lineHeight: 1.25 }}>{i + 1}. {q.title}</div>
                    <div style={{ marginTop: 2, fontSize: 11.5, fontWeight: 800, color: label ? DONE : "var(--tg-destructive, #ff453a)" }}>
                      {label || "Не отвечено"}
                    </div>
                  </div>
                  <Pressable onClick={() => { setMode("fill"); setStepIndex(i); }} haptic="selection" style={reviewEditBtnStyle}>
                    Изменить
                  </Pressable>
                </div>
              );
            })}
          </div>
          <div style={{ ...navRowStyle, marginTop: 12 }}>
            <Pressable onClick={() => setMode("fill")} haptic="light" style={navBtnStyle(false, "ghost")}>← К вопросам</Pressable>
            <Pressable
              onClick={() => setShowConfirm(true)}
              disabled={!allAnswered || submitting}
              haptic="medium"
              style={navBtnStyle(!allAnswered || submitting, "primary")}
            >
              {submitting ? "Отправляю…" : submitLabel}
            </Pressable>
          </div>
          {!allAnswered && (
            <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 750, color: "var(--tg-hint)", lineHeight: 1.4 }}>
              Ответь на все {total} {pluralRu(total, "вопрос", "вопроса", "вопросов")}, чтобы отправить.
            </div>
          )}
        </section>
      )}

      {/* Read-only answer summary when the challenge is closed/scoring but not yet scored.
          As each question's official answer is confirmed, the user sees a preliminary
          correct/wrong/void self-check — before the final recalc. */}
      {!hasScore && !canEdit && total > 0 && (() => {
        const rows = activeQuestions.map((q) => {
          const userId = answers[q.question_key] || null;
          // A confirmed tie accepts several options; fall back to the singular id
          // for questions confirmed before multi-answer existed.
          const officialIds = Array.isArray(q.official_answer_option_ids) && q.official_answer_option_ids.length > 0
            ? q.official_answer_option_ids.map(String)
            : (q.official_answer_option_id ? [String(q.official_answer_option_id)] : []);
          return {
            q,
            userLabel: optionLabelFor(q.question_key, userId),
            officialLabel: officialIds.map((id) => optionLabelFor(q.question_key, id)).filter(Boolean).join(" / "),
            state: preliminaryAnswerState(q.official_status, officialIds, userId),
          };
        });
        const confirmed = rows.filter((r) => r.state.kind === "correct" || r.state.kind === "wrong");
        const correctCount = rows.filter((r) => r.state.kind === "correct").length;
        return (
          <section style={matchPoolStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h2 style={sectionTitleStyle}>Твои ответы</h2>
              {confirmed.length > 0 && (
                <span style={{ fontSize: 11.5, fontWeight: 900, color: DONE }}>
                  Верно {correctCount} из {confirmed.length}
                </span>
              )}
            </div>
            {confirmed.length < total && (
              <div style={{ marginTop: 3, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.4 }}>
                Предварительно — итог по части вопросов ещё подтверждается.
              </div>
            )}
            <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 6 }}>
              {rows.map(({ q, userLabel, officialLabel, state }, i) => (
                <div key={q.question_key} style={preliminaryRowStyle(state.kind)}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 850, color: "var(--tg-text)", lineHeight: 1.25, minWidth: 0 }}>{i + 1}. {q.title}</div>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 850, color: state.color, whiteSpace: "nowrap" }}>{state.badge}</span>
                  </div>
                  {state.kind === "void" ? (
                    <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.35 }}>
                      Вопрос аннулирован
                    </div>
                  ) : (
                    <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: META_COLOR, lineHeight: 1.4 }}>
                      Твой: {userLabel || "не отвечено"}
                      {state.kind === "pending"
                        ? <> · Итог: будет позже</>
                        : <> · Итог: {officialLabel || "—"}</>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* W5: public weekly leaderboard — once the challenge is being/has been scored */}
      {(challenge.status === "scoring" || challenge.status === "completed" || hasScore) && (
        <WeeklyChallengeLeaderboard challengeId={challenge.id} />
      )}

      {/* Submit confirmation */}
      {showConfirm && (
        <ActionDialog
          title="Отправить ответы?"
          cancelLabel="Вернуться к проверке"
          confirmLabel={submitLabel}
          onCancel={() => setShowConfirm(false)}
          onConfirm={submitChallenge}
        >
          Ты ответил на все {total} {pluralRu(total, "вопрос", "вопроса", "вопросов")}. До дедлайна ответы можно изменить и отправить повторно, после дедлайна — уже нет.
        </ActionDialog>
      )}

      {/* Match pool — collapsed by default once the challenge is decided. */}
      {matches.length > 0 && (
        <details style={matchPoolStyle} open={!hasScore}>
          <summary style={matchSummaryStyle}>
            <span style={sectionTitleStyle}>Пул матчей недели</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tg-hint)" }}>{matches.length} матчей</span>
          </summary>
          <ol style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
            {matches.map((match, idx) => (
              <li key={match.id} style={matchRowStyle(idx === matches.length - 1)}>
                <span style={{ fontSize: 11, fontWeight: 850, color: "var(--tg-hint)", minWidth: 16 }}>{idx + 1}.</span>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--tg-text)", flex: 1, minWidth: 0, lineHeight: 1.3, overflowWrap: "anywhere" }}>
                  {match.home_team_name} — {match.away_team_name}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--tg-hint)", whiteSpace: "nowrap" }}>
                  {formatKickoff(match.kickoff_at)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

const RESULT_STATUS: Record<string, { label: string; color: string }> = {
  correct: { label: "Угадано", color: DONE },
  wrong: { label: "Мимо", color: "color-mix(in srgb, #d98a1a 82%, var(--tg-text))" },
  void: { label: "Аннулирован", color: "var(--tg-hint)" },
  unanswered: { label: "Без ответа", color: "var(--tg-hint)" },
  pending_official: { label: "Итог не подтверждён", color: "var(--tg-hint)" },
};

function WeeklyResultCard({ score }: { score: import("../types").WeeklyChallengeScore }) {
  const pct = Math.round((score.points_pct || 0) * 100);
  const questions = score.breakdown_json?.questions || [];
  return (
    <section style={matchPoolStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h2 style={sectionTitleStyle}>Твой результат</h2>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 950, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>{score.total_points}/{score.max_possible_points}</span>
          <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 900, background: "color-mix(in srgb, #34c759 16%, var(--tg-bg))", color: DONE, border: "1px solid color-mix(in srgb, #34c759 26%, transparent)" }}>{pct}%</span>
        </span>
      </div>
      <div style={{ marginTop: 3, fontSize: 12, fontWeight: 700, color: "var(--tg-hint)" }}>
        Угадано {score.correct_answers} из {score.correct_answers + score.wrong_answers + score.unanswered_questions}
        {score.void_questions > 0 ? ` · аннулировано ${score.void_questions}` : ""}
      </div>
      <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
        {questions.map((q, idx) => <WeeklyResultRow key={q.question_id} q={q} index={idx} />)}
      </div>
    </section>
  );
}

function WeeklyResultRow({ q, index }: { q: WeeklyChallengeScoreQuestion; index: number }) {
  const st = RESULT_STATUS[q.status] || { label: q.status, color: "var(--tg-hint)" };
  const isVoid = q.status === "void";
  return (
    <div style={{
      borderRadius: 10, padding: "7px 10px",
      background: q.status === "correct" ? "color-mix(in srgb, #34c759 8%, var(--tg-bg))" : "color-mix(in srgb, var(--tg-secondary-bg) 55%, transparent)",
      border: q.status === "correct" ? "1px solid color-mix(in srgb, #34c759 18%, transparent)" : "1px solid color-mix(in srgb, var(--tg-hint) 11%, transparent)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 850, color: "var(--tg-text)", minWidth: 0, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {index + 1}. {q.title}
        </span>
        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 850, color: st.color, whiteSpace: "nowrap" }}>
          {st.label}{!isVoid && q.status !== "pending_official" ? ` · +${q.points}` : ""}
        </span>
      </div>
      {isVoid ? (
        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.35 }}>
          Аннулирован{q.note ? ` · ${q.note}` : ""}
        </div>
      ) : (
        <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: META_COLOR, lineHeight: 1.4 }}>
          Твой: {q.user_answer_label || "—"}
          {q.status !== "pending_official" ? <> · Итог: {q.official_answer_label || "—"}</> : <> · Итог: будет позже</>}
        </div>
      )}
    </div>
  );
}

// Preliminary per-question self-check (post-deadline, pre-final-recalc). Compares the
// user's pick against the confirmed official answer exposed by the API. "pending" while
// the official answer is not yet confirmed; "void" for annulled questions.
type PreliminaryKind = "correct" | "wrong" | "void" | "pending";
const PRELIMINARY_WRONG = "color-mix(in srgb, #d98a1a 82%, var(--tg-text))";
function preliminaryAnswerState(
  officialStatus: "pending" | "confirmed" | "void" | undefined,
  officialOptionIds: string[],
  userOptionId: string | null,
): { kind: PreliminaryKind; badge: string; color: string } {
  if (officialStatus === "void") return { kind: "void", badge: "Аннулирован", color: "var(--tg-hint)" };
  if (officialStatus === "confirmed") {
    if (userOptionId && officialOptionIds.includes(userOptionId)) {
      return { kind: "correct", badge: "Верно ✓", color: DONE };
    }
    return { kind: "wrong", badge: userOptionId ? "Неверно ✗" : "Не отвечено", color: PRELIMINARY_WRONG };
  }
  return { kind: "pending", badge: "Ждём итог", color: "var(--tg-hint)" };
}

function preliminaryRowStyle(kind: PreliminaryKind) {
  const correct = kind === "correct";
  const wrong = kind === "wrong";
  return {
    borderRadius: 11,
    padding: "8px 11px",
    background: correct
      ? "color-mix(in srgb, #34c759 8%, var(--tg-bg))"
      : wrong
        ? "color-mix(in srgb, #d98a1a 8%, var(--tg-bg))"
        : "color-mix(in srgb, var(--tg-secondary-bg) 58%, transparent)",
    border: correct
      ? "1px solid color-mix(in srgb, #34c759 18%, transparent)"
      : wrong
        ? "1px solid color-mix(in srgb, #d98a1a 20%, transparent)"
        : "1px solid color-mix(in srgb, var(--tg-hint) 11%, transparent)",
  } as const;
}

function ProgressChip({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      height: 26,
      padding: "0 9px",
      borderRadius: 999,
      background: done ? "color-mix(in srgb, #34c759 14%, var(--tg-bg))" : CHIP_BG,
      border: done ? "1px solid color-mix(in srgb, #34c759 24%, transparent)" : "1px solid color-mix(in srgb, var(--tg-hint) 13%, transparent)",
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: done ? DONE : "var(--tg-hint)" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, fontWeight: 950, color: done ? DONE : "var(--tg-text)" }}>
        {value}
      </span>
      {done && <span style={{ fontSize: 11, color: DONE }}>✓</span>}
    </div>
  );
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))";
const CARD_SHADOW = "0 8px 22px color-mix(in srgb, var(--tg-text) 12%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 7%, transparent)";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";
const SOFT_BORDER = "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)";
const CHIP_BG = "color-mix(in srgb, var(--tg-secondary-bg) 72%, var(--tg-bg))";

const modeBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 24,
  padding: "0 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.02em",
  background: `color-mix(in srgb, ${ACCENT} 14%, var(--tg-bg))`,
  color: `color-mix(in srgb, ${ACCENT} 84%, var(--tg-text))`,
  border: `1px solid color-mix(in srgb, ${ACCENT} 26%, transparent)`,
} as const;

const backBtnStyle = {
  alignSelf: "flex-start",
  height: 34,
  borderRadius: 999,
  padding: "0 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
  letterSpacing: "0.01em",
} as const;

const matchPoolStyle = {
  borderRadius: 18,
  padding: "12px 14px",
  background: CARD_SURFACE,
  boxShadow: CARD_SHADOW,
  border: SOFT_BORDER,
  color: "var(--tg-text)",
} as const;

const sectionTitleStyle = {
  margin: 0,
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: 0,
} as const;

function matchRowStyle(isLast: boolean) {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "7px 0",
    borderBottom: isLast ? "none" : "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  } as const;
}

const emptyStyle = {
  borderRadius: 18,
  padding: 16,
  background: CARD_SURFACE,
  boxShadow: CARD_SHADOW,
  border: SOFT_BORDER,
  color: "var(--tg-text)",
} as const;

const dirtyChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 8px",
  borderRadius: 999,
  background: "color-mix(in srgb, #ffb020 14%, var(--tg-bg))",
  color: "color-mix(in srgb, #ffb020 82%, var(--tg-text))",
  fontSize: 11,
  fontWeight: 800,
} as const;

const taskRowStyle = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  borderRadius: 12,
  padding: "9px 12px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
  border: SOFT_BORDER,
  cursor: "pointer",
  textAlign: "left" as const,
} as const;

const taskRowCtaStyle = {
  flexShrink: 0,
  fontSize: 12.5,
  fontWeight: 900,
  color: `color-mix(in srgb, ${ACCENT} 82%, var(--tg-text))`,
  whiteSpace: "nowrap" as const,
} as const;

const matchSummaryStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  cursor: "pointer",
  listStyle: "none",
  userSelect: "none" as const,
} as const;

const successStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "color-mix(in srgb, #34c759 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #34c759 20%, transparent)",
  color: DONE,
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

const warningStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "color-mix(in srgb, #ffb020 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, #ffb020 22%, transparent)",
  color: "color-mix(in srgb, #ffb020 84%, var(--tg-text))",
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

const errorStyle = {
  padding: "9px 12px",
  borderRadius: 12,
  background: "color-mix(in srgb, var(--tg-destructive) 12%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-destructive) 22%, transparent)",
  color: "var(--tg-destructive, #ff453a)",
  fontWeight: 750,
  fontSize: 13,
  lineHeight: 1.45,
} as const;

// ── W3: stepper styles ───────────────────────────────────────────────────────
const progressTrackStyle = {
  marginTop: 10,
  height: 6,
  borderRadius: 999,
  background: "color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  overflow: "hidden",
} as const;

const progressFillStyle = {
  height: "100%",
  borderRadius: 999,
  transition: "width 220ms ease, background 220ms ease",
} as const;

const stepDotsRowStyle = {
  display: "flex",
  gap: 6,
  justifyContent: "center",
  flexWrap: "wrap" as const,
} as const;

function stepDotStyle(current: boolean, answered: boolean) {
  return {
    width: current ? 26 : 12,
    height: 12,
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
    padding: 0,
    background: current
      ? ACCENT
      : answered
        ? DONE
        : "color-mix(in srgb, var(--tg-hint) 26%, transparent)",
    transition: "width 180ms ease, background 180ms ease",
  } as const;
}

const navRowStyle = {
  display: "flex",
  gap: 8,
  alignItems: "stretch",
} as const;

function navBtnStyle(disabled: boolean, variant: "primary" | "ghost") {
  const primary = variant === "primary";
  return {
    flex: primary ? 1.4 : 1,
    minHeight: 46,
    borderRadius: 13,
    border: primary ? "none" : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
    background: primary ? "var(--tg-button, #007aff)" : "color-mix(in srgb, var(--tg-secondary-bg) 66%, var(--tg-bg))",
    color: primary ? "var(--tg-button-text, #fff)" : "var(--tg-text)",
    fontSize: 13.5,
    fontWeight: 850,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: primary && !disabled ? "0 8px 20px var(--sg-glow-button)" : "none",
  } as const;
}

function reviewRowStyle(missing: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "9px 11px",
    borderRadius: 11,
    background: "color-mix(in srgb, var(--tg-secondary-bg) 58%, transparent)",
    border: missing
      ? "1px solid color-mix(in srgb, var(--tg-destructive) 30%, transparent)"
      : "1px solid color-mix(in srgb, var(--tg-hint) 11%, transparent)",
  } as const;
}

const reviewEditBtnStyle = {
  flexShrink: 0,
  minHeight: 34,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  background: "color-mix(in srgb, var(--tg-bg) 60%, var(--tg-secondary-bg))",
  color: `color-mix(in srgb, ${ACCENT} 82%, var(--tg-text))`,
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
} as const;
