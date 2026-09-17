"use client";

import type { HTMLAttributes, ReactNode } from "react";

export type AdminBadgeVariant = "neutral" | "info" | "success" | "warning" | "danger" | "accent";
export type AdminBadgeSize = "sm" | "md";

type AdminBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  variant?: AdminBadgeVariant;
  size?: AdminBadgeSize;
  dot?: boolean;
};

const variantClass: Record<AdminBadgeVariant, string> = {
  neutral: "bg-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))_12%,transparent)] text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))] border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))_18%,transparent)]",
  info: "bg-[color-mix(in_srgb,var(--tg-theme-button-color,var(--tg-button,#2481cc))_13%,transparent)] text-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] border-[color-mix(in_srgb,var(--tg-theme-button-color,var(--tg-button,#2481cc))_24%,transparent)]",
  success: "bg-[color-mix(in_srgb,#34c759_14%,transparent)] text-[color-mix(in_srgb,#34c759_86%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#34c759_26%,transparent)]",
  warning: "bg-[color-mix(in_srgb,#ffb340_16%,transparent)] text-[color-mix(in_srgb,#ffb340_88%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#ffb340_28%,transparent)]",
  danger: "bg-[color-mix(in_srgb,#ff5a52_13%,transparent)] text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#ff5a52_26%,transparent)]",
  accent: "bg-[color-mix(in_srgb,var(--tg-theme-button-color,var(--tg-button,#2481cc))_18%,transparent)] text-[var(--tg-theme-text-color,var(--tg-text,#fff))] border-[color-mix(in_srgb,var(--tg-theme-button-color,var(--tg-button,#2481cc))_30%,transparent)]",
};

export function AdminBadge({
  children,
  variant = "neutral",
  size = "sm",
  dot = false,
  className = "",
  ...props
}: AdminBadgeProps) {
  return (
    <span
      {...props}
      className={[
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border font-extrabold leading-none",
        size === "sm" ? "px-2 py-1 text-[10.5px]" : "px-2.5 py-1.5 text-[11.5px]",
        variantClass[variant],
        className,
      ].filter(Boolean).join(" ")}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
