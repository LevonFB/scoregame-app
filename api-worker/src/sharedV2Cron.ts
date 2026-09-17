// Stage 16 — single shared V2 cron dispatcher.
//
// Cloudflare Free plan allows at most 5 cron triggers across all workers. We already
// use api `*/10` + `1 0` and bot `*/2` (= 3). Rather than add three separate V2 cron
// triggers (weekly `5`, partner `7`, daily `15 4`), ONE hourly trigger fans out to all
// three V2 branches. Each branch is independently feature-flagged; flag off => no D1.

/** The single extra trigger that serves all V2 scheduled work. */
export const SHARED_V2_CRON = "5 * * * *";
export function isSharedV2Cron(cron: string | undefined | null): boolean {
  return cron === SHARED_V2_CRON;
}

/**
 * Daily-case backfill runs in a fixed hour-window (04:00 UTC by default), safely after
 * the 00:00 UTC / 03:00 MSK football-day boundary, so previousMatchdayKey() points at the
 * just-completed day.
 * The per-matchday job lock then guarantees once-per-matchday even if the window
 * were wider. `hourUtc` is configurable (DAILY_CASE_BACKFILL_HOUR_UTC, default 4).
 */
export function isDailyBackfillWindow(date: Date, hourUtc: number): boolean {
  return date.getUTCHours() === hourUtc;
}
