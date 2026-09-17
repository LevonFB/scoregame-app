"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AdminButtonVariant = "primary" | "secondary" | "ghost" | "success" | "warning" | "danger";
export type AdminButtonSize = "sm" | "md" | "lg";

type AdminButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

const variantClass: Record<AdminButtonVariant, string> = {
  primary: "bg-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] text-[var(--tg-theme-button-text-color,var(--tg-button-text,#fff))] border-transparent shadow-[0_10px_24px_rgba(36,129,204,0.18)]",
  secondary: "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#1f2937))_82%,var(--tg-theme-bg-color,var(--tg-bg,#111827)))] text-[var(--tg-theme-text-color,var(--tg-text,#fff))] border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_22%,transparent)]",
  ghost: "bg-transparent text-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] border-transparent",
  success: "bg-[color-mix(in_srgb,#34c759_18%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] text-[color-mix(in_srgb,#34c759_82%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#34c759_30%,transparent)]",
  warning: "bg-[color-mix(in_srgb,#ffb340_18%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] text-[color-mix(in_srgb,#ffb340_82%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#ffb340_30%,transparent)]",
  danger: "bg-[color-mix(in_srgb,#ff5a52_14%,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827)))] text-[color-mix(in_srgb,#ff5a52_86%,var(--tg-theme-text-color,var(--tg-text,#fff)))] border-[color-mix(in_srgb,#ff5a52_28%,transparent)]",
};

const sizeClass: Record<AdminButtonSize, string> = {
  sm: "min-h-9 px-3 py-1.5 text-[12px] rounded-xl",
  md: "min-h-11 px-4 py-2.5 text-[13px] rounded-2xl",
  lg: "min-h-12 px-5 py-3 text-[14px] rounded-2xl",
};

export function AdminButton({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled,
  iconLeft,
  iconRight,
  type = "button",
  className = "",
  ...props
}: AdminButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 border font-extrabold leading-tight",
        "transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] focus-visible:ring-offset-2",
        "focus-visible:ring-offset-[var(--tg-theme-bg-color,var(--tg-bg,#0b0f19))]",
        "disabled:pointer-events-none disabled:opacity-55",
        "[-webkit-tap-highlight-color:transparent]",
        sizeClass[size],
        variantClass[variant],
        fullWidth ? "w-full" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {loading ? <span aria-hidden className="h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" /> : iconLeft}
      <span className="min-w-0 truncate">{children}</span>
      {iconRight}
    </button>
  );
}
