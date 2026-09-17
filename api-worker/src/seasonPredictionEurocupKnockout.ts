// seasonPredictionEurocupKnockout.ts
// Stage E6: pure helpers for the eurocup playoff (knockout) FOUNDATION.
// No scoring, no DB, no I/O. Builds the placeholder slot set, validates admin
// pairings/winners, and validates user winner-picks. Playoff points are NOT
// computed here — that is a later stage (E7 / eurocups_v2).

export type EurocupKnockoutStage =
  | "knockout_playoffs"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "final";

export type EurocupKnockoutStageDef = {
  stage: EurocupKnockoutStage;
  label: string;
  count: number;
  keyPart: string; // KP | R16 | QF | SF | FINAL
};

// 8 + 8 + 4 + 2 + 1 = 23 slots per tournament. Champion is derived from the
// final winner, so it is NOT a slot.
export const EUROCUP_KNOCKOUT_STAGES: EurocupKnockoutStageDef[] = [
  { stage: "knockout_playoffs", label: "Стыки плей-офф", count: 8, keyPart: "KP" },
  { stage: "round_of_16", label: "1/8 финала", count: 8, keyPart: "R16" },
  { stage: "quarter_final", label: "1/4 финала", count: 4, keyPart: "QF" },
  { stage: "semi_final", label: "1/2 финала", count: 2, keyPart: "SF" },
  { stage: "final", label: "Финал", count: 1, keyPart: "FINAL" },
];

export const EUROCUP_KNOCKOUT_TOTAL_SLOTS = EUROCUP_KNOCKOUT_STAGES.reduce((n, s) => n + s.count, 0); // 23

const STAGE_RANK: Record<EurocupKnockoutStage, number> = {
  knockout_playoffs: 0,
  round_of_16: 1,
  quarter_final: 2,
  semi_final: 3,
  final: 4,
};

const STATUSES = new Set(["draft", "confirmed", "completed", "void"]);

export type EurocupKnockoutSlot = {
  stage: EurocupKnockoutStage;
  match_order: number; // 1-based within the stage
  match_key: string;
};

// match_key: e.g. UCL_KP_1, UCL_R16_1, UCL_QF_1, UCL_SF_1, UCL_FINAL.
export function knockoutMatchKey(code: string, def: EurocupKnockoutStageDef, index1: number): string {
  return def.count === 1 ? `${code}_${def.keyPart}` : `${code}_${def.keyPart}_${index1}`;
}

// Deterministic placeholder slot set for a tournament. Used by the idempotent
// bootstrap (caller inserts with INSERT OR IGNORE on the unique match_key).
export function buildEurocupKnockoutSlots(code: string): EurocupKnockoutSlot[] {
  const slots: EurocupKnockoutSlot[] = [];
  for (const def of EUROCUP_KNOCKOUT_STAGES) {
    for (let i = 1; i <= def.count; i += 1) {
      slots.push({ stage: def.stage, match_order: i, match_key: knockoutMatchKey(code, def, i) });
    }
  }
  return slots;
}

// ── Bracket path (E7 fix) ────────────────────────────────────────────────────
// After the 1/8 draw the whole tree is fixed. Each downstream match draws its two
// teams from the winners of two upstream matches (stable source links).
export type BracketSource = { stage: EurocupKnockoutStage; a: string; b: string };

export function eurocupKnockoutBracketSources(code: string): Record<string, BracketSource> {
  const r16 = (i: number) => `${code}_R16_${i}`;
  const qf = (i: number) => `${code}_QF_${i}`;
  const sf = (i: number) => `${code}_SF_${i}`;
  const fin = `${code}_FINAL`;
  return {
    [qf(1)]: { stage: "quarter_final", a: r16(1), b: r16(2) },
    [qf(2)]: { stage: "quarter_final", a: r16(3), b: r16(4) },
    [qf(3)]: { stage: "quarter_final", a: r16(5), b: r16(6) },
    [qf(4)]: { stage: "quarter_final", a: r16(7), b: r16(8) },
    [sf(1)]: { stage: "semi_final", a: qf(1), b: qf(2) },
    [sf(2)]: { stage: "semi_final", a: qf(3), b: qf(4) },
    [fin]: { stage: "final", a: sf(1), b: sf(2) },
  };
}

// ── 1/8 eligibility (E7 fix) ──────────────────────────────────────────────────
// Only 16 teams may enter the 1/8: the official league-stage top-8 + the 8
// official playoff winners. NOT all 36 tournament teams.
export type PlayoffResultRow = { stage: string; status?: unknown; winner_team_id?: unknown };

export function eurocupPlayoffWinners(matches: PlayoffResultRow[]): string[] {
  return (matches || [])
    .filter((m) => String(m.stage) === "knockout_playoffs" && String(m.status ?? "") !== "void" && m.winner_team_id != null && m.winner_team_id !== "")
    .map((m) => String(m.winner_team_id));
}

export function eurocupR16Eligibility(officialTop8: string[], playoffMatches: PlayoffResultRow[]): {
  top8: string[];
  winners: string[];
  eligible: Set<string>;
  top8_confirmed: boolean;
  winners_confirmed: boolean;
  ready: boolean;
} {
  const top8 = (officialTop8 || []).map(String).filter(Boolean);
  const winners = eurocupPlayoffWinners(playoffMatches);
  const eligible = new Set<string>([...top8, ...winners]);
  const top8_confirmed = top8.length === 8 && new Set(top8).size === 8;
  const winners_confirmed = winners.length === 8 && new Set(winners).size === 8;
  const ready = top8_confirmed && winners_confirmed && eligible.size === 16;
  return { top8, winners, eligible, top8_confirmed, winners_confirmed, ready };
}

// Validate the full 8-pair 1/8 bracket against the eligible pool (admin confirm).
export function validateR16BracketComplete(
  r16Pairs: Array<{ team_a_id: string | null; team_b_id: string | null }>,
  eligible: Set<string>,
): void {
  if (eligible.size !== 16) throw new Error("EUROCUP_R16_ELIGIBLE_TEAMS_REQUIRED");
  const ids: string[] = [];
  for (const m of r16Pairs) {
    if (m.team_a_id) ids.push(m.team_a_id);
    if (m.team_b_id) ids.push(m.team_b_id);
  }
  if (ids.length !== 16) throw new Error("EUROCUP_R16_REQUIRES_16_TEAMS");
  if (new Set(ids).size !== 16) throw new Error("EUROCUP_R16_DUPLICATE_TEAM");
  for (const id of ids) if (!eligible.has(id)) throw new Error("EUROCUP_R16_TEAM_NOT_ELIGIBLE");
}

// Derive the user's bracket matches: r16 admin pairs + downstream pairs computed
// from the user's own winner picks via the fixed source links. A downstream match
// is "known" only once both upstream winners are picked.
export function deriveUserBracketMatches(
  r16Known: KnownMatch[],
  rawPicks: Record<string, unknown>,
  sources: Record<string, BracketSource>,
): KnownMatch[] {
  const winnerOf = (matchKey: string): string | null => {
    for (const stage of Object.keys(rawPicks || {})) {
      const obj = (rawPicks as Record<string, unknown>)[stage];
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const v = (obj as Record<string, unknown>)[matchKey];
        if (v != null && v !== "") return String(v);
      }
    }
    return null;
  };
  const out: KnownMatch[] = [...r16Known];
  // qf depends on r16, sf on qf, final on sf — winnerOf reads from rawPicks so a
  // single pass over the source map is enough.
  for (const [matchKey, src] of Object.entries(sources)) {
    const a = winnerOf(src.a);
    const b = winnerOf(src.b);
    if (a && b) out.push({ match_key: matchKey, stage: src.stage, team_a_id: a, team_b_id: b });
  }
  return out;
}

export function sortKnockoutMatches<T extends { stage: string; match_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ra = STAGE_RANK[a.stage as EurocupKnockoutStage] ?? 99;
    const rb = STAGE_RANK[b.stage as EurocupKnockoutStage] ?? 99;
    if (ra !== rb) return ra - rb;
    return Number(a.match_order || 0) - Number(b.match_order || 0);
  });
}

// A match is "known" (pickable by users) when both teams are set and the slot
// is confirmed or completed by the admin.
export function isKnockoutMatchKnown(m: { team_a_id: unknown; team_b_id: unknown; status: unknown }): boolean {
  const a = m.team_a_id == null || m.team_a_id === "" ? null : String(m.team_a_id);
  const b = m.team_b_id == null || m.team_b_id === "" ? null : String(m.team_b_id);
  const st = String(m.status || "");
  return !!a && !!b && (st === "confirmed" || st === "completed");
}

// ── Stage result lock (E7 fix) ───────────────────────────────────────────────
// "Pairs confirmed" = both teams set (status confirmed/completed) → stage stays
// open for predictions. "Results confirmed" = admin set an official winner_team_id
// for a match → that stage's prediction is locked (read-only). We lock a stage as
// soon as ANY non-void match in it has an official winner (safest).

type KnockoutResultRow = { stage: string; status?: unknown; winner_team_id?: unknown };

export function eurocupKnockoutStageResultsConfirmed(matches: KnockoutResultRow[], stage: string): boolean {
  return (matches || []).some((m) =>
    String(m.stage) === stage &&
    String(m.status ?? "") !== "void" &&
    m.winner_team_id != null && m.winner_team_id !== "",
  );
}

export function eurocupKnockoutLockedStages(matches: KnockoutResultRow[]): Set<string> {
  const locked = new Set<string>();
  for (const def of EUROCUP_KNOCKOUT_STAGES) {
    if (eurocupKnockoutStageResultsConfirmed(matches, def.stage)) locked.add(def.stage);
  }
  return locked;
}

export function eurocupBracketResultsConfirmed(matches: KnockoutResultRow[]): boolean {
  return ["round_of_16", "quarter_final", "semi_final", "final"].some((stage) =>
    eurocupKnockoutStageResultsConfirmed(matches, stage),
  );
}

export function eurocupDownstreamKnockoutPairUpdates(
  matches: Array<{
    match_key: string;
    stage: string;
    team_a_id?: unknown;
    team_b_id?: unknown;
    winner_team_id?: unknown;
    status?: unknown;
  }>,
  sources: Record<string, BracketSource>,
): Array<{ match_key: string; stage: EurocupKnockoutStage; team_a_id: string; team_b_id: string; team_a_source: string; team_b_source: string }> {
  const byKey = new Map(matches.map((m) => [String(m.match_key), m]));
  const winnerOf = (key: string): string | null => {
    const m = byKey.get(key);
    if (!m || !["confirmed", "completed"].includes(String(m.status ?? ""))) return null;
    const winner = m.winner_team_id == null || m.winner_team_id === "" ? null : String(m.winner_team_id);
    return winner;
  };
  const out: Array<{ match_key: string; stage: EurocupKnockoutStage; team_a_id: string; team_b_id: string; team_a_source: string; team_b_source: string }> = [];
  for (const [matchKey, src] of Object.entries(sources)) {
    const target = byKey.get(matchKey);
    if (!target) continue;
    const status = String(target.status ?? "");
    const hasConfirmedWinner = status !== "void" && target.winner_team_id != null && target.winner_team_id !== "";
    if (hasConfirmedWinner) continue;
    const a = winnerOf(src.a);
    const b = winnerOf(src.b);
    if (!a || !b) continue;
    out.push({
      match_key: matchKey,
      stage: src.stage,
      team_a_id: a,
      team_b_id: b,
      team_a_source: `winner:${src.a}`,
      team_b_source: `winner:${src.b}`,
    });
  }
  return out;
}

function normalizeStagePicks(obj: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v != null && v !== "") out[k] = String(v);
    }
  }
  return out;
}

function sameStagePicks(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  return ak.every((k, i) => bk[i] === k && a[k] === b[k]);
}

// First locked stage whose incoming picks differ from the stored picks (= an
// attempt to change a locked stage). null = no conflict.
export function lockedStagePickConflict(
  incoming: Record<string, Record<string, string>>,
  stored: Record<string, unknown>,
  locked: Set<string>,
): string | null {
  for (const stage of locked) {
    // Absent stage in the payload = not a change attempt (client sent a partial
    // update); only an explicitly-provided, differing stage is a conflict.
    if (!(stage in incoming)) continue;
    if (!sameStagePicks(normalizeStagePicks(incoming[stage]), normalizeStagePicks(stored[stage]))) return stage;
  }
  return null;
}

// Force locked stages to keep their stored picks (never overwritten by a write).
export function applyLockedStagePicks(
  incoming: Record<string, Record<string, string>>,
  stored: Record<string, unknown>,
  locked: Set<string>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = { ...incoming };
  for (const stage of locked) out[stage] = normalizeStagePicks(stored[stage]);
  return out;
}

// ── Admin update validation ─────────────────────────────────────────────────

export type AdminKnockoutMatchInput = {
  match_key: string;
  team_a_id?: string | null;
  team_b_id?: string | null;
  team_a_source?: string | null;
  team_b_source?: string | null;
  winner_team_id?: string | null;
  status?: string | null;
};

export type AdminKnockoutMatchNormalized = {
  match_key: string;
  stage: EurocupKnockoutStage;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_source: string | null;
  team_b_source: string | null;
  winner_team_id: string | null;
  status: string;
};

export type KnockoutSlotMeta = { match_key: string; stage: EurocupKnockoutStage };

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v).trim() || null);

// Validate admin pairings/winners for a tournament's knockout matches.
// `slotByKey` is the existing slot set (match_key → stage). `allTeamIds` and
// `zone924TeamIds` come from the confirmed official league-stage result.
export function validateAdminKnockoutMatches(
  inputs: AdminKnockoutMatchInput[],
  slotByKey: Map<string, KnockoutSlotMeta>,
  allTeamIds: Set<string>,
  zone924TeamIds: Set<string>,
  r16EligibleTeamIds?: Set<string>,
): AdminKnockoutMatchNormalized[] {
  const out: AdminKnockoutMatchNormalized[] = [];
  // Track per-stage team usage to forbid the same team appearing twice in a stage.
  const stageTeams = new Map<EurocupKnockoutStage, Set<string>>();

  for (const raw of inputs || []) {
    const key = str(raw.match_key);
    if (!key) throw new Error("KNOCKOUT_MATCH_KEY_REQUIRED");
    const slot = slotByKey.get(key);
    if (!slot) throw new Error("KNOCKOUT_MATCH_NOT_IN_TOURNAMENT");

    const status = str(raw.status) || "draft";
    if (!STATUSES.has(status)) throw new Error("KNOCKOUT_STATUS_INVALID");

    const teamA = str(raw.team_a_id);
    const teamB = str(raw.team_b_id);
    const winner = str(raw.winner_team_id);

    for (const t of [teamA, teamB]) {
      if (t && !allTeamIds.has(t)) throw new Error("KNOCKOUT_TEAM_NOT_IN_TOURNAMENT");
    }
    // Playoff round teams must come from the official 9–24 zone.
    if (slot.stage === "knockout_playoffs") {
      for (const t of [teamA, teamB]) {
        if (t && zone924TeamIds.size > 0 && !zone924TeamIds.has(t)) {
          throw new Error("KNOCKOUT_PLAYOFF_TEAM_NOT_IN_ZONE_9_24");
        }
      }
    }
    // 1/8 teams must be eligible: official top-8 + playoff winners (never all 36).
    if (slot.stage === "round_of_16" && r16EligibleTeamIds && r16EligibleTeamIds.size > 0) {
      for (const t of [teamA, teamB]) {
        if (t && !r16EligibleTeamIds.has(t)) throw new Error("EUROCUP_R16_TEAM_NOT_ELIGIBLE");
      }
    }
    if (teamA && teamB && teamA === teamB) throw new Error("KNOCKOUT_MATCH_SAME_TEAM");

    if (winner && winner !== teamA && winner !== teamB) {
      throw new Error("KNOCKOUT_WINNER_NOT_IN_MATCH");
    }
    if (status === "confirmed" && (!teamA || !teamB)) {
      throw new Error("KNOCKOUT_CONFIRMED_REQUIRES_BOTH_TEAMS");
    }

    // No duplicate team within the same stage.
    let used = stageTeams.get(slot.stage);
    if (!used) { used = new Set(); stageTeams.set(slot.stage, used); }
    for (const t of [teamA, teamB]) {
      if (!t) continue;
      if (used.has(t)) throw new Error("KNOCKOUT_TEAM_DUPLICATE_IN_STAGE");
      used.add(t);
    }

    out.push({
      match_key: key,
      stage: slot.stage,
      team_a_id: teamA,
      team_b_id: teamB,
      team_a_source: str(raw.team_a_source),
      team_b_source: str(raw.team_b_source),
      winner_team_id: status === "void" ? null : winner,
      status,
    });
  }
  return out;
}

// ── User picks validation ───────────────────────────────────────────────────

export type KnownMatch = {
  match_key: string;
  stage: EurocupKnockoutStage;
  team_a_id: string;
  team_b_id: string;
};

export type ValidatedKnockoutPicks = {
  picks: Record<string, Record<string, string>>; // stage → { match_key: winner_team_id }
  champion_team_id: string | null;
};

// Validate user picks against the set of currently-known matches. Picks for
// unknown matches are rejected; a pick must be one of the match's two teams.
// When `requireAll` (submit), every known match must have a pick.
export function validateUserKnockoutPicks(
  rawPicks: unknown,
  knownMatches: KnownMatch[],
  allTeamIds: Set<string>,
  requireAll: boolean,
): ValidatedKnockoutPicks {
  const knownByKey = new Map(knownMatches.map((m) => [m.match_key, m]));
  const raw = (rawPicks && typeof rawPicks === "object" && !Array.isArray(rawPicks))
    ? (rawPicks as Record<string, unknown>)
    : {};

  const byStage: Record<string, Record<string, string>> = {};
  // Flatten any { stage: { match_key: winner } } structure from the client.
  for (const def of EUROCUP_KNOCKOUT_STAGES) {
    const stageObj = raw[def.stage];
    if (!stageObj || typeof stageObj !== "object" || Array.isArray(stageObj)) continue;
    for (const [matchKey, winnerRaw] of Object.entries(stageObj as Record<string, unknown>)) {
      const winner = winnerRaw == null || winnerRaw === "" ? null : String(winnerRaw);
      if (!winner) continue;
      const known = knownByKey.get(matchKey);
      if (!known) throw new Error("KNOCKOUT_PICK_FOR_UNKNOWN_MATCH");
      if (known.stage !== def.stage) throw new Error("KNOCKOUT_PICK_STAGE_MISMATCH");
      if (winner !== known.team_a_id && winner !== known.team_b_id) {
        throw new Error("KNOCKOUT_PICK_NOT_IN_MATCH");
      }
      if (!byStage[def.stage]) byStage[def.stage] = {};
      byStage[def.stage][matchKey] = winner;
    }
  }

  // Champion (optional). If set it must be a valid tournament team.
  const championRaw = raw.champion_team_id;
  const champion = championRaw == null || championRaw === "" ? null : String(championRaw);
  if (champion && !allTeamIds.has(champion)) throw new Error("KNOCKOUT_CHAMPION_INVALID");

  if (requireAll) {
    for (const m of knownMatches) {
      const picked = byStage[m.stage]?.[m.match_key];
      if (!picked) throw new Error("KNOCKOUT_PICKS_INCOMPLETE");
    }
  }

  return { picks: byStage, champion_team_id: champion };
}

// ── Bulk stage status (admin) ────────────────────────────────────────────────
// Apply one status to every match of a stage in a single action. Pure validation
// only — the DB write + downstream generation happen in the route. NO scoring.

export const EUROCUP_BULK_STAGE_STATUSES = new Set(["draft", "confirmed", "completed"]);

// Accept both the canonical stage keys and the short admin codes (r16/qf/sf…).
export function normalizeKnockoutStageParam(raw: string): EurocupKnockoutStage | null {
  const s = String(raw || "").toLowerCase().trim();
  const map: Record<string, EurocupKnockoutStage> = {
    knockout_playoffs: "knockout_playoffs", playoffs: "knockout_playoffs", kp: "knockout_playoffs", ties: "knockout_playoffs",
    round_of_16: "round_of_16", r16: "round_of_16", "1/8": "round_of_16",
    quarter_final: "quarter_final", qf: "quarter_final", "1/4": "quarter_final",
    semi_final: "semi_final", sf: "semi_final", "1/2": "semi_final",
    final: "final",
  };
  return map[s] || null;
}

export type BulkStatusMatchRow = {
  match_key: string;
  stage: string;
  team_a_id?: unknown;
  team_b_id?: unknown;
  winner_team_id?: unknown;
  status?: unknown;
};

export type BulkStageStatusPlan =
  | { ok: true; stage: EurocupKnockoutStage; status: string; targets: string[]; void_skipped: number }
  | { ok: false; error: string; missing_match_keys?: string[] };

// Validate a bulk "set all matches of <stage> to <status>" request.
//  - draft     → no team requirement (reset).
//  - confirmed → every (non-void) match must have both teams (pair confirmed).
//  - completed → every (non-void) match must have both teams AND a valid winner.
export function planEurocupBulkStageStatus(
  matches: BulkStatusMatchRow[],
  stageRaw: string,
  statusRaw: string,
): BulkStageStatusPlan {
  const stage = normalizeKnockoutStageParam(stageRaw);
  if (!stage) return { ok: false, error: "EUROCUP_KNOCKOUT_STAGE_INVALID" };
  const status = String(statusRaw || "").trim();
  if (!EUROCUP_BULK_STAGE_STATUSES.has(status)) return { ok: false, error: "EUROCUP_KNOCKOUT_STATUS_INVALID" };

  const all = (matches || []).filter((m) => String(m.stage) === stage);
  if (all.length === 0) return { ok: false, error: "EUROCUP_STAGE_HAS_NO_MATCHES" };
  const live = all.filter((m) => String(m.status ?? "") !== "void");
  const voidSkipped = all.length - live.length;
  if (live.length === 0) return { ok: false, error: "EUROCUP_STAGE_HAS_NO_MATCHES" };

  const idOf = (v: unknown) => (v == null || v === "" ? null : String(v));

  if (status === "completed") {
    const missing: string[] = [];
    for (const m of live) {
      const a = idOf(m.team_a_id), b = idOf(m.team_b_id), w = idOf(m.winner_team_id);
      if (!a || !b || !w || (w !== a && w !== b)) missing.push(String(m.match_key));
    }
    if (missing.length) return { ok: false, error: "EUROCUP_STAGE_WINNERS_REQUIRED", missing_match_keys: missing };
  } else if (status === "confirmed") {
    const missing: string[] = [];
    for (const m of live) {
      const a = idOf(m.team_a_id), b = idOf(m.team_b_id);
      if (!a || !b) missing.push(String(m.match_key));
    }
    if (missing.length) return { ok: false, error: "EUROCUP_STAGE_PAIRS_REQUIRED", missing_match_keys: missing };
  }

  return { ok: true, stage, status, targets: live.map((m) => String(m.match_key)), void_skipped: voidSkipped };
}
