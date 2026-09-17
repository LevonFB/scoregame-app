import { Pressable } from "@/app/components/ui/Pressable";

const ACCENT = "#ff8a3c";

export function SaveSubmitBar({
  canEdit,
  canSubmit,
  isSubmitted,
  saving,
  dirty,
  onSave,
  onSubmit,
  // Table and awards are confirmed separately, so each bar names what it confirms.
  saveLabel = "Сохранить",
  submitLabel,
  hint,
}: {
  canEdit: boolean;
  canSubmit: boolean;
  isSubmitted: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onSubmit: () => void;
  saveLabel?: string;
  submitLabel?: string;
  hint?: string;
}) {
  const submitText = submitLabel || (isSubmitted ? "Подтвердить заново" : "Подтвердить");
  if (!canEdit) {
    return (
      <div style={barStyle(false)}>
        <div style={lockedStyle}>Дедлайн прошёл, ответы заблокированы.</div>
      </div>
    );
  }

  return (
    <div style={barStyle(dirty)}>
      {dirty && (
        <div style={dirtyHintStyle}>несохранённые изменения</div>
      )}
      {!dirty && hint && (
        <div style={plainHintStyle}>{hint}</div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Pressable
          onClick={onSave}
          disabled={saving}
          haptic="light"
          aria-label={`${saveLabel} как черновик`}
          style={secondaryButtonStyle}
        >
          {saving ? "…" : saveLabel}
        </Pressable>
        <Pressable
          onClick={onSubmit}
          disabled={!canSubmit || saving}
          haptic="success"
          aria-label={submitText}
          aria-disabled={!canSubmit || saving}
          style={canSubmit ? primaryButtonStyle : disabledButtonStyle}
        >
          {submitText}
        </Pressable>
      </div>
    </div>
  );
}

function barStyle(dirty: boolean) {
  return {
    borderRadius: 18,
    padding: "10px 10px",
    background: "linear-gradient(180deg, color-mix(in srgb, var(--tg-secondary-bg) 90%, var(--tg-bg)), color-mix(in srgb, var(--tg-bg) 84%, var(--tg-secondary-bg)))",
    border: dirty
      ? "1px solid color-mix(in srgb, #ffb020 44%, var(--tg-hint))"
      : "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
    boxShadow: dirty
      ? "0 8px 20px color-mix(in srgb, #ffb020 14%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)"
      : "0 7px 18px color-mix(in srgb, var(--tg-text) 10%, transparent), inset 0 1px 0 color-mix(in srgb, var(--tg-text) 6%, transparent)",
  } as const;
}

const primaryButtonStyle = {
  flex: 1,
  minHeight: 42,
  borderRadius: 13,
  border: `1px solid color-mix(in srgb, ${ACCENT} 68%, var(--tg-text))`,
  background: `linear-gradient(180deg, color-mix(in srgb, ${ACCENT} 24%, var(--tg-bg)), color-mix(in srgb, ${ACCENT} 14%, var(--tg-secondary-bg)))`,
  color: `color-mix(in srgb, ${ACCENT} 76%, var(--tg-text))`,
  boxShadow: `0 3px 14px color-mix(in srgb, ${ACCENT} 17%, transparent)`,
  fontSize: 14,
  fontWeight: 950,
  cursor: "pointer",
  letterSpacing: 0,
} as const;

const secondaryButtonStyle = {
  minHeight: 42,
  minWidth: 90,
  borderRadius: 13,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 14%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  color: "color-mix(in srgb, var(--tg-text) 75%, var(--tg-hint))",
  fontSize: 13,
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
  letterSpacing: 0,
} as const;

const disabledButtonStyle = {
  ...primaryButtonStyle,
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 62%, var(--tg-bg))",
  color: "var(--tg-hint)",
  boxShadow: "none",
  cursor: "not-allowed",
} as const;

const lockedStyle = {
  minHeight: 40,
  borderRadius: 13,
  padding: "0 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "color-mix(in srgb, var(--tg-secondary-bg) 70%, var(--tg-bg))",
  border: "1px solid color-mix(in srgb, var(--tg-hint) 12%, transparent)",
  color: "color-mix(in srgb, var(--tg-text) 60%, var(--tg-hint))",
  fontSize: 13,
  fontWeight: 850,
  textAlign: "center",
} as const;

const plainHintStyle = {
  fontSize: 11,
  fontWeight: 750,
  color: "var(--tg-hint)",
  textAlign: "center",
  marginBottom: 6,
  letterSpacing: "0.02em",
} as const;

const dirtyHintStyle = {
  fontSize: 11,
  fontWeight: 800,
  color: "color-mix(in srgb, #ffb020 82%, var(--tg-text))",
  textAlign: "center",
  marginBottom: 6,
  letterSpacing: "0.02em",
} as const;
