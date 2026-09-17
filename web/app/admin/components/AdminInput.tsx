import React from "react";

export function AdminInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        background: "var(--tg-secondary-bg, rgba(128,128,128,0.1))",
        border: "1px solid var(--tg-separator, rgba(128,128,128,0.2))",
        borderRadius: 12,
        padding: "12px 16px",
        color: "var(--tg-text, #fff)",
        outline: "none",
        fontSize: 14,
        width: "100%",
        WebkitAppearance: "none",
        transition: "border-color 0.2s",
        ...(props.style || {})
      }}
      className={props.className || ""}
    />
  );
}
