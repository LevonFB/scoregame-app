import { Pressable } from "@/app/components/ui/Pressable";
import {
  EUROPEAN_CUP_ACCENTS,
  EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT,
  EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT,
  EUROPEAN_STAGE_LABELS,
} from "../constants";
import { deriveEuropean } from "../europe";
import type { EuropeanCupCode, SeasonPredictionTournament } from "../types";
import { SeasonPredictionStatusPill } from "./SeasonPredictionStatusPill";

function formatDeadline(ts: number | null | undefined): string | null {
  if (!ts) return null;
  const diffMs = ts * 1000 - Date.now();
  const diffDays = Math.ceil(diffMs / 86400000);
  if (diffDays < 0) return "Дедлайн прошёл";
  if (diffDays === 0) return "Сегодня";
  if (diffDays <= 3) return `${diffDays}д до дедлайна`;
  if (diffDays <= 30) return `${diffDays} дн.`;
  return new Date(ts * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });
}

export type EuropeanCupCardScore = {
  total_points: number;
  max_possible_points: number;
  points_pct: number;
};

export function EuropeanCupCard({
  tournament,
  onOpen,
  score = null,
}: {
  tournament: SeasonPredictionTournament;
  onOpen: () => void;
  score?: EuropeanCupCardScore | null;
}) {
  const code = tournament.tournament_code as EuropeanCupCode;
  const accent = EUROPEAN_CUP_ACCENTS[code];
  const tone = accent?.tone || "var(--tg-button)";
  const d = deriveEuropean(tournament);
  const hasScore = !!score;
  // Short, non-truncating status (CTA is always "Открыть →" on the right).
  const statusLabel = hasScore
    ? "Очки рассчитаны"
    : d.isSubmitted
      ? "Прогноз подтверждён"
      : d.entryStatus === "draft"
        ? "Черновик"
        : "Не начато";
  const deadline = formatDeadline(tournament.deadline_at);
  const activeStageLabel = EUROPEAN_STAGE_LABELS[d.activeStage] || EUROPEAN_STAGE_LABELS.league_stage;

  const ctaColor = !d.teamsReady || tournament.status === "archived"
    ? "var(--tg-hint)"
    : d.locked
      ? "var(--tg-hint)"
      : d.isSubmitted
        ? "var(--tg-text)"
        : tone;

  const nextActionColor =
    d.nextActionTone === "done"
      ? "#3ddc6f"
      : d.nextActionTone === "accent"
        ? tone
        : "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))";

  return (
    <Pressable
      onClick={onOpen}
      haptic="light"
      pressedScale={0.985}
      aria-label={`${tournament.title} — ${d.ctaLabel}`}
      style={{
        width: "100%",
        textAlign: "left",
        color: "var(--tg-text)",
        background: CARD_SURFACE,
        border: "none",
        borderRadius: 16,
        padding: 0,
        cursor: "pointer",
        overflow: "hidden",
        boxShadow: CARD_SHADOW,
      }}
    >
      {/* Accent top bar with glow */}
      <div style={{ height: 3, background: tone, boxShadow: `0 0 10px ${tone}` }} />

      <div style={{ padding: "10px 13px 11px" }}>
        {/* Header row: code label + status pill */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 850,
            color: tone,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            lineHeight: 1.6,
          }}>
            {accent?.short || code} · Еврокубок
          </span>
          <SeasonPredictionStatusPill status={d.entryStatus} />
        </div>

        {/* Title */}
        <div style={{
          fontSize: 16,
          fontWeight: 950,
          letterSpacing: "-0.03em",
          lineHeight: 1.12,
          color: "var(--tg-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 3,
        }}>
          {tournament.title}
        </div>

        {/* Meta */}
        <div style={{ fontSize: 12, fontWeight: 700, color: META_COLOR, letterSpacing: "0.01em" }}>
          {[
            `${d.teamCount || 36} команд`,
            `Активно: ${activeStageLabel}`,
            deadline,
          ].filter(Boolean).join(" · ")}
        </div>

        {/* Progress chips (or score chip once calculated) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
          {hasScore ? (
            <span style={scoreChipStyle}>
              {score!.total_points} / {score!.max_possible_points} · {Math.round((score!.points_pct || 0) * 100)}%
            </span>
          ) : !d.teamsReady ? (
            <StatChip label="Команды не настроены" dim />
          ) : (
            <>
              <StatChip label={`Топ-8 ${d.top8Count}/${EUROPEAN_LEAGUE_STAGE_TOP8_LIMIT}`} green={d.top8Complete} />
              <StatChip label={`9–24 ${d.zoneCount}/${EUROPEAN_LEAGUE_STAGE_ZONE_LIMIT}`} green={d.zoneComplete} />
            </>
          )}
        </div>

        {/* Unified CTA row */}
        <div style={ctaRowStyle}>
          <span style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 800,
            color: hasScore ? "#3ddc6f" : nextActionColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: hasScore ? "#3ddc6f" : nextActionColor, flexShrink: 0 }} />
            {statusLabel}
          </span>
          {/* CTA stays short and never truncates (flexShrink:0); status is separate. */}
          <span style={{
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: "-0.01em",
            color: hasScore ? tone : ctaColor,
          }}>
            Открыть
          </span>
        </div>
      </div>
    </Pressable>
  );
}

function StatChip({ label, green = false, dim = false }: { label: string; green?: boolean; dim?: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      height: 21,
      padding: "0 8px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 800,
      background: green ? "rgba(52,199,89,0.16)" : "color-mix(in srgb, var(--tg-text) 8%, transparent)",
      color: green
        ? "#3ddc6f"
        : dim
          ? "var(--tg-hint)"
          : "color-mix(in srgb, var(--tg-text) 80%, transparent)",
      whiteSpace: "nowrap" as const,
    }}>
      {label}
    </span>
  );
}

const scoreChipStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 21,
  padding: "0 9px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 900,
  background: "color-mix(in srgb, #34c759 16%, var(--tg-bg))",
  color: "#3ddc6f",
  border: "1px solid color-mix(in srgb, #34c759 26%, transparent)",
  whiteSpace: "nowrap" as const,
} as const;

// Theme-aware surface: lighter than bg in dark, subtly darker than bg in light
// (was hardcoded white overlays that vanished in light theme → "empty" cards).
const CARD_SURFACE = "linear-gradient(180deg, color-mix(in srgb, var(--tg-text) 13%, var(--tg-bg)), color-mix(in srgb, var(--tg-text) 6%, var(--tg-bg)))";
const CARD_SHADOW = "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px color-mix(in srgb, var(--tg-text) 12%, transparent)";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";

const ctaRowStyle = {
  marginTop: 9,
  height: 34,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "0 11px",
  background: "color-mix(in srgb, var(--tg-text) 5%, transparent)",
} as const;
