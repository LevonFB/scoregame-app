// seasonPredictionWeeklyScoring.ts
// Pure scoring engine for "Вызов недели" (Stage W1). No I/O, no DB, no rewards.
// Formula version: weekly_challenge_v1. +1 per correct answer, max = number of
// confirmed active questions; void questions are excluded from the max.

export const WEEKLY_CHALLENGE_FORMULA_VERSION = "weekly_challenge_v1";

export type WeeklyOfficialStatus = "pending" | "confirmed" | "void";

export type WeeklyQuestionInput = {
  id: number;
  question_key: string;
  title: string;
  status: string; // active | disabled | void (the question's own state)
  options: Array<{ id?: unknown; label?: unknown }>;
  official_status: WeeklyOfficialStatus | string;
  official_answer_option_id: string | null;
  // Multi-answer support: when non-empty, every listed option id is accepted as
  // correct. NULL/empty keeps the legacy single-answer behaviour driven by
  // official_answer_option_id, so previously scored challenges are unaffected.
  official_answer_option_ids?: string[] | null;
  // Whether this question's template may carry several correct answers at all.
  // Computed from the template registry by the caller; the engine stays I/O-free.
  allow_multi_correct?: boolean;
  official_note: string | null;
};

export type WeeklyScoreInput = {
  questions: WeeklyQuestionInput[];
  answers: Record<string, unknown>; // answers_json: { [question_key]: option_id }
};

export type WeeklyQuestionBreakdown = {
  question_id: number;
  question_key: string;
  title: string;
  user_answer_option_id: string | null;
  user_answer_label: string | null;
  official_answer_option_id: string | null;
  official_answer_label: string | null;
  // Full accepted set. Single-answer questions repeat the one id/label here, so a
  // reader can always use these two fields and ignore the singular ones.
  official_answer_option_ids?: string[];
  official_answer_labels?: string[];
  status: "correct" | "wrong" | "void" | "unanswered" | "pending_official";
  points: number;
  note?: string | null;
};

export type WeeklyScoreBreakdown = {
  formula_version: string;
  total_points: number;
  max_possible_points: number;
  correct_answers: number;
  wrong_answers: number;
  void_questions: number;
  unanswered_questions: number;
  points_pct: number;
  breakdown: Record<string, unknown>;
};

function optionLabel(options: WeeklyQuestionInput["options"], optionId: string | null): string | null {
  if (optionId == null) return null;
  for (const o of options || []) {
    if (String(o?.id ?? "") === optionId) {
      const label = o?.label;
      return label == null || label === "" ? optionId : String(label);
    }
  }
  return optionId;
}

// Every option id accepted as correct for a question. Multi-answer questions list
// them explicitly; legacy rows fall back to the single official_answer_option_id.
export function acceptedOfficialOptionIds(q: Pick<WeeklyQuestionInput, "official_answer_option_id" | "official_answer_option_ids">): string[] {
  const many = Array.isArray(q.official_answer_option_ids) ? q.official_answer_option_ids : [];
  const cleaned: string[] = [];
  for (const raw of many) {
    const id = raw == null ? "" : String(raw);
    if (id !== "" && !cleaned.includes(id)) cleaned.push(id);
  }
  if (cleaned.length > 0) return cleaned;
  const single = q.official_answer_option_id == null || q.official_answer_option_id === ""
    ? null
    : String(q.official_answer_option_id);
  return single == null ? [] : [single];
}

// Returns true if any active question still has a pending official answer
// (neither confirmed nor void). Recalc must be blocked while this is true.
export function weeklyChallengeHasPendingOfficial(questions: WeeklyQuestionInput[]): boolean {
  return questions.some((q) => String(q.status) === "active" && String(q.official_status) !== "confirmed" && String(q.official_status) !== "void" && String(q.status) !== "void");
}

export function scoreWeeklyChallengeEntry(input: WeeklyScoreInput): WeeklyScoreBreakdown {
  const answers = (input.answers && typeof input.answers === "object" && !Array.isArray(input.answers))
    ? (input.answers as Record<string, unknown>)
    : {};

  let totalPoints = 0;
  let maxPoints = 0;
  let correct = 0;
  let wrong = 0;
  let voidCount = 0;
  let unanswered = 0;
  const breakdownQuestions: WeeklyQuestionBreakdown[] = [];

  for (const q of input.questions) {
    const qStatus = String(q.status || "active");
    if (qStatus === "disabled") continue; // disabled questions are fully ignored

    const officialStatus = String(q.official_status || "pending");
    const isVoid = qStatus === "void" || officialStatus === "void";

    if (isVoid) {
      voidCount += 1;
      breakdownQuestions.push({
        question_id: q.id, question_key: q.question_key, title: q.title,
        user_answer_option_id: null, user_answer_label: null,
        official_answer_option_id: null, official_answer_label: null,
        status: "void", points: 0, note: q.official_note ?? null,
      });
      continue;
    }

    const rawUser = answers[q.question_key];
    const userAns = rawUser == null || rawUser === "" ? null : String(rawUser);

    if (officialStatus !== "confirmed") {
      // Pending official answer — not yet scorable. Recalc gate prevents this in
      // practice; if it slips through, mark pending and exclude from max.
      breakdownQuestions.push({
        question_id: q.id, question_key: q.question_key, title: q.title,
        user_answer_option_id: userAns, user_answer_label: optionLabel(q.options, userAns),
        official_answer_option_id: null, official_answer_label: null,
        status: "pending_official", points: 0, note: q.official_note ?? null,
      });
      continue;
    }

    // Confirmed question → counts toward max.
    maxPoints += 1;
    const acceptedIds = acceptedOfficialOptionIds(q);
    const acceptedLabels = acceptedIds.map((id) => optionLabel(q.options, id) ?? id);
    const officialId = acceptedIds.length > 0 ? acceptedIds[0] : null;
    // Legacy readers (and the current UI) render a single label, so join the whole
    // accepted set — otherwise a user who picked the second correct option would be
    // told the "right" answer was a different one.
    const officialLabel = acceptedLabels.length > 0 ? acceptedLabels.join(" / ") : null;

    if (!userAns) {
      unanswered += 1;
      breakdownQuestions.push({
        question_id: q.id, question_key: q.question_key, title: q.title,
        user_answer_option_id: null, user_answer_label: null,
        official_answer_option_id: officialId, official_answer_label: officialLabel,
        official_answer_option_ids: acceptedIds, official_answer_labels: acceptedLabels,
        status: "unanswered", points: 0,
      });
      continue;
    }

    const isCorrect = acceptedIds.includes(userAns);
    if (isCorrect) { totalPoints += 1; correct += 1; } else { wrong += 1; }
    breakdownQuestions.push({
      question_id: q.id, question_key: q.question_key, title: q.title,
      user_answer_option_id: userAns, user_answer_label: optionLabel(q.options, userAns),
      official_answer_option_id: officialId, official_answer_label: officialLabel,
      official_answer_option_ids: acceptedIds, official_answer_labels: acceptedLabels,
      status: isCorrect ? "correct" : "wrong", points: isCorrect ? 1 : 0,
    });
  }

  const pointsPct = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 10000) / 10000 : 0;
  return {
    formula_version: WEEKLY_CHALLENGE_FORMULA_VERSION,
    total_points: totalPoints,
    max_possible_points: maxPoints,
    correct_answers: correct,
    wrong_answers: wrong,
    void_questions: voidCount,
    unanswered_questions: unanswered,
    points_pct: pointsPct,
    breakdown: {
      formula_version: WEEKLY_CHALLENGE_FORMULA_VERSION,
      summary: { correct, wrong, void: voidCount, total_points: totalPoints, max_possible_points: maxPoints },
      questions: breakdownQuestions,
    },
  };
}

// ── Official answer validation (admin PUT) ───────────────────────────────────

export type WeeklyOfficialAnswerInput = {
  question_id: number;
  official_status: string;
  official_answer_option_id?: string | null;
  official_answer_option_ids?: unknown;
  official_note?: string | null;
};

export type WeeklyOfficialAnswerNormalized = {
  question_id: number;
  official_status: WeeklyOfficialStatus;
  official_answer_option_id: string | null;
  // null → store SQL NULL and keep the row on legacy single-answer semantics.
  official_answer_option_ids: string[] | null;
  official_note: string | null;
};

const WEEKLY_OFFICIAL_STATUSES: WeeklyOfficialStatus[] = ["pending", "confirmed", "void"];

// Validate official-answer settings against the challenge's questions. Throws coded errors.
export function validateWeeklyOfficialAnswers(
  rawAnswers: WeeklyOfficialAnswerInput[],
  questions: WeeklyQuestionInput[],
): WeeklyOfficialAnswerNormalized[] {
  const byId = new Map<number, WeeklyQuestionInput>();
  for (const q of questions) byId.set(Number(q.id), q);

  const out: WeeklyOfficialAnswerNormalized[] = [];
  for (const a of rawAnswers || []) {
    const qid = Number(a.question_id);
    const q = byId.get(qid);
    if (!q) throw new Error("WEEKLY_QUESTION_NOT_IN_CHALLENGE");
    const status = String(a.official_status || "");
    if (!(WEEKLY_OFFICIAL_STATUSES as string[]).includes(status)) throw new Error("WEEKLY_OFFICIAL_STATUS_INVALID");
    const allowed = (q.options || []).map((o) => String(o?.id ?? ""));

    // Multi-answer payload (optional). Normalized here so the rest of the flow can
    // treat "one id" and "several ids" uniformly.
    const rawMany = a.official_answer_option_ids;
    let manyIds: string[] | null = null;
    if (rawMany != null) {
      if (!Array.isArray(rawMany)) throw new Error("WEEKLY_OFFICIAL_OPTIONS_INVALID");
      const cleaned: string[] = [];
      for (const raw of rawMany) {
        const id = raw == null ? "" : String(raw);
        if (id === "") continue;
        if (cleaned.includes(id)) throw new Error("WEEKLY_OFFICIAL_OPTIONS_DUPLICATE");
        cleaned.push(id);
      }
      manyIds = cleaned.length > 0 ? cleaned : null;
    }
    if (manyIds && manyIds.length > 1 && q.allow_multi_correct !== true) {
      // Engine-level guard kept for callers that opt out explicitly. Templates all
      // allow multi-answer today, so in production this only fires for a caller that
      // passes allow_multi_correct: false on purpose.
      throw new Error("WEEKLY_OFFICIAL_MULTI_NOT_ALLOWED");
    }

    // The singular field stays authoritative for single-answer questions and keeps
    // pointing at the first accepted id otherwise, so legacy readers keep working.
    const rawSingle = a.official_answer_option_id == null || a.official_answer_option_id === "" ? null : String(a.official_answer_option_id);
    const optionId = rawSingle ?? (manyIds ? manyIds[0] : null);

    if (status === "confirmed") {
      if (!optionId) throw new Error("WEEKLY_OFFICIAL_OPTION_REQUIRED");
      for (const id of manyIds ?? [optionId]) {
        if (!allowed.includes(id)) throw new Error("WEEKLY_OFFICIAL_OPTION_INVALID");
      }
      if (!allowed.includes(optionId)) throw new Error("WEEKLY_OFFICIAL_OPTION_INVALID");
    }
    out.push({
      question_id: qid,
      official_status: status as WeeklyOfficialStatus,
      official_answer_option_id: status === "void" ? null : optionId,
      official_answer_option_ids: status === "void" ? null : manyIds,
      official_note: a.official_note == null || a.official_note === "" ? null : String(a.official_note),
    });
  }
  return out;
}
