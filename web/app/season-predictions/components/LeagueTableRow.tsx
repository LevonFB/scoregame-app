import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pressable } from "@/app/components/ui/Pressable";
import type { SeasonPredictionTeam } from "../types";
import { LeagueZoneBadge, getLeagueZoneForPosition } from "./LeagueZoneBadge";

export function getRowId(team: SeasonPredictionTeam) {
  return String(team.team_id || team.id);
}

export function LeagueTableRow({
  team,
  position,
  zones,
  readOnly,
  isLast,
  onMoveTo,
}: {
  team: SeasonPredictionTeam;
  position: number;
  zones: Record<string, unknown>;
  readOnly: boolean;
  isLast?: boolean;
  onMoveTo: () => void;
}) {
  const zone = getLeagueZoneForPosition(position, zones);
  const crest = team.crest_url || "";
  const id = getRowId(team);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: readOnly });

  return (
    <div
      ref={setNodeRef}
      style={{
        // dnd-kit drives position via transform — the list animates smoothly,
        // no per-step array mutation while dragging.
        transform: CSS.Transform.toString(transform),
        transition,
        display: "grid",
        gridTemplateColumns: readOnly ? "24px 1fr" : "24px 36px 1fr auto",
        alignItems: "center",
        gap: 8,
        minHeight: 48,
        padding: "6px 8px 6px 10px",
        borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
        background: isDragging ? "color-mix(in srgb, var(--tg-button) 12%, var(--tg-bg))" : "transparent",
        boxShadow: isDragging ? "0 8px 20px color-mix(in srgb, var(--tg-text) 22%, transparent)" : "none",
        borderRadius: isDragging ? 10 : 0,
        opacity: isDragging ? 0.95 : 1,
        position: "relative",
        zIndex: isDragging ? 5 : 0,
      }}
    >
      <div style={{
        fontSize: 13,
        fontWeight: 900,
        color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
        textAlign: "center",
        lineHeight: 1,
      }}>
        {position}
      </div>

      {!readOnly && (
        // Handle is the ONLY drag activator: listeners/attributes live here, not
        // on the whole row, so page scroll over the row keeps working.
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Перетащить команду ${team.team_name}`}
          title="Перетащить"
          {...attributes}
          {...listeners}
          style={dragHandleStyle}
        >
          ⋮⋮
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {crest ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={crest}
            alt=""
            width={26}
            height={26}
            style={{ width: 26, height: 26, borderRadius: 5, objectFit: "contain", background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }}
          />
        ) : (
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(128,128,128,0.18)", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tg-text)", fontSize: 10, fontWeight: 950 }}>
            {(team.short_name || team.team_name || "?").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, lineHeight: 1.15, fontWeight: 800, color: "var(--tg-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {team.team_name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            {team.short_name && (
              <span style={{ color: "var(--tg-hint)", fontSize: 11, fontWeight: 700 }}>
                {team.short_name}
              </span>
            )}
            <LeagueZoneBadge zone={zone} />
          </div>
        </div>
      </div>

      {!readOnly && (
        <Pressable
          onClick={onMoveTo}
          haptic="light"
          aria-label={`Выбрать место для ${team.team_name}`}
          title="Выбрать место"
          style={placeButtonStyle}
        >
          Место
        </Pressable>
      )}
    </div>
  );
}

const dragHandleStyle = {
  width: 36,
  height: 36,
  border: "1px solid color-mix(in srgb, var(--tg-text) 12%, transparent)",
  borderRadius: 10,
  background: "color-mix(in srgb, var(--tg-text) 6%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
  fontSize: 15,
  fontWeight: 950,
  cursor: "grab",
  touchAction: "none",
  WebkitTapHighlightColor: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  userSelect: "none",
} as const;

const placeButtonStyle = {
  height: 28,
  padding: "0 9px",
  border: "1px solid color-mix(in srgb, var(--tg-text) 14%, transparent)",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--tg-text) 5%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 68%, var(--tg-hint))",
  fontSize: 11,
  fontWeight: 850,
  cursor: "pointer",
  letterSpacing: "-0.01em",
  whiteSpace: "nowrap",
} as const;
