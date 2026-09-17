// Stage 9 — safe in-flight request coalescing for leaderboard computations.
//
// Goal: collapse IDENTICAL concurrent leaderboard computations within one worker
// isolate into a single computation (request coalescing). It does NOT cache across
// time (no persistent Cache API for personalized responses) — the in-flight entry
// is cleared as soon as the computation settles. An error clears the entry too, so
// a retry recomputes. The dedupe key includes the viewer so different users / scopes
// / periods never share a result.

/** Build a stable dedupe key for a global leaderboard computation. */
export function buildGlobalLeaderboardKey(
  resolvedPeriod: string,
  seasonId: number | null | undefined,
  viewerId: number | null | undefined
): string {
  return `global|${resolvedPeriod}|${seasonId ?? "-"}|${viewerId ?? "anon"}`;
}

/** Build a stable dedupe key for a league leaderboard computation. */
export function buildLeagueLeaderboardKey(
  leagueId: string,
  resolvedPeriod: string,
  seasonId: number | null | undefined,
  viewerId: number | null | undefined
): string {
  return `league|${leagueId}|${resolvedPeriod}|${seasonId ?? "-"}|${viewerId ?? "anon"}`;
}

export interface DedupeOutcome<T> {
  value: T;
  /** True when this call attached to an already in-flight computation. */
  coalesced: boolean;
}

/**
 * Per-isolate in-flight coalescer. `run(key, fn)` returns the same promise for
 * concurrent identical keys; the entry is deleted once it settles (success OR
 * error), so subsequent calls recompute. Never throws synchronously.
 */
export class InFlightDeduper {
  private inflight = new Map<string, Promise<unknown>>();

  /** Number of currently in-flight keys (for tests / metrics). */
  size(): number {
    return this.inflight.size;
  }

  async run<T>(key: string, fn: () => Promise<T>): Promise<DedupeOutcome<T>> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      // Attach to the in-flight computation; do not start a new one.
      const value = await existing;
      return { value, coalesced: true };
    }
    const p = (async () => fn())();
    this.inflight.set(key, p);
    try {
      const value = await p;
      return { value, coalesced: false };
    } finally {
      // Clear whether it resolved or rejected → errors allow a fresh retry.
      this.inflight.delete(key);
    }
  }
}
