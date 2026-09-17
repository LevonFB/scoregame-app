type ZoneRange = [number, number];

const ZONE_LABELS: Record<string, string> = {
  champion: "Чемпион",
  champions_league: "ЛЧ",
  europa_league: "ЛЕ",
  conference_league: "ЛК",
  relegation: "Вылет",
  playoff_relegation: "Стыки",
  playoff: "Стыки",
  // Eurocup league-stage zones (Stage E1).
  top8: "Топ-8",
  playoff_9_24: "9–24",
  eliminated: "Вылет",
};

const ZONE_COLORS: Record<string, { color: string; background: string }> = {
  champion: { color: "#ffd34d", background: "rgba(255,211,77,0.14)" },
  champions_league: { color: "#45caff", background: "rgba(69,202,255,0.14)" },
  europa_league: { color: "#ff9f43", background: "rgba(255,159,67,0.14)" },
  conference_league: { color: "#47e36f", background: "rgba(71,227,111,0.14)" },
  relegation: { color: "#ff5b57", background: "rgba(255,91,87,0.14)" },
  playoff_relegation: { color: "#ffb020", background: "rgba(255,176,32,0.14)" },
  playoff: { color: "#ffb020", background: "rgba(255,176,32,0.14)" },
  // Eurocup league-stage zones (Stage E1).
  top8: { color: "#45caff", background: "rgba(69,202,255,0.14)" },
  playoff_9_24: { color: "#ffb020", background: "rgba(255,176,32,0.14)" },
  eliminated: { color: "#ff5b57", background: "rgba(255,91,87,0.14)" },
};

function isRange(value: unknown): value is ZoneRange {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

export function getLeagueZoneForPosition(position: number, zones: Record<string, unknown>) {
  for (const [key, value] of Object.entries(zones || {})) {
    if (key === "champion") continue;
    if (!isRange(value)) continue;
    const from = Number(value[0]);
    const to = Number(value[1]);
    if (position >= from && position <= to) return key;
  }
  if (isRange(zones?.champion)) {
    const [from, to] = zones.champion;
    if (position >= Number(from) && position <= Number(to)) return "champion";
  }
  return null;
}

// Compact-view helper: label + accent color for a zone (no pill markup).
export function getLeagueZoneMeta(zone: string | null): { label: string; color: string } | null {
  if (!zone) return null;
  return {
    label: ZONE_LABELS[zone] || zone,
    color: (ZONE_COLORS[zone] || { color: "var(--tg-hint)" }).color,
  };
}

export function LeagueZoneBadge({ zone }: { zone: string | null }) {
  if (!zone) return null;
  const palette = ZONE_COLORS[zone] || { color: "var(--tg-hint)", background: "rgba(128,128,128,0.12)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 22,
        padding: "0 8px",
        borderRadius: 999,
        color: palette.color,
        background: palette.background,
        fontSize: 11,
        fontWeight: 950,
        whiteSpace: "nowrap",
      }}
    >
      {ZONE_LABELS[zone] || zone}
    </span>
  );
}
