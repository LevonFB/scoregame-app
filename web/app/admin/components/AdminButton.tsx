export function AdminButton({ 
  children, 
  onClick, 
  variant = "primary", 
  disabled = false,
  className = "",
  size = "md",
  type = "button"
}: { 
  children: React.ReactNode, 
  onClick?: () => void, 
  variant?: "primary" | "secondary" | "danger" | "ghost",
  disabled?: boolean,
  className?: string,
  size?: "sm" | "md" | "lg",
  type?: "button" | "submit" | "reset"
}) {
  let background = "transparent";
  let color = "var(--tg-text)";
  let padding = "12px 16px";
  let borderRadius = 12;

  if (variant === "primary") {
    background = "var(--tg-button, #007aff)";
    color = "var(--tg-button-text, #ffffff)";
  } else if (variant === "secondary") {
    background = "var(--tg-secondary-bg, rgba(128,128,128,0.1))";
    color = "var(--tg-text, #ffffff)";
  } else if (variant === "danger") {
    background = "rgba(255,59,48,0.1)";
    color = "#ff3b30";
  } else if (variant === "ghost") {
    background = "transparent";
    color = "var(--tg-link, #007aff)";
  }

  if (size === "sm") {
    padding = "8px 12px";
    borderRadius = 10;
  } else if (size === "lg") {
    padding = "16px 20px";
    borderRadius = 16;
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`font-semibold flex items-center justify-center transition-all ${className}`}
      style={{
        background,
        color,
        padding,
        borderRadius,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        outline: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {children}
    </button>
  );
}
