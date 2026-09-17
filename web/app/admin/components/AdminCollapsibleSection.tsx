"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

// Read the persisted open/closed state (lazy useState initializer — runs once,
// no effect, no SSR mismatch since admin tabs render client-side after auth).
function initialOpen(storageKey: string | undefined, defaultOpen: boolean): boolean {
  if (storageKey && typeof window !== "undefined") {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === "1") return true;
    if (saved === "0") return false;
  }
  return defaultOpen;
}

// Reusable collapsible admin section: clickable header (title + optional
// description + badge + rightContent) and a chevron. Collapsed state is persisted
// in localStorage when `storageKey` is given (survives reloads). Children are only
// mounted while open, so heavy lists don't render when collapsed.
export function AdminCollapsibleSection({
  title,
  description,
  badge,
  rightContent,
  defaultOpen = false,
  forceOpen = false,
  keepMounted = false,
  storageKey,
  children,
}: {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  rightContent?: ReactNode;
  defaultOpen?: boolean;
  // Open on mount regardless of persisted/default state (e.g. a validation error
  // needs attention). The admin can still collapse it manually afterwards.
  forceOpen?: boolean;
  // Keep children mounted while collapsed (hidden via CSS). Use for sections that
  // hold form state / heavy widgets (dnd-kit, draft editors) so collapsing never
  // loses input. Default false (unmount) for cheap/stateless or lifted-state lists.
  keepMounted?: boolean;
  storageKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => forceOpen || initialOpen(storageKey, defaultOpen));

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      }
      return next;
    });
  }

  return (
    <div style={cardStyle}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={headerStyle}
        className="admin-collapsible-header"
      >
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={titleStyle}>{title}</span>
            {badge}
          </span>
          {description && <span style={descriptionStyle}>{description}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {rightContent}
          <span style={{ ...chevronStyle, transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
        </span>
      </button>
      {keepMounted
        ? <div style={{ ...bodyStyle, display: open ? undefined : "none" }}>{children}</div>
        : open && <div style={bodyStyle}>{children}</div>}
      <style jsx>{`
        .admin-collapsible-header:hover {
          background: color-mix(in srgb, var(--tg-secondary-bg) 80%, var(--tg-bg));
        }
        .admin-collapsible-header:active {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}

const cardStyle: CSSProperties = {
  borderRadius: 14,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 16%, transparent)",
  background: "var(--tg-bg)",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "12px 14px",
  border: "none",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 60%, var(--tg-bg))",
  color: "var(--tg-text)",
  cursor: "pointer",
  textAlign: "left",
};

const titleStyle: CSSProperties = { fontSize: 14, fontWeight: 950, color: "var(--tg-text)" };
const descriptionStyle: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--tg-hint)", lineHeight: 1.4 };
const chevronStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  lineHeight: 1,
  color: "var(--tg-hint)",
  transition: "transform 160ms ease",
  display: "inline-block",
};
const bodyStyle: CSSProperties = { padding: "12px 14px", borderTop: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)" };
