import { EUROPEAN_STAGE_LABELS } from "../constants";
import type { SeasonPredictionEuropeanStage } from "../types";

export function StageTimeline({
  stages,
  activeStage,
  tone,
}: {
  stages: SeasonPredictionEuropeanStage[];
  activeStage: SeasonPredictionEuropeanStage;
  tone: string;
}) {
  return (
    <section style={cardStyle}>
      <h2 style={titleStyle}>Этапы турнира</h2>
      <ol style={listStyle}>
        {stages.map((stage, index) => {
          const isActive = stage === activeStage;
          const label = EUROPEAN_STAGE_LABELS[stage] || stage;
          return (
            <li key={stage} style={rowStyle(index === stages.length - 1)}>
              <span style={dotStyle(isActive, tone)} aria-hidden="true" />
              <span style={{
                fontSize: 13,
                fontWeight: isActive ? 900 : 800,
                color: isActive ? "var(--tg-text)" : "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
                letterSpacing: "-0.01em",
              }}>
                {label}
              </span>
              <span style={{
                marginLeft: "auto",
                fontSize: 11,
                fontWeight: 850,
                letterSpacing: "0.01em",
                color: isActive ? tone : "rgba(128,128,128,0.55)",
              }}>
                {isActive ? "активно" : "скоро"}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const cardStyle = {
  borderRadius: 18,
  padding: "12px 14px 6px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
  color: "var(--tg-text)",
} as const;

const titleStyle = {
  margin: 0,
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: "-0.02em",
  color: "var(--tg-text)",
} as const;

const listStyle = {
  margin: "8px 0 0",
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
} as const;

function rowStyle(isLast: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.08)",
  } as const;
}

function dotStyle(isActive: boolean, tone: string) {
  return {
    width: 9,
    height: 9,
    borderRadius: "50%",
    background: isActive ? tone : "rgba(128,128,128,0.22)",
    boxShadow: isActive ? `0 0 8px ${tone}` : "none",
    flexShrink: 0,
  } as const;
}
