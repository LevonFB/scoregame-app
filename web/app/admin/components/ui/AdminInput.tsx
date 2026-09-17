"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

type AdminInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  fullWidth?: boolean;
};

export function AdminInput({
  id,
  label,
  description,
  error,
  prefix,
  suffix,
  fullWidth = true,
  className = "",
  disabled,
  readOnly,
  ...props
}: AdminInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={fullWidth ? "w-full" : "inline-flex flex-col"} data-admin-ui="input">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-[12px] font-extrabold leading-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">
          {label}
        </label>
      )}
      {description && (
        <div id={descriptionId} className="mb-2 text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">
          {description}
        </div>
      )}
      <div className={[
        "flex min-h-11 items-center gap-2 rounded-2xl border px-3",
        "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_78%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
        error ? "border-[color-mix(in_srgb,#ff5a52_55%,transparent)]" : "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_18%,transparent)]",
        disabled ? "opacity-55" : "",
        readOnly ? "opacity-80" : "",
      ].filter(Boolean).join(" ")}>
        {prefix && <span className="shrink-0 text-[12px] font-bold text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{prefix}</span>}
        <input
          {...props}
          id={inputId}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          className={[
            "min-h-10 w-full min-w-0 bg-transparent text-[16px] font-semibold text-[var(--tg-theme-text-color,var(--tg-text,#fff))] outline-none",
            "placeholder:text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))] disabled:cursor-not-allowed",
            "[color-scheme:dark] sm:text-[14px]",
            className,
          ].filter(Boolean).join(" ")}
        />
        {suffix && <span className="shrink-0 text-[12px] font-bold text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{suffix}</span>}
      </div>
      {error && (
        <div id={errorId} role="alert" className="mt-1.5 text-[11.5px] font-bold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,var(--tg-text,#fff)))]">
          {error}
        </div>
      )}
    </div>
  );
}
