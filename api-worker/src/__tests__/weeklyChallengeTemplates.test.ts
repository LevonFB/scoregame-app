import { describe, it, expect } from "vitest";
import {
  WEEKLY_QUESTION_TEMPLATES,
  getWeeklyTemplate,
  listWeeklyTemplatesForQuestion,
  listWeeklyTemplatesForMode,
  resolveWeeklyCompetitionMode,
  normalizeWeeklyCompetitionMode,
  weeklyQuestionDisplayCategory,
  validateWeeklyQuestionByTemplate,
  templateSupportsMode,
  type WeeklyTemplateContext,
  type WeeklyTemplateInput,
} from "../weeklyChallengeTemplates";

const QUESTION_KEYS = ["match_of_week", "league_of_week", "duel_of_week", "upset_of_week", "event_of_week"] as const;

function ctx(poolRefs: string[], partial: Partial<WeeklyTemplateContext> = {}): WeeklyTemplateContext {
  return { poolRefs: new Set(poolRefs), mode: "club", status: "active", ...partial };
}

describe("registry shape", () => {
  it("has 30 templates; every question key has at least 3", () => {
    expect(WEEKLY_QUESTION_TEMPLATES).toHaveLength(30);
    for (const key of QUESTION_KEYS) {
      expect(listWeeklyTemplatesForQuestion(key).length).toBeGreaterThanOrEqual(3);
    }
    // league_of_week: 4 group + families P (4) + M (1) + O (1) + L (2) + max margin (1) = 13.
    expect(listWeeklyTemplatesForQuestion("league_of_week")).toHaveLength(13);
  });

  it("template keys are unique", () => {
    const keys = WEEKLY_QUESTION_TEMPLATES.map((t) => t.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps each template to one of the five fixed question keys", () => {
    for (const t of WEEKLY_QUESTION_TEMPLATES) {
      expect(QUESTION_KEYS).toContain(t.questionKey);
    }
  });

  it("league_of_week renders as Расклад недели", () => {
    expect(weeklyQuestionDisplayCategory("league_of_week")).toBe("Расклад недели");
    expect(weeklyQuestionDisplayCategory("match_of_week")).toBe("Матч недели");
  });

  it("duel templates always expose player_a/player_b/equal", () => {
    for (const t of listWeeklyTemplatesForQuestion("duel_of_week")) {
      expect(t.fixedOptionIds).toEqual(["player_a", "player_b", "equal"]);
    }
  });

  it("legacy group templates always include the equal option", () => {
    for (const t of listWeeklyTemplatesForQuestion("league_of_week").filter((t) => t.templateKey.startsWith("group_"))) {
      expect(t.fixedOptionIds).toContain("equal");
    }
  });

  it("pool-aggregate templates derive options from configurable buckets", () => {
    const goals = getWeeklyTemplate("pool_total_goals_bucket")!;
    // default buckets [10,16] → three options
    expect(goals.buildQuestion({ templateKey: "pool_total_goals_bucket" }).options.map((o) => o.id))
      .toEqual(["goals_lt_10", "goals_10_15", "goals_16_plus"]);
    // custom buckets reshape the options
    expect(goals.buildQuestion({ templateKey: "pool_total_goals_bucket", goalsBuckets: [8, 12, 18] }).options.map((o) => o.id))
      .toEqual(["goals_lt_8", "goals_8_11", "goals_12_17", "goals_18_plus"]);

    const count = getWeeklyTemplate("pool_big_wins_count")!;
    expect(count.buildQuestion({ templateKey: "pool_big_wins_count" }).options.map((o) => o.id))
      .toEqual(["count_0", "count_1", "count_2", "count_3_plus"]);
    expect(count.buildQuestion({ templateKey: "pool_big_wins_count", countMax: 2 }).options.map((o) => o.id))
      .toEqual(["count_0", "count_1", "count_2_plus"]);
  });

  it("family M/O/L build the expected option ids and validate", () => {
    const topMatch = getWeeklyTemplate("pool_top_scoring_match")!;
    expect(topMatch.buildQuestion({ templateKey: "pool_top_scoring_match", matchOptions: [{ match_ref: "1", label: "A" }, { match_ref: "2", label: "B" }] }).options.map((o) => o.id))
      .toEqual(["match_1", "match_2", "equal"]);
    expect(topMatch.validate({ templateKey: "pool_top_scoring_match", matchOptions: [{ match_ref: "1" }] }, ctx(["1", "2"])).map((i) => i.code))
      .toContain("WEEKLY_MAX_MIN_TWO");

    const outcome = getWeeklyTemplate("pool_outcome_balance")!;
    expect(outcome.buildQuestion({ templateKey: "pool_outcome_balance" }).options.map((o) => o.id)).toEqual(["home_wins", "away_wins", "equal"]);
    expect(outcome.buildQuestion({ templateKey: "pool_outcome_balance", includeDraws: true }).options.map((o) => o.id)).toEqual(["home_wins", "away_wins", "draws", "equal"]);

    const league = getWeeklyTemplate("league_top_scoring")!;
    expect(league.buildQuestion({ templateKey: "league_top_scoring", leagues: [{ code: "PL", label: "АПЛ" }, { code: "PD", label: "Ла Лига" }] }).options.map((o) => o.id))
      .toEqual(["league_PL", "league_PD", "equal"]);
    expect(league.validate({ templateKey: "league_top_scoring", leagues: [{ code: "PL" }] }, ctx([])).map((i) => i.code)).toContain("WEEKLY_LEAGUE_MIN_TWO");
    expect(league.validate({ templateKey: "league_top_scoring", leagues: [{ code: "PL" }, { code: "PL" }] }, ctx([])).map((i) => i.code)).toContain("WEEKLY_LEAGUE_DUPLICATE");
  });

  it("pool-aggregate rejects non-ascending buckets and validates selected scope", () => {
    const goals = getWeeklyTemplate("pool_total_goals_bucket")!;
    expect(goals.validate({ templateKey: "pool_total_goals_bucket", goalsBuckets: [16, 10] }, ctx(["1"])).map((i) => i.code))
      .toContain("WEEKLY_POOL_BUCKETS_INVALID");
    expect(goals.validate({ templateKey: "pool_total_goals_bucket", scope: { type: "selected", match_refs: [] } }, ctx(["1"])).map((i) => i.code))
      .toContain("WEEKLY_POOL_SCOPE_EMPTY");
    expect(goals.validate({ templateKey: "pool_total_goals_bucket", scope: { type: "selected", match_refs: ["9"] } }, ctx(["1"])).map((i) => i.code))
      .toContain("WEEKLY_POOL_MATCH_OUTSIDE_POOL");
    // clean default input validates
    expect(goals.validate({ templateKey: "pool_total_goals_bucket" }, ctx(["1"]))).toEqual([]);
  });
});

describe("mode resolution", () => {
  it("resolves competition_mode from settings, missing → unspecified", () => {
    expect(resolveWeeklyCompetitionMode({ competition_mode: "club" })).toBe("club");
    expect(resolveWeeklyCompetitionMode({ competition_mode: "national_team" })).toBe("national_team");
    expect(resolveWeeklyCompetitionMode({})).toBe("unspecified");
    expect(resolveWeeklyCompetitionMode(null)).toBe("unspecified");
  });

  it("normalizes mode input", () => {
    expect(normalizeWeeklyCompetitionMode("club")).toBe("club");
    expect(normalizeWeeklyCompetitionMode("bogus")).toBeNull();
  });

  it("all templates support both modes in v1 set", () => {
    for (const t of WEEKLY_QUESTION_TEMPLATES) {
      expect(t.supportedModes).toEqual(["club", "national_team"]);
      expect(templateSupportsMode(t.templateKey, "national_team")).toBe(true);
    }
    expect(listWeeklyTemplatesForMode("match_of_week", "club")).toHaveLength(4);
    expect(listWeeklyTemplatesForMode("match_of_week", "unspecified")).toHaveLength(4);
  });
});

describe("option/config generation", () => {
  it("match_result builds home/draw/away with team labels", () => {
    const t = getWeeklyTemplate("match_result")!;
    const built = t.buildQuestion({ templateKey: "match_result", matchRef: "10", homeTeamName: "Спартак", awayTeamName: "Зенит" });
    expect(built.options.map((o) => o.id)).toEqual(["home", "draw", "away"]);
    expect(built.options[0].label).toContain("Спартак");
    expect(built.config.template_key).toBe("match_result");
    expect(built.config.match_ref).toBe("10");
  });

  it("group template builds group ids + equal and stable index ids", () => {
    const t = getWeeklyTemplate("group_highest_average_goals")!;
    const built = t.buildQuestion({
      templateKey: "group_highest_average_goals",
      groups: [{ title: "Европа", match_ids: ["1", "2"] }, { title: "Азия", match_ids: ["3"] }],
    });
    expect(built.options.map((o) => o.id)).toEqual(["group_1", "group_2", "equal"]);
    expect(built.config.calculation).toBe("average_goals_per_match");
    expect(built.config.tie_behavior).toBe("equal_option");
  });

  it("upset candidate template appends no_upset", () => {
    const t = getWeeklyTemplate("underdog_not_lose")!;
    const built = t.buildQuestion({ templateKey: "underdog_not_lose", upsetCandidates: [{ team_name: "Гранада" }, { team_name: "Кадис" }] });
    const ids = built.options.map((o) => o.id);
    expect(ids[ids.length - 1]).toBe("no_upset");
    expect(ids).toHaveLength(3);
  });

  it("upset_count uses count options without no_upset", () => {
    const t = getWeeklyTemplate("upset_count")!;
    const built = t.buildQuestion({ templateKey: "upset_count", upsetCountMatches: [{ match_ref: "1", favorite_side: "home" }] });
    expect(built.options.map((o) => o.id)).toEqual(["count_0", "count_1", "count_2", "count_3_plus"]);
    expect(built.options.some((o) => o.id === "no_upset")).toBe(false);
  });
});

describe("validation", () => {
  it("single match: missing / outside pool", () => {
    const t = getWeeklyTemplate("both_teams_to_score")!;
    expect(t.validate({ templateKey: "both_teams_to_score", matchRef: "" }, ctx(["1"]))[0].code).toBe("WEEKLY_MATCH_REQUIRED");
    expect(t.validate({ templateKey: "both_teams_to_score", matchRef: "99" }, ctx(["1"]))[0].code).toBe("WEEKLY_MATCH_OUTSIDE_POOL");
    expect(t.validate({ templateKey: "both_teams_to_score", matchRef: "1" }, ctx(["1"]))).toHaveLength(0);
  });

  it("groups: min two, empty group, duplicate id, outside pool, overlap", () => {
    const t = getWeeklyTemplate("group_most_draws")!;
    const one = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }] }, ctx(["1", "2"]));
    expect(one.map((i) => i.code)).toContain("WEEKLY_GROUP_MIN_TWO");

    const empty = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: [] }] }, ctx(["1", "2"]));
    expect(empty.map((i) => i.code)).toContain("WEEKLY_GROUP_NEEDS_MATCH");

    const dup = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g1", title: "B", match_ids: ["2"] }] }, ctx(["1", "2"]));
    expect(dup.map((i) => i.code)).toContain("WEEKLY_GROUP_DUPLICATE_ID");

    const outside = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["99"] }] }, ctx(["1", "2"]));
    expect(outside.map((i) => i.code)).toContain("WEEKLY_GROUP_MATCH_OUTSIDE_POOL");

    const overlap = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["1"] }] }, ctx(["1", "2"]));
    expect(overlap.map((i) => i.code)).toContain("WEEKLY_GROUP_MATCH_OVERLAP");

    const ok = t.validate({ templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }] }, ctx(["1", "2"]));
    expect(ok).toHaveLength(0);
  });

  it("duel: missing side, identical sides", () => {
    const t = getWeeklyTemplate("player_goals_duel")!;
    const missing = t.validate({ templateKey: "player_goals_duel", duel: { side_a: { kind: "player", name: "A" } } }, ctx([]));
    expect(missing.map((i) => i.code)).toContain("WEEKLY_DUEL_SIDE_B_REQUIRED");
    const same = t.validate({ templateKey: "player_goals_duel", duel: { side_a: { kind: "player", name: "Месси" }, side_b: { kind: "player", name: "месси" } } }, ctx([]));
    expect(same.map((i) => i.code)).toContain("WEEKLY_DUEL_SIDES_IDENTICAL");
  });

  it("upset candidates: min two", () => {
    const t = getWeeklyTemplate("underdog_not_lose")!;
    const one = t.validate({ templateKey: "underdog_not_lose", upsetCandidates: [{ team_name: "A" }] }, ctx([]));
    expect(one.map((i) => i.code)).toContain("WEEKLY_UPSET_MIN_TWO");
  });

  it("event scope: selected but empty", () => {
    const t = getWeeklyTemplate("any_five_plus_goals")!;
    const empty = t.validate({ templateKey: "any_five_plus_goals", scope: { type: "selected", match_refs: [] } }, ctx(["1"]));
    expect(empty.map((i) => i.code)).toContain("WEEKLY_EVENT_SCOPE_EMPTY");
    const allPool = t.validate({ templateKey: "any_five_plus_goals", scope: { type: "all_pool" } }, ctx(["1"]));
    expect(allPool).toHaveLength(0);
  });

  it("draft (non-active) status skips validation", () => {
    const t = getWeeklyTemplate("group_most_draws")!;
    expect(t.validate({ templateKey: "group_most_draws", groups: [] }, ctx([], { status: "disabled" }))).toHaveLength(0);
  });

  it("validateWeeklyQuestionByTemplate is legacy-safe (no template_key → [])", () => {
    expect(validateWeeklyQuestionByTemplate({ foo: "bar" }, null, ctx([]))).toHaveLength(0);
  });

  it("validateWeeklyQuestionByTemplate reconstructs upset candidates from options", () => {
    const config = { template_key: "underdog_not_lose" };
    const options = [{ id: "no_upset", label: "Сенсаций не будет" }];
    const issues = validateWeeklyQuestionByTemplate(config, null, ctx([]), options);
    expect(issues.map((i) => i.code)).toContain("WEEKLY_UPSET_MIN_TWO");
  });
});

describe("templates added 2026-09-16", () => {
  it("clean_sheet_win: fixed ids, team-named labels, calculation in config", () => {
    const built = getWeeklyTemplate("clean_sheet_win")!.buildQuestion({ templateKey: "clean_sheet_win", matchRef: "1", homeTeamName: "Арсенал", awayTeamName: "Челси" });
    expect(built.options.map((o) => o.id)).toEqual(["home_clean_win", "away_clean_win", "no"]);
    expect(built.options[0].label).toBe("Арсенал выиграет на ноль");
    expect(built.config.calculation).toBe("clean_sheet_win");
  });

  it("group_most_corners reuses the group builder with corners_count", () => {
    const built = getWeeklyTemplate("group_most_corners")!.buildQuestion({ templateKey: "group_most_corners", groups: [{ title: "A", match_ids: ["1"] }, { title: "B", match_ids: ["2"] }] });
    expect(built.options.map((o) => o.id)).toEqual(["group_1", "group_2", "equal"]);
    expect(built.config.calculation).toBe("corners_count");
  });

  it("pool_biggest_margin: fixed margin buckets, scope validation", () => {
    const t = getWeeklyTemplate("pool_biggest_margin")!;
    expect(t.buildQuestion({ templateKey: "pool_biggest_margin" }).options.map((o) => o.id)).toEqual(["margin_0_1", "margin_2", "margin_3", "margin_4_plus"]);
    expect(t.validate({ templateKey: "pool_biggest_margin", scope: { type: "selected", match_refs: [] } }, ctx(["1"])).map((i) => i.code)).toContain("WEEKLY_POOL_SCOPE_EMPTY");
  });

  it("team_conceded_duel rejects a player side and never voids on minutes", () => {
    const t = getWeeklyTemplate("team_conceded_duel")!;
    const bad = t.validate({ templateKey: "team_conceded_duel", duel: { side_a: { kind: "player", name: "Салах" }, side_b: { kind: "team", team_name: "Челси" } } }, ctx([]));
    expect(bad.map((i) => i.code)).toContain("WEEKLY_DUEL_TEAMS_ONLY");
    const built = t.buildQuestion({ templateKey: "team_conceded_duel", duel: { side_a: { kind: "team", team_name: "Арсенал" }, side_b: { kind: "team", team_name: "Челси" } } });
    expect(built.options.map((o) => o.id)).toEqual(["player_a", "player_b", "equal"]);
    expect(built.config.void_if_player_did_not_play).toBe(false);
    expect(built.config.calculation).toBe("goals_conceded_fewer");
  });

  it("older duel templates still accept either side kind", () => {
    const t = getWeeklyTemplate("team_goals_duel")!;
    expect(t.validate({ templateKey: "team_goals_duel", duel: { side_a: { kind: "player", name: "A" }, side_b: { kind: "player", name: "B" } } }, ctx([]))).toHaveLength(0);
  });

  it("event templates: red cards and fastest goal", () => {
    expect(getWeeklyTemplate("any_red_card")!.buildQuestion({ templateKey: "any_red_card" }).config.event_type).toBe("any_red_card");
    expect(getWeeklyTemplate("red_cards_count")!.buildQuestion({ templateKey: "red_cards_count" }).options.map((o) => o.id)).toEqual(["count_0", "count_1", "count_2", "count_3_plus"]);
    const fastest = getWeeklyTemplate("fastest_goal_window")!.buildQuestion({ templateKey: "fastest_goal_window", scope: { type: "selected", match_refs: ["1"] } });
    expect(fastest.options.map((o) => o.id)).toEqual(["first_goal_1_5", "first_goal_6_15", "first_goal_16_plus", "no_goals"]);
    expect(fastest.config.scope).toEqual({ type: "selected", match_refs: ["1"] });
  });
});
