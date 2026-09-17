"use client";

import type { CSSProperties, ReactNode } from "react";
import { AppIcon } from "./ui/AppIcon";
import type { AppIconName } from "./ui/appIcons";
import { Pressable } from "./ui/Pressable";

/* Home HUD — короткие действия, которые можно сделать прямо сейчас.
 *
 * Два ряда вместо списка полос: сверху то, что уже заработано и ждёт игрока
 * (награды, кейсы) — крупными плитками со счётчиком, снизу одной строкой
 * бонусы-предложения. Разделение по смыслу заодно экономит высоту: прежние
 * четыре полосы во всю ширину отжимали матчи дня под сгиб экрана. */

/** Плитка «забрать»: то, что уже начислено и ждёт нажатия. */
export type HomeClaim = {
  key: string;
  icon: AppIconName;
  label: string;
  action: string;
  count: number;
  onClick: () => void;
};

/** Сегмент полосы бонусов: предложение, а не начисленное. */
export type HomeBonus = {
  key: string;
  icon: AppIconName;
  label: string;
  /** Награда справа от подписи — то, ради чего жмут. */
  reward?: ReactNode;
  /** Иконка награды рядом с числом: «+10» с мячом короче, чем «+10 мячей». */
  rewardIcon?: AppIconName;
  /** Пояснение второй строкой. Показывается, только когда действие в полосе одно. */
  hint?: string;
  onClick: () => void;
};

export function HomeActionBoard({ claims, bonuses }: { claims: HomeClaim[]; bonuses: HomeBonus[] }) {
  if (!claims.length && !bonuses.length) return null;
  const single = claims.length === 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {claims.length > 0 && (
        <div style={{ display: "flex", gap: 8 }}>
          {claims.map((claim) => (
            <Pressable
              key={claim.key}
              onClick={claim.onClick}
              haptic="selection"
              pressedScale={0.98}
              aria-label={`${claim.label}: ${claim.action}`}
              style={{
                // Одинокая плитка занимает всю ширину: половинка в одиночестве
                // выглядит обрезком ряда.
                flex: single ? "1 1 100%" : "1 1 0",
                minWidth: 0,
                textAlign: "left",
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <div style={claimTileStyle}>
                <AppIcon name={claim.icon} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={claimLabelStyle}>{claim.label}</span>
                  <span style={claimActionStyle}>{claim.action}</span>
                </span>
                <span style={countStyle}>{claim.count}</span>
                <span aria-hidden="true" style={chevronStyle}>›</span>
              </div>
            </Pressable>
          ))}
        </div>
      )}

      {bonuses.length > 0 && (
        <div style={bonusBarStyle}>
          {/* Заголовок нужен, только когда полоса делится на сегменты. С одним
              действием он оставлял дыру: подпись слева, кнопка по центру
              пустого поля. Тогда действие занимает строку целиком. */}
          {bonuses.length > 1 && <span style={bonusTitleStyle}>Бонусы</span>}
          {bonuses.map((bonus, index) => (
            <span key={bonus.key} style={{ display: "contents" }}>
              {index > 0 && <span aria-hidden="true" style={dividerStyle} />}
              <Pressable
                onClick={bonus.onClick}
                haptic="selection"
                pressedScale={0.98}
                aria-label={bonus.label}
                style={bonuses.length > 1 ? bonusSegmentStyle : soleBonusStyle}
              >
                <AppIcon name={bonus.icon} size={bonuses.length > 1 ? 16 : 20} />
                {bonuses.length > 1 || !bonus.hint ? (
                  <span style={bonusLabelStyle}>{bonus.label}</span>
                ) : (
                  // Одно действие на всю строку: без пояснения полоса выглядит
                  // полупустой, поэтому возвращаем вторую строку.
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    <span style={{ ...bonusLabelStyle, display: "block" }}>{bonus.label}</span>
                    <span style={soleBonusHintStyle}>{bonus.hint}</span>
                  </span>
                )}
                {bonus.reward && (
                  <span style={bonusRewardStyle}>
                    {bonus.reward}
                    {bonus.rewardIcon && <AppIcon name={bonus.rewardIcon} size={13} />}
                  </span>
                )}
                {/* Стрелка у каждого действия: одна в конце полосы читалась как
                    переход только для последнего сегмента. */}
                <span
                  aria-hidden="true"
                  style={bonuses.length > 1 ? bonusChevronStyle : { ...bonusChevronStyle, marginLeft: "auto" }}
                >
                  ›
                </span>
              </Pressable>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const claimTileStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minHeight: 52,
  padding: "7px 9px 7px 11px",
  borderRadius: 14,
  background: "color-mix(in srgb, var(--tg-button) 10%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-button) 34%, transparent)",
};

const claimLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 13.5,
  fontWeight: 950,
  letterSpacing: "-0.02em",
  color: "var(--tg-text)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const claimActionStyle: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11.5,
  fontWeight: 850,
  color: "var(--tg-button)",
  whiteSpace: "nowrap",
};

const countStyle: CSSProperties = {
  flexShrink: 0,
  minWidth: 22,
  height: 22,
  padding: "0 6px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  background: "var(--tg-button)",
  color: "var(--tg-button-text)",
  fontSize: 12,
  fontWeight: 950,
};

const chevronStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 15,
  fontWeight: 900,
  lineHeight: 1,
  color: "color-mix(in srgb, var(--tg-text) 40%, var(--tg-hint))",
};

const bonusBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  minHeight: 44,
  padding: "0 10px",
  borderRadius: 14,
  background: "color-mix(in srgb, var(--tg-secondary-bg) 55%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  // Подписи не режем: если сегмент не влезает, полоса прокручивается вбок.
  overflowX: "auto",
  overflowY: "hidden",
};

const bonusTitleStyle: CSSProperties = {
  flexShrink: 0,
  marginRight: 2,
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "color-mix(in srgb, var(--tg-text) 42%, var(--tg-hint))",
};

const dividerStyle: CSSProperties = {
  flexShrink: 0,
  width: 1,
  height: 18,
  background: "color-mix(in srgb, var(--tg-hint) 30%, transparent)",
};

const bonusSegmentStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  height: 30,
  whiteSpace: "nowrap",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

/** Единственное действие: обычная строка слева направо, стрелка у правого края. */
const soleBonusStyle: CSSProperties = {
  ...bonusSegmentStyle,
  flex: "1 1 auto",
  justifyContent: "flex-start",
  height: 42,
  gap: 9,
};

const soleBonusHintStyle: CSSProperties = {
  display: "block",
  marginTop: 1,
  fontSize: 11,
  fontWeight: 750,
  color: "color-mix(in srgb, var(--tg-text) 48%, var(--tg-hint))",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const bonusLabelStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: 12.5,
  fontWeight: 900,
  color: "var(--tg-text)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const bonusChevronStyle: CSSProperties = {
  flexShrink: 0,
  marginLeft: -1,
  fontSize: 14,
  fontWeight: 900,
  lineHeight: 1,
  color: "color-mix(in srgb, var(--tg-text) 38%, var(--tg-hint))",
};

const bonusRewardStyle: CSSProperties = {
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 12,
  fontWeight: 950,
  color: "var(--tg-button)",
  whiteSpace: "nowrap",
};

/** Партнёрское задание, доступное этому игроку. null — звать некуда. */
export type PartnerPromo = {
  id: number;
  title: string;
  taskType: string;
  status: string;
  reward: { type: string; amount: number; label: string };
};

/** Подпись сегмента: в узкой полосе это ярлык места, а не фраза с глаголом. */
export function partnerPromoLabel(promo: PartnerPromo): string {
  return promo.taskType === "telegram_channel_subscribe" ? "Канал" : promo.title;
}

export function partnerPromoIcon(promo: PartnerPromo): AppIconName {
  return promo.taskType === "telegram_channel_subscribe" ? "league_channel" : "quests";
}
