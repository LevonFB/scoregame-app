import { useMemo, useState } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import { triggerHaptic } from "@/lib/haptics";
import {
  EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT,
  EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT,
} from "../constants";
import type { SeasonPredictionLeagueStageJson, SeasonPredictionTeam } from "../types";

type Bucket = "top8" | "zone";

function teamRef(team: SeasonPredictionTeam) {
  return String(team.team_id || team.id);
}

export function LeagueStageEditor({
  teams,
  value,
  readOnly,
  tone,
  onChange,
  onReset,
  canReset,
}: {
  teams: SeasonPredictionTeam[];
  value: SeasonPredictionLeagueStageJson;
  readOnly: boolean;
  tone: string;
  onChange: (next: SeasonPredictionLeagueStageJson) => void;
  onReset?: () => void;
  canReset?: boolean;
}) {
  const [query, setQuery] = useState("");

  const top8 = value.league_stage.top8_team_ids;
  const zone = value.league_stage.zone_9_24_team_ids;
  const winnerTeamId = value.league_stage.winner_team_id;

  const top8Set = useMemo(() => new Set(top8), [top8]);
  const zoneSet = useMemo(() => new Set(zone), [zone]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((team) => {
      const name = team.team_name.toLowerCase();
      const short = (team.short_name || "").toLowerCase();
      return name.includes(q) || short.includes(q);
    });
  }, [teams, query]);

  function updateBuckets(nextTop8: string[], nextZone: string[]) {
    // Winner stays valid as long as the team exists in the squad — the picker
    // tracks bucket membership, not winner eligibility.
    onChange({
      stage: "league_stage",
      league_stage: {
        top8_team_ids: nextTop8,
        zone_9_24_team_ids: nextZone,
        winner_team_id: winnerTeamId,
      },
    });
  }

  function assignToBucket(ref: string, bucket: Bucket) {
    if (readOnly) return;
    if (bucket === "top8") {
      if (top8Set.has(ref)) return; // already there
      if (top8.length >= EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT) return;
      const nextZone = zone.filter((id) => id !== ref);
      const nextTop8 = [...top8, ref];
      updateBuckets(nextTop8, nextZone);
      triggerHaptic("selection");
    } else {
      if (zoneSet.has(ref)) return;
      if (zone.length >= EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT) return;
      const nextTop8 = top8.filter((id) => id !== ref);
      const nextZone = [...zone, ref];
      updateBuckets(nextTop8, nextZone);
      triggerHaptic("selection");
    }
  }

  function clearAssignment(ref: string) {
    if (readOnly) return;
    if (!top8Set.has(ref) && !zoneSet.has(ref)) return;
    updateBuckets(top8.filter((id) => id !== ref), zone.filter((id) => id !== ref));
    triggerHaptic("selection");
  }

  const top8Full = top8.length >= EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT;
  const zoneFull = zone.length >= EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT;

  return (
    <section style={cardStyle}>
      {/* Header + progress */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <h2 style={sectionTitleStyle}>Стадия лиги</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ProgressPill label="Топ-8" current={top8.length} max={EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT} done={top8Full} />
          <ProgressPill label="9–24" current={zone.length} max={EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT} done={zoneFull} />
          {!readOnly && onReset && (
            <Pressable
              onClick={onReset}
              disabled={!canReset}
              haptic="light"
              style={resetButtonStyle(!canReset)}
              aria-label="Сбросить распределение команд"
            >
              Сброс
            </Pressable>
          )}
        </div>
      </div>

      {!readOnly && (
        <p style={{ margin: "0 0 10px", color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))", fontSize: 11, lineHeight: 1.45, fontWeight: 700 }}>
          Топ-8 выходит напрямую в 1/8. Команды 9–24 идут в стыки плей-офф. Команда не может быть в обеих зонах.
        </p>
      )}

      {/* Search */}
      {teams.length > 8 && (
        <input
          type="search"
          placeholder="Поиск команды"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={readOnly}
          style={searchStyle}
          aria-label="Поиск команды"
        />
      )}

      {/* Team list */}
      <div style={listContainerStyle}>
        {filteredTeams.length === 0 ? (
          <div style={emptyHintStyle}>Команд по запросу не найдено</div>
        ) : (
          filteredTeams.map((team, index) => {
            const ref = teamRef(team);
            const inTop8 = top8Set.has(ref);
            const inZone = zoneSet.has(ref);
            const assigned = inTop8 || inZone;
            return (
              <div key={ref} style={teamRowStyle(index === filteredTeams.length - 1)}>
                {team.crest_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={team.crest_url}
                    alt=""
                    width={26}
                    height={26}
                    style={crestStyle}
                  />
                ) : (
                  <div style={crestFallbackStyle}>
                    {(team.short_name || team.team_name || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={teamNameStyle}>{team.team_name}</div>
                  {team.short_name && (
                    <div style={teamShortStyle}>{team.short_name}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <BucketButton
                    label="—"
                    title="Без зоны"
                    aria-label={`Убрать ${team.team_name} из зон`}
                    active={!assigned}
                    tone={tone}
                    disabled={readOnly}
                    onClick={() => clearAssignment(ref)}
                  />
                  <BucketButton
                    label="Топ-8"
                    title={top8Full && !inTop8 ? "Топ-8 заполнена" : "Топ-8"}
                    aria-label={`${team.team_name} в Топ-8`}
                    active={inTop8}
                    tone={tone}
                    disabled={readOnly || (top8Full && !inTop8)}
                    onClick={() => assignToBucket(ref, "top8")}
                  />
                  <BucketButton
                    label="9–24"
                    title={zoneFull && !inZone ? "Зона 9–24 заполнена" : "9–24"}
                    aria-label={`${team.team_name} в зону 9–24`}
                    active={inZone}
                    tone={tone}
                    disabled={readOnly || (zoneFull && !inZone)}
                    onClick={() => assignToBucket(ref, "zone")}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Winner moved to the "Bracket" stage (E6). League stage = top-8 + 9–24 only.
          Any existing predicted_winner_team_id is preserved on save (see updateBuckets). */}
    </section>
  );
}

function BucketButton({
  label,
  title,
  active,
  tone,
  disabled,
  onClick,
  ...aria
}: {
  label: string;
  title: string;
  active: boolean;
  tone: string;
  disabled: boolean;
  onClick: () => void;
  "aria-label"?: string;
}) {
  return (
    <Pressable
      onClick={onClick}
      disabled={disabled}
      title={title}
      haptic="none"
      aria-label={aria["aria-label"]}
      aria-pressed={active}
      style={{
        minWidth: 44,
        height: 28,
        padding: "0 9px",
        border: active ? `1px solid ${tone}` : "1px solid rgba(255,255,255,0.10)",
        borderRadius: 8,
        background: active ? `color-mix(in srgb, ${tone} 24%, transparent)` : "rgba(255,255,255,0.06)",
        color: active ? tone : "color-mix(in srgb, var(--tg-text) 70%, var(--tg-hint))",
        fontSize: 11,
        fontWeight: 900,
        whiteSpace: "nowrap",
        letterSpacing: "-0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !active ? 0.45 : 1,
      }}
    >
      {label}
    </Pressable>
  );
}

function ProgressPill({ label, current, max, done }: { label: string; current: number; max: number; done: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      height: 22,
      padding: "0 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 900,
      background: done ? "rgba(52,199,89,0.16)" : "rgba(255,255,255,0.07)",
      color: done ? "#3ddc6f" : "color-mix(in srgb, var(--tg-text) 75%, var(--tg-hint))",
      whiteSpace: "nowrap",
      letterSpacing: "-0.01em",
    }}>
      {label} {current}/{max}{done ? " ✓" : ""}
    </span>
  );
}

function resetButtonStyle(disabled: boolean) {
  return {
    height: 22,
    padding: "0 9px",
    border: "none",
    borderRadius: 999,
    background: disabled ? "rgba(128,128,128,0.06)" : "rgba(128,128,128,0.14)",
    color: disabled ? "rgba(128,128,128,0.35)" : "var(--tg-hint)",
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: "nowrap" as const,
    letterSpacing: "-0.01em",
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}

const cardStyle = {
  borderRadius: 18,
  padding: 14,
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
  color: "var(--tg-text)",
} as const;

const sectionTitleStyle = {
  margin: 0,
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.02em",
} as const;

const searchStyle = {
  width: "100%",
  height: 38,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.06)",
  color: "var(--tg-text)",
  fontSize: 13,
  fontWeight: 700,
  outline: "none",
  marginBottom: 10,
  boxSizing: "border-box" as const,
} as const;

const listContainerStyle = {
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.18)",
} as const;

const emptyHintStyle = {
  padding: "14px 12px",
  fontSize: 12,
  fontWeight: 700,
  textAlign: "center" as const,
  color: "var(--tg-hint)",
};

function teamRowStyle(isLast: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
  } as const;
}

const crestStyle = {
  width: 26,
  height: 26,
  borderRadius: 5,
  objectFit: "contain" as const,
  background: "rgba(255,255,255,0.08)",
  flex: "0 0 auto",
};

const crestFallbackStyle = {
  width: 26,
  height: 26,
  borderRadius: 5,
  background: "rgba(128,128,128,0.18)",
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--tg-text)",
  fontSize: 10,
  fontWeight: 950,
} as const;

const teamNameStyle = {
  fontSize: 13,
  lineHeight: 1.15,
  fontWeight: 800,
  color: "var(--tg-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

const teamShortStyle = {
  marginTop: 2,
  fontSize: 11,
  fontWeight: 700,
  color: "var(--tg-hint)",
};

