// weeklyGoals.ts — pure presentation helper. Maps the THREE backend V2 reward tasks
// (participation / bonus / result) onto FIVE user-facing GOALS, without changing the
// backend task schema, claim keys, scoring, or reward amounts.
//
//   Goal 1  Начать вызов                  ← participation step "started"
//   Goal 2  Ответить на все вопросы        ← participation step "answered"
//   Goal 3  Подтвердить прогноз            ← participation step "submitted"
//   Goal 4  Угадать бонусный вопрос        ← bonus task (claimable/claimed/completed)
//   Goal 5  Получить итог недели           ← result task (claimable/claimed/completed)
//
// rewardsTotal = number of reward-bearing tasks (3 for V2). Legacy V1 has no
// participation steps → we fall back to the backend progress counts.

export type WeeklyGoalTaskLike = {
  key: string;
  status: string;
  reward?: { stars: number; balls: number; case_type: string | null; case_count: number } | null;
  steps?: Array<{ key: string; title: string; completed: boolean }>;
};

export type WeeklyGoal = { key: string; title: string; done: boolean };

export type WeeklyGoalsSummary = {
  isV2: boolean;
  goals: WeeklyGoal[];
  goalsDone: number;
  goalsTotal: number;
  rewardsTotal: number;
};

const DONE_STATUSES = new Set(["claimable", "claimed", "completed"]);

function hasReward(t: WeeklyGoalTaskLike | undefined): boolean {
  const r = t?.reward;
  return !!r && (r.stars > 0 || r.balls > 0 || r.case_count > 0);
}

export function deriveWeeklyGoals(
  tasks: WeeklyGoalTaskLike[],
  fallbackProgress?: { current: number; target: number },
): WeeklyGoalsSummary {
  const participation = tasks.find((t) => t.key === "weekly_challenge_participation");
  const bonus = tasks.find((t) => t.key === "weekly_challenge_bonus");
  const result = tasks.find((t) => t.key === "weekly_challenge_result");
  const isV2 = !!participation && Array.isArray(participation.steps) && participation.steps.length > 0;

  if (!isV2) {
    const cur = Math.max(0, Number(fallbackProgress?.current ?? 0));
    const tgt = Math.max(cur, Number(fallbackProgress?.target ?? tasks.length));
    return { isV2: false, goals: [], goalsDone: cur, goalsTotal: tgt, rewardsTotal: tasks.filter((t) => hasReward(t)).length };
  }

  const steps = participation!.steps || [];
  const step = (k: string) => steps.find((s) => s.key === k)?.completed === true;
  const bonusDone = DONE_STATUSES.has(String(bonus?.status));
  const resultDone = DONE_STATUSES.has(String(result?.status));

  const goals: WeeklyGoal[] = [
    { key: "started", title: "Начать Вызов недели", done: step("started") },
    { key: "answered", title: "Ответить на все активные вопросы", done: step("answered") },
    { key: "submitted", title: "Подтвердить прогноз", done: step("submitted") },
    { key: "bonus", title: "Угадать бонусный вопрос", done: bonusDone },
    { key: "result", title: "Получить итог недели", done: resultDone },
  ];
  const rewardsTotal = [participation, bonus, result].filter((t) => hasReward(t)).length;
  return { isV2: true, goals, goalsDone: goals.filter((g) => g.done).length, goalsTotal: goals.length, rewardsTotal };
}
