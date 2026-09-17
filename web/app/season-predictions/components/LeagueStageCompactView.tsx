import { useMemo } from "react";
import { getLeagueZoneMeta } from "./LeagueZoneBadge";
import type { SeasonPredictionLeagueStageJson, SeasonPredictionTeam } from "../types";

// Screenshot-friendly read-only view of a confirmed eurocup league-stage pick:
// one slim line per team, grouped by the zone the user assigned it to.
// Mirrors LeagueTableCompactView (top-5 leagues) — same card, same rhythm.
export function LeagueStageCompactView({
  title,
  subtitle,
  teams,
  value,
  tone,
}: {
  title: string;
  subtitle?: string;
  teams: SeasonPredictionTeam[];
  value: SeasonPredictionLeagueStageJson;
  tone: string;
}) {
  const groups = useMemo(() => {
    const byRef = new Map<string, SeasonPredictionTeam>();
    for (const team of teams) byRef.set(String(team.team_id || team.id), team);

    const top8 = value.league_stage.top8_team_ids
      .map((ref) => byRef.get(String(ref)))
      .filter((team): team is SeasonPredictionTeam => !!team);
    const zone = value.league_stage.zone_9_24_team_ids
      .map((ref) => byRef.get(String(ref)))
      .filter((team): team is SeasonPredictionTeam => !!team);

    const picked = new Set([
      ...top8.map((team) => String(team.team_id || team.id)),
      ...zone.map((team) => String(team.team_id || team.id)),
    ]);
    // Everything the user left unassigned reads as "does not advance".
    const rest = teams.filter((team) => !picked.has(String(team.team_id || team.id)));

    return [
      { zone: "top8", teams: top8, from: 1 },
      { zone: "playoff_9_24", teams: zone, from: 9 },
      { zone: "eliminated", teams: rest, from: 25 },
    ].filter((group) => group.teams.length > 0);
  }, [teams, value]);

  return (
    <section style={cardStyle}>
      <div style={{ height: 3, background: tone, boxShadow: `0 0 12px ${tone}` }} />
      <div style={{ padding: "7px 12px 6px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)", lineHeight: 1.15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 750, color: "var(--tg-hint)" }}>{subtitle}</div>
        )}
      </div>
      <div style={{ padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 5 }}>
        {groups.map((group) => {
          const meta = getLeagueZoneMeta(group.zone);
          const color = meta ? meta.color : "var(--tg-hint)";
          return (
            <div key={group.zone}>
              <div style={groupHeaderStyle(color)}>
                <span>{meta ? meta.label : group.zone}</span>
                <span style={{ opacity: 0.75 }}>{group.teams.length}</span>
              </div>
              <div style={listStyle}>
                {group.teams.map((team, index) => {
                  const crest = team.crest_url || "";
                  const key = String(team.team_id || team.id);
                  return (
                    <div key={key} style={rowStyle(index === group.teams.length - 1)}>
                      <div style={{ fontSize: 11, fontWeight: 900, textAlign: "center", lineHeight: 1, color }}>
                        {group.from + index}
                      </div>
                      {crest ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={crest}
                          alt=""
                          width={17}
                          height={17}
                          style={{ width: 17, height: 17, borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }}
                        />
                      ) : (
                        <div style={crestFallbackStyle}>
                          {(team.short_name || team.team_name || "?").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div style={teamNameStyle}>{team.team_name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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

function groupHeaderStyle(color: string) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 4px 3px",
    fontSize: 10.5,
    fontWeight: 900,
    letterSpacing: "0.01em",
    color,
  } as const;
}

function rowStyle(isLast: boolean) {
  return {
    display: "grid",
    gridTemplateColumns: "19px 17px 1fr",
    alignItems: "center",
    gap: 6,
    minHeight: 23,
    padding: "0 8px 0 5px",
    borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
  } as const;
}

const crestFallbackStyle = {
  width: 17,
  height: 17,
  borderRadius: "50%",
  background: "rgba(128,128,128,0.18)",
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--tg-text)",
  fontSize: 8,
  fontWeight: 950,
} as const;

const teamNameStyle = {
  fontSize: 12,
  fontWeight: 750,
  color: "var(--tg-text)",
  lineHeight: 1.15,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};
