"use client";

import type { ReactNode } from "react";
import { Pressable } from "./Pressable";

export function BottomSheet({
  children,
  maxHeight = "84vh",
  onClose,
  title,
}: {
  children: ReactNode;
  maxHeight?: string;
  onClose: () => void;
  title: ReactNode;
}) {
  return (
    <div
      className="sg-backdrop"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 9999,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        className="sg-sheet"
        onClick={(event) => event.stopPropagation()}
        style={{
          background: "linear-gradient(180deg, var(--tg-bg, #fff), color-mix(in srgb, var(--tg-bg, #fff) 94%, #000 6%))",
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          width: "100%",
          maxHeight,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -24px 52px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 44,
            height: 5,
            borderRadius: 999,
            background: "rgba(128,128,128,0.28)",
            margin: "9px auto 2px",
            flex: "0 0 auto",
          }}
        />
        <div
          style={{
            padding: "12px 18px 14px",
            borderBottom: "1px solid var(--tg-separator, rgba(128,128,128,0.12))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flex: "0 0 auto",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--tg-text)", minWidth: 0 }}>
            {title}
          </div>
          <Pressable
            aria-label="Close"
            haptic="light"
            onClick={onClose}
            pressedScale={0.9}
            style={{
              background: "rgba(128,128,128,0.12)",
              border: "1px solid rgba(128,128,128,0.08)",
              width: 34,
              height: 34,
              borderRadius: 17,
              color: "var(--tg-hint)",
              fontSize: 18,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 auto",
            }}
          >
            x
          </Pressable>
        </div>
        <div style={{ overflowY: "auto", padding: 16, flex: 1, WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
