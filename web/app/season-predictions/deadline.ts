// Human-readable deadline info for tournament hero cards: absolute date + time left.

export function formatTimeLeft(diffSeconds: number): string {
  const d = Math.floor(diffSeconds / 86400);
  const h = Math.floor((diffSeconds % 86400) / 3600);
  const m = Math.floor((diffSeconds % 3600) / 60);
  if (d >= 7) return `${d} дн.`;
  if (d >= 1) return h > 0 ? `${d} дн. ${h} ч` : `${d} дн.`;
  if (h >= 1) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  return `${Math.max(1, m)} мин`;
}

export function formatDeadlineDate(deadline: number): string {
  const date = new Date(deadline * 1000).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
  return `${date} МСК`;
}

export type DeadlineLine = { text: string; urgent: boolean; passed: boolean };

// null deadline → null (nothing to show). urgent = less than 24h left.
export function deadlineLine(deadline: number | null | undefined, label = "Дедлайн"): DeadlineLine | null {
  if (!deadline) return null;
  const now = Math.floor(Date.now() / 1000);
  const date = formatDeadlineDate(deadline);
  if (now >= deadline) {
    return { text: `${label} прошёл · ${date}`, urgent: false, passed: true };
  }
  const left = deadline - now;
  return {
    text: `${label} ${date} · осталось ${formatTimeLeft(left)}`,
    urgent: left < 24 * 3600,
    passed: false,
  };
}
