import { describe, it, expect } from "vitest";
import {
  buildEurocupKnockoutTaskViews,
  parseEurocupResultFromBreakdown,
  parseEurocupLeagueStageResult,
  type EurocupCupTaskInput,
  type EurocupCupResult,
  type EurocupCupCode,
} from "../seasonPredictionEurocupTasks";

function cup(code: EurocupCupCode, over: Partial<EurocupCupTaskInput> = {}): EurocupCupTaskInput {
  return {
    code, label: code, short: code,
    tiesPicked: 0, bracketPicked: 0, championPicked: false, bracketSubmitted: false, result: null,
    knockoutOpen: true, // the draw gate has its own describe block below
    ...over,
  };
}

type ResOver = {
  ties?: { correct: number; total: number; predicted: boolean };
  points?: number;
  semis?: { correct: number; resolved: boolean };
  finalists?: { correct: number; resolved: boolean };
  champion?: { correct: boolean; resolved: boolean };
  total_points?: number;
};
function res(over: ResOver): EurocupCupResult {
  return {
    playoffs: over.ties ?? null,
    bracket: (over.points != null || over.semis || over.finalists || over.champion)
      ? {
        points: over.points ?? 0,
        semifinalists: over.semis ?? { correct: 0, resolved: false },
        finalists: over.finalists ?? { correct: 0, resolved: false },
        champion: over.champion ?? { correct: false, resolved: false },
      }
      : null,
    total_points: over.total_points ?? 0,
  };
}

const ALL3: EurocupCupCode[] = ["UCL", "UEL", "UECL"];
function find(views: ReturnType<typeof buildEurocupKnockoutTaskViews>, id: string) {
  const v = views.find((x) => x.id === id);
  if (!v) throw new Error(`task not found: ${id}`);
  return v;
}

describe("eurocup activity tasks", () => {
  it("1. fill ties UCL 8/8 → completed", () => {
    const views = buildEurocupKnockoutTaskViews([cup("UCL", { tiesPicked: 8 }), cup("UEL"), cup("UECL")]);
    expect(find(views, "ek_ties_UCL_fill").status).toBe("completed");
    expect(find(views, "ek_ties_fill_any").status).toBe("completed");
  });

  it("2. fill ties all 3 → fill_all completed", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { tiesPicked: 8 })));
    expect(find(views, "ek_ties_fill_all").status).toBe("completed");
    expect(find(views, "ek_ties_fill_all").current).toBe(3);
  });

  it("3. fill bracket UCL 15/15 → completed", () => {
    const views = buildEurocupKnockoutTaskViews([cup("UCL", { bracketPicked: 15 }), cup("UEL"), cup("UECL")]);
    expect(find(views, "ek_bracket_UCL_fill").status).toBe("completed");
    expect(find(views, "ek_bracket_UCL_fill").target).toBe(15);
  });

  it("4. submit bracket all 3 → submit_all completed (ties + bracket)", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { bracketSubmitted: true })));
    expect(find(views, "ek_bracket_submit_all").status).toBe("completed");
    expect(find(views, "ek_ties_submit_all").status).toBe("completed");
    expect(find(views, "ek_bracket_submit_any").status).toBe("completed");
  });

  it("partial fill → in_progress", () => {
    const views = buildEurocupKnockoutTaskViews([cup("UCL", { bracketPicked: 9 }), cup("UEL"), cup("UECL")]);
    expect(find(views, "ek_bracket_UCL_fill").status).toBe("in_progress");
    expect(find(views, "ek_bracket_UCL_fill").current).toBe(9);
  });

  it("champion picked any/all", () => {
    const v1 = buildEurocupKnockoutTaskViews([cup("UCL", { championPicked: true }), cup("UEL"), cup("UECL")]);
    expect(find(v1, "ek_bracket_champion_any").status).toBe("completed");
    expect(find(v1, "ek_bracket_champion_all").status).toBe("in_progress");
    const v2 = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { championPicked: true })));
    expect(find(v2, "ek_bracket_champion_all").status).toBe("completed");
  });
});

describe("eurocup result tasks — ties", () => {
  it("5. ties 6/8 (all resolved) → 4/8 & 6/8 completed, 8/8 failed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 6, total: 8, predicted: true } }) }),
      cup("UEL", { result: res({ ties: { correct: 0, total: 8, predicted: true } }) }),
      cup("UECL", { result: res({ ties: { correct: 0, total: 8, predicted: true } }) }),
    ]);
    expect(find(views, "ek_res_ties_4_any").status).toBe("completed");
    expect(find(views, "ek_res_ties_6_any").status).toBe("completed");
    expect(find(views, "ek_res_ties_8_any").status).toBe("failed");
    expect(find(views, "ek_res_ties_6_any").current).toBe(6);
  });

  it("6. before ties recalc → future (with future_reason)", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c)));
    const t = find(views, "ek_res_ties_4_any");
    expect(t.status).toBe("future");
    expect(t.future_reason).toBeTruthy();
  });

  it("7. ties final 3/8 (all resolved) → 4/8 failed", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { result: res({ ties: { correct: 3, total: 8, predicted: true } }) })));
    expect(find(views, "ek_res_ties_4_any").status).toBe("failed");
  });

  it("ties one resolved missed, others pending → 8/8 stays future (not failed)", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 3, total: 8, predicted: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_ties_8_any").status).toBe("future");
  });
});

describe("eurocup result tasks — bracket", () => {
  it("8. champion correct any cup → claimable/completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ champion: { correct: true, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_champion_any").status).toBe("completed");
  });

  it("9. champion not recalculated yet → future", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ champion: { correct: false, resolved: false } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_champion_any").status).toBe("future");
  });

  it("10. finalists 2/2 any → completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ finalists: { correct: 2, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_finalists_any").status).toBe("completed");
  });

  it("11. semifinalists 4/4 any → completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ semis: { correct: 4, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_semis_any").status).toBe("completed");
  });

  it("12. bracket points 80 reached, 100 future until final", () => {
    const notFinal = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ points: 80, champion: { correct: false, resolved: false } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(notFinal, "ek_res_bracket_80_any").status).toBe("completed");
    expect(find(notFinal, "ek_res_bracket_100_any").status).toBe("future");

    const finalDecided = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { result: res({ points: 80, champion: { correct: true, resolved: true } }) })));
    expect(find(finalDecided, "ek_res_bracket_100_any").status).toBe("failed");
  });

  it("13. all 3 champions correct → champion_3 completed", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c, { result: res({ champion: { correct: true, resolved: true } }) })));
    expect(find(views, "ek_res_champion_3").status).toBe("completed");
    expect(find(views, "ek_res_champion_2").status).toBe("completed");
  });

  it("total points 150/200 thresholds", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ total_points: 160, champion: { correct: true, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_total_150_any").status).toBe("completed");
    expect(find(views, "ek_res_total_200_any").status).toBe("future"); // others not resolved yet
  });
});

describe("eurocup per-cup result tasks", () => {
  it("1. UCL ties 4/8 → ek_res_UCL_ties_4 completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 4, total: 8, predicted: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_ties_4").status).toBe("completed");
    expect(find(views, "ek_res_UCL_ties_4").current).toBe(4);
    expect(find(views, "ek_res_UCL_ties_4").target).toBe(4);
  });

  it("2. UCL ties 6/8 → 4/8 & 6/8 completed, 8/8 failed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 6, total: 8, predicted: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_ties_4").status).toBe("completed");
    expect(find(views, "ek_res_UCL_ties_6").status).toBe("completed");
    expect(find(views, "ek_res_UCL_ties_8").status).toBe("failed");
    expect(find(views, "ek_res_UCL_ties_8").current).toBe(6); // progress 6/8
  });

  it("3. UEL ties not recalculated → UEL ties result tasks future", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 8, total: 8, predicted: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UEL_ties_4").status).toBe("future");
    expect(find(views, "ek_res_UEL_ties_4").future_reason).toBeTruthy();
    // UCL resolved independently.
    expect(find(views, "ek_res_UCL_ties_4").status).toBe("completed");
  });

  it("4. UECL champion correct → ek_res_UECL_champion completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL"), cup("UEL"),
      cup("UECL", { result: res({ champion: { correct: true, resolved: true } }) }),
    ]);
    expect(find(views, "ek_res_UECL_champion").status).toBe("completed");
    expect(find(views, "ek_res_UCL_champion").status).toBe("future");
  });

  it("5. UCL champion wrong after final → ek_res_UCL_champion failed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ champion: { correct: false, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_champion").status).toBe("failed");
  });

  it("6. UCL finalists 2/2 → ek_res_UCL_finalists completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ finalists: { correct: 2, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_finalists").status).toBe("completed");
    expect(find(views, "ek_res_UCL_finalists").target).toBe(2);
  });

  it("7. UCL semifinals 4/4 → ek_res_UCL_semis completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ semis: { correct: 4, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_semis").status).toBe("completed");
    expect(find(views, "ek_res_UCL_semis").target).toBe(4);
  });

  it("8. UCL bracket points 108 → 80+ and 100+ completed", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ points: 108 }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(views, "ek_res_UCL_bracket_80").status).toBe("completed");
    expect(find(views, "ek_res_UCL_bracket_100").status).toBe("completed");
  });

  it("9. UCL total 160 → 150+ completed; 200+ future (not final) / failed (final)", () => {
    const notFinal = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ total_points: 160, points: 60, champion: { correct: false, resolved: false } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(notFinal, "ek_res_UCL_total_150").status).toBe("completed");
    expect(find(notFinal, "ek_res_UCL_total_200").status).toBe("future");

    const final = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ total_points: 160, points: 60, champion: { correct: false, resolved: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    expect(find(final, "ek_res_UCL_total_200").status).toBe("failed");
  });

  it("10. per-cup tasks carry the right cup and don't leak across cups", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c)));
    expect(find(views, "ek_res_UCL_champion").cup).toBe("UCL");
    expect(find(views, "ek_res_UEL_champion").cup).toBe("UEL");
    expect(find(views, "ek_res_UECL_champion").cup).toBe("UECL");
    // aggregate result tasks stay aggregate
    expect(find(views, "ek_res_champion_any").cup).toBe("aggregate");
    expect(find(views, "ek_res_ties_4_any").cup).toBe("aggregate");
  });

  it("11. aggregate result tasks still present alongside per-cup", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { result: res({ ties: { correct: 8, total: 8, predicted: true } }) }),
      cup("UEL"), cup("UECL"),
    ]);
    // aggregate "any cup 8/8" satisfied by UCL; per-cup UCL task also completed.
    expect(find(views, "ek_res_ties_8_any").status).toBe("completed");
    expect(find(views, "ek_res_UCL_ties_8").status).toBe("completed");
    // aggregate "all 3 cups 4+" still future (UEL/UECL unresolved).
    expect(find(views, "ek_res_ties_4_all").status).toBe("future");
  });

  it("12. each cup gets 10 result tasks (counters include them)", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c)));
    for (const code of ALL3) {
      const perCupResults = views.filter((v) => v.cup === code && v.id.startsWith(`ek_res_${code}_`));
      expect(perCupResults).toHaveLength(10);
    }
  });

  it("13. per-cup result tasks are grouped by phase: ties→ties, bracket→bracket, totals→result", () => {
    const views = buildEurocupKnockoutTaskViews(ALL3.map((c) => cup(c)));
    const phaseOf = (id: string) => find(views, id).badge;
    // ties-results → «Стыки»
    expect(phaseOf("ek_res_UCL_ties_4")).toBe("ties");
    expect(phaseOf("ek_res_UCL_ties_8")).toBe("ties");
    // bracket-results → «Сетка»
    expect(phaseOf("ek_res_UCL_finalists")).toBe("bracket");
    expect(phaseOf("ek_res_UCL_semis")).toBe("bracket");
    expect(phaseOf("ek_res_UCL_champion")).toBe("bracket");
    expect(phaseOf("ek_res_UCL_bracket_80")).toBe("bracket");
    expect(phaseOf("ek_res_UCL_bracket_100")).toBe("bracket");
    // totals → «Результаты»
    expect(phaseOf("ek_res_UCL_total_150")).toBe("result");
    expect(phaseOf("ek_res_UCL_total_200")).toBe("result");
    // aggregates stay "result" (shown under «Все еврокубки»)
    expect(phaseOf("ek_res_champion_any")).toBe("result");
    expect(phaseOf("ek_res_ties_4_any")).toBe("result");
  });
});

describe("parseEurocupResultFromBreakdown", () => {
  it("returns null for legacy league-only breakdown", () => {
    expect(parseEurocupResultFromBreakdown({ summary: { top8_correct: 8 } }, 188)).toBeNull();
    expect(parseEurocupResultFromBreakdown(null, 0)).toBeNull();
  });

  it("extracts playoffs + bracket from eurocups_full_v1 breakdown", () => {
    const r = parseEurocupResultFromBreakdown({
      playoffs: { correct: 6, total: 8, predicted: true },
      bracket: {
        points: 80,
        semifinalists: { correct: 3, resolved: true },
        finalists: { correct: 1, resolved: true },
        champion: { correct: true, resolved: true },
      },
    }, 292);
    expect(r?.playoffs).toMatchObject({ correct: 6, total: 8 });
    expect(r?.bracket?.points).toBe(80);
    expect(r?.bracket?.champion).toMatchObject({ correct: true, resolved: true });
    expect(r?.total_points).toBe(292);
  });
});

describe("parseEurocupLeagueStageResult", () => {
  it("reads a league-only breakdown (eurocups_v2)", () => {
    const bd = { formula_version: "eurocups_v2", summary: { top8_correct: 5, top24_correct: 22, total_points: 68 } };
    expect(parseEurocupLeagueStageResult(bd, 68)).toEqual({ points: 68, top8_correct: 5, top24_correct: 22 });
  });

  it("takes league_stage.points once the play-off is scored, NOT the tournament total", () => {
    // combineEurocupFullScore spreads the league breakdown and adds league_stage.
    // total_points here is league + ties + bracket: reading it would pay league-stage
    // rewards for bracket points (e.g. 190 total on a 62-point league stage).
    const bd = {
      formula_version: "eurocups_v2",
      summary: { top8_correct: 4, top24_correct: 20, total_points: 62 },
      league_stage: { points: 62, max: 100 },
      playoffs: { correct: 6, total: 8, predicted: true },
    };
    const res = parseEurocupLeagueStageResult(bd, 190);
    expect(res).toEqual({ points: 62, top8_correct: 4, top24_correct: 20 });
    expect(res!.points).toBeLessThan(75); // would have cleared the 75+ tier off the full total
  });

  it("returns null while the tournament has no score yet", () => {
    expect(parseEurocupLeagueStageResult(null, 0)).toBeNull();
    expect(parseEurocupLeagueStageResult({}, 0)).toBeNull();
    expect(parseEurocupLeagueStageResult({ playoffs: { correct: 3 } }, 12)).toBeNull();
  });

  it("falls back to the row total when a summary carries no total_points", () => {
    expect(parseEurocupLeagueStageResult({ summary: { top8_correct: 8, top24_correct: 24 } }, 100))
      .toEqual({ points: 100, top8_correct: 8, top24_correct: 24 });
  });
});

describe("play-off draw gate", () => {
  const closed = (code: EurocupCupCode) => cup(code, { knockoutOpen: false, tiesPicked: 8, bracketPicked: 15, bracketSubmitted: true });

  it("a cup without a confirmed draw shows every task as «Скоро», progress zeroed", () => {
    const views = buildEurocupKnockoutTaskViews([closed("UCL"), closed("UEL"), closed("UECL")]);
    expect(views.length).toBeGreaterThan(0);
    for (const v of views) {
      expect(v.status, v.id).toBe("future");
      expect(v.current, v.id).toBe(0);
      expect(v.future_reason, v.id).toBe("После жеребьёвки плей-офф");
    }
  });

  it("an open cup keeps its own tasks while the closed ones stay «Скоро»", () => {
    const views = buildEurocupKnockoutTaskViews([
      cup("UCL", { tiesPicked: 8 }), closed("UEL"), closed("UECL"),
    ]);
    expect(find(views, "ek_ties_UCL_fill").status).toBe("completed");
    expect(find(views, "ek_ties_UEL_fill").status).toBe("future");
    expect(find(views, "ek_ties_UECL_fill").status).toBe("future");
    // aggregates open as soon as one cup does — the user can act on them again
    expect(find(views, "ek_ties_fill_any").status).toBe("completed");
  });

  it("aggregates wait until at least one cup opens", () => {
    const views = buildEurocupKnockoutTaskViews([closed("UCL"), closed("UEL"), closed("UECL")]);
    expect(find(views, "ek_ties_fill_any").status).toBe("future");
    expect(find(views, "ek_bracket_submit_all").status).toBe("future");
  });
});
