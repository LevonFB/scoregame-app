// Pure helpers for the Season-Predictions table-zone editor (P6.11).
//
// `rules.zones` is an object map of `zoneKey -> [from, to]` (a 2-number range over
// final standings positions). The admin used to edit this as raw JSON; these helpers
// let a structured editor parse it into rows, rebuild the exact same object (without
// dropping unknown / non-range entries), and validate ranges before save.
//
// IMPORTANT: the on-wire format (object of key -> [from,to]) is unchanged — these
// helpers only translate to/from a form-friendly shape and never alter the payload.

export type ZoneRow = {
  key: string;
  from: string;
  to: string;
};

export type ZoneValidation = {
  fieldErrors: Record<number, string>;
  general: string[];
  ok: boolean;
};

function isRangeTuple(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === "number" && Number.isFinite(v));
}

// Split a parsed `zones` object into editable rows (entries shaped as [from,to])
// and an `extra` bucket that preserves any other / unknown-shaped entries verbatim.
export function parseZonesObject(raw: unknown): { zones: ZoneRow[]; extra: Record<string, unknown> } {
  const zones: ZoneRow[] = [];
  const extra: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (isRangeTuple(value)) {
        zones.push({ key, from: String(value[0]), to: String(value[1]) });
      } else {
        // Unknown shape (legacy / future fields) — keep as-is for round-trip.
        extra[key] = value;
      }
    }
  }
  return { zones, extra };
}

// Rebuild the `zones` object from editor rows, merging back the preserved `extra`
// entries first so a row with the same key can still override if intended.
export function buildZonesObject(zones: ZoneRow[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extra };
  for (const zone of zones) {
    const key = zone.key.trim();
    if (!key) continue;
    out[key] = [Number(zone.from), Number(zone.to)];
  }
  return out;
}

// Validate editor rows. Returns per-row field errors + general (cross-row) warnings.
// Rules: key required + unique, from ≥ 1, to ≥ from, to ≤ teamCount (when known),
// ranges must not overlap (standings positions are exclusive in this model).
export function validateZones(zones: ZoneRow[], teamCount: number): ZoneValidation {
  const fieldErrors: Record<number, string> = {};
  const general: string[] = [];
  const seenKeys = new Set<string>();
  const ranges: Array<{ from: number; to: number; key: string }> = [];

  zones.forEach((zone, index) => {
    const key = zone.key.trim();
    const from = Number(zone.from);
    const to = Number(zone.to);
    if (!key) {
      fieldErrors[index] = "Укажите ключ зоны";
      return;
    }
    if (seenKeys.has(key)) {
      fieldErrors[index] = `Дублирующийся ключ: ${key}`;
      return;
    }
    seenKeys.add(key);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      fieldErrors[index] = "Диапазон должен быть числом";
      return;
    }
    if (from < 1) {
      fieldErrors[index] = "Начало должно быть ≥ 1";
      return;
    }
    if (to < from) {
      fieldErrors[index] = "Конец должен быть ≥ начала";
      return;
    }
    if (teamCount > 0 && to > teamCount) {
      fieldErrors[index] = `Конец не может превышать число команд (${teamCount})`;
      return;
    }
    ranges.push({ from, to, key });
  });

  for (let a = 0; a < ranges.length; a += 1) {
    for (let b = a + 1; b < ranges.length; b += 1) {
      if (ranges[a].from <= ranges[b].to && ranges[b].from <= ranges[a].to) {
        general.push(`Зоны пересекаются: «${ranges[a].key}» и «${ranges[b].key}»`);
      }
    }
  }

  return {
    fieldErrors,
    general,
    ok: Object.keys(fieldErrors).length === 0 && general.length === 0,
  };
}
