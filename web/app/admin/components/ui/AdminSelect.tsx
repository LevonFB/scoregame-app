"use client";

import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

export interface AdminSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type AdminSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "onChange"> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  options: AdminSelectOption[];
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  fullWidth?: boolean;
};

export function AdminSelect({
  id,
  label,
  description,
  error,
  options,
  placeholder,
  value,
  onChange,
  fullWidth = true,
  className = "",
  disabled,
  ...props
}: AdminSelectProps) {
  const generatedId = useId();
  const selectId = id || generatedId;
  const descriptionId = description ? `${selectId}-description` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className={fullWidth ? "w-full" : "inline-flex flex-col"} data-admin-ui="select">
      {label && <label htmlFor={selectId} className="mb-1.5 block text-[12px] font-extrabold leading-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{label}</label>}
      {description && <div id={descriptionId} className="mb-2 text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{description}</div>}
      <div className="relative">
        <select
          {...props}
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          className={[
            "min-h-11 w-full appearance-none rounded-2xl border py-2.5 pl-3 pr-10 text-[16px] font-bold outline-none sm:text-[14px]",
            "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_78%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
            "text-[var(--tg-theme-text-color,var(--tg-text,#fff))] disabled:opacity-55",
            error ? "border-[color-mix(in_srgb,#ff5a52_55%,transparent)]" : "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_18%,transparent)]",
            className,
          ].filter(Boolean).join(" ")}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] font-black text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">v</span>
      </div>
      {error && <div id={errorId} role="alert" className="mt-1.5 text-[11.5px] font-bold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,var(--tg-text,#fff)))]">{error}</div>}
    </div>
  );
}
