import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Pressable } from "@/app/components/ui/Pressable";
import type { SeasonPredictionTeam } from "../types";
import { reorderByIds } from "../reorder";
import { LeagueTableRow } from "./LeagueTableRow";

export function getTeamRef(team: SeasonPredictionTeam) {
  return String(team.team_id || team.id);
}

export function LeagueTableOrderEditor({
  teams,
  zones,
  readOnly,
  onChange,
  onReset,
  canReset,
}: {
  teams: SeasonPredictionTeam[];
  zones: Record<string, unknown>;
  readOnly: boolean;
  onChange: (teams: SeasonPredictionTeam[]) => void;
  onReset?: () => void;
  canReset?: boolean;
}) {
  const [moveTarget, setMoveTarget] = useState<SeasonPredictionTeam | null>(null);
  const displayTeams = teams;

  // Drag starts only after an intentional move/hold so page scroll still works.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Single final reorder: arrayMove(activeIndex -> overIndex). No stepwise swaps.
    const next = reorderByIds(teams, String(active.id), String(over.id), getTeamRef);
    if (next !== teams) onChange(next);
  }

  function moveToPosition(team: SeasonPredictionTeam, position: number) {
    if (readOnly) return;
    const fromIndex = teams.findIndex((item) => getTeamRef(item) === getTeamRef(team));
    const toIndex = Math.max(0, Math.min(teams.length - 1, position - 1));
    if (fromIndex < 0 || fromIndex === toIndex) {
      setMoveTarget(null);
      return;
    }
    const next = [...teams];
    const [picked] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, picked);
    onChange(next);
    setMoveTarget(null);
  }

  const currentPosition = moveTarget
    ? displayTeams.findIndex((item) => getTeamRef(item) === getTeamRef(moveTarget)) + 1
    : 0;

  return (
    <section style={cardStyle}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <h2 style={sectionTitleStyle}>Таблица лиги</h2>
          <span style={{ color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))", fontSize: 12, fontWeight: 800 }}>{displayTeams.length} команд</span>
        </div>
        {!readOnly && onReset && (
          <Pressable
            onClick={onReset}
            disabled={!canReset}
            haptic="light"
            style={resetButtonStyle(!canReset)}
          >
            Сброс
          </Pressable>
        )}
      </div>

      {!readOnly && (
        <p style={{ display: "none", margin: "0 0 10px", color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))", fontSize: 11, lineHeight: 1.4, fontWeight: 700 }}>
          Нажми на команду или кнопку «Место», чтобы выбрать позицию в таблице
        </p>
      )}

      {!readOnly && (
        <p style={{ margin: "-6px 0 10px", color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))", fontSize: 11, lineHeight: 1.4, fontWeight: 700 }}>
          Тяни за значок, чтобы изменить порядок. Кнопка «Место» — быстрый перенос.
        </p>
      )}

      {/* List */}
      <div style={listContainerStyle}>
        {readOnly ? (
          displayTeams.map((team, index) => (
            <LeagueTableRow
              key={getTeamRef(team)}
              team={team}
              position={index + 1}
              zones={zones}
              readOnly
              isLast={index === displayTeams.length - 1}
              onMoveTo={() => undefined}
            />
          ))
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={displayTeams.map(getTeamRef)} strategy={verticalListSortingStrategy}>
              {displayTeams.map((team, index) => (
                <LeagueTableRow
                  key={getTeamRef(team)}
                  team={team}
                  position={index + 1}
                  zones={zones}
                  readOnly={false}
                  isLast={index === displayTeams.length - 1}
                  onMoveTo={() => setMoveTarget(team)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Move-to-position bottom sheet */}
      {moveTarget && (
        <div
          style={sheetOverlayStyle}
          onClick={() => setMoveTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Выбрать место для ${moveTarget.team_name}`}
        >
          <div style={sheetStyle} onClick={(event) => event.stopPropagation()}>
            {/* Sheet header */}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 950, letterSpacing: "-0.03em", color: "var(--tg-text)" }}>
                  Переместить команду
                </div>
                <div style={{ marginTop: 3, color: "var(--tg-hint)", fontSize: 14, fontWeight: 750 }}>
                  {moveTarget.team_name}
                </div>
              </div>
              <Pressable
                onClick={() => setMoveTarget(null)}
                haptic="light"
                aria-label="Закрыть"
                style={closeButtonStyle}
              >
                ×
              </Pressable>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(128,128,128,0.5)", marginBottom: 14 }}>
              Сейчас: {currentPosition} место · выбери новое
            </div>

            {/* Position grid — dynamic columns based on team count */}
            <div style={positionsGridStyle(displayTeams.length)}>
              {displayTeams.map((_, index) => {
                const pos = index + 1;
                const isCurrent = pos === currentPosition;
                return (
                  <Pressable
                    key={pos}
                    onClick={() => moveToPosition(moveTarget, pos)}
                    haptic="selection"
                    aria-label={`Место ${pos}${isCurrent ? " (текущее)" : ""}`}
                    aria-pressed={isCurrent}
                    style={positionButtonStyle(isCurrent)}
                  >
                    {pos}
                  </Pressable>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle = {
  borderRadius: 18,
  padding: "12px 12px 4px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
} as const;

const sectionTitleStyle = {
  margin: 0,
  fontSize: 15,
  fontWeight: 950,
  letterSpacing: "-0.02em",
} as const;

const listContainerStyle = {
  borderRadius: 12,
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.18)",
  marginBottom: 8,
} as const;

function resetButtonStyle(disabled: boolean) {
  return {
    height: 26,
    padding: "0 10px",
    border: "none",
    borderRadius: 8,
    background: disabled ? "rgba(128,128,128,0.06)" : "rgba(128,128,128,0.12)",
    color: disabled ? "rgba(128,128,128,0.35)" : "var(--tg-hint)",
    fontSize: 11,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}

const sheetOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "16px 12px calc(16px + env(safe-area-inset-bottom, 0px))",
  background: "rgba(0,0,0,0.48)",
} as const;

const sheetStyle = {
  width: "min(560px, 100%)",
  maxHeight: "80dvh",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  borderRadius: 26,
  padding: "18px 16px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 -18px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.10)",
} as const;

const closeButtonStyle = {
  flexShrink: 0,
  width: 34,
  height: 34,
  border: "none",
  borderRadius: 999,
  background: "rgba(128,128,128,0.14)",
  color: "var(--tg-hint)",
  fontSize: 20,
  fontWeight: 400,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
} as const;

// 5 columns for ≤20 teams, 6 for more
function positionsGridStyle(teamCount: number) {
  const cols = teamCount > 20 ? 6 : 5;
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gap: 7,
  } as const;
}

function positionButtonStyle(active: boolean) {
  return {
    minHeight: 46,
    border: active ? "2px solid var(--tg-button)" : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 13,
    background: active ? "color-mix(in srgb, var(--tg-button) 22%, transparent)" : "rgba(255,255,255,0.07)",
    color: active ? "var(--tg-button)" : "var(--tg-text)",
    fontSize: 16,
    fontWeight: active ? 950 : 800,
    cursor: "pointer",
  } as const;
}
