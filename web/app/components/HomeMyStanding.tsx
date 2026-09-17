"use client";

/* A prominent "your place" bar shown at the top of each home rating/league card,
 * so the user's own standing is visible at a glance without scanning the list.
 * Pure presentation. */

export function HomeMyStanding({ rank, points }: { rank: number | null; points: number | null }) {
  const inRanking = rank != null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 11px",
        marginBottom: 12,
        borderRadius: 12,
        background: inRanking
          ? "color-mix(in srgb, var(--tg-button) 16%, var(--tg-bg))"
          : "color-mix(in srgb, var(--tg-hint) 10%, var(--tg-bg))",
        border: inRanking
          ? "1px solid color-mix(in srgb, var(--tg-button) 34%, transparent)"
          : "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--tg-hint)" }}>
        Твоё место
      </span>
      {inRanking ? (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 950, color: "var(--tg-button)" }}>#{rank}</span>
          {points != null && (
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--tg-hint)" }}>{points} очк.</span>
          )}
        </span>
      ) : (
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--tg-hint)" }}>пока не в рейтинге</span>
      )}
    </div>
  );
}
