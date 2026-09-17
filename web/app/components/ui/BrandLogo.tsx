"use client";

import { useEffect, useState, type CSSProperties } from "react";

// ScoreGame logo, drawn as PNG alpha masks filled with color, so the mark
// follows the user's Telegram accent and stays crisp at any size.
//   dark mark  — two layers: cream outline behind thick accent letter bodies
//   light mark — one layer: the flat accent silhouette
// Both masks are cut from the mark's bbox onto the same 320x157 canvas, so the
// two variants sit identically in the header.
const DARK_BODY_MASK = "url(/sg-logo-blue.png)";
const DARK_OUTLINE_MASK = "url(/sg-logo-cream.png)";
const LIGHT_MASK = "url(/sg-logo-light.png)";
const LOGO_CREAM = "#fff3d9";

// Native aspect ratio of the asset (matches the 70x34 header usage).
export const BRAND_LOGO_RATIO = 70 / 34;

const layerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

// Relative luminance of the resolved --tg-bg, used when the Telegram client is
// too old to expose colorScheme (or the app runs outside Telegram).
function backgroundIsLight(): boolean {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--tg-bg").trim();
  let r: number, g: number, b: number;
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = raw.match(/(\d+(?:\.\d+)?)/g);
    if (!rgb || rgb.length < 3) return false;
    [r, g, b] = rgb.slice(0, 3).map(Number);
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}

function useLightTheme(): boolean {
  // Defaults to the dark mark: it is the canonical one and stays readable for
  // the single frame before the effect resolves the real theme.
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    const sync = () => {
      const scheme = window.Telegram?.WebApp?.colorScheme;
      setIsLight(scheme === "light" || scheme === "dark" ? scheme === "light" : backgroundIsLight());
    };
    sync();
    tg?.onEvent?.("themeChanged", sync);
    return () => tg?.offEvent?.("themeChanged", sync);
  }, []);

  return isLight;
}

export function BrandLogo({
  width,
  height,
  style,
}: {
  width: number;
  height: number;
  style?: CSSProperties;
}) {
  const isLight = useLightTheme();

  return (
    <span
      role="img"
      aria-label="ScoreGame"
      style={{ position: "relative", display: "block", width, height, flexShrink: 0, ...style }}
    >
      {isLight ? (
        <span style={{ ...layerStyle, backgroundColor: "var(--tg-button)", WebkitMaskImage: LIGHT_MASK, maskImage: LIGHT_MASK }} />
      ) : (
        <>
          <span style={{ ...layerStyle, backgroundColor: LOGO_CREAM, WebkitMaskImage: DARK_OUTLINE_MASK, maskImage: DARK_OUTLINE_MASK }} />
          <span style={{ ...layerStyle, backgroundColor: "var(--tg-button)", WebkitMaskImage: DARK_BODY_MASK, maskImage: DARK_BODY_MASK }} />
        </>
      )}
    </span>
  );
}
