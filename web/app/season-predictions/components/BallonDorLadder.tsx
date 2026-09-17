"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Pressable } from "@/app/components/ui/Pressable";
import type { BallonDorNominee } from "../types";

export function getNomineeRef(nominee: BallonDorNominee) {
  return String(nominee.id);
}

// Подиум — единственное, что игрок реально прогнозирует, поэтому он и несёт
// весь визуальный вес: золото/серебро/бронза, крупные карточки, номер медалью.
export const PODIUM_TONES: Record<number, { tone: string; label: string }> = {
  1: { tone: "#ffc94a", label: "Золото" },
  2: { tone: "#cfd8e3", label: "Серебро" },
  3: { tone: "#e0955c", label: "Бронза" },
};

/** Полоса, к которой относится место: она задаёт плотность и акцент строки. */
export function bandForPlace(place: number): "podium" | "top10" | "rest" {
  if (place <= 3) return "podium";
  if (place <= 10) return "top10";
  return "rest";
}

export function NomineeAvatar({ nominee, size }: { nominee: BallonDorNominee; size: number }) {
  const radius = Math.round(size / 2);
  if (nominee.photo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={nominee.photo_url}
        alt=""
        width={size}
        height={size}
        style={{
          width: size, height: size, borderRadius: radius, objectFit: "cover",
          flexShrink: 0, background: "rgba(128,128,128,0.16)",
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: "rgba(128,128,128,0.16)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: Math.max(10, Math.round(size * 0.36)), fontWeight: 900,
      color: "color-mix(in srgb, var(--tg-text) 45%, var(--tg-hint))",
    }}>
      {nominee.player_name.slice(0, 1)}
    </div>
  );
}

/** Занятая ступень: медаль/номер, игрок, ручка драга и снятие обратно в пул. */
export function BallonDorStep({
  nominee,
  place,
  readOnly,
  isLast,
  onMoveTo,
  onRemove,
}: {
  nominee: BallonDorNominee;
  place: number;
  readOnly: boolean;
  isLast?: boolean;
  onMoveTo: () => void;
  onRemove: () => void;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id: getNomineeRef(nominee), disabled: readOnly });

  const band = bandForPlace(place);
  const podium = PODIUM_TONES[place];
  const avatarSize = band === "podium" ? 40 : band === "top10" ? 32 : 28;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "grid",
        gridTemplateColumns: readOnly ? "34px 1fr" : "34px 30px 1fr auto auto",
        alignItems: "center",
        gap: 8,
        minHeight: band === "podium" ? 60 : band === "top10" ? 50 : 44,
        padding: "6px 6px 6px 8px",
        borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
        background: isDragging
          ? "color-mix(in srgb, var(--tg-button) 12%, var(--tg-bg))"
          : podium
            ? `linear-gradient(90deg, color-mix(in srgb, ${podium.tone} 16%, transparent), transparent 70%)`
            : "transparent",
        boxShadow: isDragging ? "0 8px 20px color-mix(in srgb, var(--tg-text) 22%, transparent)" : "none",
        borderRadius: isDragging ? 10 : 0,
        opacity: isDragging ? 0.95 : 1,
        position: "relative",
        zIndex: isDragging ? 5 : 0,
      }}
    >
      {podium ? (
        <div
          aria-label={podium.label}
          style={{
            width: 30, height: 30, borderRadius: 999, justifySelf: "center",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `linear-gradient(160deg, ${podium.tone}, color-mix(in srgb, ${podium.tone} 55%, #000))`,
            color: "#1a1a1a", fontSize: 14, fontWeight: 950,
            boxShadow: `0 2px 10px color-mix(in srgb, ${podium.tone} 45%, transparent)`,
          }}
        >
          {place}
        </div>
      ) : (
        <div style={{
          fontSize: 13, fontWeight: 900, textAlign: "center",
          color: band === "top10"
            ? "color-mix(in srgb, var(--tg-button) 70%, var(--tg-text))"
            : "color-mix(in srgb, var(--tg-text) 45%, var(--tg-hint))",
        }}>
          {place}
        </div>
      )}

      {!readOnly && (
        // Ручка — единственный активатор драга, иначе страница перестанет скроллиться.
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Перетащить ${nominee.player_name}`}
          style={{
            width: 30, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 9, color: "color-mix(in srgb, var(--tg-text) 35%, var(--tg-hint))",
            cursor: "grab", touchAction: "none",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
            <g fill="currentColor">
              <circle cx="4" cy="3" r="1.4" /><circle cx="10" cy="3" r="1.4" />
              <circle cx="4" cy="7" r="1.4" /><circle cx="10" cy="7" r="1.4" />
              <circle cx="4" cy="11" r="1.4" /><circle cx="10" cy="11" r="1.4" />
            </g>
          </svg>
        </div>
      )}

      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
        <NomineeAvatar nominee={nominee} size={avatarSize} />
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: band === "podium" ? 14.5 : 13,
            fontWeight: band === "podium" ? 950 : 850,
            letterSpacing: band === "podium" ? "-0.02em" : 0,
            color: "var(--tg-text)",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {nominee.player_name}
          </div>
          {nominee.team_name && (
            <div style={{
              fontSize: 11, fontWeight: 750,
              color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {nominee.team_name}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <Pressable
          onClick={onMoveTo}
          haptic="light"
          aria-label={`Выбрать место для ${nominee.player_name}`}
          style={smallButtonStyle}
        >
          Место
        </Pressable>
      )}
      {!readOnly && (
        <Pressable
          onClick={onRemove}
          haptic="light"
          aria-label={`Убрать ${nominee.player_name} из списка`}
          style={{ ...smallButtonStyle, width: 30, padding: 0, fontSize: 16, fontWeight: 400 }}
        >
          ×
        </Pressable>
      )}
    </div>
  );
}

/** Пустая ступень — приглашение поставить сюда игрока. */
export function BallonDorEmptyStep({
  place,
  isLast,
  onPick,
}: {
  place: number;
  isLast?: boolean;
  onPick: () => void;
}) {
  const band = bandForPlace(place);
  const podium = PODIUM_TONES[place];
  return (
    <Pressable
      onClick={onPick}
      haptic="selection"
      aria-label={`Поставить игрока на ${place} место`}
      style={{
        display: "grid",
        gridTemplateColumns: "34px 1fr",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minHeight: band === "podium" ? 60 : band === "top10" ? 50 : 44,
        padding: "6px 10px 6px 8px",
        border: "none",
        borderBottom: isLast ? "none" : "1px solid rgba(128,128,128,0.07)",
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <div style={{
        width: podium ? 30 : undefined,
        height: podium ? 30 : undefined,
        borderRadius: 999,
        justifySelf: "center",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: podium ? `1.5px dashed color-mix(in srgb, ${podium.tone} 60%, transparent)` : "none",
        color: podium
          ? `color-mix(in srgb, ${podium.tone} 85%, var(--tg-text))`
          : "color-mix(in srgb, var(--tg-text) 32%, var(--tg-hint))",
        fontSize: 13, fontWeight: 900,
      }}>
        {place}
      </div>
      <div style={{
        fontSize: 12.5, fontWeight: 800,
        color: "color-mix(in srgb, var(--tg-text) 38%, var(--tg-hint))",
      }}>
        {place === 1 ? "Кто заберёт Золотой мяч?" : "Выбрать игрока"}
      </div>
    </Pressable>
  );
}

const smallButtonStyle = {
  height: 28,
  padding: "0 9px",
  border: "none",
  borderRadius: 8,
  background: "rgba(128,128,128,0.12)",
  color: "var(--tg-hint)",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
