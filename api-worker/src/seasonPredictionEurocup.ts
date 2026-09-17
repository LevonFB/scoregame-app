// Stage E1 — official results foundation for the European cups (league stage).
//
// Pure, DB-free helpers (codes, zone snapshot, 36-team table validation) so they
// can be unit-tested without auth or D1. NO scoring, NO recalc, NO leaderboard,
// NO rewards happen here — E1 only fixes the admin-confirmed official table.

export const EUROCUP_TEAM_COUNT = 36;
export const EUROCUP_CODES = ["UCL", "UEL", "UECL"] as const;
export type EurocupCode = (typeof EUROCUP_CODES)[number];

export function isEurocupCode(value: unknown): value is EurocupCode {
  return typeof value === "string" && (EUROCUP_CODES as readonly string[]).includes(value);
}

export type EurocupZonesSnapshot = {
  top8: { from: number; to: number; label: string };
  playoff_9_24: { from: number; to: number; label: string };
  eliminated: { from: number; to: number; label: string };
};

// League-stage zones for a 36-team eurocup: 1–8 direct, 9–24 knockout playoff, 25–36 out.
export function buildEurocupLeagueStageZonesSnapshot(): EurocupZonesSnapshot {
  return {
    top8: { from: 1, to: 8, label: "Топ-8" },
    playoff_9_24: { from: 9, to: 24, label: "9–24" },
    eliminated: { from: 25, to: 36, label: "Вылет" },
  };
}

type ParsedRow = { id: string; position: number | null };

// Accepts an array (of ids or {position,team_id} objects) or an object with
// `ordered_team_ids` / `ordered_teams` / `table` / `teams`.
function parseEurocupRows(tableJson: unknown): ParsedRow[] {
  const t = tableJson as Record<string, unknown> | null;
  const source: unknown[] = Array.isArray(tableJson)
    ? tableJson
    : Array.isArray(t?.ordered_team_ids)
      ? (t!.ordered_team_ids as unknown[])
      : Array.isArray(t?.ordered_teams)
        ? (t!.ordered_teams as unknown[])
        : Array.isArray(t?.table)
          ? (t!.table as unknown[])
          : Array.isArray(t?.teams)
            ? (t!.teams as unknown[])
            : [];
  return source.map((item) => {
    if (typeof item === "string" || typeof item === "number") {
      return { id: String(item).trim(), position: null };
    }
    const obj = item as Record<string, unknown> | null;
    const id = String(obj?.team_ref ?? obj?.team_id ?? obj?.teamId ?? obj?.id ?? "").trim();
    const rawPos = obj?.position;
    const pos = rawPos == null || rawPos === "" ? null : Number(rawPos);
    return { id, position: pos != null && Number.isFinite(pos) ? pos : null };
  });
}

/**
 * Validate a eurocup official league-stage table and return the 36 team ids in
 * final order. Throws coded errors on any problem. When rows carry explicit
 * `position`, they must form a 1..36 bijection; otherwise array order is used.
 */
export function validateEurocupOfficialTable(tableJson: unknown, allowedTeamIds: string[]): string[] {
  const rows = parseEurocupRows(tableJson);
  if (rows.length !== EUROCUP_TEAM_COUNT) throw new Error("EUROCUP_TABLE_INCOMPLETE");
  if (rows.some((r) => !r.id)) throw new Error("EUROCUP_TABLE_INVALID_ROW");

  const ids = rows.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new Error("EUROCUP_TABLE_HAS_DUPLICATES");

  const positions = rows.map((r) => r.position);
  const anyExplicit = positions.some((p) => p != null);
  let ordered = ids;
  if (anyExplicit) {
    if (positions.some((p) => p == null)) throw new Error("EUROCUP_TABLE_POSITION_MISSING");
    const sorted = [...(positions as number[])].sort((a, b) => a - b);
    for (let i = 0; i < EUROCUP_TEAM_COUNT; i += 1) {
      if (sorted[i] !== i + 1) throw new Error("EUROCUP_TABLE_BAD_POSITIONS"); // covers dup + out-of-range
    }
    ordered = [...rows].sort((a, b) => (a.position as number) - (b.position as number)).map((r) => r.id);
  }

  const allowed = new Set(allowedTeamIds.map(String));
  for (const id of ids) {
    if (!allowed.has(id)) throw new Error("EUROCUP_TABLE_HAS_UNKNOWN_TEAM");
  }
  return ordered;
}
