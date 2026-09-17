// weeklyTemplates.ts (frontend mirror)
// Pure TS (no React, no path aliases) so it is importable by both the admin builder and
// the api-worker parity test (api-worker/src/__tests__/weeklyTemplateParity.test.ts).
//
// This MUST stay in lockstep with api-worker/src/weeklyChallengeTemplates.ts:
//   template keys, questionKey mapping, supportedModes, stable option IDs, default titles,
//   and the options/config generation. The parity test fails on any drift.

export type WeeklyQuestionKey =
  | "match_of_week"
  | "league_of_week"
  | "duel_of_week"
  | "upset_of_week"
  | "event_of_week";

export type WeeklyCompetitionMode = "club" | "national_team";
export type WeeklyResolvedMode = WeeklyCompetitionMode | "unspecified";
export type WeeklyAnswerMode = "binary" | "three_way" | "range" | "entities" | "groups";

export type WeeklyTemplateKey =
  | "match_result"
  | "both_teams_to_score"
  | "match_goals_range"
  | "group_highest_average_goals"
  | "group_most_draws"
  | "group_most_btts"
  | "player_goals_duel"
  | "team_goals_duel"
  | "player_vs_team_goals"
  | "underdog_not_lose"
  | "favorite_drops_points"
  | "upset_count"
  | "any_five_plus_goals"
  | "any_zero_zero"
  | "draws_count_event"
  | "pool_total_goals_bucket"
  | "pool_big_wins_count"
  | "pool_btts_count"
  | "pool_clean_sheets_count"
  | "pool_top_scoring_match"
  | "pool_outcome_balance"
  | "league_top_scoring"
  | "league_most_home_wins"
  | "clean_sheet_win"
  | "group_most_corners"
  | "pool_biggest_margin"
  | "team_conceded_duel"
  | "any_red_card"
  | "red_cards_count"
  | "fastest_goal_window";

export type WeeklyBuiltOption = { id: string; label: string; [k: string]: unknown };
export type BuiltWeeklyQuestion = { options: WeeklyBuiltOption[]; config: Record<string, unknown> };

export type WeeklyTemplateGroupInput = { id?: string; title?: string; match_ids?: unknown[] };
export type WeeklyTemplateDuelSide = {
  kind?: "player" | "team";
  name?: string;
  team_name?: string;
  match_ref?: string | null;
};
export type WeeklyTemplateUpsetCandidate = {
  id?: string;
  label?: string;
  team_name?: string;
  opponent_name?: string;
  match_ref?: string | null;
};

export type WeeklyTemplateInput = {
  templateKey: WeeklyTemplateKey | string;
  title?: string;
  matchRef?: string | null;
  homeTeamName?: string;
  awayTeamName?: string;
  groups?: WeeklyTemplateGroupInput[];
  allowGroupOverlap?: boolean;
  duel?: { side_a?: WeeklyTemplateDuelSide; side_b?: WeeklyTemplateDuelSide; void_if_did_not_play?: boolean };
  upsetCandidates?: WeeklyTemplateUpsetCandidate[];
  upsetCountMatches?: Array<{ match_ref?: string | null; favorite_side?: "home" | "away" }>;
  scope?: { type?: "all_pool" | "selected"; match_refs?: unknown[] };
  eventType?: string;
  goalsBuckets?: number[];
  countMax?: number;
  matchOptions?: Array<{ match_ref?: string | null; label?: string }>;
  includeDraws?: boolean;
  leagues?: Array<{ code?: string; label?: string }>;
};

export type WeeklyTemplateContext = {
  poolRefs: Set<string>;
  mode: WeeklyResolvedMode;
  status: "active" | "disabled" | "void";
};

export type ValidationIssue = { code: string; message: string; field?: string };

export type WeeklyQuestionTemplate = {
  templateKey: WeeklyTemplateKey;
  questionKey: WeeklyQuestionKey;
  title: string;
  supportedModes: WeeklyCompetitionMode[];
  answerMode: WeeklyAnswerMode;
  fixedOptionIds: string[];
  buildQuestion: (input: WeeklyTemplateInput) => BuiltWeeklyQuestion;
  validate: (input: WeeklyTemplateInput, ctx: WeeklyTemplateContext) => ValidationIssue[];
};

const BOTH_MODES: WeeklyCompetitionMode[] = ["club", "national_team"];

export const WEEKLY_QUESTION_DISPLAY_CATEGORY: Record<WeeklyQuestionKey, string> = {
  match_of_week: "Матч недели",
  league_of_week: "Расклад недели",
  duel_of_week: "Дуэль недели",
  upset_of_week: "Сенсация недели",
  event_of_week: "Событие недели",
};

export function weeklyQuestionDisplayCategory(questionKey: string): string {
  return WEEKLY_QUESTION_DISPLAY_CATEGORY[questionKey as WeeklyQuestionKey] || "Вопрос недели";
}

export const WEEKLY_COMPETITION_MODE_LABEL: Record<WeeklyCompetitionMode, string> = {
  club: "Клубный футбол",
  national_team: "Матчи сборных",
};

function asRef(value: unknown): string {
  return value == null ? "" : String(value).trim();
}
function refInPool(ctx: WeeklyTemplateContext, ref: string): boolean {
  return ref.length > 0 && ctx.poolRefs.has(ref);
}
function issue(code: string, message: string, field?: string): ValidationIssue {
  return field ? { code, message, field } : { code, message };
}

const GROUP_MAX = 5;
const GROUP_MIN = 2;
const UPSET_MIN = 2;
const UPSET_MAX = 5;

function groupId(group: WeeklyTemplateGroupInput, index: number): string {
  return asRef(group?.id) || `group_${index + 1}`;
}

function buildGroupQuestion(input: WeeklyTemplateInput, calculation: string): BuiltWeeklyQuestion {
  const groups = Array.isArray(input.groups) ? input.groups : [];
  const normGroups = groups.map((g, i) => ({
    id: groupId(g, i),
    title: asRef(g?.title) || `Группа ${i + 1}`,
    match_ids: (Array.isArray(g?.match_ids) ? g.match_ids : []).map(asRef).filter((r) => r.length > 0),
  }));
  const options: WeeklyBuiltOption[] = normGroups.map((g) => ({ id: g.id, label: g.title }));
  options.push({ id: "equal", label: "Равенство" });
  return {
    options,
    config: { template_key: input.templateKey, calculation, groups: normGroups, tie_behavior: "equal_option", match_pool_only: true },
  };
}

function validateGroupTemplate(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const groups = Array.isArray(input.groups) ? input.groups : [];
  if (groups.length < GROUP_MIN) issues.push(issue("WEEKLY_GROUP_MIN_TWO", "Нужно минимум две группы.", "groups"));
  if (groups.length > GROUP_MAX) issues.push(issue("WEEKLY_GROUP_MAX_FIVE", "Не больше пяти групп.", "groups"));
  const seenGroupIds = new Set<string>();
  const seenMatchRefs = new Set<string>();
  const allowOverlap = input.allowGroupOverlap === true;
  groups.forEach((g, i) => {
    const id = groupId(g, i);
    if (seenGroupIds.has(id)) issues.push(issue("WEEKLY_GROUP_DUPLICATE_ID", `Дублирующийся ID группы: ${id}.`, "groups"));
    seenGroupIds.add(id);
    if (!asRef(g?.title)) issues.push(issue("WEEKLY_GROUP_TITLE_REQUIRED", `У группы ${i + 1} нет названия.`, "groups"));
    const refs = (Array.isArray(g?.match_ids) ? g.match_ids : []).map(asRef).filter((r) => r.length > 0);
    if (refs.length < 1) issues.push(issue("WEEKLY_GROUP_NEEDS_MATCH", `В группе «${asRef(g?.title) || i + 1}» нет матчей.`, "groups"));
    for (const r of refs) {
      if (!refInPool(ctx, r)) issues.push(issue("WEEKLY_GROUP_MATCH_OUTSIDE_POOL", `Матч ${r} группы не входит в пул.`, "groups"));
      if (!allowOverlap && seenMatchRefs.has(r)) issues.push(issue("WEEKLY_GROUP_MATCH_OVERLAP", `Матч ${r} в нескольких группах.`, "groups"));
      seenMatchRefs.add(r);
    }
  });
  return issues;
}

function duelSideLabel(side: WeeklyTemplateDuelSide | undefined, fallback: string): string {
  if (!side) return fallback;
  const kind = side.kind === "team" ? "team" : "player";
  const name = kind === "team" ? asRef(side.team_name) || asRef(side.name) : asRef(side.name);
  return name || fallback;
}

function buildDuelQuestion(input: WeeklyTemplateInput): BuiltWeeklyQuestion {
  const sideA = input.duel?.side_a;
  const sideB = input.duel?.side_b;
  return {
    options: [
      { id: "player_a", label: duelSideLabel(sideA, "Сторона A") },
      { id: "player_b", label: duelSideLabel(sideB, "Сторона B") },
      { id: "equal", label: "Поровну" },
    ],
    config: {
      template_key: input.templateKey,
      side_a: { kind: sideA?.kind === "team" ? "team" : "player", name: asRef(sideA?.name), team_name: asRef(sideA?.team_name), match_ref: asRef(sideA?.match_ref) || null },
      side_b: { kind: sideB?.kind === "team" ? "team" : "player", name: asRef(sideB?.name), team_name: asRef(sideB?.team_name), match_ref: asRef(sideB?.match_ref) || null },
      void_if_player_did_not_play: input.duel?.void_if_did_not_play !== false,
      match_pool_only: true,
    },
  };
}

function validateDuelTemplate(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext, opts: { teamsOnly?: boolean } = {}): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const a = input.duel?.side_a;
  const b = input.duel?.side_b;
  const aName = a?.kind === "team" ? asRef(a?.team_name) || asRef(a?.name) : asRef(a?.name);
  const bName = b?.kind === "team" ? asRef(b?.team_name) || asRef(b?.name) : asRef(b?.name);
  if (!aName) issues.push(issue("WEEKLY_DUEL_SIDE_A_REQUIRED", "Заполните сторону A дуэли.", "duel"));
  if (!bName) issues.push(issue("WEEKLY_DUEL_SIDE_B_REQUIRED", "Заполните сторону B дуэли.", "duel"));
  if (aName && bName && aName.toLowerCase() === bName.toLowerCase()) {
    issues.push(issue("WEEKLY_DUEL_SIDES_IDENTICAL", "Стороны дуэли не должны совпадать.", "duel"));
  }
  if (opts.teamsOnly && (a?.kind !== "team" || b?.kind !== "team")) {
    issues.push(issue("WEEKLY_DUEL_TEAMS_ONLY", "В этой дуэли обе стороны — команды.", "duel"));
  }
  for (const [side, label] of [[a, "A"], [b, "B"]] as Array<[WeeklyTemplateDuelSide | undefined, string]>) {
    const ref = asRef(side?.match_ref);
    if (ref && !refInPool(ctx, ref)) issues.push(issue("WEEKLY_DUEL_MATCH_OUTSIDE_POOL", `Матч стороны ${label} не входит в пул.`, "duel"));
  }
  return issues;
}

const RANGE_GOAL_OPTIONS: WeeklyBuiltOption[] = [
  { id: "goals_0_1", label: "0–1 гол" },
  { id: "goals_2_3", label: "2–3 гола" },
  { id: "goals_4_plus", label: "4+ голов" },
];
const COUNT_OPTIONS: WeeklyBuiltOption[] = [
  { id: "count_0", label: "0" },
  { id: "count_1", label: "1" },
  { id: "count_2", label: "2" },
  { id: "count_3_plus", label: "3+" },
];

const MARGIN_OPTIONS: WeeklyBuiltOption[] = [
  { id: "margin_0_1", label: "Не больше 1 мяча" },
  { id: "margin_2", label: "2 мяча" },
  { id: "margin_3", label: "3 мяча" },
  { id: "margin_4_plus", label: "4+ мяча" },
];
const FASTEST_GOAL_OPTIONS: WeeklyBuiltOption[] = [
  { id: "first_goal_1_5", label: "1–5-я минута" },
  { id: "first_goal_6_15", label: "6–15-я минута" },
  { id: "first_goal_16_plus", label: "16-я минута и позже" },
  { id: "no_goals", label: "Голов не будет" },
];

function buildSingleMatchQuestion(input: WeeklyTemplateInput, options: WeeklyBuiltOption[], extraConfig: Record<string, unknown> = {}): BuiltWeeklyQuestion {
  return {
    options,
    config: {
      template_key: input.templateKey,
      match_ref: asRef(input.matchRef) || null,
      home_team_name: asRef(input.homeTeamName),
      away_team_name: asRef(input.awayTeamName),
      match_pool_only: true,
      ...extraConfig,
    },
  };
}

function validateSingleMatch(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const ref = asRef(input.matchRef);
  if (!ref) return [issue("WEEKLY_MATCH_REQUIRED", "Выберите матч из пула.", "matchRef")];
  if (!refInPool(ctx, ref)) return [issue("WEEKLY_MATCH_OUTSIDE_POOL", "Матч не входит в пул.", "matchRef")];
  return [];
}

function buildScopedEventQuestion(input: WeeklyTemplateInput, options: WeeklyBuiltOption[], eventType: string): BuiltWeeklyQuestion {
  const scopeType = input.scope?.type === "selected" ? "selected" : "all_pool";
  const matchRefs = scopeType === "selected"
    ? (Array.isArray(input.scope?.match_refs) ? input.scope!.match_refs : []).map(asRef).filter((r) => r.length > 0)
    : [];
  return {
    options,
    config: { template_key: input.templateKey, event_type: eventType, scope: { type: scopeType, match_refs: matchRefs }, match_pool_only: true },
  };
}

function validateScopedEvent(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const scopeType = input.scope?.type === "selected" ? "selected" : "all_pool";
  if (scopeType === "selected") {
    const refs = (Array.isArray(input.scope?.match_refs) ? input.scope!.match_refs : []).map(asRef).filter((r) => r.length > 0);
    if (refs.length < 1) issues.push(issue("WEEKLY_EVENT_SCOPE_EMPTY", "Выберите хотя бы один матч для события.", "scope"));
    for (const r of refs) {
      if (!refInPool(ctx, r)) issues.push(issue("WEEKLY_EVENT_MATCH_OUTSIDE_POOL", `Матч ${r} события не входит в пул.`, "scope"));
    }
  }
  return issues;
}

function buildUpsetCandidateQuestion(input: WeeklyTemplateInput, fallbackLabel: string): BuiltWeeklyQuestion {
  const candidates = (Array.isArray(input.upsetCandidates) ? input.upsetCandidates : [])
    .map((c, i) => {
      const team = asRef(c?.team_name);
      const opponent = asRef(c?.opponent_name);
      const label = asRef(c?.label) || (team ? (opponent ? `${team} (vs ${opponent})` : team) : "");
      if (!team && !label) return null;
      return { id: asRef(c?.id) || `upset_${i + 1}`, label: label || team, team_name: team, opponent_name: opponent, match_ref: asRef(c?.match_ref) || null };
    })
    .filter(Boolean) as WeeklyBuiltOption[];
  return { options: [...candidates, { id: "no_upset", label: fallbackLabel }], config: { template_key: input.templateKey, match_pool_only: true } };
}

function validateUpsetCandidates(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const candidates = (Array.isArray(input.upsetCandidates) ? input.upsetCandidates : []).filter((c) => asRef(c?.team_name) || asRef(c?.label));
  if (candidates.length < UPSET_MIN) issues.push(issue("WEEKLY_UPSET_MIN_TWO", "Нужно минимум два кандидата.", "upsetCandidates"));
  if (candidates.length > UPSET_MAX) issues.push(issue("WEEKLY_UPSET_MAX_FIVE", "Не больше пяти кандидатов.", "upsetCandidates"));
  candidates.forEach((c) => {
    const ref = asRef(c?.match_ref);
    if (ref && !refInPool(ctx, ref)) issues.push(issue("WEEKLY_UPSET_MATCH_OUTSIDE_POOL", "Матч кандидата не входит в пул.", "upsetCandidates"));
  });
  return issues;
}

// ── Pool-aggregate family P (league_of_week) — MIRRORS api-worker exactly ─────
const DEFAULT_GOALS_BUCKETS = [10, 16];
const DEFAULT_COUNT_MAX = 3;

function poolAggScope(input: WeeklyTemplateInput): { type: "all_pool" | "selected"; match_refs: string[] } {
  const type = input.scope?.type === "selected" ? "selected" : "all_pool";
  const refs = type === "selected"
    ? (Array.isArray(input.scope?.match_refs) ? input.scope!.match_refs : []).map(asRef).filter((r) => r.length > 0)
    : [];
  return { type, match_refs: refs };
}

function normalizeGoalsBuckets(input: WeeklyTemplateInput): number[] {
  const raw = Array.isArray(input.goalsBuckets) ? input.goalsBuckets : [];
  const nums = raw.map((n) => Math.floor(Number(n))).filter((n) => Number.isFinite(n) && n > 0);
  const uniqSorted = [...new Set(nums)].sort((a, b) => a - b);
  return uniqSorted.length > 0 ? uniqSorted : [...DEFAULT_GOALS_BUCKETS];
}

function goalsBucketOptions(buckets: number[]): WeeklyBuiltOption[] {
  const opts: WeeklyBuiltOption[] = [{ id: `goals_lt_${buckets[0]}`, label: `Меньше ${buckets[0]}` }];
  for (let i = 0; i < buckets.length - 1; i++) {
    opts.push({ id: `goals_${buckets[i]}_${buckets[i + 1] - 1}`, label: `${buckets[i]}–${buckets[i + 1] - 1}` });
  }
  const last = buckets[buckets.length - 1];
  opts.push({ id: `goals_${last}_plus`, label: `${last}+` });
  return opts;
}

function normalizeCountMax(input: WeeklyTemplateInput): number {
  const n = Math.floor(Number(input.countMax));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_COUNT_MAX;
  return Math.min(n, 10);
}

function countBucketOptions(max: number): WeeklyBuiltOption[] {
  const opts: WeeklyBuiltOption[] = [];
  for (let i = 0; i < max; i++) opts.push({ id: `count_${i}`, label: String(i) });
  opts.push({ id: `count_${max}_plus`, label: `${max}+` });
  return opts;
}

function buildPoolGoalsBucketQuestion(input: WeeklyTemplateInput, calculation: string): BuiltWeeklyQuestion {
  const buckets = normalizeGoalsBuckets(input);
  return { options: goalsBucketOptions(buckets), config: { template_key: input.templateKey, calculation, scope: poolAggScope(input), buckets, match_pool_only: true } };
}

function buildPoolCountQuestion(input: WeeklyTemplateInput, calculation: string): BuiltWeeklyQuestion {
  const max = normalizeCountMax(input);
  return { options: countBucketOptions(max), config: { template_key: input.templateKey, calculation, scope: poolAggScope(input), count_max: max, match_pool_only: true } };
}

function validatePoolScope(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext, issues: ValidationIssue[]): void {
  const scope = poolAggScope(input);
  if (scope.type !== "selected") return;
  if (scope.match_refs.length < 1) issues.push(issue("WEEKLY_POOL_SCOPE_EMPTY", "Выберите хотя бы один матч.", "scope"));
  for (const r of scope.match_refs) {
    if (!refInPool(ctx, r)) issues.push(issue("WEEKLY_POOL_MATCH_OUTSIDE_POOL", `Матч ${r} не входит в пул.`, "scope"));
  }
}

function validatePoolGoalsBucket(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  validatePoolScope(input, ctx, issues);
  const buckets = Array.isArray(input.goalsBuckets) ? input.goalsBuckets.map((n) => Math.floor(Number(n))) : [];
  if (buckets.length > 0) {
    const ok = buckets.every((n) => Number.isFinite(n) && n > 0) && buckets.every((n, i) => i === 0 || n > buckets[i - 1]);
    if (!ok) issues.push(issue("WEEKLY_POOL_BUCKETS_INVALID", "Границы бакетов должны строго возрастать и быть положительными.", "goalsBuckets"));
  }
  return issues;
}

function validatePoolCount(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  validatePoolScope(input, ctx, issues);
  if (input.countMax != null) {
    const n = Math.floor(Number(input.countMax));
    if (!Number.isFinite(n) || n < 1 || n > 10) issues.push(issue("WEEKLY_POOL_COUNT_MAX_INVALID", "Максимум счётчика — от 1 до 10.", "countMax"));
  }
  return issues;
}

// ── Families M / O / L (league_of_week) — MIRRORS api-worker exactly ──────────
function buildTopMatchQuestion(input: WeeklyTemplateInput, calculation: string): BuiltWeeklyQuestion {
  const cands = (Array.isArray(input.matchOptions) ? input.matchOptions : [])
    .map((m) => ({ ref: asRef(m?.match_ref), label: asRef(m?.label) }))
    .filter((m) => m.ref.length > 0);
  const options: WeeklyBuiltOption[] = cands.map((c) => ({ id: `match_${c.ref}`, label: c.label || c.ref, match_ref: c.ref }));
  options.push({ id: "equal", label: "Равенство" });
  return { options, config: { template_key: input.templateKey, calculation, candidates: cands.map((c) => ({ match_ref: c.ref, label: c.label })), match_pool_only: true } };
}

function validateTopMatch(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const cands = (Array.isArray(input.matchOptions) ? input.matchOptions : []).filter((m) => asRef(m?.match_ref));
  if (cands.length < 2) issues.push(issue("WEEKLY_MAX_MIN_TWO", "Нужно минимум два матча-кандидата.", "matchOptions"));
  for (const m of cands) {
    const ref = asRef(m?.match_ref);
    if (ref && !refInPool(ctx, ref)) issues.push(issue("WEEKLY_MAX_MATCH_OUTSIDE_POOL", `Матч ${ref} не входит в пул.`, "matchOptions"));
  }
  return issues;
}

function buildOutcomeBalanceQuestion(input: WeeklyTemplateInput): BuiltWeeklyQuestion {
  const includeDraws = input.includeDraws === true;
  const options: WeeklyBuiltOption[] = [
    { id: "home_wins", label: "Больше побед хозяев" },
    { id: "away_wins", label: "Больше побед гостей" },
  ];
  if (includeDraws) options.push({ id: "draws", label: "Больше ничьих" });
  options.push({ id: "equal", label: "Поровну" });
  return { options, config: { template_key: input.templateKey, calculation: "outcome_balance", include_draws: includeDraws, scope: poolAggScope(input), match_pool_only: true } };
}

function validatePoolScopeOnly(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  validatePoolScope(input, ctx, issues);
  return issues;
}

function validateOutcomeBalance(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  validatePoolScope(input, ctx, issues);
  return issues;
}

function buildLeagueSliceQuestion(input: WeeklyTemplateInput, calculation: string): BuiltWeeklyQuestion {
  const leagues = (Array.isArray(input.leagues) ? input.leagues : [])
    .map((l) => ({ code: asRef(l?.code), label: asRef(l?.label) }))
    .filter((l) => l.code.length > 0);
  const options: WeeklyBuiltOption[] = leagues.map((l) => ({ id: `league_${l.code}`, label: l.label || l.code, code: l.code }));
  options.push({ id: "equal", label: "Равенство" });
  return { options, config: { template_key: input.templateKey, calculation, leagues, match_pool_only: true } };
}

function validateLeagueSlice(input: WeeklyTemplateInput, ctx: WeeklyTemplateContext): ValidationIssue[] {
  if (ctx.status !== "active") return [];
  const issues: ValidationIssue[] = [];
  const leagues = (Array.isArray(input.leagues) ? input.leagues : []).filter((l) => asRef(l?.code));
  if (leagues.length < 2) issues.push(issue("WEEKLY_LEAGUE_MIN_TWO", "Нужно минимум две лиги для сравнения.", "leagues"));
  const seen = new Set<string>();
  for (const l of leagues) {
    const code = asRef(l?.code);
    if (seen.has(code)) issues.push(issue("WEEKLY_LEAGUE_DUPLICATE", `Дублирующаяся лига: ${code}.`, "leagues"));
    seen.add(code);
  }
  return issues;
}

export const WEEKLY_QUESTION_TEMPLATES: WeeklyQuestionTemplate[] = [
  {
    templateKey: "match_result", questionKey: "match_of_week", title: "Кто победит в матче недели?",
    supportedModes: BOTH_MODES, answerMode: "three_way", fixedOptionIds: ["home", "draw", "away"],
    buildQuestion: (input) => buildSingleMatchQuestion(input, [
      { id: "home", label: asRef(input.homeTeamName) ? `Победа ${asRef(input.homeTeamName)}` : "Хозяева" },
      { id: "draw", label: "Ничья" },
      { id: "away", label: asRef(input.awayTeamName) ? `Победа ${asRef(input.awayTeamName)}` : "Гости" },
    ]),
    validate: validateSingleMatch,
  },
  {
    templateKey: "both_teams_to_score", questionKey: "match_of_week", title: "Обе команды забьют?",
    supportedModes: BOTH_MODES, answerMode: "binary", fixedOptionIds: ["yes", "no"],
    buildQuestion: (input) => buildSingleMatchQuestion(input, [{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }]),
    validate: validateSingleMatch,
  },
  {
    templateKey: "match_goals_range", questionKey: "match_of_week", title: "Сколько голов будет в матче?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["goals_0_1", "goals_2_3", "goals_4_plus"],
    buildQuestion: (input) => buildSingleMatchQuestion(input, RANGE_GOAL_OPTIONS.map((o) => ({ ...o }))),
    validate: validateSingleMatch,
  },
  {
    templateKey: "clean_sheet_win", questionKey: "match_of_week", title: "Будет ли «сухая» победа?",
    supportedModes: BOTH_MODES, answerMode: "three_way", fixedOptionIds: ["home_clean_win", "away_clean_win", "no"],
    buildQuestion: (input) => buildSingleMatchQuestion(input, [
      { id: "home_clean_win", label: asRef(input.homeTeamName) ? `${asRef(input.homeTeamName)} выиграет на ноль` : "Хозяева выиграют на ноль" },
      { id: "away_clean_win", label: asRef(input.awayTeamName) ? `${asRef(input.awayTeamName)} выиграет на ноль` : "Гости выиграют на ноль" },
      { id: "no", label: "Сухой победы не будет" },
    ], { calculation: "clean_sheet_win" }),
    validate: validateSingleMatch,
  },
  {
    templateKey: "group_highest_average_goals", questionKey: "league_of_week", title: "В какой группе матчей будет выше средняя результативность?",
    supportedModes: BOTH_MODES, answerMode: "groups", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildGroupQuestion(input, "average_goals_per_match"), validate: validateGroupTemplate,
  },
  {
    templateKey: "group_most_draws", questionKey: "league_of_week", title: "В какой группе матчей будет больше ничьих?",
    supportedModes: BOTH_MODES, answerMode: "groups", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildGroupQuestion(input, "draws_count"), validate: validateGroupTemplate,
  },
  {
    templateKey: "group_most_btts", questionKey: "league_of_week", title: "В какой группе матчей чаще забьют обе команды?",
    supportedModes: BOTH_MODES, answerMode: "groups", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildGroupQuestion(input, "btts_count"), validate: validateGroupTemplate,
  },
  {
    templateKey: "group_most_corners", questionKey: "league_of_week", title: "В какой группе матчей будет больше угловых?",
    supportedModes: BOTH_MODES, answerMode: "groups", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildGroupQuestion(input, "corners_count"), validate: validateGroupTemplate,
  },
  {
    templateKey: "pool_total_goals_bucket", questionKey: "league_of_week", title: "Каким будет тур по голам?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: [],
    buildQuestion: (input) => buildPoolGoalsBucketQuestion(input, "pool_total_goals"), validate: validatePoolGoalsBucket,
  },
  {
    templateKey: "pool_big_wins_count", questionKey: "league_of_week", title: "Сколько будет крупных побед (3+ разницы)?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: [],
    buildQuestion: (input) => buildPoolCountQuestion(input, "pool_big_wins"), validate: validatePoolCount,
  },
  {
    templateKey: "pool_btts_count", questionKey: "league_of_week", title: "Во скольких матчах забьют обе команды?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: [],
    buildQuestion: (input) => buildPoolCountQuestion(input, "pool_btts_count"), validate: validatePoolCount,
  },
  {
    templateKey: "pool_clean_sheets_count", questionKey: "league_of_week", title: "Сколько будет «сухих» матчей в туре?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: [],
    buildQuestion: (input) => buildPoolCountQuestion(input, "pool_clean_sheets"), validate: validatePoolCount,
  },
  {
    templateKey: "pool_biggest_margin", questionKey: "league_of_week", title: "Какой будет самая крупная разница в счёте?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["margin_0_1", "margin_2", "margin_3", "margin_4_plus"],
    buildQuestion: (input) => ({
      options: MARGIN_OPTIONS.map((o) => ({ ...o })),
      config: { template_key: input.templateKey, calculation: "pool_max_margin", scope: poolAggScope(input), match_pool_only: true },
    }),
    validate: validatePoolScopeOnly,
  },
  {
    templateKey: "pool_top_scoring_match", questionKey: "league_of_week", title: "Самый результативный матч тура",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildTopMatchQuestion(input, "top_scoring_match"), validate: validateTopMatch,
  },
  {
    templateKey: "pool_outcome_balance", questionKey: "league_of_week", title: "Чего в туре будет больше — побед хозяев или гостей?",
    supportedModes: BOTH_MODES, answerMode: "three_way", fixedOptionIds: ["home_wins", "away_wins", "equal"],
    buildQuestion: buildOutcomeBalanceQuestion, validate: validateOutcomeBalance,
  },
  {
    templateKey: "league_top_scoring", questionKey: "league_of_week", title: "Самая забивная лига тура",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildLeagueSliceQuestion(input, "league_total_goals"), validate: validateLeagueSlice,
  },
  {
    templateKey: "league_most_home_wins", questionKey: "league_of_week", title: "В какой лиге больше побед хозяев?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["equal"],
    buildQuestion: (input) => buildLeagueSliceQuestion(input, "league_home_wins"), validate: validateLeagueSlice,
  },
  {
    templateKey: "player_goals_duel", questionKey: "duel_of_week", title: "Кто забьёт больше голов на этой неделе?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["player_a", "player_b", "equal"],
    buildQuestion: buildDuelQuestion, validate: validateDuelTemplate,
  },
  {
    templateKey: "team_goals_duel", questionKey: "duel_of_week", title: "Какая команда забьёт больше?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["player_a", "player_b", "equal"],
    buildQuestion: buildDuelQuestion, validate: validateDuelTemplate,
  },
  {
    templateKey: "player_vs_team_goals", questionKey: "duel_of_week", title: "Кто забьёт больше: игрок или команда?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["player_a", "player_b", "equal"],
    buildQuestion: buildDuelQuestion, validate: validateDuelTemplate,
  },
  {
    templateKey: "team_conceded_duel", questionKey: "duel_of_week", title: "Какая команда пропустит меньше?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["player_a", "player_b", "equal"],
    buildQuestion: (input) => {
      const built = buildDuelQuestion(input);
      built.config.calculation = "goals_conceded_fewer";
      built.config.void_if_player_did_not_play = false;
      return built;
    },
    validate: (input, ctx) => validateDuelTemplate(input, ctx, { teamsOnly: true }),
  },
  {
    templateKey: "underdog_not_lose", questionKey: "upset_of_week", title: "Кто из андердогов не проиграет?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["no_upset"],
    buildQuestion: (input) => buildUpsetCandidateQuestion(input, "Сенсаций не будет"), validate: validateUpsetCandidates,
  },
  {
    templateKey: "favorite_drops_points", questionKey: "upset_of_week", title: "Какой фаворит потеряет очки?",
    supportedModes: BOTH_MODES, answerMode: "entities", fixedOptionIds: ["no_upset"],
    buildQuestion: (input) => buildUpsetCandidateQuestion(input, "Все фавориты победят"), validate: validateUpsetCandidates,
  },
  {
    templateKey: "upset_count", questionKey: "upset_of_week", title: "Сколько будет сенсаций?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["count_0", "count_1", "count_2", "count_3_plus"],
    buildQuestion: (input) => {
      const matches = (Array.isArray(input.upsetCountMatches) ? input.upsetCountMatches : [])
        .map((m) => ({ match_ref: asRef(m?.match_ref) || null, favorite_side: m?.favorite_side === "away" ? "away" : "home" }))
        .filter((m) => m.match_ref);
      return { options: COUNT_OPTIONS.map((o) => ({ ...o })), config: { template_key: "upset_count", matches, match_pool_only: true } };
    },
    validate: (input, ctx) => {
      if (ctx.status !== "active") return [];
      const issues: ValidationIssue[] = [];
      const matches = (Array.isArray(input.upsetCountMatches) ? input.upsetCountMatches : []).filter((m) => asRef(m?.match_ref));
      if (matches.length < 1) issues.push(issue("WEEKLY_UPSET_COUNT_NEEDS_MATCH", "Отметьте хотя бы один матч с фаворитом.", "upsetCountMatches"));
      for (const m of matches) {
        const ref = asRef(m?.match_ref);
        if (ref && !refInPool(ctx, ref)) issues.push(issue("WEEKLY_UPSET_COUNT_MATCH_OUTSIDE_POOL", `Матч ${ref} не входит в пул.`, "upsetCountMatches"));
      }
      return issues;
    },
  },
  {
    templateKey: "any_five_plus_goals", questionKey: "event_of_week", title: "Будет ли хотя бы один матч с 5+ голами?",
    supportedModes: BOTH_MODES, answerMode: "binary", fixedOptionIds: ["yes", "no"],
    buildQuestion: (input) => buildScopedEventQuestion(input, [{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }], "any_five_plus_goals"),
    validate: validateScopedEvent,
  },
  {
    templateKey: "any_zero_zero", questionKey: "event_of_week", title: "Будет ли матч 0:0?",
    supportedModes: BOTH_MODES, answerMode: "binary", fixedOptionIds: ["yes", "no"],
    buildQuestion: (input) => buildScopedEventQuestion(input, [{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }], "any_zero_zero"),
    validate: validateScopedEvent,
  },
  {
    templateKey: "draws_count_event", questionKey: "event_of_week", title: "Сколько матчей завершатся вничью?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["count_0", "count_1", "count_2", "count_3_plus"],
    buildQuestion: (input) => buildScopedEventQuestion(input, COUNT_OPTIONS.map((o) => ({ ...o })), "draws_count"),
    validate: validateScopedEvent,
  },
  {
    templateKey: "any_red_card", questionKey: "event_of_week", title: "Будет ли красная карточка?",
    supportedModes: BOTH_MODES, answerMode: "binary", fixedOptionIds: ["yes", "no"],
    buildQuestion: (input) => buildScopedEventQuestion(input, [{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }], "any_red_card"),
    validate: validateScopedEvent,
  },
  {
    templateKey: "red_cards_count", questionKey: "event_of_week", title: "Сколько будет удалений?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["count_0", "count_1", "count_2", "count_3_plus"],
    buildQuestion: (input) => buildScopedEventQuestion(input, COUNT_OPTIONS.map((o) => ({ ...o })), "red_cards_count"),
    validate: validateScopedEvent,
  },
  {
    templateKey: "fastest_goal_window", questionKey: "event_of_week", title: "На какой минуте забьют самый быстрый гол?",
    supportedModes: BOTH_MODES, answerMode: "range", fixedOptionIds: ["first_goal_1_5", "first_goal_6_15", "first_goal_16_plus", "no_goals"],
    buildQuestion: (input) => buildScopedEventQuestion(input, FASTEST_GOAL_OPTIONS.map((o) => ({ ...o })), "fastest_goal_minute"),
    validate: validateScopedEvent,
  },
];

const TEMPLATE_BY_KEY = new Map<string, WeeklyQuestionTemplate>(WEEKLY_QUESTION_TEMPLATES.map((t) => [t.templateKey, t]));

export function getWeeklyTemplate(templateKey: unknown): WeeklyQuestionTemplate | null {
  const key = templateKey == null ? "" : String(templateKey).trim();
  return key ? TEMPLATE_BY_KEY.get(key) || null : null;
}

export function listWeeklyTemplatesForQuestion(questionKey: WeeklyQuestionKey): WeeklyQuestionTemplate[] {
  return WEEKLY_QUESTION_TEMPLATES.filter((t) => t.questionKey === questionKey);
}

export function listWeeklyTemplatesForMode(questionKey: WeeklyQuestionKey, mode: WeeklyResolvedMode): WeeklyQuestionTemplate[] {
  const all = listWeeklyTemplatesForQuestion(questionKey);
  if (mode === "unspecified") return all;
  return all.filter((t) => t.supportedModes.includes(mode));
}

export function resolveWeeklyCompetitionMode(settings: unknown): WeeklyResolvedMode {
  const raw = (settings && typeof settings === "object" && !Array.isArray(settings)) ? (settings as Record<string, unknown>).competition_mode : null;
  const v = raw == null ? "" : String(raw).trim();
  if (v === "club") return "club";
  if (v === "national_team") return "national_team";
  return "unspecified";
}

export function weeklyTemplateRegistrySnapshot(): Array<{
  templateKey: string;
  questionKey: string;
  supportedModes: string[];
  answerMode: string;
  fixedOptionIds: string[];
}> {
  return WEEKLY_QUESTION_TEMPLATES.map((t) => ({
    templateKey: t.templateKey,
    questionKey: t.questionKey,
    supportedModes: [...t.supportedModes],
    answerMode: t.answerMode,
    fixedOptionIds: [...t.fixedOptionIds],
  }));
}

// ── Serializable manifest (parity contract — MUST mirror api-worker exactly) ──
export type WeeklyTemplateManifestEntry = {
  templateKey: string;
  questionKey: WeeklyQuestionKey;
  supportedModes: WeeklyCompetitionMode[];
  answerMode: string;
  optionIds: string[];
  defaultTitle: string;
  validationRuleIds: string[];
  calculationKey: string | null;
  tieBehavior: string | null;
  voidRuleKey: string | null;
  scopeMode: string | null;
  fallbackOptionId: string | null;
  minGroups: number | null;
  maxGroups: number | null;
  minEntities: number | null;
  maxEntities: number | null;
};

type WeeklyTemplateMeta = Omit<WeeklyTemplateManifestEntry, "templateKey" | "questionKey" | "supportedModes" | "answerMode" | "optionIds" | "defaultTitle">;

const SINGLE_MATCH_RULES = ["WEEKLY_MATCH_REQUIRED", "WEEKLY_MATCH_OUTSIDE_POOL"];
const GROUP_RULES = ["WEEKLY_GROUP_MIN_TWO", "WEEKLY_GROUP_MAX_FIVE", "WEEKLY_GROUP_DUPLICATE_ID", "WEEKLY_GROUP_TITLE_REQUIRED", "WEEKLY_GROUP_NEEDS_MATCH", "WEEKLY_GROUP_MATCH_OUTSIDE_POOL", "WEEKLY_GROUP_MATCH_OVERLAP"];
const DUEL_RULES = ["WEEKLY_DUEL_SIDE_A_REQUIRED", "WEEKLY_DUEL_SIDE_B_REQUIRED", "WEEKLY_DUEL_SIDES_IDENTICAL", "WEEKLY_DUEL_MATCH_OUTSIDE_POOL"];
const UPSET_RULES = ["WEEKLY_UPSET_MIN_TWO", "WEEKLY_UPSET_MAX_FIVE", "WEEKLY_UPSET_MATCH_OUTSIDE_POOL"];
const UPSET_COUNT_RULES = ["WEEKLY_UPSET_COUNT_NEEDS_MATCH", "WEEKLY_UPSET_COUNT_MATCH_OUTSIDE_POOL"];
const EVENT_RULES = ["WEEKLY_EVENT_SCOPE_EMPTY", "WEEKLY_EVENT_MATCH_OUTSIDE_POOL"];
const POOL_SCOPE_RULES = ["WEEKLY_POOL_SCOPE_EMPTY", "WEEKLY_POOL_MATCH_OUTSIDE_POOL"];
const POOL_GOALS_RULES = [...POOL_SCOPE_RULES, "WEEKLY_POOL_BUCKETS_INVALID"];
const POOL_COUNT_RULES = [...POOL_SCOPE_RULES, "WEEKLY_POOL_COUNT_MAX_INVALID"];
const POOL_MAX_RULES = ["WEEKLY_MAX_MIN_TWO", "WEEKLY_MAX_MATCH_OUTSIDE_POOL"];
const LEAGUE_RULES = ["WEEKLY_LEAGUE_MIN_TWO", "WEEKLY_LEAGUE_DUPLICATE"];
const DUEL_TEAMS_RULES = [...DUEL_RULES, "WEEKLY_DUEL_TEAMS_ONLY"];

export const WEEKLY_TEMPLATE_META: Record<WeeklyTemplateKey, WeeklyTemplateMeta> = {
  match_result: { validationRuleIds: SINGLE_MATCH_RULES, calculationKey: null, tieBehavior: null, voidRuleKey: null, scopeMode: "single_match", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  both_teams_to_score: { validationRuleIds: SINGLE_MATCH_RULES, calculationKey: null, tieBehavior: null, voidRuleKey: null, scopeMode: "single_match", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  match_goals_range: { validationRuleIds: SINGLE_MATCH_RULES, calculationKey: null, tieBehavior: null, voidRuleKey: null, scopeMode: "single_match", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  group_highest_average_goals: { validationRuleIds: GROUP_RULES, calculationKey: "average_goals_per_match", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "groups", fallbackOptionId: null, minGroups: GROUP_MIN, maxGroups: GROUP_MAX, minEntities: null, maxEntities: null },
  group_most_draws: { validationRuleIds: GROUP_RULES, calculationKey: "draws_count", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "groups", fallbackOptionId: null, minGroups: GROUP_MIN, maxGroups: GROUP_MAX, minEntities: null, maxEntities: null },
  group_most_btts: { validationRuleIds: GROUP_RULES, calculationKey: "btts_count", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "groups", fallbackOptionId: null, minGroups: GROUP_MIN, maxGroups: GROUP_MAX, minEntities: null, maxEntities: null },
  player_goals_duel: { validationRuleIds: DUEL_RULES, calculationKey: null, tieBehavior: "equal_option", voidRuleKey: "player_zero_minutes", scopeMode: "duel", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: 2 },
  team_goals_duel: { validationRuleIds: DUEL_RULES, calculationKey: null, tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "duel", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: 2 },
  player_vs_team_goals: { validationRuleIds: DUEL_RULES, calculationKey: null, tieBehavior: "equal_option", voidRuleKey: "player_zero_minutes", scopeMode: "duel", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: 2 },
  underdog_not_lose: { validationRuleIds: UPSET_RULES, calculationKey: null, tieBehavior: null, voidRuleKey: null, scopeMode: "entities", fallbackOptionId: "no_upset", minGroups: null, maxGroups: null, minEntities: UPSET_MIN, maxEntities: UPSET_MAX },
  favorite_drops_points: { validationRuleIds: UPSET_RULES, calculationKey: null, tieBehavior: null, voidRuleKey: null, scopeMode: "entities", fallbackOptionId: "no_upset", minGroups: null, maxGroups: null, minEntities: UPSET_MIN, maxEntities: UPSET_MAX },
  upset_count: { validationRuleIds: UPSET_COUNT_RULES, calculationKey: "upset_count", tieBehavior: null, voidRuleKey: null, scopeMode: "marked_matches", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  any_five_plus_goals: { validationRuleIds: EVENT_RULES, calculationKey: "any_five_plus_goals", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  any_zero_zero: { validationRuleIds: EVENT_RULES, calculationKey: "any_zero_zero", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  draws_count_event: { validationRuleIds: EVENT_RULES, calculationKey: "draws_count", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  pool_total_goals_bucket: { validationRuleIds: POOL_GOALS_RULES, calculationKey: "pool_total_goals", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  pool_big_wins_count: { validationRuleIds: POOL_COUNT_RULES, calculationKey: "pool_big_wins", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  pool_btts_count: { validationRuleIds: POOL_COUNT_RULES, calculationKey: "pool_btts_count", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  pool_clean_sheets_count: { validationRuleIds: POOL_COUNT_RULES, calculationKey: "pool_clean_sheets", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  pool_top_scoring_match: { validationRuleIds: POOL_MAX_RULES, calculationKey: "top_scoring_match", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "pool_candidates", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: null },
  pool_outcome_balance: { validationRuleIds: POOL_SCOPE_RULES, calculationKey: "outcome_balance", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  league_top_scoring: { validationRuleIds: LEAGUE_RULES, calculationKey: "league_total_goals", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "league_slice", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: null },
  league_most_home_wins: { validationRuleIds: LEAGUE_RULES, calculationKey: "league_home_wins", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "league_slice", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: null },
  clean_sheet_win: { validationRuleIds: SINGLE_MATCH_RULES, calculationKey: "clean_sheet_win", tieBehavior: null, voidRuleKey: null, scopeMode: "single_match", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  group_most_corners: { validationRuleIds: GROUP_RULES, calculationKey: "corners_count", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "groups", fallbackOptionId: null, minGroups: GROUP_MIN, maxGroups: GROUP_MAX, minEntities: null, maxEntities: null },
  pool_biggest_margin: { validationRuleIds: POOL_SCOPE_RULES, calculationKey: "pool_max_margin", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_aggregate", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  team_conceded_duel: { validationRuleIds: DUEL_TEAMS_RULES, calculationKey: "goals_conceded_fewer", tieBehavior: "equal_option", voidRuleKey: null, scopeMode: "duel", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: 2, maxEntities: 2 },
  any_red_card: { validationRuleIds: EVENT_RULES, calculationKey: "any_red_card", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  red_cards_count: { validationRuleIds: EVENT_RULES, calculationKey: "red_cards_count", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: null, minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
  fastest_goal_window: { validationRuleIds: EVENT_RULES, calculationKey: "fastest_goal_minute", tieBehavior: null, voidRuleKey: null, scopeMode: "pool_or_selected", fallbackOptionId: "no_goals", minGroups: null, maxGroups: null, minEntities: null, maxEntities: null },
};

export function weeklyTemplateManifest(): WeeklyTemplateManifestEntry[] {
  return WEEKLY_QUESTION_TEMPLATES.map((t) => ({
    templateKey: t.templateKey,
    questionKey: t.questionKey,
    supportedModes: [...t.supportedModes],
    answerMode: t.answerMode,
    optionIds: [...t.fixedOptionIds],
    defaultTitle: t.title,
    ...WEEKLY_TEMPLATE_META[t.templateKey],
    validationRuleIds: [...WEEKLY_TEMPLATE_META[t.templateKey].validationRuleIds],
  }));
}
