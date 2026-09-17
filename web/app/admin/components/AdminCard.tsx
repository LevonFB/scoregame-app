export function AdminCard({ 
  children, 
  className = "", 
  noPadding = false,
  onClick
}: { 
  children: React.ReactNode, 
  className?: string, 
  noPadding?: boolean,
  onClick?: () => void 
}) {
  return (
    <div 
      className={`relative overflow-hidden transition-opacity ${onClick ? "cursor-pointer active:opacity-70" : ""} ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      style={{
        background: "var(--tg-bg)",
        borderRadius: 16,
        padding: noPadding ? 0 : 16,
        color: "var(--tg-text)"
      }}
    >
      {children}
    </div>
  );
}
