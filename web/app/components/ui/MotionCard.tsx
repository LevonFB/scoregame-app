"use client";

import type { CSSProperties, HTMLAttributes } from "react";

type MotionCardProps = HTMLAttributes<HTMLDivElement> & {
  delayIndex?: number;
};

export function MotionCard({ className = "", delayIndex = 0, style, ...props }: MotionCardProps) {
  const motionStyle = { ...style } as CSSProperties & Record<string, string | number>;
  motionStyle["--sg-enter-delay"] = `${Math.min(delayIndex * 35, 180)}ms`;

  return <div {...props} className={`sg-motion-card ${className}`.trim()} style={motionStyle} />;
}
