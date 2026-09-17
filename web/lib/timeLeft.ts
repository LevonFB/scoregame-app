// Human-readable "time left" for prediction deadlines (minute precision).
export function formatTimeLeft(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} д ${hours} ч` : `${days} д`;
  if (hours > 0) return mins > 0 ? `${hours} ч ${mins} мин` : `${hours} ч`;
  return `${mins} мин`;
}
