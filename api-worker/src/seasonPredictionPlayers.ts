import { normalizeSeasonPredictionAwardType } from "./seasonPredictionAwardTypes";

export type SeasonPredictionPlayerPositionGroup = "goalkeeper" | "defender" | "midfielder" | "forward" | "unknown";

export type SeasonPredictionAwardCandidateLike = {
  position_group?: string | null;
};

export function normalizePlayerNameForSearch(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Maps a raw position string to one of four groups. Order of checks matters:
 * goalkeeper first (a keeper must never leak into an outfield award), then
 * midfield (so "central/attacking/defensive midfield" stay MF and don't fall
 * into defender/forward by their "defen"/"attack" substrings), then defender,
 * then forward. Single-letter abbreviations are matched as whole tokens only.
 */
export function normalizePlayerPosition(rawPosition: unknown): SeasonPredictionPlayerPositionGroup {
  const value = String(rawPosition || "").trim().toLocaleLowerCase("ru-RU");
  if (!value) return "unknown";
  const compact = value.replace(/[._/]+/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();

  const hasToken = (...tokens: string[]) =>
    tokens.some((t) => new RegExp(`(^|\\s)${t}(\\s|$)`, "i").test(compact));
  const has = (sub: string) => compact.includes(sub);

  // 1) Goalkeeper.
  if (has("goalkeeper") || has("goalie") || has("keeper") || has("вратар") || has("голкипер") || hasToken("gk", "g", "gkp", "kp")) {
    return "goalkeeper";
  }

  // 2) Midfield — must precede defender/forward (phrases contain defen/attack).
  if (has("midfield") || has("midfielder") || has("полузащит") || has("хавбек")
    || hasToken("mf", "m", "dm", "cdm", "cm", "cam", "am", "lm", "rm", "lcm", "rcm", "rdm", "ldm", "rcam", "lcam")) {
    return "midfielder";
  }

  // 3) Defender — back / defence / защитник, plus abbreviations.
  if (has("back") || has("defen") || has("защит") || has("свипер") || has("либеро")
    || hasToken("df", "d", "cb", "lb", "rb", "lwb", "rwb", "wb", "lcb", "rcb")) {
    return "defender";
  }

  // 4) Forward — forward / striker / winger / attacker.
  if (has("forward") || has("striker") || has("wing") || has("attack") || has("offence") || has("offense")
    || has("нападающ") || has("форвард") || has("вингер") || has("бомбардир") || has("атакующ")
    || hasToken("fw", "f", "st", "cf", "lw", "rw", "ss", "ls", "rs", "lf", "rf")) {
    return "forward";
  }

  return "unknown";
}

const POSITION_FIELD_KEYS = [
  "position", "Position",
  "player_position", "playerPosition",
  "role", "Role",
  "type", "player_type", "playerType",
  "pos", "POS", "Pos",
  "positionName", "position_name", "positionCode", "position_code",
  "detailedPosition", "detailed_position",
];

const METADATA_KEYS = ["metadata", "metadata_json", "meta"];

function pickPositionString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const nested = o.name ?? o.shortName ?? o.code ?? o.type ?? o.displayName ?? o.label ?? o.position;
    if (nested === null || nested === undefined) return null;
    if (typeof nested === "string") return nested.trim() || null;
    if (typeof nested === "number") return String(nested);
  }
  return null;
}

/**
 * Pulls a raw position-like value from a CSV/API row, checking many field names
 * and then nested metadata, before normalization. Returns the raw string (not
 * the group) so callers can both normalize it and surface it in previews.
 */
export function extractPlayerPositionFromRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;

  for (const key of POSITION_FIELD_KEYS) {
    if (key in r) {
      const s = pickPositionString(r[key]);
      if (s) return s;
    }
  }

  for (const metaKey of METADATA_KEYS) {
    const meta = r[metaKey];
    if (!meta || typeof meta !== "object") continue;
    const m = meta as Record<string, any>;
    const candidates: unknown[] = [
      m.position, m.player_position, m.playerPosition, m.role, m.type, m.pos,
      m.positionName, m.position_name,
      m.statistics?.position,
      m.player?.type, m.player?.position, m.player?.role,
      m.extra?.position, m.extra?.role,
    ];
    for (const c of candidates) {
      const s = pickPositionString(c);
      if (s) return s;
    }
  }

  return null;
}

export function isEligibleForAward(awardType: unknown, player: SeasonPredictionAwardCandidateLike): boolean {
  const type = normalizeSeasonPredictionAwardType(awardType);
  const group = normalizePlayerPosition(player.position_group || "unknown");
  if (type === "golden_glove") return group === "goalkeeper";
  return group === "defender" || group === "midfielder" || group === "forward";
}
