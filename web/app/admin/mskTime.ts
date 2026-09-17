// Admin-wide Moscow-time helpers. All backend timestamps are absolute (unix
// seconds, unix millis, ISO strings, or naive SQLite "YYYY-MM-DD HH:MM:SS"
// which is UTC), and the admin UI renders and edits everything in MSK.
// Moscow has no DST, so a fixed +03:00 offset is safe.

const MSK_TZ = "Europe/Moscow";

const NAIVE_UTC_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Any backend timestamp → unix millis. Numbers below 1e12 are unix seconds. */
export function parseTsMs(value: number | string | Date | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseTsMs(Number(raw));
  const normalized = NAIVE_UTC_RE.test(raw) ? `${raw.replace(" ", "T")}Z` : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

const DEFAULT_OPTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

/** Render a timestamp as Moscow wall time with an explicit «МСК» suffix. */
export function formatMsk(
  value: number | string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = DEFAULT_OPTS,
): string {
  const ms = parseTsMs(value);
  if (ms == null) return "—";
  const text = new Date(ms).toLocaleString("ru-RU", { ...opts, timeZone: MSK_TZ }).replace(",", "");
  return `${text} МСК`;
}

/** Timestamp → "YYYY-MM-DDTHH:mm" in Moscow wall time, for datetime-local inputs. */
export function toMskInputValue(value: number | string | Date | null | undefined): string {
  const ms = parseTsMs(value);
  if (ms == null) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MSK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** datetime-local value (Moscow wall time) → unix millis. */
export function mskInputToMs(input: string): number | null {
  const s = String(input || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}:00+03:00`);
  return Number.isFinite(ms) ? ms : null;
}
