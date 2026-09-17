"use client";

import { type CSSProperties } from "react";
import { Pressable } from "@/app/components/ui/Pressable";
import { TOP_LEAGUE_ACCENTS, TOP_LEAGUE_ORDER, TOP_LEAGUE_SUBLABELS } from "../constants";
import type { TopLeagueCode } from "../types";

// Compact league selector (mirrors the eurocup tournament switch): small
// code-only buttons. Full league name lives in the hero below. Theme-aware,
// horizontal-scroll-safe so all 5 fit / scroll cleanly on narrow WebView.
export function TopLeagueSwitch({
  codes,
  activeCode,
  onSelect,
}: {
  codes: TopLeagueCode[];
  activeCode: TopLeagueCode | null;
  onSelect: (code: TopLeagueCode) => void;
}) {
  const ordered = TOP_LEAGUE_ORDER.filter((c) => codes.includes(c));
  if (ordered.length === 0) return null;

  return (
    <div role="tablist" aria-label="Топ-5 лиг" className="sp-league-switch" style={railStyle}>
      {ordered.map((code) => {
        const accent = TOP_LEAGUE_ACCENTS[code];
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
            <span style={{ fontSize: 13, fontWeight: 950, letterSpacing: "0.01em", lineHeight: 1 }}>{accent?.short || code}</span>
            <span style={{ fontSize: 8.5, fontWeight: 800, lineHeight: 1, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: active ? "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))" : "var(--tg-hint)" }}>
              {TOP_LEAGUE_SUBLABELS[code] || ""}
            </span>
            <span style={{ position: "absolute", left: "50%", bottom: 4, transform: "translateX(-50%)", height: 2.5, width: active ? 18 : 0, borderRadius: 999, background: tone, transition: "width 150ms ease" }} />
          </Pressable>
        );
      })}
      <style jsx>{`
        .sp-league-switch::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

const railStyle: CSSProperties = {
  display: "flex",
  gap: 6,
  overflowX: "auto",
  paddingBottom: 2,
  scrollbarWidth: "none",
  WebkitOverflowScrolling: "touch",
};

function buttonStyle(active: boolean, tone: string): CSSProperties {
  return {
    position: "relative",
    flex: "1 1 0",
    minWidth: 56,
    maxWidth: 110,
    minHeight: 42,
    padding: "4px 6px 6px",
    borderRadius: 11,
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    cursor: "pointer",
    color: active ? `color-mix(in srgb, ${tone} 86%, var(--tg-text))` : "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
    background: active ? `color-mix(in srgb, ${tone} 16%, var(--tg-bg))` : "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
    border: active ? `1px solid color-mix(in srgb, ${tone} 48%, transparent)` : "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
    overflow: "hidden",
  };
}
