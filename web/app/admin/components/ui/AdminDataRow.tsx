"use client";

import type { ReactNode } from "react";

type AdminDataRowProps = {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  stackedOnMobile?: boolean;
  className?: string;
};

export function AdminDataRow({
  label,
  value,
  description,
  icon,
  badge,
  stackedOnMobile = true,
  className = "",
}: AdminDataRowProps) {
  return (
    <div
      className={[
        "flex gap-3 rounded-2xl border p-3",
        stackedOnMobile ? "flex-col sm:flex-row sm:items-center sm:justify-between" : "items-center justify-between",
        "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_62%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
        "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_14%,transparent)]",
        className,
      ].filter(Boolean).join(" ")}
    >
      <div className="flex min-w-0 items-start gap-2">
        {icon && <span className="mt-0.5 shrink-0 text-[14px] text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{icon}</span>}
        <div className="min-w-0">
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{label}</div>
          {description && <div className="mt-1 text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{description}</div>}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-left sm:justify-end sm:text-right">
        <div className="min-w-0 break-words text-[13px] font-extrabold leading-snug text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{value}</div>
        {badge}
      </div>
    </div>
  );
}
