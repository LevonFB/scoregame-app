// weeklyGroups.ts — pure resolver that maps a "Расклад недели" group config to its
// member matches using the challenge's match-pool snapshot. No React, no I/O.
// Importable by the user UI and by the api-worker parity/unit tests.

export type WeeklyPoolMatch = {
  match_id?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  kickoff_at?: number | null;
};

export type WeeklyGroupMatch = {
  ref: string;
  home: string;
  away: string;
  kickoff_at: number | null;
  missing: boolean; // true when the ref has no snapshot in the pool
};

export type ResolvedWeeklyGroup = {
  id: string;
  title: string;
  matches: WeeklyGroupMatch[];
};

// Build the ref→match map exactly like the backend pool refs: match_id, plus the
// synthetic "pool_N" (1-based) for matches without an external id.
function buildPoolRefMap(pool: WeeklyPoolMatch[]): Map<string, WeeklyPoolMatch> {
  const map = new Map<string, WeeklyPoolMatch>();
  pool.forEach((m, i) => {
    const id = m?.match_id == null ? "" : String(m.match_id).trim();
    if (id) map.set(id, m);
    map.set(`pool_${i + 1}`, m);
  });
  return map;
}

// Returns resolved groups, or null when the question has no group config (legacy /
// non-Расклад templates → caller falls back to plain options).
export function resolveWeeklyGroups(config: unknown, pool: WeeklyPoolMatch[]): ResolvedWeeklyGroup[] | null {
  const cfg = (config && typeof config === "object" && !Array.isArray(config)) ? (config as Record<string, unknown>) : {};
  const groups = Array.isArray(cfg.groups) ? (cfg.groups as Array<Record<string, unknown>>) : null;
  if (!groups || groups.length === 0) return null;
  const refMap = buildPoolRefMap(pool || []);
  return groups.map((g, i) => {
    const refs = (Array.isArray(g?.match_ids) ? (g.match_ids as unknown[]) : []).map((r) => String(r ?? "").trim()).filter(Boolean);
    const matches: WeeklyGroupMatch[] = refs.map((ref) => {
      const m = refMap.get(ref);
      if (!m) return { ref, home: "", away: "", kickoff_at: null, missing: true };
      return {
        ref,
        home: String(m.home_team_name ?? "").trim(),
        away: String(m.away_team_name ?? "").trim(),
        kickoff_at: m.kickoff_at == null ? null : Number(m.kickoff_at),
        missing: false,
      };
    });
    return { id: String(g?.id ?? `group_${i + 1}`), title: String(g?.title ?? `Группа ${i + 1}`).trim() || `Группа ${i + 1}`, matches };
  });
}

// Match refs across all groups (deduped) — used to compute pool coverage in admin.
export function weeklyGroupMatchRefs(config: unknown): Set<string> {
  const groups = resolveWeeklyGroups(config, []);
  const set = new Set<string>();
  if (!groups) return set;
  for (const g of groups) for (const m of g.matches) set.add(m.ref);
  return set;
}

// Generic group names that read poorly to players (admin activation warning).
const GENERIC_GROUP_TITLE = /^(группа\s*\d+|новая группа|group\s*\d+)$/i;
export function isGenericGroupTitle(title: unknown): boolean {
  return GENERIC_GROUP_TITLE.test(String(title ?? "").trim());
}
