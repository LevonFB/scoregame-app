"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import type { BallonDorNominee } from "../types";
import { NomineeAvatar, getNomineeRef } from "./BallonDorLadder";

/**
 * Пошаговая расстановка 30 → 1.
 *
 * Почему снизу вверх: рейтинг из тридцати строк — это не прогноз, а анкета.
 * Игрок начинает с места, которое ему не жалко, и с каждым тапом поднимается к
 * обладателю. Полный экран расклада (подиум + список) остаётся как был и
 * открывается только на 30/30 — здесь он намеренно не показывается, иначе
 * колода уедет вниз под тридцать пустых строк.
 */

/** Акцент места: чем ближе к вершине, тем сильнее золото. */
export function placeAccent(place: number): string {
  if (place <= 1) return "#ffc94a";
  if (place === 2) return "#cfd8e3";
  if (place === 3) return "#e0955c";
  if (place <= 10) return "#e2b25e";
  return "var(--tg-button)";
}

/** Короткая метка этапа — без отдельного экрана и лишнего тапа. */
export function placeBadge(place: number): string | null {
  if (place <= 3) return "Пьедестал";
  if (place <= 10) return "Топ-10";
  return null;
}

/** Следующее место в пошаговом режиме: самое нижнее свободное. 0 — свободных нет. */
export function nextGuidedPlace(slots: Array<BallonDorNominee | null>): number {
  for (let i = slots.length - 1; i >= 0; i--) if (!slots[i]) return i + 1;
  return 0;
}

// ─── Стартовый экран ─────────────────────────────────────────────────────────

export function BallonDorStartScreen({
  total,
  onStart,
}: {
  total: number;
  onStart: () => void;
}) {
  return (
    <section className="sg-motion-card" style={introCardStyle}>
      <div aria-hidden="true" style={trophyStyle} />
      <h2 style={introTitleStyle}>Золотой мяч</h2>
      <p style={introLeadStyle}>
        Собери свой рейтинг претендентов
        <br />
        на Золотой мяч
      </p>
      <div style={introCountStyle}>{total} кандидатов</div>
      <p style={introStepsStyle}>
        Начинаем с {total}-го места
        <br />
        и постепенно добираемся
        <br />
        до победителя
      </p>
      <Pressable onClick={onStart} haptic="success" pressedScale={0.97} aria-label="Начать расстановку" style={startButtonStyle}>
        Начать
      </Pressable>
    </section>
  );
}

// ─── Трек рейтинга ───────────────────────────────────────────────────────────

/** Высота строки трека; от неё же считается прокрутка ленты. */
const TRACK_ROW_H = 36;
/** Сколько мест видно в окне лестницы. */
export const TRACK_ROWS = 4;
/** Активная строка стоит второй сверху: одно будущее место видно над ней. */
const TRACK_ACTIVE_SLOT = 1;

/**
 * Лестница мест: первое место вверху, тридцатое внизу, активное — второй
 * строкой сверху.
 *
 * Окно прокручивается руками: игрок может спуститься к уже занятым местам и
 * подняться обратно, не открывая полный расклад. После каждого выбора окно само
 * доезжает до нового активного места — лента уходит вниз, взгляд поднимается.
 */
export function BallonDorTrack({
  slots,
  place,
  focused,
  onFocus,
  onRelease,
}: {
  slots: Array<BallonDorNominee | null>;
  place: number;
  /** Активное место выбрано вручную — по нему же и возвращаются обратно. */
  focused?: boolean;
  /** Перейти к месту: следующий выбор из колоды встанет именно туда. */
  onFocus?: (place: number) => void;
  /** Снять игрока с занятого места — только по кнопке «снять». */
  onRelease?: (place: number) => void;
}) {
  const activeIndex = Math.max(0, place - 1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const settledRef = useRef(false);

  // Доводим окно до активного места — но не перехватываем ручную прокрутку:
  // эффект срабатывает только на смену места. Первый заход ставим мгновенно:
  // плавная прокрутка через двадцать шесть строк заняла бы пару секунд.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const top = Math.max(0, (activeIndex - TRACK_ACTIVE_SLOT) * TRACK_ROW_H);
    el.scrollTo({ top, behavior: settledRef.current ? "smooth" : "auto" });
    settledRef.current = true;
  }, [activeIndex]);

  return (
    <div ref={viewportRef} className="sg-hide-scrollbar" style={trackViewportStyle} aria-live="polite">
      <div style={{ position: "relative" }}>
        {/* Рельс: места читаются как один путь наверх, а не как отдельные строки. */}
        <div aria-hidden="true" style={trackRailStyle} />
        {slots.map((nominee, index) => {
          const rowPlace = index + 1;
          const distance = index - activeIndex;
          const accent = placeAccent(rowPlace);
          if (distance === 0) {
            // Активная строка: на занятом месте показывает жильца — следующий
            // выбор из колоды его заменит. Тап возвращает к обычному ходу.
            return (
              <Pressable
                key={rowPlace}
                className="sg-pressable-flat"
                onClick={() => { if (focused) onFocus?.(rowPlace); }}
                disabled={!focused || !onFocus}
                haptic="light"
                pressedScale={0.99}
                aria-label={focused ? "Вернуться к очередному месту" : `${rowPlace} место`}
                style={{ ...trackRowWrapStyle, width: "100%", border: "none", background: "transparent", cursor: focused ? "pointer" : "default" }}
              >
                <div style={trackActiveRowStyle(accent)}>
                  <span style={trackActiveNumberStyle(accent)}>{rowPlace}</span>
                  {nominee ? (
                    <>
                      <NomineeAvatar nominee={nominee} size={22} />
                      <span style={{ minWidth: 0, flex: 1, textAlign: "left", fontSize: 13, fontWeight: 900, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {nominee.player_name}
                      </span>
                      <span style={releaseHintStyle}>заменить</span>
                    </>
                  ) : (
                    <span style={{ minWidth: 0, fontSize: 13.5, fontWeight: 950, letterSpacing: "-0.02em", color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {rowPlace === 1 ? "Кто заберёт Золотой мяч?" : "Кто займёт это место?"}
                    </span>
                  )}
                </div>
              </Pressable>
            );
          }
          // Любая строка — переход к своему месту. Удаление живёт отдельной
          // кнопкой: раньше тап по игроку сразу снимал его, и промах по строке
          // стоил выбора.
          return (
            <Pressable
              key={rowPlace}
              className="sg-pressable-flat"
              onClick={() => onFocus?.(rowPlace)}
              disabled={!onFocus}
              haptic="light"
              pressedScale={0.98}
              aria-label={`Перейти к ${rowPlace} месту`}
              style={{
                ...trackRowWrapStyle,
                ...trackRowStyle(Boolean(nominee)),
                width: "100%",
                border: "none",
                background: "transparent",
                cursor: onFocus ? "pointer" : "default",
              }}
            >
              <span style={trackNumberStyle(nominee ? null : accent, Boolean(nominee))}>{rowPlace}</span>
              {nominee ? (
                <>
                  <NomineeAvatar nominee={nominee} size={22} />
                  <span style={{ minWidth: 0, flex: 1, textAlign: "left", fontSize: 12.5, fontWeight: 850, color: "var(--tg-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {nominee.player_name}
                  </span>
                  {onRelease && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Убрать ${nominee.player_name} с ${rowPlace} места`}
                      onClick={(event) => { event.stopPropagation(); onRelease(rowPlace); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onRelease(rowPlace);
                        }
                      }}
                      style={releaseButtonStyle}
                    >
                      снять
                    </span>
                  )}
                </>
              ) : (
                <span style={{ fontSize: 13, fontWeight: 900, color: "color-mix(in srgb, var(--tg-text) 28%, var(--tg-hint))" }}>?</span>
              )}
            </Pressable>
          );
        })}
      </div>
    </div>
  );
}

// ─── Финальный reveal ────────────────────────────────────────────────────────

/**
 * Победитель не выбирается, а остаётся: на 29/30 претендент в колоде один, и
 * тап по нему был бы формальностью. Вместо него — отдельный экран коронации,
 * после которого открывается прежний полный расклад.
 */
export function BallonDorWinnerReveal({
  nominee,
  onContinue,
  onUndo,
}: {
  nominee: BallonDorNominee;
  onContinue: () => void;
  /** Вернуться к выбору: снимает победителя вместе со вторым местом. */
  onUndo?: () => void;
}) {
  return (
    <section className="sg-motion-card" style={introCardStyle}>
      <div style={revealLabelStyle}>Твой обладатель Золотого мяча</div>
      <div style={revealAvatarWrapStyle}>
        <NomineeAvatar nominee={nominee} size={96} />
      </div>
      <div style={revealNameStyle}>{nominee.player_name}</div>
      {nominee.team_name && <div style={revealTeamStyle}>{nominee.team_name}</div>}
      <p style={introStepsStyle}>
        Рейтинг собран целиком.
        <br />
        Осталось проверить расклад и подтвердить.
      </p>
      <Pressable onClick={onContinue} haptic="success" pressedScale={0.97} aria-label="Открыть полный расклад" style={startButtonStyle}>
        Посмотреть расклад
      </Pressable>
      {onUndo && (
        <Pressable
          onClick={onUndo}
          haptic="light"
          pressedScale={0.98}
          aria-label="Вернуться к выбору второго места"
          style={{ ...undoButtonStyle, width: "100%", marginTop: 8, minHeight: 38 }}
        >
          ↺ Вернуться к выбору
        </Pressable>
      )}
    </section>
  );
}

// ─── Пошаговая расстановка ───────────────────────────────────────────────────

export function BallonDorGuidedStep({
  total,
  placedCount,
  place,
  pool,
  filteredPool,
  query,
  onQueryChange,
  slots,
  onPick,
  onRelease,
  focused,
  onFocus,
  onUndo,
  onOpenLadder,
}: {
  total: number;
  placedCount: number;
  /** Текущее место; 0 — расставлено всё (тогда экран уже не показывается). */
  place: number;
  pool: BallonDorNominee[];
  filteredPool: BallonDorNominee[];
  query: string;
  onQueryChange: (next: string) => void;
  /** Слоты мест целиком: трек показывает и занятые снизу, и пустые сверху. */
  slots: Array<BallonDorNominee | null>;
  onPick: (nominee: BallonDorNominee) => void;
  /** Снять игрока с уже занятого места и вернуть его в колоду. */
  onRelease: (place: number) => void;
  /** Место выбрано вручную, а не подставлено очередью. */
  focused: boolean;
  /** Перейти к месту в лестнице. */
  onFocus: (place: number) => void;
  /** Отмена последнего выбора — всегда по очереди, независимо от перехода. */
  onUndo: () => void;
  onOpenLadder: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const accent = placeAccent(place);
  const badge = placeBadge(place);
  const pct = Math.round((placedCount / Math.max(1, total)) * 100);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function toggleSearch() {
    setSearchOpen((prev) => {
      if (prev) onQueryChange("");
      return !prev;
    });
  }


  return (
    <section style={guidedCardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 950, letterSpacing: "-0.03em" }}>Золотой мяч</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {badge && <span style={stageBadgeStyle(accent)}>{badge}</span>}
          <span style={{ fontSize: 13, fontWeight: 950, color: `color-mix(in srgb, ${accent} 70%, var(--tg-text))` }}>
            {placedCount} / {total}
          </span>
        </div>
      </div>

      <div style={progressTrackStyle}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 999,
          background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 55%, var(--tg-button)), ${accent})`,
          transition: "width 220ms ease",
        }} />
      </div>

      {/* Лестница: окно на четыре места, прокручивается вверх и вниз. */}
      <BallonDorTrack slots={slots} place={place} focused={focused} onFocus={onFocus} onRelease={onRelease} />

      {placedCount > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {/* Случайный тап отменяется одной кнопкой: игрок возвращается в
              колоду, а активным снова становится его место. */}
          <Pressable
            onClick={onUndo}
            haptic="light"
            pressedScale={0.98}
            aria-label="Отменить последний выбор"
            style={undoButtonStyle}
          >
            ↺ Отменить
          </Pressable>
          <Pressable onClick={onOpenLadder} haptic="light" pressedScale={0.98} aria-label="Посмотреть текущий расклад" style={{ ...ladderButtonStyle, flex: 1, marginTop: 0 }}>
            Расклад · {placedCount}/{total}
          </Pressable>
        </div>
      )}

      {/* Колода — инструмент выбора; она идёт списком целиком. */}
      <div style={deckPanelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--tg-text)" }}>Кандидаты · {pool.length}</span>
          <Pressable
            onClick={toggleSearch}
            haptic="light"
            aria-label={searchOpen ? "Закрыть поиск" : "Найти кандидата"}
            aria-pressed={searchOpen}
            style={searchToggleStyle(searchOpen)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.6" />
                <path d="M10.6 10.6 14 14" />
              </g>
            </svg>
          </Pressable>
        </div>

        {searchOpen && (
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Имя или клуб"
            aria-label="Поиск кандидата"
            style={searchInputStyle}
          />
        )}
        <div style={deckStyle}>
          {filteredPool.length === 0 ? (
            <div style={{ padding: 14, width: "100%", textAlign: "center", color: "var(--tg-hint)", fontWeight: 800, fontSize: 12.5 }}>
              Никого не нашлось.
            </div>
          ) : filteredPool.map((nominee) => (
            <Pressable
              key={getNomineeRef(nominee)}
              className="sg-pressable-flat"
              onClick={() => onPick(nominee)}
              haptic="selection"
              pressedScale={0.94}
              aria-label={`Поставить ${nominee.player_name} на ${place} место`}
              style={deckChipStyle}
            >
              <NomineeAvatar nominee={nominee} size={20} />
              <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 124 }}>
                {nominee.player_name}
              </span>
            </Pressable>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const introCardStyle: CSSProperties = {
  borderRadius: 18,
  padding: "26px 18px 22px",
  textAlign: "center",
  background: "radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, #ffc94a 16%, transparent), transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px color-mix(in srgb, #ffc94a 22%, rgba(255,255,255,0.12))",
};

const trophyStyle: CSSProperties = {
  width: 76,
  height: 76,
  margin: "0 auto 14px",
  borderRadius: 999,
  background: "radial-gradient(circle at 34% 30%, #fff3c4, #ffc94a 42%, #b8792f 100%)",
  boxShadow: "0 10px 30px color-mix(in srgb, #ffc94a 38%, transparent), inset 0 -6px 14px rgba(0,0,0,0.28)",
};

const introTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 950,
  letterSpacing: "-0.04em",
};

const introLeadStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: 13.5,
  lineHeight: 1.45,
  fontWeight: 800,
  color: "color-mix(in srgb, var(--tg-text) 68%, var(--tg-hint))",
};

const introCountStyle: CSSProperties = {
  display: "inline-block",
  margin: "14px 0 0",
  padding: "5px 13px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, #ffc94a 34%, transparent)",
  background: "color-mix(in srgb, #ffc94a 10%, transparent)",
  color: "color-mix(in srgb, #ffc94a 80%, var(--tg-text))",
  fontSize: 12,
  fontWeight: 950,
};

const introStepsStyle: CSSProperties = {
  margin: "14px 0 20px",
  fontSize: 12.5,
  lineHeight: 1.5,
  fontWeight: 750,
  color: "color-mix(in srgb, var(--tg-text) 50%, var(--tg-hint))",
};

const startButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 50,
  borderRadius: 15,
  border: "1px solid color-mix(in srgb, #ffc94a 70%, var(--tg-text))",
  background: "linear-gradient(180deg, color-mix(in srgb, #ffc94a 30%, var(--tg-bg)), color-mix(in srgb, #ffc94a 16%, var(--tg-secondary-bg)))",
  color: "color-mix(in srgb, #ffc94a 80%, var(--tg-text))",
  boxShadow: "0 6px 22px color-mix(in srgb, #ffc94a 24%, transparent)",
  fontSize: 16,
  fontWeight: 950,
  letterSpacing: "-0.01em",
  cursor: "pointer",
};

const guidedCardStyle: CSSProperties = {
  borderRadius: 18,
  padding: "12px 12px 10px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.13), rgba(255,255,255,0.06)), var(--tg-bg)",
  color: "var(--tg-text)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.12)",
};

const progressTrackStyle: CSSProperties = {
  height: 5,
  borderRadius: 999,
  background: "rgba(128,128,128,0.16)",
  overflow: "hidden",
  margin: "8px 0 10px",
};

function stageBadgeStyle(accent: string): CSSProperties {
  return {
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid color-mix(in srgb, ${accent} 38%, transparent)`,
    background: `color-mix(in srgb, ${accent} 12%, transparent)`,
    color: `color-mix(in srgb, ${accent} 78%, var(--tg-text))`,
    fontSize: 10,
    fontWeight: 950,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };
}

const trackViewportStyle: CSSProperties = {
  // Пара пикселей запаса: у активной строки своя рамка и тень, вплотную к краю
  // окна они срезаются.
  height: TRACK_ROWS * TRACK_ROW_H + 6,
  padding: "3px 0",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
  borderRadius: 14,
  marginTop: 2,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 34%, transparent)",
};

const trackRowWrapStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  display: "flex",
  alignItems: "center",
  gap: 9,
  height: TRACK_ROW_H,
  padding: "0 8px",
};

/** Рельс лестницы — под номерами, между их кружками. */
const trackRailStyle: CSSProperties = {
  position: "absolute",
  left: 22,
  top: TRACK_ROW_H / 2,
  bottom: TRACK_ROW_H / 2,
  width: 2,
  borderRadius: 2,
  background: "linear-gradient(180deg, color-mix(in srgb, var(--tg-button) 42%, transparent), color-mix(in srgb, var(--tg-hint) 22%, transparent))",
};

/**
 * Занятые места читаются полностью, пустые приглушены. Прозрачность по факту
 * заполнения, а не по расстоянию до активного: окно прокручивается руками, и
 * в дальнем конце лестницы строки не должны выцветать до нечитаемых.
 */
function trackRowStyle(filled: boolean): CSSProperties {
  return { opacity: filled ? 1 : 0.5, transition: "opacity 240ms ease" };
}

function trackNumberStyle(accent: string | null, filled: boolean): CSSProperties {
  return {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // Непрозрачный кружок разрывает рельс — путь читается пунктиром по местам.
    background: filled ? "color-mix(in srgb, var(--tg-text) 10%, var(--tg-bg))" : "var(--tg-bg)",
    border: filled
      ? "1px solid color-mix(in srgb, var(--tg-hint) 20%, transparent)"
      : `1px dashed color-mix(in srgb, ${accent || "var(--tg-hint)"} 35%, transparent)`,
    fontSize: 11.5,
    fontWeight: 900,
    color: filled
      ? "color-mix(in srgb, var(--tg-text) 62%, var(--tg-hint))"
      : `color-mix(in srgb, ${accent || "var(--tg-hint)"} 62%, var(--tg-hint))`,
  };
}

function trackActiveRowStyle(accent: string): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    height: TRACK_ROW_H - 2,
    padding: "0 10px 0 3px",
    borderRadius: 12,
    border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
    // Непрозрачная подложка: рельс не должен просвечивать сквозь активную строку.
    background: `linear-gradient(120deg, color-mix(in srgb, ${accent} 16%, transparent), transparent 74%), var(--tg-bg)`,
    boxShadow: `0 4px 16px color-mix(in srgb, ${accent} 16%, transparent)`,
    transition: "border-color 240ms ease, background 240ms ease",
  };
}

function trackActiveNumberStyle(accent: string): CSSProperties {
  return {
    flexShrink: 0,
    minWidth: 34,
    height: 30,
    padding: "0 5px",
    borderRadius: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 32%, transparent), color-mix(in srgb, ${accent} 12%, transparent))`,
    border: `1px solid color-mix(in srgb, ${accent} 48%, transparent)`,
    color: `color-mix(in srgb, ${accent} 82%, var(--tg-text))`,
    fontSize: 17,
    fontWeight: 950,
    letterSpacing: "-0.03em",
    lineHeight: 1,
  };
}

const revealLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 950,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, #ffc94a 78%, var(--tg-text))",
};

const revealAvatarWrapStyle: CSSProperties = {
  display: "inline-flex",
  margin: "14px auto 0",
  padding: 3,
  borderRadius: 999,
  background: "linear-gradient(160deg, #ffe49a, #ffc94a 45%, #b8792f)",
  boxShadow: "0 12px 34px color-mix(in srgb, #ffc94a 34%, transparent)",
};

const revealNameStyle: CSSProperties = {
  marginTop: 12,
  fontSize: 21,
  fontWeight: 950,
  letterSpacing: "-0.04em",
  color: "var(--tg-text)",
};

const revealTeamStyle: CSSProperties = {
  marginTop: 3,
  fontSize: 12.5,
  fontWeight: 800,
  color: "color-mix(in srgb, var(--tg-text) 55%, var(--tg-hint))",
};

/** «Снять» — отдельная кнопка со своей зоной нажатия внутри строки. */
const releaseButtonStyle: CSSProperties = {
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  height: 26,
  padding: "0 9px",
  borderRadius: 8,
  background: "color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 52%, var(--tg-hint))",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  cursor: "pointer",
};

const releaseHintStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, var(--tg-text) 35%, var(--tg-hint))",
};

const undoButtonStyle: CSSProperties = {
  flexShrink: 0,
  minHeight: 34,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 18%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  color: "color-mix(in srgb, var(--tg-text) 72%, var(--tg-hint))",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ladderButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 34,
  marginTop: 8,
  borderRadius: 10,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  color: "color-mix(in srgb, var(--tg-text) 70%, var(--tg-hint))",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
};


function searchToggleStyle(active: boolean): CSSProperties {
  return {
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: 9,
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: active ? "color-mix(in srgb, var(--tg-button) 18%, transparent)" : "rgba(128,128,128,0.12)",
    color: active ? "var(--tg-button)" : "var(--tg-hint)",
    cursor: "pointer",
  };
}

const searchInputStyle: CSSProperties = {
  width: "100%",
  height: 36,
  marginTop: 8,
  padding: "0 12px",
  borderRadius: 11,
  border: "1px solid rgba(128,128,128,0.22)",
  background: "var(--tg-secondary-bg)",
  color: "var(--tg-text)",
  fontSize: 14,
  fontWeight: 700,
  outline: "none",
};

const deckPanelStyle: CSSProperties = {
  // Отбивка от лестницы: колода читается как отдельный слой, но без своей
  // прокрутки — список из тридцати виден целиком и листается страницей.
  margin: "10px -12px -10px",
  padding: "10px 12px",
  borderRadius: "16px 16px 18px 18px",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 46%, var(--tg-bg))",
  borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
};

const deckStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 5,
  marginTop: 8,
};

const deckChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  height: 32,
  padding: "0 10px 0 4px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--tg-button) 24%, transparent)",
  background: "color-mix(in srgb, var(--tg-button) 10%, var(--tg-bg))",
  color: "var(--tg-text)",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
};
