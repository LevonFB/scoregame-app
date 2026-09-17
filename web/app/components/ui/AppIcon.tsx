"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary icon CDN URLs are intentionally rendered with a plain img for Mini App/static export compatibility. */

import type { CSSProperties } from "react";
import { APP_ICONS, type AppIconName } from "./appIcons";

// Optical-size normalization. Some source artworks fill more of their square
// canvas than others (e.g. the lucky_token chip fills ~78% vs the ball's ~64%),
// so at the same `size` box they look visibly uneven. These multipliers scale
// the inner image (not the layout box) so the *visible* footprint matches the
// ball baseline across the app. Box size is unchanged, so alignment is stable.
const ICON_OPTICAL_SCALE: Partial<Record<AppIconName, number>> = {
  lucky_token: 0.82,
};

type AppIconProps = {
  name: AppIconName;
  size?: number;
  className?: string;
  alt?: string;
  loading?: "lazy" | "eager";
};

export function AppIcon({
  name,
  size = 16,
  className,
  alt = "",
  loading = "lazy",
}: AppIconProps) {
  const opticalScale = ICON_OPTICAL_SCALE[name] ?? 1;
  const boxStyle: CSSProperties = {
    width: size,
    height: size,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    lineHeight: 0,
    verticalAlign: "-0.18em",
    pointerEvents: "none",
  };

  return (
    <span className={className} style={boxStyle} aria-hidden={alt ? undefined : true}>
      <img
        src={APP_ICONS[name]}
        alt={alt}
        width={size}
        height={size}
        loading={loading}
        decoding="async"
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
        style={{
          width: `${opticalScale * 100}%`,
          height: `${opticalScale * 100}%`,
          objectFit: "contain",
          display: "block",
          pointerEvents: "none",
        }}
      />
    </span>
  );
}
