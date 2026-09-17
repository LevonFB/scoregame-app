"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Pressable } from "./Pressable";
import { type HapticSignal } from "@/lib/haptics";

export type SegmentedControlItem<K extends string = string> = {
  key: K;
  /** Static content, or a render function receiving the active state. */
  content: ReactNode | ((active: boolean) => ReactNode);
  testId?: string;
};

type PillState = {
  left: number;
  top: number;
  width: number;
  height: number;
  ready: boolean;
};

/**
 * Segmented control with a sliding "pill" highlight (extracted from
 * DateSelector). The pill physically travels from the previous segment to the
 * newly selected one instead of each button repainting in place.
 *
 * Visuals are fully controlled by the caller: the track, pill and items carry
 * only positioning/animation defaults here — colors, radii, borders and
 * shadows come from `trackStyle` / `pillStyle` / `itemStyle`.
 */
export function SegmentedControl<K extends string>({
  items,
  value,
  onChange,
  trackStyle,
  pillStyle,
  itemStyle,
  gloss = false,
  haptic = "selection",
  pressedScale = 0.97,
  ariaLabel,
  className,
}: {
  items: SegmentedControlItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Merged over the track defaults (grid, gap 4, padding 4, overflow hidden). */
  trackStyle?: CSSProperties;
  /** Visuals of the sliding highlight (background, border, radius, shadow). */
  pillStyle?: CSSProperties;
  /** Per-item style; receives the active state (animate colors via transition). */
  itemStyle?: (active: boolean) => CSSProperties;
  /** Adds the glossy top highlight inside the pill (as in DateSelector). */
  gloss?: boolean;
  haptic?: HapticSignal;
  pressedScale?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<PillState>({ left: 0, top: 0, width: 0, height: 0, ready: false });

  const syncPill = () => {
    const track = trackRef.current;
    const activeNode = itemRefs.current[value];
    if (!track || !activeNode) {
      setPill((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    const trackRect = track.getBoundingClientRect();
    const itemRect = activeNode.getBoundingClientRect();
    // scrollLeft/scrollTop keep the pill in content coordinates when the
    // track is a scrollable rail (it then scrolls together with the items).
    const next: PillState = {
      left: itemRect.left - trackRect.left + track.scrollLeft,
      top: itemRect.top - trackRect.top + track.scrollTop,
      width: itemRect.width,
      height: itemRect.height,
      ready: true,
    };
    setPill((prev) =>
      prev.left === next.left &&
      prev.top === next.top &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.ready === next.ready
        ? prev
        : next,
    );
  };

  const syncRef = useRef(syncPill);
  useLayoutEffect(() => {
    syncRef.current = syncPill;
  });

  const keysSignature = items.map((item) => item.key).join("|");
  useLayoutEffect(() => {
    syncRef.current();
  }, [value, keysSignature]);

  useLayoutEffect(() => {
    const handleResize = () => syncRef.current();
    window.addEventListener("resize", handleResize);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && trackRef.current) {
      observer = new ResizeObserver(() => syncRef.current());
      observer.observe(trackRef.current);
    }
    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className={className}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        gap: 4,
        padding: 4,
        overflow: "hidden",
        ...trackStyle,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: pill.top,
          left: 0,
          width: pill.width,
          height: pill.height,
          transform: `translateX(${pill.left}px)`,
          opacity: pill.ready ? 1 : 0,
          transition:
            "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 180ms ease, height 180ms ease, opacity 120ms ease",
          pointerEvents: "none",
          ...pillStyle,
        }}
      >
        {gloss && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              left: "50%",
              width: "72%",
              height: 12,
              transform: "translateX(-50%)",
              borderRadius: 999,
              background: "linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0.04))",
            }}
          />
        )}
      </div>

      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            ref={(node) => {
              itemRefs.current[item.key] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={item.testId}
            onClick={() => onChange(item.key)}
            haptic={haptic}
            pressedScale={pressedScale}
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              ...(itemStyle ? itemStyle(active) : null),
            }}
          >
            {typeof item.content === "function" ? item.content(active) : item.content}
          </Pressable>
        );
      })}
    </div>
  );
}
