import { describe, it, expect } from "vitest";
import {
  weeklyTemplateRegistrySnapshot as beSnapshot,
  weeklyTemplateManifest as beManifest,
  WEEKLY_QUESTION_TEMPLATES as BE_TEMPLATES,
  validateWeeklyQuestionByTemplate,
  type WeeklyTemplateInput,
} from "../weeklyChallengeTemplates";
// Frontend mirror — pure TS (no React / no path aliases) so vitest can import it directly.
import {
  weeklyTemplateRegistrySnapshot as feSnapshot,
  weeklyTemplateManifest as feManifest,
  WEEKLY_QUESTION_TEMPLATES as FE_TEMPLATES,
} from "../../../web/app/season-predictions/weeklyTemplates";

describe("BE↔FE template registry parity", () => {
  it("registry snapshots match exactly (keys, questionKey, modes, answerMode, fixed ids)", () => {
    expect(feSnapshot()).toEqual(beSnapshot());
  });

  it("full serializable manifest matches exactly (rules, calc, tie, void, scope, counts)", () => {
    expect(feManifest()).toEqual(beManifest());
  });

  it("manifest covers every required serializable field for all 15 templates", () => {
    const m = beManifest();
    expect(m).toHaveLength(30);
    for (const e of m) {
      expect(typeof e.answerMode).toBe("string");
      expect(typeof e.defaultTitle).toBe("string");
      expect(Array.isArray(e.optionIds)).toBe(true);
      expect(Array.isArray(e.validationRuleIds)).toBe(true);
      expect(e.validationRuleIds.length).toBeGreaterThan(0);
      expect("calculationKey" in e && "tieBehavior" in e && "voidRuleKey" in e && "scopeMode" in e && "fallbackOptionId" in e).toBe(true);
    }
  });

  it("negative: a single manifest rule change is detected (parity would fail)", () => {
    const drifted = beManifest().map((e, i) => i === 0 ? { ...e, validationRuleIds: [...e.validationRuleIds, "DRIFT"] } : e);
    expect(drifted).not.toEqual(feManifest());
  });

  it("emits identical option ids for a representative input per template", () => {
    const sampleInput: Record<string, unknown> = {
      matchRef: "1",
      homeTeamName: "Дом",
      awayTeamName: "Гости",
      groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }],
      duel: { side_a: { kind: "player", name: "A" }, side_b: { kind: "player", name: "B" } },
      upsetCandidates: [{ team_name: "X" }, { team_name: "Y" }],
      upsetCountMatches: [{ match_ref: "1", favorite_side: "home" }],
      scope: { type: "all_pool" },
    };
    for (const beT of BE_TEMPLATES) {
      const feT = FE_TEMPLATES.find((t) => t.templateKey === beT.templateKey)!;
      const beBuilt = beT.buildQuestion({ templateKey: beT.templateKey, ...(sampleInput as object) } as never);
      const feBuilt = feT.buildQuestion({ templateKey: feT.templateKey, ...(sampleInput as object) } as never);
      expect(feBuilt.options.map((o) => o.id)).toEqual(beBuilt.options.map((o) => o.id));
      expect((feBuilt.config as Record<string, unknown>).template_key).toEqual((beBuilt.config as Record<string, unknown>).template_key);
    }
  });
});

// What the admin builder generates must pass the backend's template validation. Each
// template gets a minimal satisfying input + matching pool; the built output validates clean.
describe("builder → backend round-trip", () => {
  const poolRefs = new Set(["1", "2"]);
  const satisfyingInput: Record<string, WeeklyTemplateInput> = {
    match_result: { templateKey: "match_result", matchRef: "1", homeTeamName: "Дом", awayTeamName: "Гости" },
    both_teams_to_score: { templateKey: "both_teams_to_score", matchRef: "1" },
    match_goals_range: { templateKey: "match_goals_range", matchRef: "1" },
    group_highest_average_goals: { templateKey: "group_highest_average_goals", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }] },
    group_most_draws: { templateKey: "group_most_draws", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }] },
    group_most_btts: { templateKey: "group_most_btts", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }] },
    player_goals_duel: { templateKey: "player_goals_duel", duel: { side_a: { kind: "player", name: "A" }, side_b: { kind: "player", name: "B" } } },
    team_goals_duel: { templateKey: "team_goals_duel", duel: { side_a: { kind: "team", team_name: "A" }, side_b: { kind: "team", team_name: "B" } } },
    player_vs_team_goals: { templateKey: "player_vs_team_goals", duel: { side_a: { kind: "player", name: "A" }, side_b: { kind: "team", team_name: "B" } } },
    underdog_not_lose: { templateKey: "underdog_not_lose", upsetCandidates: [{ team_name: "X" }, { team_name: "Y" }] },
    favorite_drops_points: { templateKey: "favorite_drops_points", upsetCandidates: [{ team_name: "X" }, { team_name: "Y" }] },
    upset_count: { templateKey: "upset_count", upsetCountMatches: [{ match_ref: "1", favorite_side: "home" }] },
    any_five_plus_goals: { templateKey: "any_five_plus_goals", scope: { type: "all_pool" } },
    any_zero_zero: { templateKey: "any_zero_zero", scope: { type: "all_pool" } },
    draws_count_event: { templateKey: "draws_count_event", scope: { type: "all_pool" } },
    pool_total_goals_bucket: { templateKey: "pool_total_goals_bucket", scope: { type: "all_pool" }, goalsBuckets: [10, 16] },
    pool_big_wins_count: { templateKey: "pool_big_wins_count", scope: { type: "all_pool" }, countMax: 3 },
    pool_btts_count: { templateKey: "pool_btts_count", scope: { type: "all_pool" }, countMax: 3 },
    pool_clean_sheets_count: { templateKey: "pool_clean_sheets_count", scope: { type: "all_pool" }, countMax: 3 },
    pool_top_scoring_match: { templateKey: "pool_top_scoring_match", matchOptions: [{ match_ref: "1", label: "A" }, { match_ref: "2", label: "B" }] },
    pool_outcome_balance: { templateKey: "pool_outcome_balance", scope: { type: "all_pool" }, includeDraws: true },
    league_top_scoring: { templateKey: "league_top_scoring", leagues: [{ code: "PL", label: "АПЛ" }, { code: "PD", label: "Ла Лига" }] },
    league_most_home_wins: { templateKey: "league_most_home_wins", leagues: [{ code: "PL", label: "АПЛ" }, { code: "PD", label: "Ла Лига" }] },
    clean_sheet_win: { templateKey: "clean_sheet_win", matchRef: "1", homeTeamName: "Дом", awayTeamName: "Гости" },
    group_most_corners: { templateKey: "group_most_corners", groups: [{ id: "g1", title: "A", match_ids: ["1"] }, { id: "g2", title: "B", match_ids: ["2"] }] },
    pool_biggest_margin: { templateKey: "pool_biggest_margin", scope: { type: "all_pool" } },
    team_conceded_duel: { templateKey: "team_conceded_duel", duel: { side_a: { kind: "team", team_name: "A" }, side_b: { kind: "team", team_name: "B" } } },
    any_red_card: { templateKey: "any_red_card", scope: { type: "all_pool" } },
    red_cards_count: { templateKey: "red_cards_count", scope: { type: "selected", match_refs: ["1", "2"] } },
    fastest_goal_window: { templateKey: "fastest_goal_window", scope: { type: "all_pool" } },
  };

  for (const t of BE_TEMPLATES) {
    it(`${t.templateKey} built output passes backend validation`, () => {
      const input = satisfyingInput[t.templateKey];
      expect(input, `missing satisfying input for ${t.templateKey}`).toBeTruthy();
      const built = t.buildQuestion(input);
      const issues = validateWeeklyQuestionByTemplate(built.config, null, { poolRefs, mode: "club", status: "active" }, built.options);
      expect(issues, JSON.stringify(issues)).toHaveLength(0);
    });
  }
});
