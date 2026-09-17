"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type AdminCheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
};

export function AdminCheckbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  indeterminate = false,
  className = "",
}: AdminCheckboxProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      htmlFor={id}
      className={[
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3",
        "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_70%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
        "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_16%,transparent)]",
        disabled ? "cursor-not-allowed opacity-55" : "active:scale-[0.99]",
        className,
      ].filter(Boolean).join(" ")}
    >
      <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0">
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className={[
            "flex h-5 w-5 items-center justify-center rounded-md border text-[12px] font-black transition",
            "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_34%,transparent)] bg-[var(--tg-theme-bg-color,var(--tg-bg,#0b0f19))]",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--tg-theme-button-color,var(--tg-button,#2481cc))]",
            checked || indeterminate ? "border-transparent bg-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] text-[var(--tg-theme-button-text-color,var(--tg-button-text,#fff))]" : "",
          ].filter(Boolean).join(" ")}
        >
          {indeterminate ? "-" : checked ? "✓" : ""}
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-extrabold leading-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{label}</span>
        {description && <span className="mt-1 block text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{description}</span>}
      </span>
    </label>
  );
}
