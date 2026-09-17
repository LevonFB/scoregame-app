// Stage 9 — client-side in-flight request coalescer for home leaderboard loads.
//
// Collapses IDENTICAL concurrent requests (same key) into a single network call so
// several components rendering at once share one result. The in-flight entry is
// cleared as soon as the request settles (success OR error) — no time-based cache,
// no cross-user mixing (the caller folds a viewer identity into the key). An error
// clears the entry, so a retry issues a fresh request.

type Pending<T> = Promise<T>;

export class RequestDeduper {
  private inflight = new Map<string, Pending<unknown>>();

  /** Number of in-flight keys (used by tests/diagnostics). */
  size(): number {
    return this.inflight.size;
  }

  /** Drop everything (e.g. on user switch). */
  clear(): void {
    this.inflight.clear();
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Pending<T> | undefined;
    if (existing) return existing;
    const p = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}

// One shared instance per loaded app (single user per Mini App session). Keys must
// include a viewer identity so a future multi-user context cannot mix results.
export const homeLeaderboardDeduper = new RequestDeduper();

type ViewerLike = { id?: number | string | null; userId?: number | string | null; user_id?: number | string | null } | null | undefined;
export function viewerKeyPart(me: ViewerLike): string {
  const id = me?.id ?? me?.userId ?? me?.user_id;
  return id != null ? String(id) : "anon";
}
