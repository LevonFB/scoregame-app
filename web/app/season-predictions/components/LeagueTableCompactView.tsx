import type { SeasonPredictionTeam } from "../types";
import { getLeagueZoneForPosition, getLeagueZoneMeta } from "./LeagueZoneBadge";

// Screenshot-friendly read-only table: one slim line per team so a full
// 20-team league fits on a single phone screen.
export function LeagueTableCompactView({
  title,
  subtitle,
  teams,
  zones,
  tone,
}: {
  title: string;
  subtitle?: string;
  teams: SeasonPredictionTeam[];
  zones: Record<string, unknown>;
  tone: string;
}) {
  return (
    <section style={cardStyle}>
      <div style={{ height: 3, background: tone, boxShadow: `0 0 12px ${tone}` }} />
      <div style={{ padding: "9px 12px 8px" }}>
        <div style={{ fontSize: 14, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)", lineHeight: 1.15 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ marginTop: 2, fontSize: 11, fontWeight: 750, color: "var(--tg-hint)" }}>{subtitle}</div>
        )}
      </div>
      <div style={{ padding: "0 6px 6px" }}>
        <div style={listStyle}>
          {teams.map((team, index) => {
            const position = index + 1;
            const zone = getLeagueZoneMeta(getLeagueZoneForPosition(position, zones));
            const crest = team.crest_url || "";
            const key = String(team.team_id || team.id);
            return (
              <div key={key} style={rowStyle(index === teams.length - 1)}>
                <div style={{ fontSize: 11.5, fontWeight: 900, textAlign: "center", lineHeight: 1, color: zone ? zone.color : "color-mix(in srgb, var(--tg-text) 45%, var(--tg-hint))" }}>
                  {position}
                </div>
                {crest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={crest}
                    alt=""
                    width={18}
                    height={18}
                    style={{ width: 18, height: 18, borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }}
                  />
                ) : (
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(128,128,128,0.18)", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tg-text)", fontSize: 8, fontWeight: 950 }}>
                    {(team.short_name || team.team_name || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div style={{ fontSize: 12.5, fontWeight: 750, color: "var(--tg-text)", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {team.team_name}
                </div>
                {zone && (
                  <span style={{ fontSize: 10, fontWeight: 900, color: zone.color, whiteSpace: "nowrap", letterSpacing: "0.01em" }}>
                    {zone.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const cardStyle = {
  borderRadius: 16,
  overflow: "hidden",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
} as const;

const listStyle = {
  borderRadius: 10,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.18)",
} as const;

function rowStyle(isLast: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: "22px 18px 1fr auto",
    alignItems: "center",
    gap: 7,
    minHeight: 29,
    padding: "2px 9px 2px 6px",
    borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
  } as const;
}
