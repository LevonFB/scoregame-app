// seasonPredictionEurocupTasks.ts
// Stage E10.1: task resolver for eurocup PLAY-OFF (ties) and BRACKET (сетка),
// plus result tasks driven by the eurocups_full_v1 score breakdown.
//
// Pure: no I/O, no DB, no rewards, no economy. These are PROGRESS-TRACKING tasks
// (reward: null), consistent with the existing eurocup league-stage tasks — they
// do NOT touch the reward_ledger / claim / dedup. Status set adds "failed" for a
// result task whose stage is finally decided but the condition was not met.

export type EurocupTaskStatus = "available" | "in_progress" | "completed" | "future" | "failed";
export type EurocupTaskBadge = "ties" | "bracket" | "result";
export type EurocupCupCode = "UCL" | "UEL" | "UECL";

export const EUROCUP_TASK_TIES_TOTAL = 8;     // 8 play-off pairs
export const EUROCUP_TASK_BRACKET_TOTAL = 15; // 8 + 4 + 2 + 1 bracket picks

// Subset of the eurocups_full_v1 breakdown a task needs (null when not scored yet).
export type EurocupCupResult = {
  playoffs: { correct: number; total: number; predicted: boolean } | null;
  bracket: {
    points: number;
    semifinalists: { correct: number; resolved: boolean };
    finalists: { correct: number; resolved: boolean };
    champion: { correct: boolean; resolved: boolean };
  } | null;
  total_points: number;
} | null;

export type EurocupCupTaskInput = {
  code: EurocupCupCode;
  label: string; // "Лига чемпионов"
  short: string; // "ЛЧ"
  tiesPicked: number;       // 0..8
  bracketPicked: number;    // 0..15
  championPicked: boolean;
  bracketSubmitted: boolean; // knockout bracket status submitted/locked/completed
  result: EurocupCupResult;
  // The play-off pairs exist (an admin confirmed the draw). Until then every task
  // of this cup is shown as «Скоро»: without opponents "Заполнить стыки" is not
  // something a user can act on, and it only clutters the league-stage screen.
  knockoutOpen: boolean;
};

export type EurocupTaskView = {
  id: string;
  subsection: string; // "europe_ties" | "europe_bracket" | "europe_result"
  badge: EurocupTaskBadge; // phase: ties | bracket | result
  cup: EurocupCupCode | "aggregate"; // which tournament (or cross-cup aggregate)
  title: string;
  description: string;
  status: EurocupTaskStatus;
  current: number;
  target: number;
  future_reason?: string;
};

const TIES_SUB = "europe_ties";
const BRACKET_SUB = "europe_bracket";
const RESULT_SUB = "europe_result";
const RESULT_FUTURE = "После пересчёта результатов";
const KNOCKOUT_FUTURE = "После жеребьёвки плей-офф";

function clamp(current: number, target: number): number {
  return Math.max(0, Math.min(current, target));
}

type EurocupTaskDraft = Omit<EurocupTaskView, "cup">;

// Activity task: available → in_progress → completed (no reward, no claim).
function activity(badge: EurocupTaskBadge, subsection: string, id: string, title: string, description: string, current: number, target: number): EurocupTaskDraft {
  const c = clamp(current, target);
  const status: EurocupTaskStatus = target > 0 && c >= target ? "completed" : c > 0 ? "in_progress" : "available";
  return { id, subsection, badge, title, description, status, current: c, target };
}

// Which tournament a task belongs to: per-cup ids embed the code (e.g.
// ek_ties_UCL_fill, ek_res_UCL_champion); cross-cup aggregates (fill_all /
// submit_any / champion_2 / *_any) have no code → "aggregate".
function cupOf(id: string): EurocupCupCode | "aggregate" {
  const m = id.match(/^ek_(?:ties|bracket|res)_(UCL|UEL|UECL)_/);
  return (m?.[1] as EurocupCupCode) || "aggregate";
}

// ── Result helpers (progressive future/failed) ───────────────────────────────
// A per-cup metric: `resolved` = the needed stage is finally decided for this cup;
// `value` = the measured amount (correct count / points / total).
type CupMetric = { resolved: boolean; value: number };

// "Any cup reaches threshold". future until at least one cup can be judged; failed
// only when every cup is resolved and none reached it.
function anyResult(metrics: CupMetric[], threshold: number): { status: EurocupTaskStatus; current: number; target: number } {
  const best = metrics.reduce((m, x) => Math.max(m, x.resolved ? x.value : 0), 0);
  const met = metrics.some((x) => x.resolved && x.value >= threshold);
  const allResolved = metrics.length > 0 && metrics.every((x) => x.resolved);
  const status: EurocupTaskStatus = met ? "completed" : !allResolved ? "future" : "failed";
  return { status, current: clamp(best, threshold), target: threshold };
}

// "At least N cups reach the per-cup threshold". Progress = qualifying cups / N.
function countResult(metrics: CupMetric[], perCupThreshold: number, neededCount: number): { status: EurocupTaskStatus; current: number; target: number } {
  const metCount = metrics.filter((x) => x.resolved && x.value >= perCupThreshold).length;
  const allResolved = metrics.length > 0 && metrics.every((x) => x.resolved);
  const met = metCount >= neededCount;
  const status: EurocupTaskStatus = met ? "completed" : !allResolved ? "future" : "failed";
  return { status, current: clamp(metCount, neededCount), target: neededCount };
}

// One cup reaches the threshold. future until the stage is resolved for that cup;
// completed if met; failed if resolved but not met. Reuses the same metric +
// finality flags as the aggregate tasks.
function singleResult(metric: CupMetric, threshold: number): { status: EurocupTaskStatus; current: number; target: number } {
  const met = metric.resolved && metric.value >= threshold;
  const status: EurocupTaskStatus = met ? "completed" : metric.resolved ? "failed" : "future";
  return { status, current: clamp(metric.value, threshold), target: threshold };
}

function result(badge: EurocupTaskBadge, id: string, title: string, description: string, ev: { status: EurocupTaskStatus; current: number; target: number }): EurocupTaskDraft {
  const view: EurocupTaskDraft = { id, subsection: RESULT_SUB, badge, title, description, status: ev.status, current: ev.current, target: ev.target };
  if (ev.status === "future") view.future_reason = RESULT_FUTURE;
  return view;
}

// ── Per-cup metric extractors ────────────────────────────────────────────────
// Ties result resolved once all 8 official ties are decided (total >= 8).
function tiesMetric(c: EurocupCupTaskInput): CupMetric {
  const p = c.result?.playoffs;
  const resolved = !!p && p.total >= EUROCUP_TASK_TIES_TOTAL;
  return { resolved, value: resolved ? Number(p?.correct || 0) : 0 };
}
function championMetric(c: EurocupCupTaskInput): CupMetric {
  const ch = c.result?.bracket?.champion;
  return { resolved: !!ch && ch.resolved, value: ch && ch.resolved && ch.correct ? 1 : 0 };
}
function finalistsMetric(c: EurocupCupTaskInput): CupMetric {
  const f = c.result?.bracket?.finalists;
  return { resolved: !!f && f.resolved, value: f && f.resolved ? Number(f.correct || 0) : 0 };
}
function semisMetric(c: EurocupCupTaskInput): CupMetric {
  const s = c.result?.bracket?.semifinalists;
  return { resolved: !!s && s.resolved, value: s && s.resolved ? Number(s.correct || 0) : 0 };
}
// Score thresholds: resolved once the value already clears the bar OR the bracket
// is finally decided (champion resolved) — i.e. it can no longer grow.
function bracketPointsMetric(c: EurocupCupTaskInput, threshold: number): CupMetric {
  const b = c.result?.bracket;
  if (!b) return { resolved: false, value: 0 };
  const resolved = b.points >= threshold || b.champion.resolved;
  return { resolved, value: b.points };
}
function totalPointsMetric(c: EurocupCupTaskInput, threshold: number): CupMetric {
  const r = c.result;
  if (!r) return { resolved: false, value: 0 };
  const finalDone = !!r.bracket && r.bracket.champion.resolved;
  const resolved = r.total_points >= threshold || finalDone;
  return { resolved, value: r.total_points };
}

// ── Builder ──────────────────────────────────────────────────────────────────
export function buildEurocupKnockoutTaskViews(cups: EurocupCupTaskInput[]): EurocupTaskView[] {
  const views: EurocupTaskDraft[] = [];
  const submittedCount = cups.filter((c) => c.bracketSubmitted).length;
  const anySubmitted = submittedCount > 0;

  // ── Стыки (activity) ────────────────────────────────────────────────────────
  for (const c of cups) {
    views.push(activity("ties", TIES_SUB, `ek_ties_${c.code}_fill`, `Заполнить стыки ${c.short}`,
      `Выбери победителей всех 8 пар стыков (${c.label}).`, c.tiesPicked, EUROCUP_TASK_TIES_TOTAL));
    views.push(activity("ties", TIES_SUB, `ek_ties_${c.code}_submit`, `Подтвердить стыки ${c.short}`,
      `Подтверди прогноз плей-офф (${c.label}).`, c.bracketSubmitted ? 1 : 0, 1));
  }
  views.push(activity("ties", TIES_SUB, "ek_ties_fill_any", "Заполнить стыки любого еврокубка",
    "Выбери победителей всех 8 пар хотя бы в одном еврокубке.",
    cups.reduce((m, c) => Math.max(m, c.tiesPicked), 0), EUROCUP_TASK_TIES_TOTAL));
  views.push(activity("ties", TIES_SUB, "ek_ties_fill_all", "Заполнить стыки всех 3 еврокубков",
    "Заполни 8/8 стыков в ЛЧ, ЛЕ и ЛК.",
    cups.filter((c) => c.tiesPicked >= EUROCUP_TASK_TIES_TOTAL).length, 3));
  views.push(activity("ties", TIES_SUB, "ek_ties_submit_any", "Подтвердить стыки любого еврокубка",
    "Подтверди плей-офф хотя бы одного еврокубка.", anySubmitted ? 1 : 0, 1));
  views.push(activity("ties", TIES_SUB, "ek_ties_submit_all", "Подтвердить стыки всех 3 еврокубков",
    "Подтверди плей-офф ЛЧ, ЛЕ и ЛК.", submittedCount, 3));

  // ── Сетка (activity) ────────────────────────────────────────────────────────
  for (const c of cups) {
    views.push(activity("bracket", BRACKET_SUB, `ek_bracket_${c.code}_fill`, `Заполнить сетку ${c.short} до чемпиона`,
      `Доведи прогноз до чемпиона: 1/8, 1/4, 1/2, финал (${c.label}).`, c.bracketPicked, EUROCUP_TASK_BRACKET_TOTAL));
    views.push(activity("bracket", BRACKET_SUB, `ek_bracket_${c.code}_submit`, `Подтвердить сетку ${c.short}`,
      `Подтверди прогноз сетки (${c.label}).`, c.bracketSubmitted ? 1 : 0, 1));
  }
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_fill_any", "Заполнить сетку любого еврокубка",
    "Доведи сетку до чемпиона хотя бы в одном еврокубке.",
    cups.reduce((m, c) => Math.max(m, c.bracketPicked), 0), EUROCUP_TASK_BRACKET_TOTAL));
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_fill_all", "Заполнить сетки всех 3 еврокубков",
    "Доведи сетку до чемпиона в ЛЧ, ЛЕ и ЛК.",
    cups.filter((c) => c.bracketPicked >= EUROCUP_TASK_BRACKET_TOTAL).length, 3));
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_submit_any", "Подтвердить сетку любого еврокубка",
    "Подтверди сетку хотя бы одного еврокубка.", anySubmitted ? 1 : 0, 1));
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_submit_all", "Подтвердить сетки всех 3 еврокубков",
    "Подтверди сетку ЛЧ, ЛЕ и ЛК.", submittedCount, 3));
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_champion_any", "Выбрать чемпиона любого еврокубка",
    "Выбери победителя финала хотя бы в одном еврокубке.",
    cups.some((c) => c.championPicked) ? 1 : 0, 1));
  views.push(activity("bracket", BRACKET_SUB, "ek_bracket_champion_all", "Выбрать чемпионов всех 3 еврокубков",
    "Выбери чемпиона в ЛЧ, ЛЕ и ЛК.", cups.filter((c) => c.championPicked).length, 3));

  // ── Результаты — стыки ──────────────────────────────────────────────────────
  const tiesMetrics = cups.map(tiesMetric);
  views.push(result("result", "ek_res_ties_4_any", "Угадать 4 из 8 в стыках любого еврокубка",
    "В любом еврокубке угадай минимум 4 победителей стыков.", anyResult(tiesMetrics, 4)));
  views.push(result("result", "ek_res_ties_6_any", "Угадать 6 из 8 в стыках любого еврокубка",
    "В любом еврокубке угадай минимум 6 победителей стыков.", anyResult(tiesMetrics, 6)));
  views.push(result("result", "ek_res_ties_8_any", "Угадать 8 из 8 в стыках любого еврокубка",
    "Угадай всех 8 победителей стыков хотя бы в одном еврокубке.", anyResult(tiesMetrics, 8)));
  views.push(result("result", "ek_res_ties_4_all", "Угадать 4+ в стыках всех 3 еврокубков",
    "Угадай минимум 4 победителей стыков в ЛЧ, ЛЕ и ЛК.", countResult(tiesMetrics, 4, 3)));
  views.push(result("result", "ek_res_ties_6_two", "Угадать 6+ в стыках двух еврокубков",
    "Угадай минимум 6 победителей стыков хотя бы в двух еврокубках.", countResult(tiesMetrics, 6, 2)));

  // ── Результаты — сетка (champions / finalists / semis) ──────────────────────
  const champMetrics = cups.map(championMetric);
  views.push(result("result", "ek_res_champion_any", "Угадать чемпиона любого еврокубка",
    "Угадай победителя любого еврокубка.", anyResult(champMetrics, 1)));
  views.push(result("result", "ek_res_champion_2", "Угадать чемпионов 2 еврокубков",
    "Угадай чемпионов минимум двух еврокубков.", countResult(champMetrics, 1, 2)));
  views.push(result("result", "ek_res_champion_3", "Угадать чемпионов всех 3 еврокубков",
    "Угадай чемпионов ЛЧ, ЛЕ и ЛК.", countResult(champMetrics, 1, 3)));

  const finalistsMetrics = cups.map(finalistsMetric);
  views.push(result("result", "ek_res_finalists_any", "Угадать обоих финалистов в любом еврокубке",
    "Угадай обоих финалистов хотя бы в одном еврокубке.", anyResult(finalistsMetrics, 2)));
  views.push(result("result", "ek_res_finalists_2", "Угадать обоих финалистов в 2 еврокубках",
    "Угадай обоих финалистов минимум в двух еврокубках.", countResult(finalistsMetrics, 2, 2)));

  const semisMetrics = cups.map(semisMetric);
  views.push(result("result", "ek_res_semis_any", "Угадать всех 4 полуфиналистов в любом еврокубке",
    "Угадай всех 4 полуфиналистов хотя бы в одном еврокубке.", anyResult(semisMetrics, 4)));

  // ── Результаты — пороги очков ───────────────────────────────────────────────
  views.push(result("result", "ek_res_bracket_80_any", "Набрать 80+ очков за сетку любого еврокубка",
    "Набери минимум 80 очков за сетку хотя бы в одном еврокубке.", anyResult(cups.map((c) => bracketPointsMetric(c, 80)), 80)));
  views.push(result("result", "ek_res_bracket_100_any", "Набрать 100+ очков за сетку любого еврокубка",
    "Набери минимум 100 очков за сетку хотя бы в одном еврокубке.", anyResult(cups.map((c) => bracketPointsMetric(c, 100)), 100)));
  views.push(result("result", "ek_res_total_150_any", "Набрать 150+ очков за любой еврокубок",
    "Набери минимум 150 очков суммарно в любом еврокубке.", anyResult(cups.map((c) => totalPointsMetric(c, 150)), 150)));
  views.push(result("result", "ek_res_total_200_any", "Набрать 200+ очков за любой еврокубок",
    "Набери минимум 200 очков суммарно в любом еврокубке.", anyResult(cups.map((c) => totalPointsMetric(c, 200)), 200)));

  // ── Per-cup result tasks (отдельно для ЛЧ / ЛЕ / ЛК) ────────────────────────
  // id `ek_res_{CUP}_…` routes the task into that tournament's subsection.
  // Grouping by PHASE (badge): ties-results → «Стыки», bracket-results → «Сетка»,
  // total-points → «Результаты». (Aggregates above keep badge "result" → «Все».)
  for (const c of cups) {
    const ties = tiesMetric(c);
    views.push(result("ties", `ek_res_${c.code}_ties_4`, `Угадать 4 из 8 в стыках ${c.short}`,
      `В стыках ${c.label} угадай минимум 4 победителей (из 8).`, singleResult(ties, 4)));
    views.push(result("ties", `ek_res_${c.code}_ties_6`, `Угадать 6 из 8 в стыках ${c.short}`,
      `В стыках ${c.label} угадай минимум 6 победителей (из 8).`, singleResult(ties, 6)));
    views.push(result("ties", `ek_res_${c.code}_ties_8`, `Угадать 8 из 8 в стыках ${c.short}`,
      `Угадай всех 8 победителей стыков ${c.label}.`, singleResult(ties, 8)));
    views.push(result("bracket", `ek_res_${c.code}_finalists`, `Угадать обоих финалистов ${c.short}`,
      `Угадай обоих финалистов ${c.label}.`, singleResult(finalistsMetric(c), 2)));
    views.push(result("bracket", `ek_res_${c.code}_semis`, `Угадать всех 4 полуфиналистов ${c.short}`,
      `Угадай всех 4 полуфиналистов ${c.label}.`, singleResult(semisMetric(c), 4)));
    views.push(result("bracket", `ek_res_${c.code}_champion`, `Угадать чемпиона ${c.short}`,
      `Угадай победителя ${c.label}.`, singleResult(championMetric(c), 1)));
    views.push(result("bracket", `ek_res_${c.code}_bracket_80`, `Набрать 80+ очков за сетку ${c.short}`,
      `Набери минимум 80 очков за сетку ${c.label}.`, singleResult(bracketPointsMetric(c, 80), 80)));
    views.push(result("bracket", `ek_res_${c.code}_bracket_100`, `Набрать 100+ очков за сетку ${c.short}`,
      `Набери минимум 100 очков за сетку ${c.label}.`, singleResult(bracketPointsMetric(c, 100), 100)));
    views.push(result("result", `ek_res_${c.code}_total_150`, `Набрать 150+ очков за ${c.short}`,
      `Набери минимум 150 очков суммарно в ${c.label}.`, singleResult(totalPointsMetric(c, 150), 150)));
    views.push(result("result", `ek_res_${c.code}_total_200`, `Набрать 200+ очков за ${c.short}`,
      `Набери минимум 200 очков суммарно в ${c.label}.`, singleResult(totalPointsMetric(c, 200), 200)));
  }

  // Attach the tournament metadata (cup) for frontend grouping.
  const withCup = views.map((v) => ({ ...v, cup: cupOf(v.id) }));

  // Gate everything behind the draw: a cup whose pairs are not confirmed shows all
  // of its play-off tasks as «Скоро», and the cross-cup aggregates wait until at
  // least one cup has opened. Progress is zeroed so a half-filled draft from a
  // previous season cannot flash a stale counter.
  const openCups = new Set(cups.filter((c) => c.knockoutOpen).map((c) => c.code));
  if (openCups.size === cups.length) return withCup;
  return withCup.map((v) => {
    const open = v.cup === "aggregate" ? openCups.size > 0 : openCups.has(v.cup);
    if (open) return v;
    return { ...v, status: "future" as EurocupTaskStatus, current: 0, future_reason: KNOCKOUT_FUTURE };
  });
}

export type EurocupLeagueStageResult = {
  points: number;
  top8_correct: number;
  top24_correct: number;
};

// League-stage figures out of a scored entry, for the result tasks of that phase.
// Handles both shapes: the league-only breakdown (eurocups_v2) and the combined
// one, where combineEurocupFullScore spreads the league breakdown and adds
// `league_stage: { points, max }`. Once the play-off is scored the row's
// total_points covers the WHOLE tournament, so the nested value is the only
// correct source — reading total_points there would hand out league rewards for
// bracket points. Returns null while the tournament has not been scored yet.
export function parseEurocupLeagueStageResult(breakdown: unknown, totalPoints: number): EurocupLeagueStageResult | null {
  const bd = breakdown && typeof breakdown === "object" ? (breakdown as Record<string, unknown>) : null;
  if (!bd) return null;
  const summary = bd.summary && typeof bd.summary === "object" ? (bd.summary as Record<string, unknown>) : null;
  if (!summary) return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const nested = bd.league_stage && typeof bd.league_stage === "object" ? (bd.league_stage as Record<string, unknown>) : null;
  const points = nested
    ? num(nested.points)
    : (summary.total_points != null ? num(summary.total_points) : num(totalPoints));
  return { points, top8_correct: num(summary.top8_correct), top24_correct: num(summary.top24_correct) };
}

// Parse the eurocups_full_v1 breakdown_json into the minimal result shape a task
// needs. Returns null for missing / legacy (eurocups_v1) breakdowns.
export function parseEurocupResultFromBreakdown(breakdown: unknown, totalPoints: number): EurocupCupResult {
  const bd = breakdown && typeof breakdown === "object" ? (breakdown as Record<string, unknown>) : null;
  if (!bd) return null;
  const playoffsRaw = bd.playoffs && typeof bd.playoffs === "object" ? (bd.playoffs as Record<string, unknown>) : null;
  const bracketRaw = bd.bracket && typeof bd.bracket === "object" ? (bd.bracket as Record<string, unknown>) : null;
  if (!playoffsRaw && !bracketRaw) return null; // legacy league-only breakdown

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const stage = (raw: unknown): { correct: number; resolved: boolean } => {
    const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return { correct: num(s.correct), resolved: !!s.resolved };
  };
  const championRaw = bracketRaw && typeof bracketRaw.champion === "object" ? (bracketRaw.champion as Record<string, unknown>) : {};

  return {
    playoffs: playoffsRaw
      ? { correct: num(playoffsRaw.correct), total: num(playoffsRaw.total), predicted: !!playoffsRaw.predicted }
      : null,
    bracket: bracketRaw
      ? {
        points: num(bracketRaw.points),
        semifinalists: stage(bracketRaw.semifinalists),
        finalists: stage(bracketRaw.finalists),
        champion: { correct: !!championRaw.correct, resolved: !!championRaw.resolved },
      }
      : null,
    total_points: num(totalPoints),
  };
}
