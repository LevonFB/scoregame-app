"use client";
import { useEffect, useRef } from "react";

export function AdminTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (tab: T) => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Keep the active tab fully visible: scroll it toward the center of the
  // horizontal strip whenever `active` changes. Client-only (useEffect), guarded
  // against a null ref — no SSR/hydration impact, no static-export issue.
  // `block: "nearest"` keeps the vertical page position untouched, so this never
  // scrolls the whole page, only the tab strip.
  useEffect(() => {
    const btn = activeRef.current;
    if (!btn) return;
    btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div style={{ padding: "0 16px" }}>
      <div
        // Scrollbar hidden visually (all engines) but horizontal scroll/swipe stays.
        className="[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          padding: 4,
          background: "var(--tg-secondary-bg)",
          borderRadius: 12,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-x pan-y",
          scrollPadding: "0 8px",
        }}
      >
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              data-testid={`admin-tab-${t.key}`}
              ref={isActive ? activeRef : undefined}
              onClick={() => onChange(t.key)}
              aria-current={isActive ? "page" : undefined}
              style={{
                flexShrink: 0,
                minHeight: 40,
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: isActive ? "var(--tg-bg)" : "transparent",
                color: isActive ? "var(--tg-text)" : "var(--tg-hint)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                whiteSpace: "nowrap",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
