"use client";

import { SegmentedControl } from "./ui/SegmentedControl";

function getRelativeDateLabel(offset: number, weekday: number) {
  if (offset === -1) return "Вчера";
  if (offset === 0) return "Сегодня";
  if (offset === 1) return "Завтра";
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  return weekdays[weekday] || "";
}

export function DateSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const dates: { key: string; label: string; dayNum: number }[] = [];
  const today = new Date();

  for (let i = -2; i <= 3; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dayStr = String(d.getDate()).padStart(2, "0");
    dates.push({
      key: `${y}-${m}-${dayStr}`,
      label: getRelativeDateLabel(i, d.getDay()),
      dayNum: d.getDate(),
    });
  }

  return (
    <div style={{ position: "relative", marginBottom: 10 }}>
      <SegmentedControl
        value={value}
        onChange={onChange}
        ariaLabel="Дата матчей"
        gloss
        pressedScale={0.94}
        trackStyle={{
          gap: 4,
          padding: 6,
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.025)",
        }}
        pillStyle={{
          borderRadius: 18,
          background: "linear-gradient(180deg, var(--tg-button, #2ea6ff), var(--tg-button, #2ea6ff))",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow:
            "0 10px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -8px 16px rgba(255,255,255,0.04)",
        }}
        itemStyle={(active) => ({
          flexDirection: "column",
          gap: 2,
          height: 58,
          padding: "4px 2px",
          borderRadius: 18,
          color: active ? "var(--tg-button-text)" : "var(--tg-text)",
          transition: "color 180ms ease, opacity 180ms ease",
        })}
        items={dates.map((d) => {
          const isToday = d.label === "Сегодня";
          return {
            key: d.key,
            content: (active: boolean) => (
              <>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.2,
                    lineHeight: 1,
                    textTransform: "uppercase",
                    opacity: active ? 1 : 0.56,
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.label}
                </span>

                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    lineHeight: 1,
                  }}
                >
                  {d.dayNum}
                </span>

                {isToday && !active && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: 7,
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--tg-button)",
                      opacity: 0.9,
                    }}
                  />
                )}
              </>
            ),
          };
        })}
      />
    </div>
  );
}
