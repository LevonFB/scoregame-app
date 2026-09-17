// seasonPredictionWeeklyLifecycle.ts
// Pure lifecycle + schedule + activation validation for "Вызов недели" (W1).
// No I/O, no DB, no scoring/rewards/tasks. Backend is the source of truth; the web
// admin mirrors the small MSK datetime helpers (kept identical, tested here).

// ── MSK ↔ Unix seconds (no DST: MSK is a fixed UTC+3) ────────────────────────
export const MSK_UTC_OFFSET_SECONDS = 3 * 3600;

// "YYYY-MM-DDTHH:mm" (a datetime-local value the admin typed, meant as MSK wall
// clock) → Unix seconds. Browser timezone is irrelevant (we never call Date.parse
// on a tz-less string). Returns null for empty/invalid input.
export function parseMskDateTimeLocalToUnixSeconds(value: unknown): number | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
  if (Number.isNaN(utcMs)) return null;
  return Math.floor(utcMs / 1000) - MSK_UTC_OFFSET_SECONDS;
}

// Unix seconds → "YYYY-MM-DDTHH:mm" MSK wall clock for a datetime-local input.
// Uses getUTC* on a shifted epoch, so the admin's browser timezone never matters.
export function formatUnixSecondsForMskDateTimeLocal(unix: unknown): string {
  if (unix === null || unix === undefined || unix === "") return "";
  const n = Number(unix);
  if (!Number.isFinite(n)) return "";
  const d = new Date((n + MSK_UTC_OFFSET_SECONDS) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// ── Schedule order validation ────────────────────────────────────────────────
export type WeeklySchedule = {
  openAt: number | null;
  deadlineAt: number | null;
  closeAt: number | null;
};

function assertValidOptionalTimestamp(value: number | null, code: string): void {
  if (value === null) return;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new Error(code);
}

/**
 * Validate the open/deadline/close ordering. Pure; throws stable coded errors.
 * Semantics: open < deadline (strict), deadline <= close (close may equal deadline),
 * open < close. Missing (null) values are skipped — partial schedules are allowed.
 * Never silently reorders.
 *
 * Codes: WEEKLY_INVALID_OPEN_AT | WEEKLY_INVALID_DEADLINE_AT | WEEKLY_INVALID_CLOSE_AT
 *        | WEEKLY_INVALID_DATE_ORDER
 */
export function validateWeeklyChallengeSchedule(s: WeeklySchedule): void {
  assertValidOptionalTimestamp(s.openAt, "WEEKLY_INVALID_OPEN_AT");
  assertValidOptionalTimestamp(s.deadlineAt, "WEEKLY_INVALID_DEADLINE_AT");
  assertValidOptionalTimestamp(s.closeAt, "WEEKLY_INVALID_CLOSE_AT");

  if (s.openAt !== null && s.deadlineAt !== null && !(s.openAt < s.deadlineAt)) {
    throw new Error("WEEKLY_INVALID_DATE_ORDER");
  }
  if (s.deadlineAt !== null && s.closeAt !== null && !(s.deadlineAt <= s.closeAt)) {
    throw new Error("WEEKLY_INVALID_DATE_ORDER");
  }
  if (s.openAt !== null && s.closeAt !== null && !(s.openAt < s.closeAt)) {
    throw new Error("WEEKLY_INVALID_DATE_ORDER");
  }
}

// ── Lifecycle status transitions ─────────────────────────────────────────────
export type WeeklyChallengeStatus = "draft" | "active" | "locked" | "scoring" | "completed" | "archived";

// Forward flow + the only two intentional soft rollbacks:
//   active → draft  (unpublish before users rely on it)
//   locked → active (reopen intake before scoring)
// Neither rollback touches scores/entries/rewards. Everything else is rejected.
export const WEEKLY_CHALLENGE_STATUS_TRANSITIONS: Record<WeeklyChallengeStatus, WeeklyChallengeStatus[]> = {
  draft: ["active"],
  active: ["locked", "draft"],
  locked: ["scoring", "active"],
  scoring: ["completed"],
  completed: ["archived"],
  archived: [],
};

export function canTransitionWeeklyChallengeStatus(from: string, to: string): boolean {
  if (from === to) return true; // no-op (PUT without a status change)
  const allowed = WEEKLY_CHALLENGE_STATUS_TRANSITIONS[from as WeeklyChallengeStatus];
  return Array.isArray(allowed) && (allowed as string[]).includes(to);
}

// ── Activation: questions + options + match_ref ──────────────────────────────
export const WEEKLY_ACTIVATION_QUESTION_KEYS = [
  "match_of_week",
  "league_of_week",
  "duel_of_week",
  "upset_of_week",
  "event_of_week",
] as const;

// Per-key required option ids (only checked when the question is active).
export const WEEKLY_REQUIRED_OPTION_IDS: Record<string, string[]> = {
  upset_of_week: ["no_upset"],
  duel_of_week: ["player_a", "player_b", "equal"],
};

// Template-level override of the per-key requirement. Some templates legitimately
// emit a different fixed option set (upset_count is a range question: count_0…count_3_plus,
// no "no_upset" fallback), so the per-key rule must not apply to them.
export const WEEKLY_REQUIRED_OPTION_IDS_BY_TEMPLATE: Record<string, string[]> = {
  upset_count: [],
};

export type WeeklyActivationQuestion = {
  question_key: string;
  status: string;
  options: Array<{ id?: unknown }>;
  config?: any;
};

/**
 * Validate that the active questions are activation-ready. Pure; throws coded errors.
 * Codes: WEEKLY_CHALLENGE_ACTIVE_REQUIRES_5_ACTIVE_QUESTIONS:<missing>
 *        WEEKLY_QUESTION_NEEDS_AT_LEAST_TWO_OPTIONS:<key>
 *        WEEKLY_QUESTION_OPTION_DUPLICATE_ID:<key>
 *        WEEKLY_QUESTION_MISSING_REQUIRED_OPTION:<key>:<optionId>
 */
export function validateWeeklyActivationQuestions(questions: WeeklyActivationQuestion[]): void {
  const activeByKey = new Map<string, WeeklyActivationQuestion>();
  for (const q of questions) {
    if (String(q.status) === "active") activeByKey.set(String(q.question_key), q);
  }

  const missing = WEEKLY_ACTIVATION_QUESTION_KEYS.filter((k) => !activeByKey.has(k));
  if (missing.length > 0) {
    throw new Error(`WEEKLY_CHALLENGE_ACTIVE_REQUIRES_5_ACTIVE_QUESTIONS:${missing.join(",")}`);
  }

  for (const key of WEEKLY_ACTIVATION_QUESTION_KEYS) {
    const q = activeByKey.get(key)!;
    const ids = (q.options || []).map((o) => String(o?.id ?? "").trim()).filter((id) => id.length > 0);
    if (ids.length < 2) throw new Error(`WEEKLY_QUESTION_NEEDS_AT_LEAST_TWO_OPTIONS:${key}`);
    if (new Set(ids).size !== ids.length) throw new Error(`WEEKLY_QUESTION_OPTION_DUPLICATE_ID:${key}`);
    const templateKey = String(q.config?.template_key ?? "").trim();
    const required = (templateKey && Object.prototype.hasOwnProperty.call(WEEKLY_REQUIRED_OPTION_IDS_BY_TEMPLATE, templateKey))
      ? WEEKLY_REQUIRED_OPTION_IDS_BY_TEMPLATE[templateKey]
      : (WEEKLY_REQUIRED_OPTION_IDS[key] || []);
    for (const reqId of required) {
      if (!ids.includes(reqId)) throw new Error(`WEEKLY_QUESTION_MISSING_REQUIRED_OPTION:${key}:${reqId}`);
    }
  }
}

// Valid match references = every pool match's match_id plus the synthetic "pool_N"
// the admin UI uses for matches without an external id (N = 1-based pool order).
export function buildWeeklyPoolRefSet(matches: Array<{ match_id?: unknown }>): Set<string> {
  const set = new Set<string>();
  matches.forEach((m, i) => {
    const id = m?.match_id == null ? "" : String(m.match_id).trim();
    if (id) set.add(id);
    set.add(`pool_${i + 1}`);
  });
  return set;
}

// ── W2: question edit-state + structural-change detection ────────────────────

export type WeeklyEditState = "unused" | "has_drafts" | "has_submissions" | "has_scores";

// Resolve the edit state from entry/score counts. Order matters (most-locking wins).
export function resolveWeeklyEditState(counts: { drafts: number; submitted: number; scores: number }): WeeklyEditState {
  if (Number(counts.scores) > 0) return "has_scores";
  if (Number(counts.submitted) > 0) return "has_submissions";
  if (Number(counts.drafts) > 0) return "has_drafts";
  return "unused";
}

// Structural edits are only safe before anyone has interacted (no entries at all).
// drafts already hold option ids, so they lock structure too.
export function weeklyEditStateAllowsStructural(state: WeeklyEditState): boolean {
  return state === "unused";
}

// Fields that never affect a stored answer's meaning.
export const WEEKLY_QUESTION_DISPLAY_ONLY_FIELDS = new Set(["title", "description", "sort_order"]);

export type WeeklyQuestionStructure = {
  question_key: string;
  question_type: string;
  status: string;
  title: string;
  description: string | null;
  sort_order: number;
  options: Array<{ id?: unknown; label?: unknown }>;
  config: any;
};

export type WeeklyQuestionDiff = {
  changed_fields: string[];
  structural_fields: string[];
  display_only: boolean;
  structural: boolean;
};

function normalizeOptionPairs(options: Array<{ id?: unknown; label?: unknown }>): Array<{ id: string; label: string }> {
  return (options || []).map((o) => ({ id: String(o?.id ?? ""), label: String(o?.label ?? "") }));
}

// Deterministic JSON (sorted keys) so config comparison ignores key order.
function stableStringify(value: any): string {
  const seen = new WeakSet();
  const walk = (v: any): any => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  try {
    return JSON.stringify(walk(value));
  } catch {
    return "";
  }
}

/**
 * Compare two versions of a question and classify what changed. Pure.
 * Display-only: title, description, sort_order.
 * Structural: question_key, question_type, status, option ids (add/remove/rename),
 *             option labels, config. After any user interaction an option-label
 *             change is structural too (the user picked by the shown text).
 */
export function compareWeeklyQuestionStructure(prev: WeeklyQuestionStructure, next: WeeklyQuestionStructure): WeeklyQuestionDiff {
  const changed: string[] = [];
  if ((prev.title ?? "") !== (next.title ?? "")) changed.push("title");
  if ((prev.description ?? null) !== (next.description ?? null)) changed.push("description");
  if (Number(prev.sort_order ?? 0) !== Number(next.sort_order ?? 0)) changed.push("sort_order");
  if (String(prev.question_key) !== String(next.question_key)) changed.push("question_key");
  if (String(prev.question_type || "single_select") !== String(next.question_type || "single_select")) changed.push("question_type");
  if (String(prev.status || "active") !== String(next.status || "active")) changed.push("status");

  const prevOpts = normalizeOptionPairs(prev.options);
  const nextOpts = normalizeOptionPairs(next.options);
  const prevIds = prevOpts.map((o) => o.id).join("");
  const nextIds = nextOpts.map((o) => o.id).join("");
  if (prevIds !== nextIds) {
    changed.push("option_ids");
  } else if (prevOpts.some((o, i) => o.label !== nextOpts[i].label)) {
    changed.push("option_labels");
  }

  if (stableStringify(prev.config ?? {}) !== stableStringify(next.config ?? {})) changed.push("config");

  const structural_fields = changed.filter((f) => !WEEKLY_QUESTION_DISPLAY_ONLY_FIELDS.has(f));
  return {
    changed_fields: changed,
    structural_fields,
    structural: structural_fields.length > 0,
    display_only: structural_fields.length === 0,
  };
}

/**
 * Whether a previously set official answer survives the new options. Pure.
 * pending/void are unaffected. A confirmed answer must still point at an existing
 * option id, otherwise the edit would silently invalidate the official result.
 */
export function weeklyOfficialAnswerStillValid(
  officialStatus: string,
  officialOptionId: string | null,
  nextOptionIds: string[],
  // Multi-answer questions: every accepted id must survive the new option set,
  // otherwise part of the confirmed answer would silently disappear.
  officialOptionIds?: string[] | null,
): boolean {
  if (String(officialStatus) !== "confirmed") return true;
  const many = Array.isArray(officialOptionIds) ? officialOptionIds.filter((id) => id != null && String(id) !== "") : [];
  if (many.length > 0) return many.every((id) => nextOptionIds.includes(String(id)));
  if (!officialOptionId) return false;
  return nextOptionIds.includes(String(officialOptionId));
}

// ── W4: recalc lifecycle policy ──────────────────────────────────────────────

// Recalc is only allowed once intake is closed. `active`/`draft`/`archived` are
// rejected so an admin must explicitly lock the challenge first.
export const WEEKLY_RECALC_ALLOWED_STATUSES = ["locked", "scoring", "completed"] as const;

export function canRecalcWeeklyChallenge(status: string): boolean {
  return (WEEKLY_RECALC_ALLOWED_STATUSES as readonly string[]).includes(String(status));
}

// Final challenge status after a recalc run: only `completed` on a clean run,
// otherwise stay in `scoring` so a re-run can finish the failed entries.
export function weeklyRecalcFinalStatus(result: { failed: number }): "scoring" | "completed" {
  return Number(result.failed) > 0 ? "scoring" : "completed";
}

// A `running` recalc log older than this is considered abandoned (so a stuck run
// never blocks recalc forever).
export const WEEKLY_RECALC_RUNNING_STALE_SECONDS = 600;

export function isWeeklyRecalcRunningStale(
  startedAt: number | null | undefined,
  nowSeconds: number,
  timeoutSeconds = WEEKLY_RECALC_RUNNING_STALE_SECONDS,
): boolean {
  if (startedAt == null) return true;
  return nowSeconds - Number(startedAt) > timeoutSeconds;
}

/**
 * Whether stored scores are stale relative to the official answers. Pure.
 * - no scores yet            → not stale (nothing computed)
 * - scores but no recalc log → stale (cannot prove they are current)
 * - official updated after the last completed recalc → stale
 */
export function weeklyChallengeResultsAreStale(input: {
  officialUpdatedAt: number | null;
  lastRecalcAt: number | null;
  hasScores: boolean;
}): boolean {
  if (!input.hasScores) return false;
  if (input.lastRecalcAt == null) return true;
  if (input.officialUpdatedAt == null) return false;
  return Number(input.officialUpdatedAt) > Number(input.lastRecalcAt);
}

// ── Safe deletion eligibility ────────────────────────────────────────────────
// Permanent deletion is allowed only for a draft / archived challenge that carries NO
// user or financial history. Pure; backend remains the source of truth. Returns the
// first blocking reason (stable error code) or null when deletion is permitted.
export const WEEKLY_CHALLENGE_DELETABLE_STATUSES = ["draft", "archived"] as const;

export type WeeklyChallengeDeletionCounts = {
  entries: number;
  claims: number;
  rewards: number;
  scores: number;
};

export function evaluateWeeklyChallengeDeletion(
  status: string,
  counts: WeeklyChallengeDeletionCounts,
): { deletable: boolean; error: string | null } {
  if (!(WEEKLY_CHALLENGE_DELETABLE_STATUSES as readonly string[]).includes(String(status))) {
    return { deletable: false, error: "WEEKLY_CHALLENGE_DELETE_FORBIDDEN_STATUS" };
  }
  if (Number(counts.entries) > 0) return { deletable: false, error: "WEEKLY_CHALLENGE_DELETE_HAS_ENTRIES" };
  if (Number(counts.claims) > 0) return { deletable: false, error: "WEEKLY_CHALLENGE_DELETE_HAS_CLAIMS" };
  if (Number(counts.rewards) > 0) return { deletable: false, error: "WEEKLY_CHALLENGE_DELETE_HAS_REWARDS" };
  if (Number(counts.scores) > 0) return { deletable: false, error: "WEEKLY_CHALLENGE_DELETE_HAS_DEPENDENCIES" };
  return { deletable: true, error: null };
}

// Find the first active question whose config/option match_ref is not in the pool.
// Returns null when every present match_ref resolves. Pure.
export function findWeeklyQuestionMatchRefNotInPool(
  questions: WeeklyActivationQuestion[],
  poolRefs: Set<string>,
): { question_key: string; match_ref: string } | null {
  for (const q of questions) {
    if (String(q.status) !== "active") continue;
    const refs: string[] = [];
    const top = q.config?.match_ref;
    if (top != null && String(top).trim()) refs.push(String(top).trim());
    for (const o of (q.options || []) as Array<{ match_ref?: unknown }>) {
      const r = o?.match_ref;
      if (r != null && String(r).trim()) refs.push(String(r).trim());
    }
    for (const r of refs) {
      if (!poolRefs.has(r)) return { question_key: q.question_key, match_ref: r };
    }
  }
  return null;
}
