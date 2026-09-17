// seasonPredictionEurocupPlayoffScoring.ts
// Stage E8: pure scoring for the eurocup play-off ties + knockout bracket.
// No I/O, no DB, no side effects, NO rewards. Combines with the existing league
// stage score (eurocups_v2, max 100) to form the full eurocup score.
//
// Per-tournament maxima:
//   league stage      = 100   (eurocups_v2, imported — NOT redeclared here)
//   play-off ties      = 32   (8 ties × 4)
//   knockout bracket   = 120
//   ----------------------------------
//   one tournament max = 252  → three tournaments = 756
//
// Bracket scoring is STAGE-BASED (a team that reached a stage scores for every
// earlier stage it passed), not exact-pair, so one early mistake is not over-
// punished. The max is PROGRESSIVE: a stage contributes to points AND to the
// max only once its official results are fully confirmed.

import { EUROCUPS_LEAGUE_STAGE_MAX_POINTS } from "./seasonPredictionEurocupScoring";

export const EUROCUPS_FULL_FORMULA_VERSION = "eurocups_full_v1";

export const EUROCUP_TIES_MAX_POINTS = 32;
export const EUROCUP_BRACKET_MAX_POINTS = 120;
// Re-exported from the league-stage module rather than redeclared: the two used to
// hold their own copy of 188 and would silently drift apart on the next rebalance.
export const EUROCUP_LEAGUE_STAGE_MAX_POINTS = EUROCUPS_LEAGUE_STAGE_MAX_POINTS;
export const EUROCUP_FULL_MAX_POINTS =
  EUROCUP_LEAGUE_STAGE_MAX_POINTS + EUROCUP_TIES_MAX_POINTS + EUROCUP_BRACKET_MAX_POINTS; // 252

// Point values (kept explicit so the formula reads like the spec).
export const EUROCUP_PLAYOFF_CONFIG = {
  tiePoints: 4, // per correctly predicted play-off winner

  qfTeamPoints: 4, // per team correctly taken to the 1/4 (reached quarter-final)
  sfTeamPoints: 6, // per team correctly taken to the 1/2
  finalistPoints: 10, // per correctly predicted finalist
  championPoints: 20, // correct champion

  allQuarterfinalistsBonus: 4, // all 8 quarterfinalists correct
  allSemifinalistsBonus: 8, // all 4 semifinalists correct
  allFinalistsBonus: 8, // both finalists correct
  championBonus: 4, // champion correct (separate from the 20)
} as const;

// 8×4 + 4×6 + 2×10 + 20 = 32 + 24 + 20 + 20 = 96 base; + 4 + 8 + 8 + 4 = 120.
const STAGE_EXPECTED_COUNT: Record<string, number> = {
  knockout_playoffs: 8,
  round_of_16: 8,
  quarter_final: 4,
  semi_final: 2,
  final: 1,
};

export type EurocupPlayoffScopeStage = "league" | "ties" | "r16" | "qf" | "sf" | "final" | "full";

const SCOPE_STAGE_ALLOWED: Record<EurocupPlayoffScopeStage, Set<string>> = {
  league: new Set<string>(),
  ties: new Set(["knockout_playoffs"]),
  r16: new Set(["knockout_playoffs", "round_of_16"]),
  qf: new Set(["knockout_playoffs", "round_of_16", "quarter_final"]),
  sf: new Set(["knockout_playoffs", "round_of_16", "quarter_final", "semi_final"]),
  final: new Set(["knockout_playoffs", "round_of_16", "quarter_final", "semi_final", "final"]),
  full: new Set(["knockout_playoffs", "round_of_16", "quarter_final", "semi_final", "final"]),
};

export const EUROCUP_RECALC_STAGE_TO_OFFICIAL_STAGE: Partial<Record<EurocupPlayoffScopeStage, string>> = {
  ties: "knockout_playoffs",
  r16: "round_of_16",
  qf: "quarter_final",
  sf: "semi_final",
  final: "final",
};

export type KnockoutMatchRow = {
  match_key: string;
  stage: string;
  match_order?: unknown;
  team_a_id?: unknown;
  team_b_id?: unknown;
  winner_team_id?: unknown;
  status?: unknown;
};

export type EurocupUserBracketPicks = Record<string, unknown> & {
  champion_team_id?: unknown;
};

const id = (v: unknown): string | null => (v == null || v === "" ? null : String(v).trim() || null);

// Decided winner of a match: non-void, both teams present, winner set & valid.
function decidedWinner(m: KnockoutMatchRow): string | null {
  if (String(m.status ?? "") === "void") return null;
  const a = id(m.team_a_id);
  const b = id(m.team_b_id);
  const w = id(m.winner_team_id);
  if (!w) return null;
  if (a && w !== a && b && w !== b) return null; // winner must be one of the pair when known
  return w;
}

type StageOfficial = { winners: string[]; total: number; decided: number; complete: boolean };

function officialStage(matches: KnockoutMatchRow[], stage: string): StageOfficial {
  const rows = (matches || []).filter((m) => String(m.stage) === stage && String(m.status ?? "") !== "void");
  const winners: string[] = [];
  for (const m of rows) {
    const w = decidedWinner(m);
    if (w) winners.push(w);
  }
  const expected = STAGE_EXPECTED_COUNT[stage] ?? rows.length;
  const complete = expected > 0 && winners.length === expected && new Set(winners).size === winners.length;
  return { winners, total: rows.length, decided: winners.length, complete };
}

export function eurocupRecalcStageReadiness(matches: KnockoutMatchRow[], stage: EurocupPlayoffScopeStage): {
  stage: EurocupPlayoffScopeStage;
  official_stage: string | null;
  required: number;
  total: number;
  decided: number;
  ready: boolean;
} {
  const officialStageKey = EUROCUP_RECALC_STAGE_TO_OFFICIAL_STAGE[stage] || null;
  if (!officialStageKey) {
    return { stage, official_stage: null, required: 0, total: 0, decided: 0, ready: true };
  }
  const s = officialStage(matches, officialStageKey);
  const required = STAGE_EXPECTED_COUNT[officialStageKey] ?? s.total;
  return {
    stage,
    official_stage: officialStageKey,
    required,
    total: s.total,
    decided: s.decided,
    ready: s.complete,
  };
}

function officialMatchesForScope(matches: KnockoutMatchRow[], scopeStage: EurocupPlayoffScopeStage): KnockoutMatchRow[] {
  if (scopeStage === "full") return matches || [];
  const allowed = SCOPE_STAGE_ALLOWED[scopeStage] || SCOPE_STAGE_ALLOWED.full;
  return (matches || []).filter((m) => allowed.has(String(m.stage)));
}

// Official "reached stage" sets, derived from confirmed official results.
// quarterfinalists = winners of 1/8, semifinalists = winners of 1/4,
// finalists = winners of 1/2, champion = winner of final.
export function officialEurocupStageReached(matches: KnockoutMatchRow[]): {
  quarterfinalists: string[]; quarterfinalsComplete: boolean;
  semifinalists: string[]; semifinalsComplete: boolean;
  finalists: string[]; finalComplete: boolean;
  champion: string | null; championComplete: boolean;
} {
  const r16 = officialStage(matches, "round_of_16");
  const qf = officialStage(matches, "quarter_final");
  const sf = officialStage(matches, "semi_final");
  const fin = officialStage(matches, "final");
  return {
    quarterfinalists: r16.winners,
    quarterfinalsComplete: r16.complete,
    semifinalists: qf.winners,
    semifinalsComplete: qf.complete,
    finalists: sf.winners,
    finalComplete: sf.complete,
    champion: fin.complete ? fin.winners[0] ?? null : null,
    championComplete: fin.complete,
  };
}

function stagePickWinners(picks: EurocupUserBracketPicks, stage: string): string[] {
  const obj = picks?.[stage];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const w = id(v);
    if (w) out.push(w);
  }
  return out;
}

// User "predicted reached stage" sets, derived from the user's own winner picks.
export function userEurocupStageReached(picks: EurocupUserBracketPicks): {
  quarterfinalists: string[];
  semifinalists: string[];
  finalists: string[];
  champion: string | null;
} {
  const finalWinners = stagePickWinners(picks, "final");
  const champion = id(picks?.champion_team_id) || finalWinners[0] || null;
  return {
    quarterfinalists: stagePickWinners(picks, "round_of_16"),
    semifinalists: stagePickWinners(picks, "quarter_final"),
    finalists: stagePickWinners(picks, "semi_final"),
    champion,
  };
}

export type PlayoffTieRow = {
  match_key: string;
  user_winner_team_id: string | null;
  official_winner_team_id: string;
  points: number;
  status: "correct" | "wrong" | "no_pick";
};

export type EurocupPlayoffBreakdown = {
  points: number;
  max: number;
  correct: number;
  total: number;
  predicted: boolean;
  matches: PlayoffTieRow[];
};

export type EurocupBracketStageBreakdown = {
  points: number;
  max: number;
  correct: number;
  total: number;
  correct_team_ids: string[];
  resolved: boolean; // official results for this stage confirmed
};

export type EurocupBracketBonus = { earned: boolean; points: number; max: number; resolved: boolean };

export type EurocupBracketBreakdown = {
  points: number;
  max: number;
  predicted: boolean;
  quarterfinalists: EurocupBracketStageBreakdown;
  semifinalists: EurocupBracketStageBreakdown;
  finalists: EurocupBracketStageBreakdown;
  champion: {
    points: number; max: number; user_team_id: string | null; official_team_id: string | null;
    correct: boolean; resolved: boolean;
  };
  bonuses: {
    all_quarterfinalists: EurocupBracketBonus;
    all_semifinalists: EurocupBracketBonus;
    all_finalists: EurocupBracketBonus;
    champion_bonus: EurocupBracketBonus;
  };
};

export type EurocupPlayoffBracketResult = {
  ties_points: number;
  ties_max: number;
  bracket_points: number;
  bracket_max: number;
  playoffs: EurocupPlayoffBreakdown;
  bracket: EurocupBracketBreakdown;
};

// Score play-off ties + knockout bracket for one user.
// `bracketSubmitted` gates BOTH points and max contribution (an un-submitted
// bracket is not scored — section E8.4). The max is progressive: only stages
// with confirmed official results contribute.
export function scoreEurocupPlayoffBracket(args: {
  officialMatches: KnockoutMatchRow[];
  picks: EurocupUserBracketPicks;
  bracketSubmitted: boolean;
  scopeStage?: EurocupPlayoffScopeStage;
  config?: typeof EUROCUP_PLAYOFF_CONFIG;
}): EurocupPlayoffBracketResult {
  const cfg = args.config || EUROCUP_PLAYOFF_CONFIG;
  const submitted = !!args.bracketSubmitted;
  const matches = officialMatchesForScope(args.officialMatches || [], args.scopeStage || "full");
  const picks = args.picks || {};

  // ── Play-off ties (independent pairs) ──────────────────────────────────────
  const tieRows = matches.filter((m) => String(m.stage) === "knockout_playoffs" && String(m.status ?? "") !== "void");
  const tiePickByKey = (() => {
    const obj = picks.knockout_playoffs;
    const map: Record<string, string> = {};
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        const w = id(v);
        if (w) map[k] = w;
      }
    }
    return map;
  })();

  const tieBreakdown: PlayoffTieRow[] = [];
  let tiesPoints = 0;
  let tiesCorrect = 0;
  let tiesDecided = 0;
  for (const m of tieRows) {
    const official = decidedWinner(m);
    if (!official) continue; // only confirmed ties count toward total/max
    tiesDecided += 1;
    const userPick = submitted ? (tiePickByKey[String(m.match_key)] || null) : null;
    let points = 0;
    let status: PlayoffTieRow["status"] = "no_pick";
    if (userPick) {
      if (userPick === official) { points = cfg.tiePoints; tiesPoints += points; tiesCorrect += 1; status = "correct"; }
      else status = "wrong";
    }
    tieBreakdown.push({
      match_key: String(m.match_key),
      user_winner_team_id: userPick,
      official_winner_team_id: official,
      points,
      status,
    });
  }
  const tiesMax = submitted ? cfg.tiePoints * tiesDecided : 0;

  // ── Knockout bracket (stage-based) ─────────────────────────────────────────
  const off = officialEurocupStageReached(matches);
  const usr = userEurocupStageReached(picks);

  const offQF = new Set(off.quarterfinalists);
  const offSF = new Set(off.semifinalists);
  const offFinalists = new Set(off.finalists);

  const intersectIds = (predicted: string[], officialSet: Set<string>): string[] =>
    [...new Set(predicted)].filter((t) => officialSet.has(t));

  // Quarterfinalists (reached 1/4): scored once 1/8 results confirmed.
  const qfResolved = submitted && off.quarterfinalsComplete;
  const qfCorrectIds = qfResolved ? intersectIds(usr.quarterfinalists, offQF) : [];
  const qfPoints = qfCorrectIds.length * cfg.qfTeamPoints;
  const qfStage: EurocupBracketStageBreakdown = {
    points: qfPoints, max: qfResolved ? 8 * cfg.qfTeamPoints : 0,
    correct: qfCorrectIds.length, total: offQF.size, correct_team_ids: qfCorrectIds, resolved: qfResolved,
  };

  // Semifinalists (reached 1/2): scored once 1/4 results confirmed.
  const sfResolved = submitted && off.semifinalsComplete;
  const sfCorrectIds = sfResolved ? intersectIds(usr.semifinalists, offSF) : [];
  const sfPoints = sfCorrectIds.length * cfg.sfTeamPoints;
  const sfStage: EurocupBracketStageBreakdown = {
    points: sfPoints, max: sfResolved ? 4 * cfg.sfTeamPoints : 0,
    correct: sfCorrectIds.length, total: offSF.size, correct_team_ids: sfCorrectIds, resolved: sfResolved,
  };

  // Finalists (reached final): scored once 1/2 results confirmed.
  const finResolved = submitted && off.finalComplete;
  const finCorrectIds = finResolved ? intersectIds(usr.finalists, offFinalists) : [];
  const finPoints = finCorrectIds.length * cfg.finalistPoints;
  const finStage: EurocupBracketStageBreakdown = {
    points: finPoints, max: finResolved ? 2 * cfg.finalistPoints : 0,
    correct: finCorrectIds.length, total: offFinalists.size, correct_team_ids: finCorrectIds, resolved: finResolved,
  };

  // Champion: scored once final result confirmed.
  const champResolved = submitted && off.championComplete;
  const champCorrect = champResolved && !!usr.champion && usr.champion === off.champion;
  const champPoints = champCorrect ? cfg.championPoints : 0;

  // Bonuses (each tied to its stage being resolved).
  const allQf = qfResolved && qfCorrectIds.length === 8 && offQF.size === 8;
  const allSf = sfResolved && sfCorrectIds.length === 4 && offSF.size === 4;
  const allFin = finResolved && finCorrectIds.length === 2 && offFinalists.size === 2;

  const bonuses = {
    all_quarterfinalists: { earned: allQf, points: allQf ? cfg.allQuarterfinalistsBonus : 0, max: qfResolved ? cfg.allQuarterfinalistsBonus : 0, resolved: qfResolved },
    all_semifinalists: { earned: allSf, points: allSf ? cfg.allSemifinalistsBonus : 0, max: sfResolved ? cfg.allSemifinalistsBonus : 0, resolved: sfResolved },
    all_finalists: { earned: allFin, points: allFin ? cfg.allFinalistsBonus : 0, max: finResolved ? cfg.allFinalistsBonus : 0, resolved: finResolved },
    champion_bonus: { earned: champCorrect, points: champCorrect ? cfg.championBonus : 0, max: champResolved ? cfg.championBonus : 0, resolved: champResolved },
  };

  const bracketPoints =
    qfPoints + sfPoints + finPoints + champPoints +
    bonuses.all_quarterfinalists.points + bonuses.all_semifinalists.points +
    bonuses.all_finalists.points + bonuses.champion_bonus.points;
  const bracketMax =
    qfStage.max + sfStage.max + finStage.max + (champResolved ? cfg.championPoints : 0) +
    bonuses.all_quarterfinalists.max + bonuses.all_semifinalists.max +
    bonuses.all_finalists.max + bonuses.champion_bonus.max;

  const bracket: EurocupBracketBreakdown = {
    points: bracketPoints,
    max: bracketMax,
    predicted: submitted,
    quarterfinalists: qfStage,
    semifinalists: sfStage,
    finalists: finStage,
    champion: {
      points: champPoints, max: champResolved ? cfg.championPoints : 0,
      user_team_id: usr.champion, official_team_id: off.champion,
      correct: champCorrect, resolved: champResolved,
    },
    bonuses,
  };

  return {
    ties_points: tiesPoints,
    ties_max: tiesMax,
    bracket_points: bracketPoints,
    bracket_max: bracketMax,
    playoffs: {
      points: tiesPoints,
      max: tiesMax,
      correct: tiesCorrect,
      total: tiesDecided,
      predicted: submitted,
      matches: tieBreakdown,
    },
    bracket,
  };
}

// Minimal shape of the league-stage score we need to combine.
export type LeagueStageScoreLike = {
  total_points: number;
  max_possible_points: number;
  breakdown: Record<string, unknown>;
};

export type EurocupFullScore = {
  formula_version: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  league_stage_points: number;
  playoff_tie_points: number;
  bracket_points: number;
  breakdown: Record<string, unknown>;
};

// Merge league stage (eurocups_v2) + play-off/bracket into the full eurocup score.
// The league-stage breakdown stays at the TOP LEVEL (zones/summary/bonuses/teams)
// so the existing leaderboard extraction and legacy UI keep working; play-off and
// bracket sections are ADDED alongside.
export function combineEurocupFullScore(league: LeagueStageScoreLike, pb: EurocupPlayoffBracketResult): EurocupFullScore {
  const leaguePoints = Number(league.total_points || 0);
  const leagueMax = Number(league.max_possible_points || 0);
  const totalPoints = leaguePoints + pb.ties_points + pb.bracket_points;
  const maxPossible = leagueMax + pb.ties_max + pb.bracket_max;
  const pointsPct = maxPossible > 0 ? Math.round((totalPoints / maxPossible) * 10000) / 10000 : 0;

  const breakdown: Record<string, unknown> = {
    ...league.breakdown,
    formula_version: EUROCUPS_FULL_FORMULA_VERSION,
    league_stage: { points: leaguePoints, max: leagueMax },
    playoffs: pb.playoffs,
    bracket: pb.bracket,
    total: {
      league_stage: leaguePoints,
      playoffs: pb.ties_points,
      bracket: pb.bracket_points,
      points: totalPoints,
      max: maxPossible,
    },
  };

  return {
    formula_version: EUROCUPS_FULL_FORMULA_VERSION,
    total_points: totalPoints,
    max_possible_points: maxPossible,
    points_pct: pointsPct,
    league_stage_points: leaguePoints,
    playoff_tie_points: pb.ties_points,
    bracket_points: pb.bracket_points,
    breakdown,
  };
}
