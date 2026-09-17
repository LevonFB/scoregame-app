import type { CSSProperties } from "react";

/* Shared visual language for home cards, so leagues/rating match the newer
 * hero / weekly-challenge cards instead of looking flat and "from another app". */

export const HOME_CARD_RADIUS = 22;

// Cohesive surface: subtle vertical gradient, soft hairline border, layered shadow.
export const homeCardSurface: CSSProperties = {
  borderRadius: HOME_CARD_RADIUS,
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 86%, var(--tg-secondary-bg)))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  boxShadow:
    "0 10px 26px rgba(0,0,0,0.18), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)",
};

// Visual-only CTA pill (the whole card is the tap target, so this is not a <button>).
export const homeCardCtaPill: CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-button) 15%, transparent)",
  color: "var(--tg-button)",
  fontSize: 14,
  fontWeight: 800,
};

// Section header row style (title + optional "Все →" affordance).
export const homeSectionHeader: CSSProperties = {
  padding: "0 20px",
  marginBottom: 12,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
