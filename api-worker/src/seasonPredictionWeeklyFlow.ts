// seasonPredictionWeeklyFlow.ts
// Pure user-flow policy for "Вызов недели" stepper/submit (W3). No I/O, no DB.
// Mirrors the small helpers used by the web editor; tested here since `web` has no
// test runner. Does NOT change scoring/answers/tasks/rewards.

export type WeeklyFlowQuestion = {
  question_key: string;
  status: string;
  sort_order?: number;
  id?: number;
};

// Active questions only, in sort_order then id. Disabled/void are excluded from steps.
export function weeklyActiveQuestionsInOrder<T extends WeeklyFlowQuestion>(questions: T[]): T[] {
  return [...(questions || [])]
    .filter((q) => String(q.status) === "active")
    .sort((a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) || (Number(a.id ?? 0) - Number(b.id ?? 0)));
}

function isAnswered(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

export type WeeklyProgress = { answered: number; total: number; allAnswered: boolean };

export function weeklyProgress(activeQuestions: WeeklyFlowQuestion[], answers: Record<string, unknown> | null | undefined): WeeklyProgress {
  const a = answers && typeof answers === "object" ? answers : {};
  const total = activeQuestions.length;
  const answered = activeQuestions.filter((q) => isAnswered(a[q.question_key])).length;
  return { answered, total, allAnswered: total > 0 && answered === total };
}

// Whether the user may still edit/save a draft (independent of completeness).
export function canEditWeeklyEntry(f: { locked: boolean; deadlinePassed: boolean; hasScore: boolean }): boolean {
  return !f.locked && !f.deadlinePassed && !f.hasScore;
}

export type WeeklySubmitFlags = {
  allAnswered: boolean;
  isSubmitting: boolean;
  locked: boolean;
  deadlinePassed: boolean;
  hasScore: boolean;
};

// Submit is allowed only when every active question is answered, nothing is in
// flight, and the entry is still editable.
export function canSubmitWeeklyEntry(f: WeeklySubmitFlags): boolean {
  if (f.isSubmitting) return false;
  if (!canEditWeeklyEntry({ locked: f.locked, deadlinePassed: f.deadlinePassed, hasScore: f.hasScore })) return false;
  return f.allAnswered;
}

export type WeeklyUserState =
  | "before_open"
  | "active"
  | "submitted_editable"
  | "locked"
  | "scoring"
  | "completed"
  | "has_score";

const SUBMITTED_ENTRY_STATUSES = new Set(["submitted", "locked", "scoring", "completed"]);

// Single source of truth for the user-facing lifecycle state (challenge + entry +
// deadline + score, with a clear priority order).
export function resolveWeeklyUserState(input: {
  challengeStatus: string;
  entryStatus: string | null;
  deadlinePassed: boolean;
  hasScore: boolean;
  openAt: number | null;
  nowSeconds: number;
}): WeeklyUserState {
  if (input.hasScore) return "has_score";
  const cs = String(input.challengeStatus);
  if (cs === "completed") return "completed";
  if (cs === "scoring") return "scoring";
  if (cs === "locked" || cs === "archived") return "locked";
  if (input.deadlinePassed) return "locked";
  if (cs === "draft") return "before_open"; // not yet opened to users
  if (input.openAt != null && input.nowSeconds < input.openAt) return "before_open";
  if (input.entryStatus && SUBMITTED_ENTRY_STATUSES.has(String(input.entryStatus))) return "submitted_editable";
  return "active";
}
