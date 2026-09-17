import type { MyScoresResponse } from "../types";

const ACCENT = "#3ddc6f";

export function SeasonScoreSummary({ scores }: { scores: MyScoresResponse | null }) {
  if (!scores) return null;

  if (scores.scored_leagues_count === 0) {
    return (
      <div style={mutedStyle}>
        Очки появятся после подтверждения официальных результатов и пересчёта.
      </div>
    );
  }

  const pct = Math.round((scores.points_pct || 0) * 100);

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "-0.02em", color: "var(--tg-text)" }}>
          Очки топ‑5
        </span>
        <span style={{ fontSize: 12, fontWeight: 850, color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))" }}>
          Посчитано: {scores.scored_leagues_count} из {scores.total_leagues} лиг
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 950, letterSpacing: "-0.04em", color: "var(--tg-text)" }}>
          {scores.total_points}
        </span>
        <span style={{ fontSize: 14, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))" }}>
          / {scores.max_possible_points}
        </span>
        <span style={{
          marginLeft: "auto",
          display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px",
          borderRadius: 999, fontSize: 12, fontWeight: 900,
          background: "color-mix(in srgb, #34c759 16%, var(--tg-bg))", color: ACCENT,
          border: "1px solid color-mix(in srgb, #34c759 26%, transparent)",
        }}>
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: "color-mix(in srgb, var(--tg-hint) 16%, transparent)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`, background: ACCENT, borderRadius: 999, transition: "width 0.3s" }} />
      </div>
    </section>
  );
}

const cardStyle = {
  borderRadius: 16,
  padding: "12px 14px",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 92%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 82%, var(--tg-secondary-bg)))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  boxShadow: "0 8px 22px color-mix(in srgb, var(--tg-text) 10%, transparent)",
  color: "var(--tg-text)",
} as const;

const mutedStyle = {
  borderRadius: 14,
  padding: "11px 14px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, transparent)",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
  fontSize: 12.5,
  fontWeight: 700,
  lineHeight: 1.45,
} as const;
