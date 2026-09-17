import { STATUS_LABELS } from "../constants";

export function SeasonPredictionStatusPill({ status }: { status?: string | null }) {
  const normalized = status || "not_started";
  const label = normalized === "not_started" ? "Не начато" : (STATUS_LABELS[normalized] || normalized);

  const isSubmitted = normalized === "submitted";
  const isDraft = normalized === "draft";
  const isLocked = ["locked", "scoring", "completed", "archived"].includes(normalized);

  const color = isSubmitted
    ? "#3ddc6f"
    : isDraft
      ? "#ffc04d"
      : isLocked
        ? "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))"
        : "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))";

  const bg = isSubmitted
    ? "rgba(52,199,89,0.18)"
    : isDraft
      ? "rgba(255,176,32,0.18)"
      : isLocked
        ? "rgba(255,255,255,0.07)"
        : "rgba(255,255,255,0.10)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 22,
        padding: "0 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 850,
        color,
        background: bg,
        whiteSpace: "nowrap",
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </span>
  );
}
