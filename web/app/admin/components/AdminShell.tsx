import React from 'react';

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      // sg-selectable снимает запрет выделения: в Telegram на iOS текст
      // выделяется только там, где страница разрешила это явно.
      className="sg-selectable"
      style={{
        width: "100%",
        height: "var(--sg-viewport-height, 100dvh)",
        minHeight: 0,
        overflowX: "clip",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
        touchAction: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: "calc(8rem + env(safe-area-inset-bottom, 0px))",
        background: "var(--tg-theme-secondary-bg-color, #000000)",
        color: "var(--tg-theme-text-color, #ffffff)"
      }}
    >
      <div style={{ maxWidth: "56rem", marginLeft: "auto", marginRight: "auto", paddingLeft: "1rem", paddingRight: "1rem", paddingTop: "1rem", paddingBottom: "3rem", width: "100%" }}>
        {children}
      </div>
    </div>
  );
}
