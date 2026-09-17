import type { SeasonPredictionTournament } from "../types";
import { deriveOverall, type LeagueSegmentState } from "../progress";

const SEGMENT_COLOR: Record<LeagueSegmentState, string> = {
  done: "#3ddc6f",
  progress: "color-mix(in srgb, var(--tg-button) 70%, transparent)",
  empty: "rgba(255,255,255,0.10)",
};

export function SeasonProgressSummary({ tournaments }: { tournaments: SeasonPredictionTournament[] }) {
  if (tournaments.length === 0) return null;

  const o = deriveOverall(tournaments);

  return (
    <section style={cardStyle}>
      {/* Headline row */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--tg-text)" }}>
          Прогресс сезона
        </span>
        <span style={{ fontSize: 12, fontWeight: 850, color: o.nextActionDone ? "#3ddc6f" : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))" }}>
          {o.submittedLeagues} из {o.totalLeagues} лиг {o.nextActionDone ? "✓" : "подтверждено"}
        </span>
      </div>

      {/* Per-league segment bar — one segment per league */}
      <div style={{ display: "flex", gap: 4, marginTop: 9 }} aria-hidden="true">
        {o.segments.map((state, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 999,
              background: SEGMENT_COLOR[state],
              transition: "background 0.25s",
            }}
          />
        ))}
      </div>

      {/* Sub-progress line */}
      <div style={{ marginTop: 9, fontSize: 12, fontWeight: 750, color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))", letterSpacing: "0.01em" }}>
        Таблицы <b style={{ color: "var(--tg-text)", fontWeight: 900 }}>{o.filledTeams}/{o.totalTeams}</b>
        {" · "}
        Награды <b style={{ color: "var(--tg-text)", fontWeight: 900 }}>{o.filledAwards}/{o.totalAwards}</b>
      </div>

      {/* Next action */}
      {o.nextActionDone ? (
        <div style={nextDoneStyle}>Все прогнозы подтверждены</div>
      ) : (
        <div style={nextActionStyle}>Следующее: {o.nextActionText}</div>
      )}
    </section>
  );
}

const cardStyle = {
  borderRadius: 16,
  padding: "12px 14px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
  color: "var(--tg-text)",
} as const;

const nextActionStyle = {
  marginTop: 10,
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 10px",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--tg-button) 16%, transparent)",
  color: "var(--tg-button)",
  fontSize: 12,
  fontWeight: 850,
  letterSpacing: "-0.01em",
} as const;

const nextDoneStyle = {
  marginTop: 10,
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 10px",
  borderRadius: 999,
  background: "rgba(52,199,89,0.14)",
  color: "#3ddc6f",
  fontSize: 12,
  fontWeight: 850,
} as const;
