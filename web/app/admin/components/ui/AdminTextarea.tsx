"use client";

import { useId, type ReactNode, type TextareaHTMLAttributes } from "react";

type AdminTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  minRows?: number;
  fullWidth?: boolean;
};

export function AdminTextarea({
  id,
  label,
  description,
  error,
  minRows = 4,
  fullWidth = true,
  className = "",
  disabled,
  ...props
}: AdminTextareaProps) {
  const generatedId = useId();
  const textareaId = id || generatedId;
  const descriptionId = description ? `${textareaId}-description` : undefined;
  const errorId = error ? `${textareaId}-error` : undefined;

  return (
    <div className={fullWidth ? "w-full" : "inline-flex flex-col"} data-admin-ui="textarea">
      {label && <label htmlFor={textareaId} className="mb-1.5 block text-[12px] font-extrabold leading-tight text-[var(--tg-theme-text-color,var(--tg-text,#fff))]">{label}</label>}
      {description && <div id={descriptionId} className="mb-2 text-[11.5px] font-semibold leading-snug text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]">{description}</div>}
      <textarea
        {...props}
        id={textareaId}
        disabled={disabled}
        rows={props.rows ?? minRows}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
        className={[
          "w-full resize-y rounded-2xl border px-3 py-3 text-[16px] font-semibold leading-relaxed outline-none sm:text-[14px]",
          "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_78%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
          "text-[var(--tg-theme-text-color,var(--tg-text,#fff))] placeholder:text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))]",
          error ? "border-[color-mix(in_srgb,#ff5a52_55%,transparent)]" : "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_18%,transparent)]",
          disabled ? "opacity-55" : "",
          className,
        ].filter(Boolean).join(" ")}
      />
      {error && <div id={errorId} role="alert" className="mt-1.5 text-[11.5px] font-bold leading-snug text-[color-mix(in_srgb,#ff5a52_88%,var(--tg-theme-text-color,var(--tg-text,#fff)))]">{error}</div>}
    </div>
  );
}
