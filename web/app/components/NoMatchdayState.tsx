"use client";

function formatDateLabel(date: string) {
  // selectedDate is an MSK game-day string — compare against Moscow "today",
  // not the device date, so the label stays correct across midnight boundaries.
  const todayMsk = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const diffDays = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayMsk}T00:00:00Z`)) / 86400000);

  if (diffDays === 0) return "Сегодня";
  if (diffDays === -1) return "Вчера";
  if (diffDays === 1) return "Завтра";

  return new Date(`${date}T00:00:00Z`).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export default function NoMatchdayState({
  selectedDate,
  onGoToday,
  nextDay,
  onGoNextDay,
}: {
  selectedDate: string;
  onGoToday?: () => void;
  nextDay?: string | null;
  onGoNextDay?: () => void;
}) {
  const label = formatDateLabel(selectedDate);
  const isToday = label === "Сегодня";
  // Nearest day that actually has matches — the primary way out of an empty day.
  const hasNext = !!nextDay && !!onGoNextDay;
  const nextLabel = nextDay ? formatDateLabel(nextDay).toLowerCase() : "";

  return (
    <div
      style={{
        margin: "20px 16px",
        padding: "32px 20px",
        textAlign: "center",
        background: "var(--tg-bg, #ffffff)",
        borderRadius: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          margin: "0 0 8px",
          color: "var(--tg-text, #000)",
        }}
      >
        {isToday ? "Сегодня выходной" : "Матчей нет"}
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          opacity: 0.72,
          fontSize: 15,
          lineHeight: 1.45,
          color: "var(--tg-text, #000)",
        }}
      >
        {hasNext
          ? `На «${label}» матчей для прогнозов нет. Ближайшие — ${nextLabel}.`
          : isToday
            ? "На сегодня матчей для прогнозов нет. Посмотри соседние даты."
            : `На «${label}» матчей для прогнозов нет. Выбери другой день выше.`}
      </p>

      <div
        style={{
          background: "var(--tg-secondary-bg, #f2f2f7)",
          padding: "14px 16px",
          borderRadius: 12,
          marginBottom: hasNext || !(isToday || !onGoToday) ? 14 : 0,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--tg-text, #000)",
          }}
        >
          {hasNext
            ? "Прогнозы на ближайший игровой день уже открыты."
            : isToday
              ? "Загляни завтра или открой соседние даты."
              : "Вернуться на текущий день можно одной кнопкой."}
        </div>
      </div>

      {hasNext && (
        <button
          type="button"
          onClick={onGoNextDay}
          style={{
            padding: "10px 18px",
            background: "var(--tg-button)",
            color: "var(--tg-button-text)",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Матчи {nextLabel}
        </button>
      )}

      {!isToday && !hasNext && onGoToday && (
        <button
          type="button"
          onClick={onGoToday}
          style={{
            marginTop: 14,
            padding: "10px 18px",
            background: "var(--tg-button)",
            color: "var(--tg-button-text)",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          На сегодня
        </button>
      )}
    </div>
  );
}
