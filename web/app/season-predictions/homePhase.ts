// Phase selection for the home «Прогнозы сезона» card.
// Pure (no React, no fetching) so the rules can be reasoned about and tested
// apart from the card's rendering.
import { awardsCount } from "./progress";
import type { SeasonPredictionTournament } from "./types";

export const AWARDS_PER_TOURNAMENT = 3;

const SUBMITTED_LIKE = ["submitted", "locked", "scoring", "completed"];
const TERMINAL_STATUSES = ["locked", "scoring", "completed"];

// Entry is "done" for card purposes once submitted or terminally processed.
export function entrySubmittedLike(t: SeasonPredictionTournament): boolean {
  return SUBMITTED_LIKE.includes(String(t.entry?.status || ""));
}

// Tournament accepts table predictions right now (server enforces the real lock;
// this only decides what the card highlights).
export function isTableActionable(t: SeasonPredictionTournament, nowSec: number): boolean {
  if (t.status !== "open") return false;
  if (entrySubmittedLike(t)) return false;
  const deadline = Number(t.deadline_at || 0);
  return !(deadline > 0 && nowSec >= deadline);
}

// Individual awards run on their own window (awards_open_at / awards_deadline_at,
// NULL → falls back to the table window), so they stay actionable after the
// tables lock. Mirrors seasonPredictionAwardsWindowStatus() on the server.
export function awardsDeadlineOf(t: SeasonPredictionTournament): number {
  return Number(t.awards_deadline_at || t.deadline_at || 0);
}

// Only top-5 leagues carry individual awards today. When eurocups get awards of
// their own this predicate is the single switch that pulls them into the phase.
export function hasAwards(t: SeasonPredictionTournament): boolean {
  return t.tournament_type === "top_league";
}

export function awardsSubmittedLike(t: SeasonPredictionTournament): boolean {
  return SUBMITTED_LIKE.includes(String(t.entry?.awards_status || ""));
}

// Awards are "done" only when confirmed AND all three picks are in — a confirmed
// but incomplete set still needs the user.
export function awardsDone(t: SeasonPredictionTournament): boolean {
  return awardsSubmittedLike(t) && awardsCount(t.entry?.awards) >= AWARDS_PER_TOURNAMENT;
}

export function isAwardsActionable(t: SeasonPredictionTournament, nowSec: number): boolean {
  if (!hasAwards(t)) return false;
  if (t.status !== "open") return false;
  // A terminal entry (or terminal awards) hard-locks awards server-side regardless
  // of the window — never invite the user into a form the API will reject.
  if (TERMINAL_STATUSES.includes(String(t.entry?.status || ""))) return false;
  if (TERMINAL_STATUSES.includes(String(t.entry?.awards_status || ""))) return false;
  const openAt = Number(t.awards_open_at || 0);
  if (openAt > 0 && nowSec < openAt) return false;
  const deadline = awardsDeadlineOf(t);
  if (deadline > 0 && nowSec >= deadline) return false;
  return !awardsDone(t);
}

// Tournaments whose awards are already visible to users — the denominator of the
// awards progress ratio (pending ones alone would shrink as leagues get done).
export function awardsPool(tournaments: SeasonPredictionTournament[]): SeasonPredictionTournament[] {
  return tournaments.filter((t) => hasAwards(t) && t.status !== "draft" && t.status !== "soon");
}

export type HomeSeasonPhase =
  | { kind: "leagues"; deadlineAt: number | null }
  | { kind: "awards"; tournaments: SeasonPredictionTournament[]; deadlineAt: number | null }
  | { kind: "eurocups"; cups: SeasonPredictionTournament[]; isNew: boolean; deadlineAt: number | null }
  | { kind: "compact" };

function nearestDeadline(
  list: SeasonPredictionTournament[],
  getDeadline: (t: SeasonPredictionTournament) => number = (t) => Number(t.deadline_at || 0),
): number | null {
  const deadlines = list.map(getDeadline).filter((d) => d > 0);
  return deadlines.length ? Math.min(...deadlines) : null;
}

/* Phase priority = nearest actionable deadline; ties break tables → awards →
 * eurocups (fill a table before its awards; eurocups arrive mid-season).
 * Returns every actionable phase in priority order so the home card can show a
 * secondary task next to the primary one. Empty list → nothing actionable. */
export function selectHomeSeasonPhases(
  topLeagues: SeasonPredictionTournament[],
  europeanCups: SeasonPredictionTournament[],
  nowSec: number,
): HomeSeasonPhase[] {
  const actionableLeagues = topLeagues.filter((t) => isTableActionable(t, nowSec));
  const actionableCups = europeanCups.filter((t) => isTableActionable(t, nowSec));
  const awardsPending = [...topLeagues, ...europeanCups].filter((t) => isAwardsActionable(t, nowSec));

  const candidates: Array<{ phase: HomeSeasonPhase; deadline: number; rank: number }> = [];
  if (actionableLeagues.length > 0) {
    const deadlineAt = nearestDeadline(actionableLeagues);
    candidates.push({ phase: { kind: "leagues", deadlineAt }, deadline: deadlineAt ?? Infinity, rank: 0 });
  }
  if (awardsPending.length > 0) {
    const deadlineAt = nearestDeadline(awardsPending, awardsDeadlineOf);
    candidates.push({
      phase: { kind: "awards", tournaments: awardsPending, deadlineAt },
      deadline: deadlineAt ?? Infinity,
      rank: 1,
    });
  }
  if (actionableCups.length > 0) {
    const deadlineAt = nearestDeadline(actionableCups);
    candidates.push({
      phase: {
        kind: "eurocups",
        cups: actionableCups,
        isNew: actionableCups.every((t) => !t.entry),
        deadlineAt,
      },
      deadline: deadlineAt ?? Infinity,
      rank: 2,
    });
  }
  candidates.sort((a, b) => (a.deadline - b.deadline) || (a.rank - b.rank));
  return candidates.map((c) => c.phase);
}

/* Single-phase view of the same ranking. Returns null when the season hasn't
 * started for users yet — the card hides instead of rendering an empty compact
 * state. */
export function selectHomeSeasonPhase(
  topLeagues: SeasonPredictionTournament[],
  europeanCups: SeasonPredictionTournament[],
  nowSec: number,
): HomeSeasonPhase | null {
  const phases = selectHomeSeasonPhases(topLeagues, europeanCups, nowSec);
  if (phases.length > 0) return phases[0];
  const all = [...topLeagues, ...europeanCups];
  const anyOpened = all.some((t) => t.status !== "draft" && t.status !== "soon");
  return anyOpened ? { kind: "compact" } : null;
}
