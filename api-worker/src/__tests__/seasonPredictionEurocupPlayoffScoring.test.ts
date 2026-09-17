import { describe, it, expect } from "vitest";
import {
  scoreEurocupPlayoffBracket,
  combineEurocupFullScore,
  eurocupRecalcStageReadiness,
  officialEurocupStageReached,
  userEurocupStageReached,
  EUROCUPS_FULL_FORMULA_VERSION,
  EUROCUP_FULL_MAX_POINTS,
  EUROCUP_TIES_MAX_POINTS,
  EUROCUP_BRACKET_MAX_POINTS,
  type KnockoutMatchRow,
  type EurocupUserBracketPicks,
  type EurocupPlayoffScopeStage,
} from "../seasonPredictionEurocupPlayoffScoring";

const CODE = "UCL";

function off(match_key: string, stage: string, winner: string | null, status = "completed"): KnockoutMatchRow {
  return { match_key, stage, match_order: 1, team_a_id: winner ?? "a", team_b_id: `${winner ?? "a"}_b`, winner_team_id: winner, status };
}

// 8 quarterfinalists q1..q8; semifinalists q1,q3,q5,q7; finalists q1,q5; champion q1.
function perfectOfficialMatches(): KnockoutMatchRow[] {
  const m: KnockoutMatchRow[] = [];
  for (let i = 1; i <= 8; i += 1) m.push(off(`${CODE}_KP_${i}`, "knockout_playoffs", `w${i}`));
  for (let i = 1; i <= 8; i += 1) m.push(off(`${CODE}_R16_${i}`, "round_of_16", `q${i}`));
  m.push(off(`${CODE}_QF_1`, "quarter_final", "q1"));
  m.push(off(`${CODE}_QF_2`, "quarter_final", "q3"));
  m.push(off(`${CODE}_QF_3`, "quarter_final", "q5"));
  m.push(off(`${CODE}_QF_4`, "quarter_final", "q7"));
  m.push(off(`${CODE}_SF_1`, "semi_final", "q1"));
  m.push(off(`${CODE}_SF_2`, "semi_final", "q5"));
  m.push(off(`${CODE}_FINAL`, "final", "q1"));
  return m;
}

function perfectPicks(): EurocupUserBracketPicks {
  const kp: Record<string, string> = {};
  for (let i = 1; i <= 8; i += 1) kp[`${CODE}_KP_${i}`] = `w${i}`;
  const r16: Record<string, string> = {};
  for (let i = 1; i <= 8; i += 1) r16[`${CODE}_R16_${i}`] = `q${i}`;
  return {
    knockout_playoffs: kp,
    round_of_16: r16,
    quarter_final: { [`${CODE}_QF_1`]: "q1", [`${CODE}_QF_2`]: "q3", [`${CODE}_QF_3`]: "q5", [`${CODE}_QF_4`]: "q7" },
    semi_final: { [`${CODE}_SF_1`]: "q1", [`${CODE}_SF_2`]: "q5" },
    final: { [`${CODE}_FINAL`]: "q1" },
    champion_team_id: "q1",
  };
}

describe("play-off ties scoring", () => {
  it("1. 8/8 correct → 32", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    expect(r.ties_points).toBe(32);
    expect(r.ties_max).toBe(32);
    expect(r.playoffs.correct).toBe(8);
    expect(r.playoffs.total).toBe(8);
  });

  it("2. 6/8 correct → 24", () => {
    const picks = perfectPicks();
    (picks.knockout_playoffs as Record<string, string>)[`${CODE}_KP_7`] = "wrong";
    (picks.knockout_playoffs as Record<string, string>)[`${CODE}_KP_8`] = "wrong";
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.ties_points).toBe(24);
    expect(r.playoffs.correct).toBe(6);
  });

  it("3. 0/8 → 0", () => {
    const picks = perfectPicks();
    const kp = picks.knockout_playoffs as Record<string, string>;
    for (const k of Object.keys(kp)) kp[k] = "nope";
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.ties_points).toBe(0);
    expect(r.ties_max).toBe(32);
  });

  it("4. no user pick → 0 points but max still counts confirmed ties", () => {
    const picks = perfectPicks();
    picks.knockout_playoffs = {};
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.ties_points).toBe(0);
    expect(r.ties_max).toBe(32);
    expect(r.playoffs.matches.every((m) => m.status === "no_pick")).toBe(true);
  });

  it("5. void / unconfirmed ties do not enter the max", () => {
    const matches = perfectOfficialMatches().map((m) =>
      m.match_key === `${CODE}_KP_8` ? { ...m, status: "void", winner_team_id: null } : m);
    const matches2 = matches.map((m) =>
      m.match_key === `${CODE}_KP_7` ? { ...m, status: "confirmed", winner_team_id: null } : m);
    const r = scoreEurocupPlayoffBracket({ officialMatches: matches2, picks: perfectPicks(), bracketSubmitted: true });
    // 6 decided ties → max 24, all 6 correct.
    expect(r.ties_max).toBe(24);
    expect(r.ties_points).toBe(24);
    expect(r.playoffs.total).toBe(6);
  });
});

describe("bracket scoring (stage-based)", () => {
  it("6. perfect bracket → 120", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket_points).toBe(120);
    expect(r.bracket_max).toBe(120);
    expect(r.bracket.quarterfinalists.points).toBe(32);
    expect(r.bracket.semifinalists.points).toBe(24);
    expect(r.bracket.finalists.points).toBe(20);
    expect(r.bracket.champion.points).toBe(20);
  });

  it("7. champion correct but a finalist wrong → champion scores, finalist bonus lost", () => {
    const picks = perfectPicks();
    // predict finalist q9 (never reaches) instead of q5 in SF_2 but keep champion q1
    picks.semi_final = { [`${CODE}_SF_1`]: "q1", [`${CODE}_SF_2`]: "q9" };
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.bracket.finalists.correct).toBe(1);
    expect(r.bracket.finalists.points).toBe(10);
    expect(r.bracket.bonuses.all_finalists.earned).toBe(false);
    expect(r.bracket.champion.correct).toBe(true);
    expect(r.bracket.champion.points).toBe(20);
    expect(r.bracket.bonuses.champion_bonus.earned).toBe(true);
  });

  it("8. all quarterfinalists bonus", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket.bonuses.all_quarterfinalists.earned).toBe(true);
    expect(r.bracket.bonuses.all_quarterfinalists.points).toBe(4);
  });

  it("9. all semifinalists bonus", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket.bonuses.all_semifinalists.earned).toBe(true);
    expect(r.bracket.bonuses.all_semifinalists.points).toBe(8);
  });

  it("10. finalists bonus", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket.bonuses.all_finalists.earned).toBe(true);
    expect(r.bracket.bonuses.all_finalists.points).toBe(8);
  });

  it("11. champion bonus only", () => {
    const picks = perfectPicks();
    // wreck quarterfinalists so no all_* bonus except champion
    picks.round_of_16 = { [`${CODE}_R16_1`]: "q1" }; // only one predicted QF team
    picks.quarter_final = { [`${CODE}_QF_1`]: "q1" };
    picks.semi_final = { [`${CODE}_SF_1`]: "q1" };
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.bracket.bonuses.champion_bonus.earned).toBe(true);
    expect(r.bracket.bonuses.all_quarterfinalists.earned).toBe(false);
    expect(r.bracket.champion.points).toBe(20);
  });

  it("12. stage-based scoring is independent of exact bracket path", () => {
    const picks = perfectPicks();
    // Same semifinalist SET {q1,q5} but placed in swapped SF slots → still 2 correct.
    picks.semi_final = { [`${CODE}_SF_1`]: "q5", [`${CODE}_SF_2`]: "q1" };
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks, bracketSubmitted: true });
    expect(r.bracket.finalists.correct).toBe(2);
    expect(r.bracket.finalists.points).toBe(20);
  });

  it("13. partial official: only 1/8 confirmed → only QF max counts", () => {
    // Keep r16 confirmed, blank qf/sf/final winners.
    const matches = perfectOfficialMatches().map((m) =>
      ["quarter_final", "semi_final", "final"].includes(String(m.stage))
        ? { ...m, winner_team_id: null, status: "confirmed" } : m);
    const r = scoreEurocupPlayoffBracket({ officialMatches: matches, picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket.quarterfinalists.resolved).toBe(true);
    expect(r.bracket.semifinalists.resolved).toBe(false);
    expect(r.bracket.quarterfinalists.points).toBe(32);
    // QF 32 + all_qf bonus 4 = 36 max; nothing downstream.
    expect(r.bracket_max).toBe(36);
    expect(r.bracket_points).toBe(36);
  });

  it("13b. no official bracket confirmed → bracket max 0", () => {
    const matches = perfectOfficialMatches().map((m) =>
      m.stage === "knockout_playoffs" ? m : { ...m, winner_team_id: null, status: "confirmed" });
    const r = scoreEurocupPlayoffBracket({ officialMatches: matches, picks: perfectPicks(), bracketSubmitted: true });
    expect(r.bracket_max).toBe(0);
    expect(r.bracket_points).toBe(0);
  });

  it("14. user not submitted → no points and no max", () => {
    const r = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: false });
    expect(r.ties_points).toBe(0);
    expect(r.ties_max).toBe(0);
    expect(r.bracket_points).toBe(0);
    expect(r.bracket_max).toBe(0);
    expect(r.bracket.predicted).toBe(false);
    expect(r.playoffs.predicted).toBe(false);
  });
});

describe("stage-reached helpers", () => {
  it("15. official stage reached from confirmed matches", () => {
    const off = officialEurocupStageReached(perfectOfficialMatches());
    expect(off.quarterfinalists.sort()).toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
    expect(off.semifinalists.sort()).toEqual(["q1", "q3", "q5", "q7"]);
    expect(off.finalists.sort()).toEqual(["q1", "q5"]);
    expect(off.champion).toBe("q1");
    expect(off.championComplete).toBe(true);
  });

  it("16. user predicted stage reached from picks", () => {
    const usr = userEurocupStageReached(perfectPicks());
    expect(usr.quarterfinalists.length).toBe(8);
    expect(usr.semifinalists.sort()).toEqual(["q1", "q3", "q5", "q7"]);
    expect(usr.finalists.sort()).toEqual(["q1", "q5"]);
    expect(usr.champion).toBe("q1");
  });
});

describe("full score combine", () => {
  const leaguePerfect = {
    total_points: 100,
    max_possible_points: 100,
    breakdown: { formula_version: "eurocups_v2", summary: { top8_correct: 8 }, bonuses: [] },
  };

  it("17. one tournament perfect = 100 + 32 + 120 = 252", () => {
    const pb = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true });
    const full = combineEurocupFullScore(leaguePerfect, pb);
    expect(full.total_points).toBe(252);
    expect(full.max_possible_points).toBe(EUROCUP_FULL_MAX_POINTS);
    expect(full.max_possible_points).toBe(252);
    expect(full.points_pct).toBe(1);
    expect(full.formula_version).toBe(EUROCUPS_FULL_FORMULA_VERSION);
    // league breakdown preserved at top level for leaderboard + legacy UI.
    expect((full.breakdown as any).summary.top8_correct).toBe(8);
    expect((full.breakdown as any).league_stage.points).toBe(100);
    expect((full.breakdown as any).total.points).toBe(252);
  });

  it("constants: ties 32, bracket 120, three cups 756", () => {
    expect(EUROCUP_TIES_MAX_POINTS).toBe(32);
    expect(EUROCUP_BRACKET_MAX_POINTS).toBe(120);
    expect(EUROCUP_FULL_MAX_POINTS * 3).toBe(756);
  });

  it("league-only when bracket not submitted → max stays 100", () => {
    const pb = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: {}, bracketSubmitted: false });
    const full = combineEurocupFullScore(leaguePerfect, pb);
    expect(full.total_points).toBe(100);
    expect(full.max_possible_points).toBe(100);
  });
});

describe("stage-scoped eurocup recalc scoring", () => {
  it("stage=ties includes only playoff ties", () => {
    const r = scoreEurocupPlayoffBracket({
      officialMatches: perfectOfficialMatches(),
      picks: perfectPicks(),
      bracketSubmitted: true,
      scopeStage: "ties",
    });
    expect(r.ties_points).toBe(32);
    expect(r.ties_max).toBe(32);
    expect(r.bracket_points).toBe(0);
    expect(r.bracket_max).toBe(0);
  });

  it("stage=r16 includes ties + quarterfinalists, but not qf/sf/final", () => {
    const r = scoreEurocupPlayoffBracket({
      officialMatches: perfectOfficialMatches(),
      picks: perfectPicks(),
      bracketSubmitted: true,
      scopeStage: "r16",
    });
    expect(r.ties_max).toBe(32);
    expect(r.bracket.quarterfinalists.resolved).toBe(true);
    expect(r.bracket.semifinalists.resolved).toBe(false);
    expect(r.bracket.finalists.resolved).toBe(false);
    expect(r.bracket.champion.resolved).toBe(false);
    expect(r.bracket_max).toBe(36);
  });

  it("stage=qf includes semifinalists, but not finalists/champion", () => {
    const r = scoreEurocupPlayoffBracket({
      officialMatches: perfectOfficialMatches(),
      picks: perfectPicks(),
      bracketSubmitted: true,
      scopeStage: "qf",
    });
    expect(r.bracket.quarterfinalists.resolved).toBe(true);
    expect(r.bracket.semifinalists.resolved).toBe(true);
    expect(r.bracket.finalists.resolved).toBe(false);
    expect(r.bracket.champion.resolved).toBe(false);
    expect(r.bracket_max).toBe(68);
  });

  it("stage=sf includes finalists, but not champion", () => {
    const r = scoreEurocupPlayoffBracket({
      officialMatches: perfectOfficialMatches(),
      picks: perfectPicks(),
      bracketSubmitted: true,
      scopeStage: "sf",
    });
    expect(r.bracket.finalists.resolved).toBe(true);
    expect(r.bracket.champion.resolved).toBe(false);
    expect(r.bracket_max).toBe(96);
  });

  it("stage=final gives full playoff/bracket max", () => {
    const pb = scoreEurocupPlayoffBracket({
      officialMatches: perfectOfficialMatches(),
      picks: perfectPicks(),
      bracketSubmitted: true,
      scopeStage: "final",
    });
    const full = combineEurocupFullScore({
      total_points: 100,
      max_possible_points: 100,
      breakdown: { formula_version: "eurocups_v2" },
    }, pb);
    expect(pb.ties_max + pb.bracket_max).toBe(152);
    expect(full.max_possible_points).toBe(252);
  });

  it("readiness detects missing ties and missing complete r16", () => {
    const noTies = perfectOfficialMatches().map((m) =>
      m.stage === "knockout_playoffs" ? { ...m, winner_team_id: null, status: "confirmed" } : m);
    expect(eurocupRecalcStageReadiness(noTies, "ties")).toMatchObject({ required: 8, decided: 0, ready: false });

    const partialR16 = perfectOfficialMatches().map((m) =>
      m.match_key === `${CODE}_R16_8` ? { ...m, winner_team_id: null, status: "confirmed" } : m);
    expect(eurocupRecalcStageReadiness(partialR16, "r16")).toMatchObject({ required: 8, decided: 7, ready: false });
  });

  // Smoke-test: the combined tournament max grows progressively per recalc stage
  // (league 100 + ties 32 + R16 36 + QF 32 + SF 28 + Final 24 = 252).
  it("combined tournament max per stage: 132 / 168 / 200 / 228 / 252", () => {
    const league = { total_points: 100, max_possible_points: 100, breakdown: { formula_version: "eurocups_v2" } };
    const expected: Array<[EurocupPlayoffScopeStage, number]> = [
      ["ties", 132], ["r16", 168], ["qf", 200], ["sf", 228], ["final", 252], ["full", 252],
    ];
    for (const [scope, max] of expected) {
      const pb = scoreEurocupPlayoffBracket({ officialMatches: perfectOfficialMatches(), picks: perfectPicks(), bracketSubmitted: true, scopeStage: scope });
      const full = combineEurocupFullScore(league, pb);
      expect(full.max_possible_points).toBe(max);
    }
  });
});
