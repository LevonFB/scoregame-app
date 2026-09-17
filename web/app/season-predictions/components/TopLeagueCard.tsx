import { Pressable } from "@/app/components/ui/Pressable";
import { TOP_LEAGUE_ACCENTS } from "../constants";
import { deriveLeague } from "../progress";
import type { MyScoresLeague, SeasonPredictionTournament } from "../types";
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

export function TopLeagueCard({
  tournament,
  score = null,
  onOpen,
}: {
  tournament: SeasonPredictionTournament;
  score?: MyScoresLeague | null;
  onOpen: () => void;
}) {
  const accent = TOP_LEAGUE_ACCENTS[tournament.tournament_code];
  const tone = accent?.tone || "var(--tg-button)";
  const d = deriveLeague(tournament);
  const deadline = formatDeadline(tournament.deadline_at);
  const scorePct = score?.has_score && score.points_pct != null ? Math.round(score.points_pct * 100) : null;

  // Unified CTA: neutral surface for all cards, league tone only in text + arrow.
  const ctaColor = d.locked
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
      {/* League accent top bar with glow — sole league identity (logos removed: weak assets look muddy) */}
      <div style={{ height: 3, background: tone, boxShadow: `0 0 10px ${tone}` }} />

      <div style={{ padding: "11px 13px 13px" }}>
        {/* Header row: code + status (left) · score as primary result (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 850,
              color: tone,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              lineHeight: 1.6,
            }}>
              {accent?.short || tournament.tournament_code}
            </span>
            <SeasonPredictionStatusPill status={d.entryStatus} />
          </div>
          {score?.has_score && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, lineHeight: 1 }}>
              <span style={{ fontSize: 17, fontWeight: 950, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>
                {score.total_points} <span style={{ fontSize: 12, fontWeight: 800, color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))" }}>/ {score.max_possible_points}</span>
              </span>
              {scorePct != null && (
                <span style={{ marginTop: 3, fontSize: 11, fontWeight: 900, color: "#3ddc6f" }}>{scorePct}%</span>
              )}
            </div>
          )}
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

        {/* Meta: country · teams */}
        <div style={{ fontSize: 12, fontWeight: 700, color: META_COLOR, letterSpacing: "0.01em" }}>
          {[tournament.country || "Клубная лига", d.expectedCount > 0 ? `${d.expectedCount} команд` : null].filter(Boolean).join(" · ")}
        </div>

        {/* Progress chips */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
          {!d.teamsReady ? (
            <StatChip label="Команды не настроены" dim />
          ) : (
            <>
              <StatChip label={`Таблица ${d.filledTeams}/${d.expectedCount}`} green={d.tableComplete} />
              <StatChip label={`Награды ${d.filledAwards}/3`} green={d.awardsComplete} />
            </>
          )}
          {deadline && <StatChip label={deadline} />}
          {/* Score shown prominently in the header; here only a hint when it's pending. */}
          {!score?.has_score && (d.isSubmitted || d.locked) && <StatChip label="Очки позже" dim />}
        </div>

        {/* Unified CTA row: next action (left) + CTA label (right) */}
        <div style={ctaRowStyle}>
          <span style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 800,
            color: nextActionColor,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: nextActionColor, flexShrink: 0 }} />
            {d.nextAction}
          </span>
          <span style={{
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: "-0.01em",
            color: ctaColor,
          }}>
            {d.ctaLabel}
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
      background: green ? "rgba(52,199,89,0.16)" : "rgba(255,255,255,0.08)",
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

// Elevated premium dark surface — lifts card above the page background and
// stays subtle in light themes (white overlay barely changes white).
const CARD_SURFACE =
  "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)";
const CARD_SHADOW =
  "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)";
const META_COLOR = "color-mix(in srgb, var(--tg-text) 58%, var(--tg-hint))";

// Unified across all cards: same shape, height and neutral fill — league color
// lives only in the text/arrow, avoiding a wall of differently-tinted buttons.
const ctaRowStyle = {
  marginTop: 11,
  height: 36,
  borderRadius: 10,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "0 11px",
  background: "rgba(255,255,255,0.05)",
} as const;
