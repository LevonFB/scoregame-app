"use client";

import type { ReactNode } from "react";

type AdminMetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  trend?: ReactNode;
  badge?: ReactNode;
  size?: "sm" | "md";
  className?: string;
};

export function AdminMetricCard({
  label,
  value,
  description,
  icon,
  trend,
  badge,
  size = "md",
  className = "",
}: AdminMetricCardProps) {
  return (
    <div
      className={[
        "min-w-0 rounded-2xl border",
        size === "sm" ? "p-3" : "p-4",
        "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_70%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
        "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)]",
        className,
      ].filter(Boolean).join(" ")}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 text-[11px] font-extrabold uppercase tracking-wide text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{label}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {badge}
          {icon && <span className="text-[15px] text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{icon}</span>}
        </div>
      </div>
      <div className={["break-words font-black leading-none text-[var(--tg-theme-text-color,var(--tg-text,#fff))]", size === "sm" ? "text-[21px]" : "text-[26px]"].join(" ")}>
        {value}
      </div>
      {(description || trend) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">
          {description && <span>{description}</span>}
          {trend && <span className="font-extrabold text-[var(--tg-theme-button-color,var(--tg-button,#2481cc))]">{trend}</span>}
        </div>
      )}
    </div>
  );
}
