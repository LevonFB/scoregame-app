"use client";

import type { ReactNode } from "react";
import { Pressable } from "./Pressable";

export function ActionDialog({
  cancelLabel,
  children,
  confirmDestructive = false,
  confirmLabel,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: ReactNode;
  children: ReactNode;
  confirmDestructive?: boolean;
  confirmLabel: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
}) {
  return (
    <div
      className="sg-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.56)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
      }}
    >
      <div
        className="sg-pop"
        style={{
          background: "var(--tg-theme-bg-color, #fff)",
          borderRadius: 22,
          padding: 20,
          width: "100%",
          maxWidth: 330,
          boxShadow: "0 18px 46px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.08)",
          border: "1px solid rgba(128,128,128,0.12)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 18, color: "var(--tg-theme-text-color, #000)" }}>
          {title}
        </h3>
        <div style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #888)", marginBottom: 20, lineHeight: 1.45 }}>
          {children}
        </div>
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <Pressable
            haptic="light"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 13,
              border: "none",
              background: "rgba(128,128,128,0.12)",
              color: "var(--tg-theme-text-color, #000)",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </Pressable>
          <Pressable
            haptic={confirmDestructive ? "warning" : "medium"}
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "12px 0",
              borderRadius: 13,
              border: "none",
              background: confirmDestructive ? "#ff3b30" : "var(--tg-button, #007aff)",
              color: "var(--tg-button-text, #fff)",
              fontWeight: 800,
              fontSize: 15,
              cursor: "pointer",
              boxShadow: confirmDestructive ? "0 10px 22px rgba(255,59,48,0.22)" : "0 10px 22px var(--sg-glow-button)",
            }}
          >
            {confirmLabel}
          </Pressable>
        </div>
      </div>
    </div>
  );
}
