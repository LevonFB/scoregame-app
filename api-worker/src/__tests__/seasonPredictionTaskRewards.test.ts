import { describe, it, expect } from "vitest";
import {
  buildSeasonTaskRewardCatalog,
  seasonTaskRewardCatalog,
  getTaskRewardCatalogEntry,
  validateTaskRewardConfigInput,
  effectiveTaskReward,
  rewardIsActive,
  rewardForPayload,
  taskClaimStatus,
  resolveTaskClaim,
  taskClaimUniqueKeyBase,
  taskKeyFromClaimUniqueKey,
  computeSeedInserts,
  countClaimableTasks,
  theoreticalMaxRewards,
  buildTaskRewardWarnings,
  buildSeasonTaskClaimableSummary,
  seasonTaskSortRank,
  TASK_REWARD_WARN_LIMITS,
  SEASON_TASK_REWARD_PREMIUM_CASE,
  type TaskRewardConfig,
  type TaskRewardSpec,
  type TaskRewardMaxSummary,
  type ClaimableSummaryTask,
} from "../seasonPredictionTaskRewards";

const CASES = new Set(["premium", "daily_free"]);

function cfg(taskKey: string, p: Partial<TaskRewardConfig>): TaskRewardConfig {
  return {
    task_key: taskKey, enabled: false, balls: 0, stars: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0,
    title_override: null, admin_note: null, ...p,
  };
}
const active = (balls: number, stars = 0): TaskRewardSpec => ({ enabled: true, balls, stars, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });

// ── Catalog integrity ─────────────────────────────────────────────────────────
describe("catalog", () => {
  it("has unique task keys and covers all 3 cups + 5 leagues", () => {
    const cat = buildSeasonTaskRewardCatalog();
    const keys = cat.map((e) => e.task_key);
    expect(new Set(keys).size).toBe(keys.length); // no dupes
    expect(cat.some((e) => e.task_key === "ek_res_UCL_ties_6")).toBe(true);
    expect(cat.some((e) => e.task_key === "ek_res_UEL_champion")).toBe(true);
    expect(cat.some((e) => e.task_key === "top5_PL_submit_prediction")).toBe(true);
  });
  it("eurocup ties/bracket/result tasks carry the matching phase", () => {
    expect(getTaskRewardCatalogEntry("ek_ties_UCL_fill")?.phase).toBe("ties");
    expect(getTaskRewardCatalogEntry("ek_bracket_UCL_fill")?.phase).toBe("bracket");
    expect(getTaskRewardCatalogEntry("ek_res_UCL_total_200")?.phase).toBe("result");
    expect(getTaskRewardCatalogEntry("ek_res_UCL_champion")?.phase).toBe("bracket");
    expect(getTaskRewardCatalogEntry("ek_res_UCL_ties_8")?.phase).toBe("ties");
  });
  it("starter defaults match the spec for sample tasks", () => {
    // E10.4 lowered starter defaults.
    expect(getTaskRewardCatalogEntry("ek_ties_UCL_fill")?.default).toMatchObject({ enabled: true, balls: 1, stars: 0 });
    expect(getTaskRewardCatalogEntry("ek_res_UCL_ties_6")?.default).toMatchObject({ balls: 1, stars: 1 });
    expect(getTaskRewardCatalogEntry("ek_res_UCL_champion")?.default).toMatchObject({ balls: 3, stars: 6 });
    expect(getTaskRewardCatalogEntry("ek_res_champion_3")?.default).toMatchObject({ stars: 20, case_type: SEASON_TASK_REWARD_PREMIUM_CASE, case_count: 1 });
    // §C: top-5 + league-stage activity + start now grant 1⭐ each; top5_complete_all → Premium
    expect(getTaskRewardCatalogEntry("top5_PL_fill_table")?.default).toMatchObject({ enabled: true, balls: 0, stars: 1 });
    expect(getTaskRewardCatalogEntry("europe_UCL_submit")?.default).toMatchObject({ enabled: true, balls: 0, stars: 1 });
    expect(getTaskRewardCatalogEntry("start_first_prediction")?.default).toMatchObject({ enabled: true, stars: 1 });
    expect(getTaskRewardCatalogEntry("top5_complete_all")?.default).toMatchObject({ enabled: true, case_type: SEASON_TASK_REWARD_PREMIUM_CASE, case_count: 1 });
  });
});

// ── Reward config seed (spec tests 1–2) ─────────────────────────────────────────
describe("seed defaults", () => {
  it("1. seed creates the missing starter (active) configs", () => {
    const inserts = computeSeedInserts(new Set());
    expect(inserts.length).toBeGreaterThan(0);
    // every seeded entry has an active default; disabled defaults are not seeded
    expect(inserts.every((e) => rewardIsActive(e.default))).toBe(true);
    expect(inserts.some((e) => e.task_key === "ek_ties_UCL_fill")).toBe(true);
    expect(inserts.some((e) => e.task_key === "top5_PL_fill_table")).toBe(true);   // §C: now an active default
    expect(inserts.some((e) => e.task_key === "ek_res_ties_4_any")).toBe(false);   // §15: intentionally disabled
  });
  it("2. seed does NOT overwrite configs already saved by the admin", () => {
    const existing = new Set(["ek_ties_UCL_fill", "ek_res_UCL_champion"]);
    const inserts = computeSeedInserts(existing);
    expect(inserts.some((e) => e.task_key === "ek_ties_UCL_fill")).toBe(false);
    expect(inserts.some((e) => e.task_key === "ek_res_UCL_champion")).toBe(false);
  });
});

// ── Validation (spec tests 3–4, 22) ─────────────────────────────────────────────
describe("validation", () => {
  it("3. rejects negative balls", () => {
    expect(() => validateTaskRewardConfigInput("ek_ties_UCL_fill", { balls: -1 }, { validCaseTypes: CASES })).toThrow("REWARD_NEGATIVE");
  });
  it("4. rejects negative stars", () => {
    expect(() => validateTaskRewardConfigInput("ek_ties_UCL_fill", { stars: -5 }, { validCaseTypes: CASES })).toThrow("REWARD_NEGATIVE");
  });
  it("rejects unknown task key + unknown case type", () => {
    expect(() => validateTaskRewardConfigInput("does_not_exist", { balls: 1 }, { validCaseTypes: CASES })).toThrow("UNKNOWN_TASK_KEY");
    expect(() => validateTaskRewardConfigInput("ek_ties_UCL_fill", { case_type: "diamond", case_count: 1 }, { validCaseTypes: CASES })).toThrow("UNKNOWN_CASE_TYPE");
  });
  it("22. normalizes a valid admin update (empty case type forces count 0)", () => {
    const c = validateTaskRewardConfigInput("ek_ties_UCL_fill", { enabled: true, balls: 5, stars: 2, case_type: "", case_count: 4, admin_note: "  hi " }, { validCaseTypes: CASES });
    expect(c).toMatchObject({ enabled: true, balls: 5, stars: 2, case_type: null, case_count: 0, admin_note: "hi" });
  });
  it("23. lucky_tokens: accepts valid; rejects negative and over-max", () => {
    const c = validateTaskRewardConfigInput("ek_ties_UCL_fill", { enabled: true, lucky_tokens: 3 }, { validCaseTypes: CASES });
    expect(c.lucky_tokens).toBe(3);
    expect(() => validateTaskRewardConfigInput("ek_ties_UCL_fill", { lucky_tokens: -1 }, { validCaseTypes: CASES })).toThrow("REWARD_NEGATIVE");
    expect(() => validateTaskRewardConfigInput("ek_ties_UCL_fill", { lucky_tokens: 9999 }, { validCaseTypes: CASES })).toThrow("REWARD_OVER_MAX");
  });
  it("24. boosts: accepts allowed type; empty type forces count 0; rejects unknown/over-max", () => {
    const c = validateTaskRewardConfigInput("ek_res_UCL_champion", { enabled: true, boost_type: "double_chance", boost_count: 2 }, { validCaseTypes: CASES });
    expect(c).toMatchObject({ boost_type: "double_chance", boost_count: 2 });
    // empty type ⇒ count forced to 0 (no orphan boost count)
    expect(validateTaskRewardConfigInput("ek_res_UCL_champion", { boost_type: "", boost_count: 3 }, { validCaseTypes: CASES }))
      .toMatchObject({ boost_type: null, boost_count: 0 });
    expect(() => validateTaskRewardConfigInput("ek_res_UCL_champion", { boost_type: "rocket", boost_count: 1 }, { validCaseTypes: CASES })).toThrow("UNKNOWN_BOOST_TYPE");
    expect(() => validateTaskRewardConfigInput("ek_res_UCL_champion", { boost_type: "extra_joker", boost_count: 9999 }, { validCaseTypes: CASES })).toThrow("REWARD_OVER_MAX");
  });
  it("25. boost-only reward is active and appears in payload", () => {
    const eff = effectiveTaskReward(cfg("ek_res_UCL_champion", { enabled: true, boost_type: "extra_joker", boost_count: 1 }), active(0));
    expect(rewardIsActive(eff)).toBe(true);
    expect(rewardForPayload(eff)).toEqual({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: "extra_joker", boost_count: 1 });
  });
});

// ── Effective reward / payload (spec tests 5–6) ─────────────────────────────────
describe("effective reward + payload", () => {
  it("5. disabled config ⇒ reward payload null", () => {
    const stored = cfg("ek_ties_UCL_fill", { enabled: false, balls: 5 });
    const eff = effectiveTaskReward(stored, active(2));
    expect(rewardIsActive(eff)).toBe(false);
    expect(rewardForPayload(eff)).toBeNull();
  });
  it("5b. zero-reward enabled config ⇒ null", () => {
    const eff = effectiveTaskReward(cfg("ek_ties_UCL_fill", { enabled: true, balls: 0, stars: 0 }), active(2));
    expect(rewardForPayload(eff)).toBeNull();
  });
  it("6. enabled config appears in payload and overrides the default", () => {
    const eff = effectiveTaskReward(cfg("ek_ties_UCL_fill", { enabled: true, balls: 9, stars: 1 }), active(2));
    expect(rewardForPayload(eff)).toEqual({ stars: 1, balls: 9, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
  });
  it("falls back to the code default when no stored row", () => {
    const eff = effectiveTaskReward(null, active(2));
    expect(rewardForPayload(eff)).toEqual({ stars: 0, balls: 2, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
  });
  it("lucky_tokens-only reward is active and appears in payload", () => {
    const eff = effectiveTaskReward(cfg("ek_ties_UCL_fill", { enabled: true, balls: 0, stars: 0, lucky_tokens: 4 }), active(0));
    expect(rewardIsActive(eff)).toBe(true);
    expect(rewardForPayload(eff)).toEqual({ stars: 0, balls: 0, case_type: null, case_count: 0, lucky_tokens: 4, boost_type: null, boost_count: 0 });
  });
});

// ── Claim status (spec tests 7–11) ──────────────────────────────────────────────
describe("claim status", () => {
  const r = active(5);
  it("7. completed + active reward ⇒ claimable", () => {
    expect(taskClaimStatus("completed", rewardIsActive(r), false)).toBe("claimable");
  });
  it("8. completed without reward ⇒ not_claimable (stays 'Выполнено')", () => {
    expect(taskClaimStatus("completed", false, false)).toBe("not_claimable");
  });
  it("9. future ⇒ not_claimable", () => {
    expect(taskClaimStatus("future", true, false)).toBe("not_claimable");
  });
  it("10. failed ⇒ not_claimable", () => {
    expect(taskClaimStatus("failed", true, false)).toBe("not_claimable");
  });
  it("11. claimed ⇒ claimed", () => {
    expect(taskClaimStatus("completed", true, true)).toBe("claimed");
  });
});

// ── Claim resolver (spec tests 12–18) ───────────────────────────────────────────
describe("claim resolver", () => {
  const reward = active(5, 2);
  it("12–14. completed + active reward ⇒ ok with balls/stars (and case)", () => {
    const res = resolveTaskClaim("completed", reward, false);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.reward).toEqual({ stars: 2, balls: 5, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
    const withCase: TaskRewardSpec = { enabled: true, balls: 0, stars: 30, case_type: "premium", case_count: 1, lucky_tokens: 0, boost_type: null, boost_count: 0 };
    const r2 = resolveTaskClaim("completed", withCase, false);
    expect(r2.ok && r2.reward.case_count).toBe(1);
  });
  it("balls-only reward resolves with balls, zero stars", () => {
    const r = resolveTaskClaim("completed", { enabled: true, balls: 2, stars: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 }, false);
    expect(r.ok && r.reward).toEqual({ stars: 0, balls: 2, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
  });
  it("stars-only reward resolves with stars, zero balls", () => {
    const r = resolveTaskClaim("completed", { enabled: true, balls: 0, stars: 8, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 }, false);
    expect(r.ok && r.reward).toEqual({ stars: 8, balls: 0, case_type: null, case_count: 0, lucky_tokens: 0, boost_type: null, boost_count: 0 });
  });
  it("15. repeat claim rejected (already claimed)", () => {
    expect(resolveTaskClaim("completed", reward, true)).toEqual({ ok: false, code: "ALREADY_CLAIMED" });
  });
  it("16. disabled reward rejected", () => {
    expect(resolveTaskClaim("completed", { ...reward, enabled: false }, false)).toEqual({ ok: false, code: "NOT_CLAIMABLE" });
  });
  it("17. failed/future/in_progress/available rejected", () => {
    expect(resolveTaskClaim("failed", reward, false)).toEqual({ ok: false, code: "NOT_COMPLETED" });
    expect(resolveTaskClaim("future", reward, false)).toEqual({ ok: false, code: "NOT_COMPLETED" });
    expect(resolveTaskClaim("in_progress", reward, false)).toEqual({ ok: false, code: "NOT_COMPLETED" });
    expect(resolveTaskClaim("available", reward, false)).toEqual({ ok: false, code: "NOT_COMPLETED" });
  });
  it("9b. reward=null (effective from a disabled config) cannot be claimed", () => {
    const eff = effectiveTaskReward(cfg("ek_ties_UCL_fill", { enabled: false, balls: 5 }), active(2));
    expect(resolveTaskClaim("completed", eff, false)).toEqual({ ok: false, code: "NOT_CLAIMABLE" });
  });
  it("13b. unknown task_key is not in the catalog (endpoint → 404)", () => {
    expect(getTaskRewardCatalogEntry("totally_unknown_task")).toBeNull();
    expect(getTaskRewardCatalogEntry("ek_ties_UCL_fill")).not.toBeNull();
  });
});

// ── Dedup key (spec test 18 unknown handled by endpoint; key round-trip) ────────
describe("dedup key", () => {
  it("builds + round-trips the task key", () => {
    const base = taskClaimUniqueKeyBase(7, 12345, "ek_res_UCL_champion");
    expect(base).toBe("season_prediction_task_claim:7:12345:ek_res_UCL_champion");
    expect(taskKeyFromClaimUniqueKey(`${base}:balls`)).toBe("ek_res_UCL_champion");
    expect(taskKeyFromClaimUniqueKey("weekly_challenge_task:foo")).toBeNull();
  });
});

// ── Claimable badge counting (spec tests 19–21) ─────────────────────────────────
describe("claimable badge count", () => {
  it("19–21. counts only completed reward-bearing not-claimed tasks", () => {
    const tasks = [
      { status: "completed" as const, claim_status: "claimable" as const },   // counts
      { status: "completed" as const, claim_status: "not_claimable" as const }, // reward=null
      { status: "completed" as const, claim_status: "claimed" as const },      // claimed
      { status: "failed" as const, claim_status: "not_claimable" as const },
      { status: "future" as const, claim_status: "not_claimable" as const },
    ];
    expect(countClaimableTasks(tasks)).toBe(1);
  });
});

// ── Theoretical max (spec tests 24, 26) ─────────────────────────────────────────
describe("theoretical max summary", () => {
  it("26. sums enabled, non-zero effective rewards (defaults only)", () => {
    const sum = theoreticalMaxRewards(new Map());
    expect(sum.enabled_count).toBeGreaterThan(0);
    expect(sum.max_balls).toBeGreaterThan(0);
    expect(sum.max_stars).toBeGreaterThan(0);
    expect(sum.max_cases).toBe(3); // ek_res_champion_3 + top5_complete_all + europe_res_top8_any
    expect(sum.cases_by_type[SEASON_TASK_REWARD_PREMIUM_CASE]).toBe(3);
  });
  it("24. admin override changes the effective max (disable lowers count)", () => {
    const base = theoreticalMaxRewards(new Map());
    const stored = new Map<string, TaskRewardConfig>([
      ["ek_ties_UCL_fill", cfg("ek_ties_UCL_fill", { enabled: false })],
    ]);
    const after = theoreticalMaxRewards(stored);
    expect(after.enabled_count).toBe(base.enabled_count - 1);
    expect(after.max_balls).toBe(base.max_balls - 1); // ek_ties_UCL_fill default = 1 ball (E10.4)
  });
  it("admin can enable a top-5 task (raises count)", () => {
    const base = theoreticalMaxRewards(new Map());
    const stored = new Map<string, TaskRewardConfig>([
      ["ek_res_ties_4_any", cfg("ek_res_ties_4_any", { enabled: true, balls: 3 })], // §15-disabled default
    ]);
    const after = theoreticalMaxRewards(stored);
    expect(after.enabled_count).toBe(base.enabled_count + 1);
    expect(after.max_balls).toBe(base.max_balls + 3);
  });
});

// ── E10.3: balance breakdown + warnings + sort ──────────────────────────────────
describe("theoretical max breakdown (E10.3)", () => {
  it("1-3. defaults: by_category/by_group sums match the global totals", () => {
    const s = theoreticalMaxRewards(new Map());
    // §C: europe carries all balls; stars now split across europe/top5/start.
    expect(s.by_category.europe.balls).toBe(s.max_balls);
    expect(s.by_category.top5.balls).toBe(0);
    expect(s.by_category.start.balls).toBe(0);
    expect(s.by_category.ballon_dor.balls).toBe(0);
    // by_category — разбиение: сумма всех четырёх бакетов равна общему максимуму.
    expect(
      s.by_category.top5.stars
      + s.by_category.europe.stars
      + s.by_category.start.stars
      + s.by_category.ballon_dor.stars,
    ).toBe(s.max_stars);
    // group split is a partition → sums equal the totals
    const g = s.by_group;
    expect(g.activity.balls + g.result.balls + g.aggregate.balls).toBe(s.max_balls);
    expect(g.activity.stars + g.result.stars + g.aggregate.stars).toBe(s.max_stars);
    expect(g.activity.cases + g.result.cases + g.aggregate.cases).toBe(s.max_cases);
    expect(g.aggregate.cases).toBe(3); // ek_res_champion_3 + top5_complete_all + europe_res_top8_any
  });
  it("4-5. disabled / reward=null configs do not contribute to any bucket", () => {
    const base = theoreticalMaxRewards(new Map());
    const stored = new Map<string, TaskRewardConfig>([
      ["ek_ties_UCL_fill", cfg("ek_ties_UCL_fill", { enabled: false })], // disable an active default
    ]);
    const after = theoreticalMaxRewards(stored);
    expect(after.by_category.europe.balls).toBe(base.by_category.europe.balls - 1); // ek_ties_UCL_fill = 1 ball (E10.4)
    expect(after.by_group.activity.balls).toBe(base.by_group.activity.balls - 1);
  });
  it("6-7. overriding a top5 task moves only the top5 category bucket", () => {
    const base = theoreticalMaxRewards(new Map());
    // top5_PL_fill_table default = balls 0, stars 1 → override to balls 10, stars 5.
    const stored = new Map<string, TaskRewardConfig>([
      ["top5_PL_fill_table", cfg("top5_PL_fill_table", { enabled: true, balls: 10, stars: 5 })],
    ]);
    const after = theoreticalMaxRewards(stored);
    expect(after.by_category.top5.balls).toBe(base.by_category.top5.balls + 10); // 0 → 10
    expect(after.by_category.top5.stars).toBe(base.by_category.top5.stars + 4);  // 1 → 5
    expect(after.by_category.europe.balls).toBe(base.by_category.europe.balls);  // europe untouched
    expect(after.by_group.activity.balls).toBe(base.by_group.activity.balls + 10);
  });
});

describe("starter balance (E10.4)", () => {
  const s = theoreticalMaxRewards(new Map());
  it("default theoretical max lands in the calmer target range", () => {
    expect(s.max_balls).toBeGreaterThanOrEqual(120);
    expect(s.max_balls).toBeLessThanOrEqual(180);
    expect(s.max_stars).toBeGreaterThanOrEqual(430);
    expect(s.max_stars).toBeLessThanOrEqual(550); // 184 prior + 268 league-stage results
  });
  it("at most 2 cases in the defaults", () => {
    expect(s.max_cases).toBeLessThanOrEqual(3);
    expect(s.max_cases).toBe(3); // results Premium + top5_complete_all + league-stage top-8
  });
  it("balls/case warnings do not fire on the default config (stars may — see §C)", () => {
    const warnings = buildTaskRewardWarnings(s);
    expect(warnings.some((w) => w.includes("мячик"))).toBe(false); // 145 < 200
    expect(warnings.some((w) => w.includes("кейс"))).toBe(false);  // 3 cases, at the raised limit
  });
  it("every active default still grants something (claimable) — no zeroed task", () => {
    // enabling/lowering must not silently drop a task out of the claimable set
    expect(s.enabled_count).toBe(129); // 107 prior + 21 league-stage result + ballon_dor_fill
  });
  it("disabled stored config is excluded from the max", () => {
    const stored = new Map<string, TaskRewardConfig>([["ek_res_champion_3", cfg("ek_res_champion_3", { enabled: false })]]);
    const after = theoreticalMaxRewards(stored);
    expect(after.max_cases).toBe(2); // top5_complete_all + europe_res_top8_any Premium remain
    expect(after.enabled_count).toBe(s.enabled_count - 1);
  });
});

describe("reward warnings (E10.3)", () => {
  const eb = { enabled_count: 0, balls: 0, stars: 0, cases: 0, lucky_tokens: 0 };
  const mk = (p: Partial<TaskRewardMaxSummary>): TaskRewardMaxSummary => ({
    enabled_count: 1, max_balls: 0, max_stars: 0, max_cases: 0, max_lucky_tokens: 0, cases_by_type: {},
    by_category: { top5: { ...eb }, europe: { ...eb }, start: { ...eb } },
    by_group: { activity: { ...eb }, result: { ...eb }, aggregate: { ...eb } },
    ...p,
  });
  it("8. warns when cases exceed the limit", () => {
    expect(buildTaskRewardWarnings(mk({ max_cases: TASK_REWARD_WARN_LIMITS.cases + 1 })).some((w) => w.includes("кейс"))).toBe(true);
    expect(buildTaskRewardWarnings(mk({ max_cases: TASK_REWARD_WARN_LIMITS.cases })).some((w) => w.includes("кейс"))).toBe(false);
  });
  it("9. warns when stars exceed the limit", () => {
    expect(buildTaskRewardWarnings(mk({ max_stars: TASK_REWARD_WARN_LIMITS.stars + 1 })).some((w) => w.includes("звёзд"))).toBe(true);
    expect(buildTaskRewardWarnings(mk({ max_stars: TASK_REWARD_WARN_LIMITS.stars })).some((w) => w.includes("звёзд"))).toBe(false);
  });
  it("10. warns when balls exceed the limit", () => {
    expect(buildTaskRewardWarnings(mk({ max_balls: TASK_REWARD_WARN_LIMITS.balls + 1 })).some((w) => w.includes("мячик"))).toBe(true);
    expect(buildTaskRewardWarnings(mk({ max_balls: TASK_REWARD_WARN_LIMITS.balls })).some((w) => w.includes("мячик"))).toBe(false);
  });
  it("no warnings under all limits", () => {
    expect(buildTaskRewardWarnings(mk({ max_balls: 10, max_stars: 10, max_cases: 1 }))).toEqual([]);
  });
});

describe("task sort rank (E10.3 §5)", () => {
  it("11. claimable ranks above future and failed", () => {
    const claimable = seasonTaskSortRank({ status: "completed", claim_status: "claimable" });
    expect(claimable).toBeLessThan(seasonTaskSortRank({ status: "future", claim_status: "not_claimable" }));
    expect(claimable).toBeLessThan(seasonTaskSortRank({ status: "failed", claim_status: "not_claimable" }));
  });
  it("12. claimed ranks below completed-without-claim, above future/failed", () => {
    const completed = seasonTaskSortRank({ status: "completed", claim_status: "not_claimable" });
    const claimed = seasonTaskSortRank({ status: "completed", claim_status: "claimed" });
    expect(completed).toBeLessThan(claimed);
    expect(claimed).toBeLessThan(seasonTaskSortRank({ status: "future" }));
    expect(claimed).toBeLessThan(seasonTaskSortRank({ status: "failed" }));
  });
  it("full ordering claimable<inprogress<completed<claimed<future<failed", () => {
    const ranks = [
      seasonTaskSortRank({ status: "completed", claim_status: "claimable" }),
      seasonTaskSortRank({ status: "in_progress" }),
      seasonTaskSortRank({ status: "completed", claim_status: "not_claimable" }),
      seasonTaskSortRank({ status: "completed", claim_status: "claimed" }),
      seasonTaskSortRank({ status: "future" }),
      seasonTaskSortRank({ status: "failed" }),
    ];
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(6); // all distinct tiers
  });
});

// ── Catalog coverage sanity ─────────────────────────────────────────────────────
describe("catalog size", () => {
  it("exposes a stable cached catalog", () => {
    expect(seasonTaskRewardCatalog()).toBe(seasonTaskRewardCatalog());
  });
});

// ── Granular claimable summary (E10.2b, spec §2/§7/§11) ─────────────────────────
function task(p: Partial<ClaimableSummaryTask> & { section: string; subsection: string }): ClaimableSummaryTask {
  return { phase: null, claim_status: "claimable", ...p };
}

// A representative mixed tree: top-5 (PL/PD + aggregate) and eurocups (UCL ties/bracket/result,
// UEL, UECL, aggregate), plus non-claimable noise (claimed/failed/future/not_claimable).
function sampleTasks(): ClaimableSummaryTask[] {
  return [
    // Top-5
    task({ section: "top5", subsection: "PL", phase: "league" }),
    task({ section: "top5", subsection: "PL", phase: "league" }),
    task({ section: "top5", subsection: "PL", phase: "league" }),       // PL = 3
    task({ section: "top5", subsection: "PD", phase: "league" }),
    task({ section: "top5", subsection: "PD", phase: "league" }),       // PD = 2
    task({ section: "top5", subsection: "all", phase: "league" }),      // top5 aggregate
    // Eurocups · UCL
    task({ section: "europe", subsection: "UCL", phase: "ties" }),
    task({ section: "europe", subsection: "UCL", phase: "ties" }),
    task({ section: "europe", subsection: "UCL", phase: "ties" }),      // UCL ties = 3
    task({ section: "europe", subsection: "UCL", phase: "bracket" }),
    task({ section: "europe", subsection: "UCL", phase: "bracket" }),
    task({ section: "europe", subsection: "UCL", phase: "bracket" }),
    task({ section: "europe", subsection: "UCL", phase: "bracket" }),   // UCL bracket = 4
    task({ section: "europe", subsection: "UCL", phase: "result" }),    // UCL result = 1 → UCL = 8
    // Eurocups · UEL / UECL / aggregate
    task({ section: "europe", subsection: "UEL", phase: "ties" }),
    task({ section: "europe", subsection: "UECL", phase: "bracket" }),
    task({ section: "europe", subsection: "all", phase: "result" }),    // eurocup aggregate
    // Non-claimable noise (must be ignored)
    task({ section: "top5", subsection: "PL", phase: "league", claim_status: "not_claimable" }), // reward=null/completed
    task({ section: "europe", subsection: "UCL", phase: "ties", claim_status: "claimed" }),
    task({ section: "europe", subsection: "UCL", phase: "bracket", claim_status: undefined }),   // failed/future/in_progress
    task({ section: "start", subsection: "start", phase: "league", claim_status: "not_claimable" }),
  ];
}

describe("claimable summary", () => {
  const s = buildSeasonTaskClaimableSummary(sampleTasks());

  it("1. completed reward task (claimable) is counted", () => {
    expect(buildSeasonTaskClaimableSummary([task({ section: "europe", subsection: "UCL", phase: "ties" })]).total).toBe(1);
  });
  it("2. completed reward=null (not_claimable) is NOT counted", () => {
    expect(buildSeasonTaskClaimableSummary([task({ section: "europe", subsection: "UCL", claim_status: "not_claimable" })]).total).toBe(0);
  });
  it("3. claimed is NOT counted", () => {
    expect(buildSeasonTaskClaimableSummary([task({ section: "europe", subsection: "UCL", claim_status: "claimed" })]).total).toBe(0);
  });
  it("4. failed/in_progress (no claim_status) is NOT counted", () => {
    expect(buildSeasonTaskClaimableSummary([task({ section: "europe", subsection: "UCL", claim_status: undefined })]).total).toBe(0);
  });
  it("5. future is NOT counted (carries no claimable claim_status)", () => {
    expect(buildSeasonTaskClaimableSummary([task({ section: "europe", subsection: "UCL", claim_status: "not_claimable" })]).total).toBe(0);
  });
  it("6. total = sum of all claimable", () => {
    // 3+2+1(top5) + 8(UCL) + 1(UEL) + 1(UECL) + 1(europe aggregate) = 17
    expect(s.total).toBe(17);
  });
  it("7. section grouping: top5 vs europe vs start", () => {
    expect(s.sections.top5).toBe(6);   // PL3 + PD2 + all1
    expect(s.sections.europe).toBe(11); // UCL8 + UEL1 + UECL1 + all1
    expect(s.sections.start ?? 0).toBe(0);
  });
  it("8. season-prediction sections sum equals total (no weekly noise here)", () => {
    expect((s.sections.top5 || 0) + (s.sections.europe || 0) + (s.sections.start || 0)).toBe(s.total);
  });
  it("9. top5 count = only top5", () => {
    expect(s.sections.top5).toBe(6);
  });
  it("10. PL subsection = only PL", () => {
    expect(s.subsections["top5:PL"]).toBe(3);
    expect(s.subsections["top5:PD"]).toBe(2);
  });
  it("11. eurocups count = only eurocup tasks", () => {
    expect(s.sections.europe).toBe(11);
  });
  it("12. UCL subsection = only UCL", () => {
    expect(s.subsections["europe:UCL"]).toBe(8);
    expect(s.subsections["europe:UEL"]).toBe(1);
    expect(s.subsections["europe:UECL"]).toBe(1);
  });
  it("13. UCL ties phase = only ties tasks", () => {
    expect(s.phases["europe:UCL:ties"]).toBe(3);
    expect(s.phases["europe:UCL:bracket"]).toBe(4);
    expect(s.phases["europe:UCL:result"]).toBe(1);
  });
  it("14. aggregate eurocup tasks land in :all, not in UCL/UEL/UECL", () => {
    expect(s.subsections["europe:all"]).toBe(1);
    // aggregate not leaking into a cup bucket
    expect((s.subsections["europe:UCL"] || 0) + (s.subsections["europe:UEL"] || 0) + (s.subsections["europe:UECL"] || 0)).toBe(10);
  });
  it("15. claiming one UCL ties task decrements the relevant counts", () => {
    const tasks = sampleTasks();
    const idx = tasks.findIndex((t) => t.section === "europe" && t.subsection === "UCL" && t.phase === "ties" && t.claim_status === "claimable");
    tasks[idx] = { ...tasks[idx], claim_status: "claimed" };
    const after = buildSeasonTaskClaimableSummary(tasks);
    expect(after.total).toBe(s.total - 1);
    expect(after.subsections["europe:UCL"]).toBe(7);
    expect(after.phases["europe:UCL:ties"]).toBe(2);
  });
});

describe("league-stage result rewards", () => {
  const sum = (keys: string[], pick: (d: any) => number) =>
    keys.reduce((n, k) => n + pick(getTaskRewardCatalogEntry(k)!.default), 0);
  const perCup = (suffix: string) => ["UCL", "UEL", "UECL"].map((c) => `europe_${c}_res_${suffix}`);
  const all = [
    ...perCup("points_50"), ...perCup("points_75"),
    ...perCup("top24_20"), ...perCup("top24_all"), ...perCup("top8_6"), ...perCup("top8_all"),
    "europe_res_points_50_all", "europe_res_points_75_all", "europe_res_top8_any",
  ];

  it("every cup carries the six result tiers, in the league phase", () => {
    for (const key of all) {
      const entry = getTaskRewardCatalogEntry(key);
      expect(entry, key).toBeTruthy();
      expect(entry!.phase, key).toBe("league");
      expect(entry!.category, key).toBe("europe");
      expect(entry!.default.enabled, key).toBe(true);
    }
  });

  it("adds up to the agreed 268⭐ + 19⚽ + 5 tokens + 1 Premium", () => {
    expect(sum(all, (d) => d.stars)).toBe(268);
    expect(sum(all, (d) => d.balls)).toBe(19);
    expect(sum(all, (d) => d.lucky_tokens)).toBe(5);
    expect(sum(all, (d) => d.case_count)).toBe(1);
  });

  it("boosts sit on the middle tiers only: 8 extra jokers + 3 double chances", () => {
    const boosts = (type: string) =>
      all.reduce((n, k) => {
        const d = getTaskRewardCatalogEntry(k)!.default;
        return n + (d.boost_type === type ? d.boost_count : 0);
      }, 0);
    expect(boosts("extra_joker")).toBe(8);
    expect(boosts("double_chance")).toBe(3);
    // balls/tokens/case stay on the rare feats, never on the reachable 50+ tier
    for (const key of perCup("points_50")) {
      const d = getTaskRewardCatalogEntry(key)!.default;
      expect(d.balls + d.lucky_tokens + d.case_count).toBe(0);
    }
  });

  it("the three never-completing placeholders are gone from the catalog", () => {
    for (const c of ["UCL", "UEL", "UECL"]) {
      expect(getTaskRewardCatalogEntry(`europe_${c}_future_top8`)).toBeNull();
      expect(getTaskRewardCatalogEntry(`europe_${c}_future_champion`)).toBeNull();
    }
  });
});
