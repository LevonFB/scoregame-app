"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { apiFetch } from "@/lib/api";

// Window event fired after a reward is claimed so all badges refresh without a reload.
export const CLAIMABLE_REFRESH_EVENT = "scoregame:claimable-refresh";

export function notifyClaimableChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLAIMABLE_REFRESH_EVENT));
}

// Generic "Можно забрать" counter bound to one endpoint + a claimable extractor.
// Read-only; refetches on the claimable-refresh event after a claim.
function useClaimableEndpointCount<T>(path: string, extract: (res: T) => number): number {
  const [count, setCount] = useState(0);

  const load = useCallback(() => {
    apiFetch<T>(path)
      .then((res) => setCount(extract(res)))
      .catch(() => { /* badge is best-effort */ });
  // extract is a stable inline fn per call site; path is constant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener(CLAIMABLE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(CLAIMABLE_REFRESH_EVENT, onRefresh);
  }, [load]);

  return count;
}

// Weekly Challenge claimable tasks: current challenge + unclaimed archive.
// The archive lives on a separate endpoint, so both are summed — otherwise
// rewards left from a finished challenge disappear from menu/home badges.
export function useWeeklyClaimableCount(): number {
  const current = useClaimableEndpointCount<{ tasks?: Array<{ claimable?: boolean }> }>(
    "/weekly-challenge/tasks",
    (res) => (res.tasks || []).filter((t) => t.claimable).length,
  );
  const archive = useClaimableEndpointCount<{ total_claimable?: number }>(
    "/weekly-challenge/tasks/unclaimed",
    (res) => Number(res.total_claimable || 0),
  );
  return current + archive;
}

// E10.2: season-prediction tasks claimable count (reward-bearing, completed, not claimed).
// The backend already exposes claimable_count; fall back to scanning claim_status.
export function useSeasonTaskClaimableCount(): number {
  return useClaimableEndpointCount<{ claimable_count?: number; sections?: Array<{ subsections?: Array<{ tasks?: Array<{ claim_status?: string }> }> }> }>(
    "/season-predictions/tasks",
    (res) => {
      if (typeof res.claimable_count === "number") return res.claimable_count;
      let n = 0;
      for (const s of res.sections || []) for (const ss of s.subsections || []) for (const t of ss.tasks || []) if (t.claim_status === "claimable") n += 1;
      return n;
    },
  );
}

// Combined "Можно забрать" total across all explicit claim flows (menu/global badge).
export function useClaimableCount(): number {
  return useWeeklyClaimableCount() + useSeasonTaskClaimableCount();
}

// Small accent count badge. Renders nothing when count <= 0 (no empty circle).
export function CountBadge({ count, style }: { count: number; style?: CSSProperties }) {
  if (!count || count <= 0) return null;
  return (
    <span
      aria-label={`Можно забрать: ${count}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 18,
        height: 18,
        padding: "0 5px",
        borderRadius: 999,
        background: "var(--tg-button)",
        color: "var(--tg-button-text)",
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        ...style,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
