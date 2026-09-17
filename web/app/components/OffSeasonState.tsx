import React, { useState, useEffect } from "react";

export default function OffSeasonState({ nextStartsAt }: { nextStartsAt: string | null }) {
  const [timeLeft, setTimeLeft] = useState<{ d: number; h: number; m: number } | null>(null);

  useEffect(() => {
    if (!nextStartsAt) {
      setTimeLeft(null);
      return;
    }
    const update = () => {
      const diff = new Date(nextStartsAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ d: 0, h: 0, m: 0 });
      } else {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        setTimeLeft({ d, h, m });
      }
    };
    update();
    const t = setInterval(update, 1000 * 60); // update every minute
    return () => clearInterval(t);
  }, [nextStartsAt]);

  return (
    <div style={{
      margin: "20px 16px",
      padding: "32px 20px",
      textAlign: "center",
      background: "var(--tg-bg, #ffffff)",
      borderRadius: 16,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🏁</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px", color: "var(--tg-text, #000)" }}>
        Сезон завершён
      </h2>
      <p style={{ margin: "0 0 24px", opacity: 0.7, fontSize: 15, color: "var(--tg-text, #000)" }}>
        Текущий сезон завершён.
      </p>

      {timeLeft ? (
        <div style={{
          background: "var(--tg-secondary-bg, #f2f2f7)",
          padding: "16px",
          borderRadius: 12,
          marginBottom: 16
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.6, marginBottom: 8, textTransform: "uppercase", color: "var(--tg-text, #000)" }}>
            Новый сезон начнётся через:
          </div>
          <div style={{
            display: "flex", justifyContent: "center", gap: 8, fontSize: 24, fontWeight: 800, fontFamily: "monospace", color: "var(--tg-text, #000)"
          }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span>{timeLeft.d}</span>
              <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 500, fontFamily: "sans-serif" }}>ДН</span>
            </div>
            <span>:</span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span>{String(timeLeft.h).padStart(2, "0")}</span>
              <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 500, fontFamily: "sans-serif" }}>ЧАС</span>
            </div>
            <span>:</span>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span>{String(timeLeft.m).padStart(2, "0")}</span>
              <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 500, fontFamily: "sans-serif" }}>МИН</span>
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: "var(--tg-secondary-bg, #f2f2f7)",
          padding: "16px",
          borderRadius: 12,
          marginBottom: 16
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--tg-text, #000)" }}>
            Новый сезон скоро начнётся ⏳
          </div>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13, opacity: 0.6, lineHeight: 1.4, color: "var(--tg-text, #000)" }}>
        После старта нового сезона здесь появятся новые матчи для прогнозов.
      </p>
    </div>
  );
}
