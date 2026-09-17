"use client";

import { type CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import { EUROPEAN_CUP_ACCENTS, EUROPEAN_CUP_ORDER } from "../constants";
import type { EuropeanCupCode } from "../types";

// Compact tournament selector (UX idea, NOT UEFA brand): small code-only buttons
// to switch the active eurocup. The full tournament name lives in the hero below.
// Per-tournament accent from project constants; theme-aware, scroll-safe on narrow WebView.
export function EurocupTournamentSwitch({
  codes,
  activeCode = null,
  onSelect,
}: {
  codes: EuropeanCupCode[];
  activeCode?: EuropeanCupCode | null;
  onSelect: (code: EuropeanCupCode) => void;
}) {
  const ordered = EUROPEAN_CUP_ORDER.filter((c) => codes.includes(c));
  if (ordered.length === 0) return null;

  return (
    <div role="tablist" aria-label="Турниры еврокубков" className="sp-eurocup-hub" style={railStyle}>
      {ordered.map((code) => {
        const accent = EUROPEAN_CUP_ACCENTS[code];
        const tone = accent?.tone || "var(--tg-button)";
        const active = code === activeCode;
        return (
          <Pressable
            key={code}
            role="tab"
            aria-selected={active}
            haptic="selection"
            pressedScale={0.96}
            onClick={() => onSelect(code)}
            style={buttonStyle(active, tone)}
          >
            {accent?.short || code}
            {/* Thin bottom indicator for the active tournament. */}
            <span style={{ position: "absolute", left: "50%", bottom: 5, transform: "translateX(-50%)", height: 2.5, width: active ? 20 : 0, borderRadius: 999, background: tone, transition: "width 150ms ease" }} />
          </Pressable>
        );
      })}
      <style jsx>{`
        .sp-eurocup-hub::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

const railStyle: CSSProperties = {
  // Even spacing across the container: ЛЧ left · ЛЕ center · ЛК right.
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

function buttonStyle(active: boolean, tone: string): CSSProperties {
  return {
    position: "relative",
    flex: "1 1 0",
    minWidth: 56,
    maxWidth: 120,
    height: 42,
    padding: "0 12px",
    borderRadius: 11,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 13.5,
    fontWeight: 950,
    letterSpacing: "0.02em",
    // Active = subtle tint + tone text + tone border (no big fill); inactive = soft.
    color: active ? `color-mix(in srgb, ${tone} 86%, var(--tg-text))` : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
    background: active ? `color-mix(in srgb, ${tone} 16%, var(--tg-bg))` : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
    border: active ? `1px solid color-mix(in srgb, ${tone} 48%, transparent)` : "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  };
}
