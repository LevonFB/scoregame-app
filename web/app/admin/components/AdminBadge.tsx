export function AdminBadge({ 
  children, 
  variant = "info",
  className = ""
}: { 
  children: React.ReactNode, 
  variant?: "info" | "success" | "warning" | "danger" | "default" | "solid",
  className?: string
}) {
  let style: React.CSSProperties = {};
  
  if (variant === "success") {
    style = { background: "#34c759", color: "#fff" };
  } else if (variant === "solid") {
    style = { background: "var(--tg-theme-text-color, #fff)", color: "var(--tg-theme-bg-color, #000)" };
  } else if (variant === "info") {
    style = { background: "rgba(0,122,255,0.1)", color: "#007aff" };
  } else if (variant === "warning") {
    style = { background: "#ffcc00", color: "#000" };
  } else if (variant === "danger") {
    style = { background: "rgba(255,59,48,0.1)", color: "#ff3b30" };
  } else {
    style = { background: "var(--tg-theme-hint-color, rgba(128,128,128,0.1))", color: "var(--tg-theme-text-color, #fff)" };
  }

  return (
    <div 
      className={`px-2 py-0.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
