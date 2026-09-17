import { describe, it, expect } from "vitest";
import {
  buildEurocupKnockoutSlots,
  EUROCUP_KNOCKOUT_TOTAL_SLOTS,
  EUROCUP_KNOCKOUT_STAGES,
  isKnockoutMatchKnown,
  validateAdminKnockoutMatches,
  validateUserKnockoutPicks,
  sortKnockoutMatches,
  eurocupKnockoutStageResultsConfirmed,
  eurocupKnockoutLockedStages,
  eurocupBracketResultsConfirmed,
  eurocupDownstreamKnockoutPairUpdates,
  lockedStagePickConflict,
  applyLockedStagePicks,
  eurocupKnockoutBracketSources,
  eurocupPlayoffWinners,
  eurocupR16Eligibility,
  validateR16BracketComplete,
  deriveUserBracketMatches,
  planEurocupBulkStageStatus,
  normalizeKnockoutStageParam,
  type KnockoutSlotMeta,
  type KnownMatch,
} from "../seasonPredictionEurocupKnockout";

function slotMap(code: string): Map<string, KnockoutSlotMeta> {
  const m = new Map<string, KnockoutSlotMeta>();
  for (const s of buildEurocupKnockoutSlots(code)) m.set(s.match_key, { match_key: s.match_key, stage: s.stage });
  return m;
}

const ALL = new Set(["t1", "t2", "t3", "t4", "t9", "t10", "t11", "t12"]);
const ZONE = new Set(["t9", "t10", "t11", "t12"]); // official 9–24 zone subset

describe("buildEurocupKnockoutSlots", () => {
  it("creates 23 slots with correct per-stage counts", () => {
    const slots = buildEurocupKnockoutSlots("UCL");
    expect(slots.length).toBe(23);
    expect(EUROCUP_KNOCKOUT_TOTAL_SLOTS).toBe(23);
    for (const def of EUROCUP_KNOCKOUT_STAGES) {
      expect(slots.filter((s) => s.stage === def.stage).length).toBe(def.count);
    }
  });

  it("uses expected match_key format incl. final without index", () => {
    const slots = buildEurocupKnockoutSlots("UCL");
    const keys = slots.map((s) => s.match_key);
    expect(keys).toContain("UCL_KP_1");
    expect(keys).toContain("UCL_R16_8");
    expect(keys).toContain("UCL_QF_4");
    expect(keys).toContain("UCL_SF_2");
    expect(keys).toContain("UCL_FINAL");
    expect(keys).not.toContain("UCL_FINAL_1");
  });

  it("is deterministic (idempotent set) and code-scoped", () => {
    expect(buildEurocupKnockoutSlots("UEL").every((s) => s.match_key.startsWith("UEL_"))).toBe(true);
    expect(buildEurocupKnockoutSlots("UCL").map((s) => s.match_key))
      .toEqual(buildEurocupKnockoutSlots("UCL").map((s) => s.match_key));
  });
});

describe("isKnockoutMatchKnown", () => {
  it("known only when both teams set and confirmed/completed", () => {
    expect(isKnockoutMatchKnown({ team_a_id: "t1", team_b_id: "t2", status: "confirmed" })).toBe(true);
    expect(isKnockoutMatchKnown({ team_a_id: "t1", team_b_id: "t2", status: "completed" })).toBe(true);
    expect(isKnockoutMatchKnown({ team_a_id: "t1", team_b_id: "t2", status: "draft" })).toBe(false);
    expect(isKnockoutMatchKnown({ team_a_id: "t1", team_b_id: null, status: "confirmed" })).toBe(false);
  });
});

describe("validateAdminKnockoutMatches", () => {
  const slots = slotMap("UCL");

  it("rejects match_key not in tournament", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "XXX_KP_1" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_MATCH_NOT_IN_TOURNAMENT");
  });

  it("rejects team not in tournament", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "zzz" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_TEAM_NOT_IN_TOURNAMENT");
  });

  it("rejects playoff team outside official 9–24 zone", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t1", team_b_id: "t9" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_PLAYOFF_TEAM_NOT_IN_ZONE_9_24");
  });

  it("accepts playoff pair from the 9–24 zone (draft)", () => {
    const res = validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t10", status: "draft" }], slots, ALL, ZONE);
    expect(res[0]).toMatchObject({ match_key: "UCL_KP_1", stage: "knockout_playoffs", team_a_id: "t9", team_b_id: "t10", status: "draft" });
  });

  it("rejects winner not in match", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t10", winner_team_id: "t11" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_WINNER_NOT_IN_MATCH");
  });

  it("rejects confirmed without both teams", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", status: "confirmed" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_CONFIRMED_REQUIRES_BOTH_TEAMS");
  });

  it("rejects same team on both sides", () => {
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t9" }], slots, ALL, ZONE)).toThrow("KNOCKOUT_MATCH_SAME_TEAM");
  });

  it("rejects duplicate team within the same stage", () => {
    expect(() => validateAdminKnockoutMatches([
      { match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t10" },
      { match_key: "UCL_KP_2", team_a_id: "t9", team_b_id: "t11" },
    ], slots, ALL, ZONE)).toThrow("KNOCKOUT_TEAM_DUPLICATE_IN_STAGE");
  });

  it("void clears the winner", () => {
    const res = validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t10", winner_team_id: "t9", status: "void" }], slots, ALL, ZONE);
    expect(res[0].winner_team_id).toBeNull();
  });

  it("confirms a valid pair with winner", () => {
    const res = validateAdminKnockoutMatches([{ match_key: "UCL_KP_1", team_a_id: "t9", team_b_id: "t10", winner_team_id: "t9", status: "confirmed" }], slots, ALL, ZONE);
    expect(res[0]).toMatchObject({ status: "confirmed", winner_team_id: "t9" });
  });
});

describe("validateUserKnockoutPicks", () => {
  const known: KnownMatch[] = [
    { match_key: "UCL_KP_1", stage: "knockout_playoffs", team_a_id: "t9", team_b_id: "t10" },
    { match_key: "UCL_KP_2", stage: "knockout_playoffs", team_a_id: "t11", team_b_id: "t12" },
  ];

  it("saves draft for a known match", () => {
    const res = validateUserKnockoutPicks({ knockout_playoffs: { UCL_KP_1: "t9" } }, known, ALL, false);
    expect(res.picks.knockout_playoffs.UCL_KP_1).toBe("t9");
  });

  it("rejects pick for unknown match", () => {
    expect(() => validateUserKnockoutPicks({ knockout_playoffs: { UCL_KP_9: "t9" } }, known, ALL, false)).toThrow("KNOCKOUT_PICK_FOR_UNKNOWN_MATCH");
  });

  it("rejects winner not in the pair", () => {
    expect(() => validateUserKnockoutPicks({ knockout_playoffs: { UCL_KP_1: "t11" } }, known, ALL, false)).toThrow("KNOCKOUT_PICK_NOT_IN_MATCH");
  });

  it("submit requires all known matches picked", () => {
    expect(() => validateUserKnockoutPicks({ knockout_playoffs: { UCL_KP_1: "t9" } }, known, ALL, true)).toThrow("KNOCKOUT_PICKS_INCOMPLETE");
    const ok = validateUserKnockoutPicks({ knockout_playoffs: { UCL_KP_1: "t9", UCL_KP_2: "t12" } }, known, ALL, true);
    expect(Object.keys(ok.picks.knockout_playoffs).length).toBe(2);
  });

  it("champion must be a valid tournament team", () => {
    expect(() => validateUserKnockoutPicks({ champion_team_id: "zzz" }, known, ALL, false)).toThrow("KNOCKOUT_CHAMPION_INVALID");
    const res = validateUserKnockoutPicks({ champion_team_id: "t9" }, known, ALL, false);
    expect(res.champion_team_id).toBe("t9");
  });

  it("ignores empty picks and tolerates no known matches", () => {
    const res = validateUserKnockoutPicks({}, [], ALL, true);
    expect(res.champion_team_id).toBeNull();
    expect(Object.keys(res.picks).length).toBe(0);
  });
});

describe("eurocup knockout stage result lock", () => {
  const matches = [
    // playoffs: pairs confirmed, one with official winner → results confirmed
    { stage: "knockout_playoffs", status: "confirmed", team_a_id: "t9", team_b_id: "t10", winner_team_id: null },
    { stage: "knockout_playoffs", status: "completed", team_a_id: "t11", team_b_id: "t12", winner_team_id: "t11" },
    // round_of_16: pair confirmed, no winner → still open
    { stage: "round_of_16", status: "confirmed", team_a_id: "t1", team_b_id: "t2", winner_team_id: null },
    // void winner ignored
    { stage: "quarter_final", status: "void", team_a_id: "t1", team_b_id: "t2", winner_team_id: "t1" },
  ];

  it("stage is results-confirmed when any non-void match has an official winner", () => {
    expect(eurocupKnockoutStageResultsConfirmed(matches, "knockout_playoffs")).toBe(true);
    expect(eurocupKnockoutStageResultsConfirmed(matches, "round_of_16")).toBe(false);
    expect(eurocupKnockoutStageResultsConfirmed(matches, "quarter_final")).toBe(false); // void ignored
  });

  it("lockedStages contains only stages with confirmed results", () => {
    const locked = eurocupKnockoutLockedStages(matches);
    expect(locked.has("knockout_playoffs")).toBe(true);
    expect(locked.has("round_of_16")).toBe(false);
  });

  it("bracket lock starts only from official r16/qf/sf/final results", () => {
    expect(eurocupBracketResultsConfirmed(matches)).toBe(false);
    expect(eurocupBracketResultsConfirmed([
      ...matches,
      { stage: "round_of_16", status: "confirmed", winner_team_id: "t1" },
    ])).toBe(true);
    expect(eurocupBracketResultsConfirmed([
      { stage: "knockout_playoffs", status: "confirmed", winner_team_id: "w1" },
    ])).toBe(false);
  });

  it("conflict detected only when a locked stage's picks change", () => {
    const stored = { knockout_playoffs: { UCL_KP_1: "t9", UCL_KP_2: "t12" } };
    const locked = new Set(["knockout_playoffs"]);
    // same picks → no conflict
    expect(lockedStagePickConflict({ knockout_playoffs: { UCL_KP_1: "t9", UCL_KP_2: "t12" } }, stored, locked)).toBeNull();
    // changed pick in locked stage → conflict
    expect(lockedStagePickConflict({ knockout_playoffs: { UCL_KP_1: "t10", UCL_KP_2: "t12" } }, stored, locked)).toBe("knockout_playoffs");
    // change in a non-locked stage → no conflict
    expect(lockedStagePickConflict({ round_of_16: { UCL_R16_1: "t1" } }, stored, new Set(["knockout_playoffs"]))).toBeNull();
  });

  it("applyLockedStagePicks keeps stored picks for locked stages", () => {
    const stored = { knockout_playoffs: { UCL_KP_1: "t9" } };
    const merged = applyLockedStagePicks(
      { knockout_playoffs: { UCL_KP_1: "t10" }, round_of_16: { UCL_R16_1: "t1" } },
      stored,
      new Set(["knockout_playoffs"]),
    );
    expect(merged.knockout_playoffs).toEqual({ UCL_KP_1: "t9" }); // stored wins
    expect(merged.round_of_16).toEqual({ UCL_R16_1: "t1" }); // open stage untouched
  });
});

describe("eurocup 1/8 eligibility + bracket path", () => {
  const top8 = ["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"];
  const playoffsAllWon = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    stage: "knockout_playoffs", status: "completed", winner_team_id: `w${i}`,
  }));

  it("playoff winners = official winners of non-void playoff matches", () => {
    const matches = [
      { stage: "knockout_playoffs", status: "completed", winner_team_id: "w1" },
      { stage: "knockout_playoffs", status: "void", winner_team_id: "w2" },
      { stage: "round_of_16", status: "completed", winner_team_id: "x1" },
    ];
    expect(eurocupPlayoffWinners(matches)).toEqual(["w1"]);
  });

  it("eligible pool = top8 + 8 playoff winners = 16, ready", () => {
    const e = eurocupR16Eligibility(top8, playoffsAllWon);
    expect(e.eligible.size).toBe(16);
    expect(e.top8_confirmed).toBe(true);
    expect(e.winners_confirmed).toBe(true);
    expect(e.ready).toBe(true);
  });

  it("not ready if top8 incomplete or winners incomplete", () => {
    expect(eurocupR16Eligibility(top8.slice(0, 7), playoffsAllWon).ready).toBe(false);
    expect(eurocupR16Eligibility(top8, playoffsAllWon.slice(0, 7)).ready).toBe(false);
  });

  it("validateR16BracketComplete: rejects non-eligible / duplicates / wrong count, accepts valid", () => {
    const eligible = new Set([...top8, ...playoffsAllWon.map((m) => m.winner_team_id)]);
    const pairs = [
      { team_a_id: "t1", team_b_id: "w1" }, { team_a_id: "t2", team_b_id: "w2" },
      { team_a_id: "t3", team_b_id: "w3" }, { team_a_id: "t4", team_b_id: "w4" },
      { team_a_id: "t5", team_b_id: "w5" }, { team_a_id: "t6", team_b_id: "w6" },
      { team_a_id: "t7", team_b_id: "w7" }, { team_a_id: "t8", team_b_id: "w8" },
    ];
    expect(() => validateR16BracketComplete(pairs, eligible)).not.toThrow();
    // eliminated/loser team t99 not eligible
    const badTeam = [...pairs.slice(0, 7), { team_a_id: "t99", team_b_id: "w8" }];
    expect(() => validateR16BracketComplete(badTeam, eligible)).toThrow("EUROCUP_R16_TEAM_NOT_ELIGIBLE");
    // duplicate
    const dup = [...pairs.slice(0, 7), { team_a_id: "t1", team_b_id: "w8" }];
    expect(() => validateR16BracketComplete(dup, eligible)).toThrow("EUROCUP_R16_DUPLICATE_TEAM");
    // only 7 pairs
    expect(() => validateR16BracketComplete(pairs.slice(0, 7), eligible)).toThrow("EUROCUP_R16_REQUIRES_16_TEAMS");
    // eligible pool not 16
    expect(() => validateR16BracketComplete(pairs, new Set(top8))).toThrow("EUROCUP_R16_ELIGIBLE_TEAMS_REQUIRED");
  });

  it("bracket sources wire r16→qf→sf→final", () => {
    const s = eurocupKnockoutBracketSources("UCL");
    expect(s.UCL_QF_1).toEqual({ stage: "quarter_final", a: "UCL_R16_1", b: "UCL_R16_2" });
    expect(s.UCL_SF_1).toEqual({ stage: "semi_final", a: "UCL_QF_1", b: "UCL_QF_2" });
    expect(s.UCL_FINAL).toEqual({ stage: "final", a: "UCL_SF_1", b: "UCL_SF_2" });
  });

  it("deriveUserBracketMatches: qf known only after both r16 winners picked; final after sf", () => {
    const sources = eurocupKnockoutBracketSources("UCL");
    const r16Known: KnownMatch[] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
      match_key: `UCL_R16_${i}`, stage: "round_of_16" as const, team_a_id: `a${i}`, team_b_id: `b${i}`,
    }));
    // pick all r16 winners (team a), 2 qf winners, 1 sf winner
    const picks = {
      round_of_16: Object.fromEntries(r16Known.map((m) => [m.match_key, m.team_a_id])),
      quarter_final: { UCL_QF_1: "a1", UCL_QF_2: "a3" },
      semi_final: { UCL_SF_1: "a1" },
    };
    const derived = deriveUserBracketMatches(r16Known, picks, sources);
    const byKey = new Map(derived.map((m) => [m.match_key, m]));
    expect(byKey.get("UCL_QF_1")).toMatchObject({ team_a_id: "a1", team_b_id: "a2" });
    expect(byKey.get("UCL_SF_1")).toMatchObject({ team_a_id: "a1", team_b_id: "a3" });
    // SF_2 needs QF_3/QF_4 winners — not picked → not known
    expect(byKey.has("UCL_SF_2")).toBe(false);
    // FINAL needs SF_1/SF_2 → not known
    expect(byKey.has("UCL_FINAL")).toBe(false);
  });

  it("downstream official pairs are generated from confirmed winners without overwriting confirmed results", () => {
    const sources = eurocupKnockoutBracketSources("UCL");
    const rows = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
        match_key: `UCL_R16_${i}`,
        stage: "round_of_16",
        status: i % 2 === 0 ? "completed" : "confirmed",
        winner_team_id: `q${i}`,
      })),
      { match_key: "UCL_QF_1", stage: "quarter_final", status: "draft", winner_team_id: null },
      { match_key: "UCL_QF_2", stage: "quarter_final", status: "confirmed", winner_team_id: "existing" },
      { match_key: "UCL_QF_3", stage: "quarter_final", status: "draft", winner_team_id: null },
      { match_key: "UCL_QF_4", stage: "quarter_final", status: "draft", winner_team_id: null },
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    expect(updates.find((u) => u.match_key === "UCL_QF_1")).toMatchObject({ team_a_id: "q1", team_b_id: "q2" });
    expect(updates.find((u) => u.match_key === "UCL_QF_2")).toBeUndefined();
    expect(updates.find((u) => u.match_key === "UCL_QF_4")).toMatchObject({ team_a_id: "q7", team_b_id: "q8" });
  });

  it("does not generate a downstream pair until both source winners are confirmed", () => {
    const updates = eurocupDownstreamKnockoutPairUpdates([
      { match_key: "UCL_R16_1", stage: "round_of_16", status: "confirmed", winner_team_id: "q1" },
      { match_key: "UCL_R16_2", stage: "round_of_16", status: "confirmed", winner_team_id: null },
      { match_key: "UCL_QF_1", stage: "quarter_final", status: "draft", winner_team_id: null },
    ], eurocupKnockoutBracketSources("UCL"));
    expect(updates).toEqual([]);
  });

  it("does not treat draft winners as confirmed source results", () => {
    const updates = eurocupDownstreamKnockoutPairUpdates([
      { match_key: "UCL_R16_1", stage: "round_of_16", status: "draft", winner_team_id: "q1" },
      { match_key: "UCL_R16_2", stage: "round_of_16", status: "completed", winner_team_id: "q2" },
      { match_key: "UCL_QF_1", stage: "quarter_final", status: "draft", winner_team_id: null },
    ], eurocupKnockoutBracketSources("UCL"));
    expect(updates).toEqual([]);
  });

  it("admin r16 validation rejects non-eligible team", () => {
    const slots = slotMap("UCL");
    const eligible = new Set(["t1", "t2"]);
    expect(() => validateAdminKnockoutMatches([{ match_key: "UCL_R16_1", team_a_id: "t1", team_b_id: "zzz" }], slots, new Set(["t1", "t2", "zzz"]), new Set(), eligible)).toThrow("EUROCUP_R16_TEAM_NOT_ELIGIBLE");
    expect(validateAdminKnockoutMatches([{ match_key: "UCL_R16_1", team_a_id: "t1", team_b_id: "t2" }], slots, new Set(["t1", "t2"]), new Set(), eligible)[0].team_a_id).toBe("t1");
  });
});

describe("sortKnockoutMatches", () => {
  it("orders by stage then match_order", () => {
    const rows = [
      { stage: "final", match_order: 1 },
      { stage: "knockout_playoffs", match_order: 2 },
      { stage: "knockout_playoffs", match_order: 1 },
      { stage: "semi_final", match_order: 1 },
    ];
    expect(sortKnockoutMatches(rows).map((r) => `${r.stage}:${r.match_order}`)).toEqual([
      "knockout_playoffs:1", "knockout_playoffs:2", "semi_final:1", "final:1",
    ]);
  });
});

describe("bulk stage status (admin)", () => {
  type Row = { match_key: string; stage: string; status: string; team_a_id?: string | null; team_b_id?: string | null; winner_team_id?: string | null };
  // Helper: 8 r16 matches with optional winners.
  function r16Matches(withWinners: boolean, status = "confirmed"): Row[] {
    return Array.from({ length: 8 }, (_, i): Row => {
      const n = i + 1;
      return {
        match_key: `UCL_R16_${n}`, stage: "round_of_16", status,
        team_a_id: `a${n}`, team_b_id: `b${n}`,
        winner_team_id: withWinners ? `a${n}` : null,
      };
    });
  }

  it("normalizeKnockoutStageParam accepts short + canonical codes", () => {
    expect(normalizeKnockoutStageParam("r16")).toBe("round_of_16");
    expect(normalizeKnockoutStageParam("round_of_16")).toBe("round_of_16");
    expect(normalizeKnockoutStageParam("qf")).toBe("quarter_final");
    expect(normalizeKnockoutStageParam("playoffs")).toBe("knockout_playoffs");
    expect(normalizeKnockoutStageParam("nope")).toBeNull();
  });

  it("1. bulk r16 → completed with all winners targets 8 matches", () => {
    const plan = planEurocupBulkStageStatus(r16Matches(true), "r16", "completed");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.stage).toBe("round_of_16");
      expect(plan.targets).toHaveLength(8);
      expect(plan.void_skipped).toBe(0);
    }
  });

  it("2. bulk completed without winner → EUROCUP_STAGE_WINNERS_REQUIRED + missing keys", () => {
    const matches = r16Matches(true);
    matches[2].winner_team_id = null;
    matches[5].winner_team_id = null;
    const plan = planEurocupBulkStageStatus(matches, "r16", "completed");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toBe("EUROCUP_STAGE_WINNERS_REQUIRED");
      expect(plan.missing_match_keys).toEqual(["UCL_R16_3", "UCL_R16_6"]);
    }
  });

  it("9. confirmed without pairs → EUROCUP_STAGE_PAIRS_REQUIRED", () => {
    const matches = r16Matches(false);
    matches[0].team_b_id = null;
    const plan = planEurocupBulkStageStatus(matches, "r16", "confirmed");
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toBe("EUROCUP_STAGE_PAIRS_REQUIRED");
      expect(plan.missing_match_keys).toContain("UCL_R16_1");
    }
  });

  it("invalid status / stage rejected", () => {
    expect(planEurocupBulkStageStatus(r16Matches(true), "r16", "void").ok).toBe(false);
    expect(planEurocupBulkStageStatus(r16Matches(true), "r16", "bogus").ok).toBe(false);
    expect(planEurocupBulkStageStatus(r16Matches(true), "bogus", "completed").ok).toBe(false);
  });

  it("draft does not require teams/winners", () => {
    const plan = planEurocupBulkStageStatus(r16Matches(false), "r16", "draft");
    expect(plan.ok).toBe(true);
  });

  it("void matches are skipped, not required", () => {
    const matches = r16Matches(true);
    matches[7] = { ...matches[7], status: "void", winner_team_id: null, team_b_id: null };
    const plan = planEurocupBulkStageStatus(matches, "r16", "completed");
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.targets).toHaveLength(7);
      expect(plan.void_skipped).toBe(1);
    }
  });

  it("empty stage → EUROCUP_STAGE_HAS_NO_MATCHES", () => {
    const plan = planEurocupBulkStageStatus([], "qf", "draft");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toBe("EUROCUP_STAGE_HAS_NO_MATCHES");
  });

  // Downstream generation after bulk completed (reuses the existing helper).
  const sources = eurocupKnockoutBracketSources("UCL");
  function completedStage(stage: string, keys: Array<[string, string]>): Row[] {
    return keys.map(([match_key, winner]): Row => ({ match_key, stage, status: "completed", winner_team_id: winner }));
  }

  it("3. completed r16 generates QF_1..QF_4", () => {
    const rows = [
      ...completedStage("round_of_16", [
        ["UCL_R16_1", "q1"], ["UCL_R16_2", "q2"], ["UCL_R16_3", "q3"], ["UCL_R16_4", "q4"],
        ["UCL_R16_5", "q5"], ["UCL_R16_6", "q6"], ["UCL_R16_7", "q7"], ["UCL_R16_8", "q8"],
      ]),
      ...["UCL_QF_1", "UCL_QF_2", "UCL_QF_3", "UCL_QF_4"].map((k) => ({ match_key: k, stage: "quarter_final", status: "draft", winner_team_id: null })),
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    expect(updates.map((u) => u.match_key).sort()).toEqual(["UCL_QF_1", "UCL_QF_2", "UCL_QF_3", "UCL_QF_4"]);
    expect(updates.find((u) => u.match_key === "UCL_QF_1")).toMatchObject({ team_a_id: "q1", team_b_id: "q2" });
  });

  it("4. completed qf generates SF_1..SF_2", () => {
    const rows = [
      ...completedStage("quarter_final", [["UCL_QF_1", "q1"], ["UCL_QF_2", "q3"], ["UCL_QF_3", "q5"], ["UCL_QF_4", "q7"]]),
      ...["UCL_SF_1", "UCL_SF_2"].map((k) => ({ match_key: k, stage: "semi_final", status: "draft", winner_team_id: null })),
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    expect(updates.map((u) => u.match_key).sort()).toEqual(["UCL_SF_1", "UCL_SF_2"]);
    expect(updates.find((u) => u.match_key === "UCL_SF_1")).toMatchObject({ team_a_id: "q1", team_b_id: "q3" });
  });

  it("5. completed sf generates Final", () => {
    const rows = [
      ...completedStage("semi_final", [["UCL_SF_1", "q1"], ["UCL_SF_2", "q5"]]),
      { match_key: "UCL_FINAL", stage: "final", status: "draft", winner_team_id: null },
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    expect(updates.map((u) => u.match_key)).toEqual(["UCL_FINAL"]);
    expect(updates[0]).toMatchObject({ team_a_id: "q1", team_b_id: "q5" });
  });

  it("6. completed playoffs does NOT generate R16 automatically", () => {
    const rows = [
      ...completedStage("knockout_playoffs", Array.from({ length: 8 }, (_, i) => [`UCL_KP_${i + 1}`, `w${i + 1}`] as [string, string])),
      ...Array.from({ length: 8 }, (_, i) => ({ match_key: `UCL_R16_${i + 1}`, stage: "round_of_16", status: "draft", winner_team_id: null })),
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    // R16 is not a `sources` target → never auto-generated from play-off winners.
    expect(updates.some((u) => u.stage === "round_of_16")).toBe(false);
    expect(updates).toEqual([]);
  });

  it("7. does not overwrite an already-completed downstream result", () => {
    const rows = [
      ...completedStage("round_of_16", [
        ["UCL_R16_1", "q1"], ["UCL_R16_2", "q2"], ["UCL_R16_3", "q3"], ["UCL_R16_4", "q4"],
        ["UCL_R16_5", "q5"], ["UCL_R16_6", "q6"], ["UCL_R16_7", "q7"], ["UCL_R16_8", "q8"],
      ]),
      // QF_1 already completed with its own winner → must be left untouched.
      { match_key: "UCL_QF_1", stage: "quarter_final", status: "completed", winner_team_id: "q1" },
      { match_key: "UCL_QF_2", stage: "quarter_final", status: "draft", winner_team_id: null },
      { match_key: "UCL_QF_3", stage: "quarter_final", status: "draft", winner_team_id: null },
      { match_key: "UCL_QF_4", stage: "quarter_final", status: "draft", winner_team_id: null },
    ];
    const updates = eurocupDownstreamKnockoutPairUpdates(rows, sources);
    expect(updates.find((u) => u.match_key === "UCL_QF_1")).toBeUndefined();
    expect(updates.map((u) => u.match_key).sort()).toEqual(["UCL_QF_2", "UCL_QF_3", "UCL_QF_4"]);
  });
});

describe("bracket results lock (user read-only)", () => {
  it("locks the user bracket only on a bracket-stage official result, not on ties", () => {
    // A confirmed play-off (ties) result must NOT lock the 1/8→final bracket.
    expect(eurocupBracketResultsConfirmed([
      { stage: "knockout_playoffs", status: "completed", winner_team_id: "w1" },
    ])).toBe(false);
    // Any confirmed bracket-stage result locks the bracket.
    expect(eurocupBracketResultsConfirmed([
      { stage: "round_of_16", status: "completed", winner_team_id: "q1" },
    ])).toBe(true);
    expect(eurocupBracketResultsConfirmed([
      { stage: "final", status: "confirmed", winner_team_id: "q1" },
    ])).toBe(true);
    // Void results never lock.
    expect(eurocupBracketResultsConfirmed([
      { stage: "round_of_16", status: "void", winner_team_id: null },
    ])).toBe(false);
  });
});
