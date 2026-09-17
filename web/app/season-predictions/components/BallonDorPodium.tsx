"use client";

import { Pressable } from "@/app/components/ui/Pressable";
import type { BallonDorNominee } from "../types";
import { NomineeAvatar, PODIUM_TONES } from "./BallonDorLadder";

/**
 * Подиум как отдельный акт: три пьедестала разной высоты, порядок колонок
 * 2–1–3, как на настоящей церемонии.
 *
 * Почему он вынесен из общего списка: обладатель и тройка дают 30 очков
 * бонусами, точный топ-5 — ещё 30, а двадцать седьмое место стоит три очка и
 * ничего не решает. Экран должен повторять эту неравномерность, а не показывать
 * тридцать одинаковых серых строк.
 */
export function BallonDorPodium({
  placed,
  readOnly,
  onPick,
  onOpen,
  onRemove,
}: {
  // Слоты мест: null — место пустое. Дырки допустимы, игрок может начать со 2-го.
  placed: Array<BallonDorNominee | null | undefined>;
  readOnly: boolean;
  onPick: (place: number) => void;
  onOpen: (nominee: BallonDorNominee) => void;
  onRemove: (nominee: BallonDorNominee) => void;
}) {
  // Визуальный порядок колонок, а не мест: серебро слева, золото в центре.
  const columns: Array<{ place: number; height: number; avatar: number }> = [
    { place: 2, height: 58, avatar: 46 },
    { place: 1, height: 78, avatar: 58 },
    { place: 3, height: 44, avatar: 42 },
  ];

  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, padding: "6px 2px 0" }}>
      {columns.map(({ place, height, avatar }) => {
        const nominee = placed[place - 1];
        const tone = PODIUM_TONES[place].tone;
        const filled = Boolean(nominee);

        return (
          <div key={place} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Игрок или приглашение выбрать */}
            <Pressable
              onClick={() => {
                if (readOnly) return;
                if (nominee) onOpen(nominee);
                else onPick(place);
              }}
              haptic="selection"
              aria-label={filled ? `${nominee!.player_name}, ${place} место` : `Выбрать игрока на ${place} место`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                width: "100%",
                padding: "2px 2px 6px",
                border: "none",
                background: "transparent",
                cursor: readOnly ? "default" : "pointer",
              }}
            >
              {filled ? (
                <div style={{ position: "relative" }}>
                  <div style={{
                    padding: 2,
                    borderRadius: 999,
                    background: `linear-gradient(160deg, ${tone}, color-mix(in srgb, ${tone} 45%, transparent))`,
                    boxShadow: `0 3px 14px color-mix(in srgb, ${tone} 40%, transparent)`,
                  }}>
                    <NomineeAvatar nominee={nominee!} size={avatar} />
                  </div>
                  {/* Убрать с подиума: без этой кнопки ошибочный выбор на 1-м
                      месте пришлось бы вытеснять другим игроком. */}
                  {!readOnly && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Убрать ${nominee!.player_name} с ${place} места`}
                      onClick={(event) => { event.stopPropagation(); onRemove(nominee!); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onRemove(nominee!);
                        }
                      }}
                      style={removeBadgeStyle}
                    >
                      ×
                    </span>
                  )}
                </div>
              ) : (
                <div style={{
                  width: avatar + 4,
                  height: avatar + 4,
                  borderRadius: 999,
                  border: `1.5px dashed color-mix(in srgb, ${tone} 55%, transparent)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: `color-mix(in srgb, ${tone} 85%, var(--tg-text))`,
                  fontSize: 18,
                  fontWeight: 900,
                }}>
                  ?
                </div>
              )}

              <div style={{
                fontSize: place === 1 ? 12 : 11,
                fontWeight: 900,
                lineHeight: 1.2,
                textAlign: "center",
                color: filled ? "var(--tg-text)" : "color-mix(in srgb, var(--tg-text) 40%, var(--tg-hint))",
                // Две строки максимум: длинные имена не должны разъезжать колонки.
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                width: "100%",
              }}>
                {filled ? nominee!.player_name : "Выбрать"}
              </div>
            </Pressable>

            {/* Пьедестал */}
            <div style={{
              width: "100%",
              height,
              borderRadius: "10px 10px 0 0",
              background: filled
                ? `linear-gradient(180deg, color-mix(in srgb, ${tone} 55%, transparent), color-mix(in srgb, ${tone} 12%, transparent))`
                : "rgba(128,128,128,0.10)",
              border: `1px solid color-mix(in srgb, ${tone} ${filled ? 45 : 20}%, transparent)`,
              borderBottom: "none",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              paddingTop: 6,
              fontSize: place === 1 ? 20 : 17,
              fontWeight: 950,
              color: filled ? "#1a1a1a" : `color-mix(in srgb, ${tone} 70%, var(--tg-hint))`,
              textShadow: filled ? `0 1px 0 color-mix(in srgb, ${tone} 60%, transparent)` : "none",
            }}>
              {place}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const removeBadgeStyle = {
  position: "absolute",
  top: -2,
  right: -2,
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "var(--tg-bg)",
  border: "1px solid rgba(128,128,128,0.35)",
  color: "var(--tg-hint)",
  fontSize: 13,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
} as const;
