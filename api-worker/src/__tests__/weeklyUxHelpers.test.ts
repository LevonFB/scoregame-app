import { describe, it, expect } from "vitest";
import { resolveWeeklyGroups, weeklyGroupMatchRefs, isGenericGroupTitle } from "../../../web/app/season-predictions/weeklyGroups";
import { deriveWeeklyGoals, type WeeklyGoalTaskLike } from "../../../web/app/season-predictions/weeklyGoals";

const pool = [
  { match_id: "m1", home_team_name: "Netherlands", away_team_name: "Sweden", kickoff_at: 100 },
  { match_id: "m2", home_team_name: "Germany", away_team_name: "Côte d'Ivoire", kickoff_at: 200 },
  { match_id: "m3", home_team_name: "Spain", away_team_name: "Saudi Arabia", kickoff_at: 300 },
  { match_id: "m4", home_team_name: "Belgium", away_team_name: "Iran", kickoff_at: 400 },
  { match_id: null, home_team_name: "Uruguay", away_team_name: "Cabo Verde", kickoff_at: 500 },
];

describe("resolveWeeklyGroups", () => {
  it("resolves group match_ids to team-name snapshots", () => {
    const cfg = { template_key: "group_most_draws", groups: [
      { id: "g1", title: "Группа 1", match_ids: ["m1", "m2"] },
      { id: "g2", title: "Европа", match_ids: ["m3", "m4"] },
    ] };
    const groups = resolveWeeklyGroups(cfg, pool)!;
    expect(groups).toHaveLength(2);
    expect(groups[0].matches.map((m) => `${m.home} — ${m.away}`)).toEqual(["Netherlands — Sweden", "Germany — Côte d'Ivoire"]);
    expect(groups[1].title).toBe("Европа");
    expect(groups[0].matches[0].kickoff_at).toBe(100);
    expect(groups[0].matches.every((m) => !m.missing)).toBe(true);
  });

  it("resolves pool_N synthetic refs for id-less matches", () => {
    const cfg = { groups: [{ id: "g1", title: "A", match_ids: ["pool_5"] }, { id: "g2", title: "B", match_ids: ["m1"] }] };
    const groups = resolveWeeklyGroups(cfg, pool)!;
    expect(groups[0].matches[0].home).toBe("Uruguay");
  });

  it("flags missing snapshots instead of crashing", () => {
    const cfg = { groups: [{ id: "g1", title: "A", match_ids: ["ghost"] }, { id: "g2", title: "B", match_ids: ["m1"] }] };
    const groups = resolveWeeklyGroups(cfg, pool)!;
    expect(groups[0].matches[0].missing).toBe(true);
  });

  it("returns null for legacy / non-group config", () => {
    expect(resolveWeeklyGroups({ calculation: "average_goals_per_match" }, pool)).toBeNull();
    expect(resolveWeeklyGroups({}, pool)).toBeNull();
  });

  it("weeklyGroupMatchRefs collects all refs; generic title detection", () => {
    const cfg = { groups: [{ id: "g1", title: "Группа 1", match_ids: ["m1", "m2"] }, { id: "g2", title: "Европа", match_ids: ["m3"] }] };
    expect([...weeklyGroupMatchRefs(cfg)].sort()).toEqual(["m1", "m2", "m3"]);
    expect(isGenericGroupTitle("Группа 1")).toBe(true);
    expect(isGenericGroupTitle("Новая группа")).toBe(true);
    expect(isGenericGroupTitle("Европа")).toBe(false);
  });
});

function v2Tasks(overrides: { started?: boolean; answered?: boolean; submitted?: boolean; bonus?: string; result?: string } = {}): WeeklyGoalTaskLike[] {
  return [
    { key: "weekly_challenge_participation", status: "in_progress", reward: { stars: 2, balls: 0, case_type: null, case_count: 0 }, steps: [
      { key: "started", title: "Начат", completed: overrides.started ?? false },
      { key: "answered", title: "5 ответов", completed: overrides.answered ?? false },
      { key: "submitted", title: "Подтверждён", completed: overrides.submitted ?? false },
    ] },
    { key: "weekly_challenge_bonus", status: overrides.bonus ?? "in_progress", reward: { stars: 2, balls: 0, case_type: null, case_count: 0 } },
    { key: "weekly_challenge_result", status: overrides.result ?? "waiting_results", reward: { stars: 3, balls: 1, case_type: null, case_count: 0 } },
  ];
}

describe("deriveWeeklyGoals", () => {
  it("maps 3 V2 tasks to 5 goals, 3 rewards", () => {
    const s = deriveWeeklyGoals(v2Tasks());
    expect(s.isV2).toBe(true);
    expect(s.goalsTotal).toBe(5);
    expect(s.rewardsTotal).toBe(3);
    expect(s.goalsDone).toBe(0);
    expect(s.goals.map((g) => g.key)).toEqual(["started", "answered", "submitted", "bonus", "result"]);
  });

  it("counts completed goals across steps + bonus + result", () => {
    const s = deriveWeeklyGoals(v2Tasks({ started: true, answered: true, submitted: true, bonus: "claimable", result: "claimed" }));
    expect(s.goalsDone).toBe(5);
  });

  it("partial: 3 participation steps done, bonus/result pending → 3/5", () => {
    const s = deriveWeeklyGoals(v2Tasks({ started: true, answered: true, submitted: true }));
    expect(s.goalsDone).toBe(3);
  });

  it("falls back to backend progress for legacy V1 (no steps)", () => {
    const v1: WeeklyGoalTaskLike[] = [
      { key: "weekly_challenge_started", status: "claimed", reward: { stars: 1, balls: 0, case_type: null, case_count: 0 } },
      { key: "weekly_challenge_submitted", status: "claimable", reward: { stars: 2, balls: 0, case_type: null, case_count: 0 } },
    ];
    const s = deriveWeeklyGoals(v1, { current: 1, target: 6 });
    expect(s.isV2).toBe(false);
    expect(s.goalsDone).toBe(1);
    expect(s.goalsTotal).toBe(6);
    expect(s.rewardsTotal).toBe(2);
  });
});
