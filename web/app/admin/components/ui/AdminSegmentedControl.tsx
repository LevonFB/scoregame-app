"use client";

export interface AdminSegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  badge?: string | number;
}

type AdminSegmentedControlProps<T extends string> = {
  value: T;
  options: AdminSegmentOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  fullWidth?: boolean;
  scrollable?: boolean;
  ariaLabel: string;
  className?: string;
};

export function AdminSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  fullWidth = true,
  scrollable = true,
  ariaLabel,
  className = "",
}: AdminSegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        "flex gap-1 rounded-2xl border p-1",
        "bg-[color-mix(in_srgb,var(--tg-theme-secondary-bg-color,var(--tg-secondary-bg,#111827))_78%,var(--tg-theme-bg-color,var(--tg-bg,#0b0f19)))]",
        "border-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_16%,transparent)]",
        scrollable ? "overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "flex-wrap",
        fullWidth ? "w-full" : "inline-flex",
        className,
      ].filter(Boolean).join(" ")}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={[
              "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border font-extrabold transition focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] disabled:pointer-events-none disabled:opacity-45",
              size === "sm" ? "min-h-8 px-2.5 text-[11.5px]" : "min-h-10 px-3 text-[12.5px]",
              active
                ? "border-transparent bg-[var(--tg-theme-button-color,var(--tg-button,#2481cc))] text-[var(--tg-theme-button-text-color,var(--tg-button-text,#fff))] shadow-sm"
                : "border-transparent text-[var(--tg-theme-hint-color,var(--tg-hint,#9ca3af))] hover:bg-[color-mix(in_srgb,var(--tg-theme-hint-color,var(--tg-hint,#8a8a8a))_9%,transparent)]",
            ].join(" ")}
          >
            <span>{option.label}</span>
            {option.badge !== undefined && (
              <span className="rounded-full bg-[color-mix(in_srgb,currentColor_15%,transparent)] px-1.5 py-0.5 text-[10px] leading-none">
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
