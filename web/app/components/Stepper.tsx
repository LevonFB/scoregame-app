"use client";

import { Pressable } from "./ui/Pressable";

export function Stepper({
    value,
    onChange,
    min = 0,
    max = 15,
    disabled = false,
    onPickingChange, // kept for compatibility, can be ignored or used for haptic triggers
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    disabled?: boolean;
    onPickingChange?: (v: boolean) => void;
}) {
    const handleDec = () => {
        if (disabled || value <= min) return;
        onChange(value - 1);
    };

    const handleInc = () => {
        if (disabled || value >= max) return;
        onChange(value + 1);
    };

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--tg-secondary-bg)", padding: 4, borderRadius: 12 }}>
            <Pressable
                onClick={handleDec}
                disabled={disabled || value <= min}
                haptic="selection"
                pressedScale={0.9}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "none",
                    background: "var(--tg-bg)",
                    color: "var(--tg-text)",
                    fontSize: 18,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: disabled || value <= min ? 0.3 : 1,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                }}
            >
                −
            </Pressable>

            <div key={value} className="sg-score-pop" style={{
                width: 24,
                textAlign: "center",
                fontSize: 18,
                fontWeight: 700,
                color: "var(--tg-text)"
            }}>
                {value}
            </div>

            <Pressable
                onClick={handleInc}
                disabled={disabled || value >= max}
                haptic="selection"
                pressedScale={0.9}
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "none",
                    background: "var(--tg-bg)",
                    color: "var(--tg-text)",
                    fontSize: 18,
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: disabled || value >= max ? 0.3 : 1,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                }}
            >
                +
            </Pressable>
        </div>
    );
}
