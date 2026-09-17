// ISO-8601 week key (YYYY-Wnn) for an app day key (YYYY-MM-DD).
// The backend validates this exact format (/^\d{4}-W\d{2}$/) and parses it in
// getWeekWindowUtc, so every leaderboard surface must build week periods here.
export function getWeekKeyForDay(day: string): string {
    const [yearRaw, monthRaw, dateRaw] = String(day || "").split("-").map(Number);
    const base = new Date(Date.UTC(yearRaw, (monthRaw || 1) - 1, dateRaw || 1));
    base.setUTCHours(0, 0, 0, 0);
    base.setUTCDate(base.getUTCDate() + 4 - (base.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(base.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((base.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${base.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
