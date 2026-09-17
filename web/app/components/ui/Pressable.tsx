"use client";

import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { type HapticSignal, triggerHaptic } from "@/lib/haptics";

type PressableProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  haptic?: HapticSignal;
  pressedScale?: number;
};

export const Pressable = forwardRef<HTMLButtonElement, PressableProps>(function Pressable(
  {
    className = "",
    disabled,
    haptic = "selection",
    onClick,
    pressedScale,
    style,
    type = "button",
    ...props
  },
  ref,
) {
  const pressStyle = { ...style } as CSSProperties & Record<string, string | number>;
  if (pressedScale) pressStyle["--sg-press-scale"] = pressedScale;

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled}
      className={`sg-pressable ${className}`.trim()}
      style={pressStyle}
      onClick={(event) => {
        if (disabled) return;
        triggerHaptic(haptic);
        onClick?.(event);
      }}
    />
  );
});
