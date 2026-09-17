-- Track which days have already been fully finalized, to skip redundant
-- recomputation on every cron tick.
--
-- Problem: finalizeDay() runs the entire per-user loop (updateUserStats,
-- updateUserDayStats, checkAchievements, checkDailyQuests, checkWeeklyQuests,
-- reconcileRevokedResultAchievements) for every user with a pick on the day,
-- every time it is invoked. The */15 cron path keeps calling it for days that
-- are already fully settled, re-doing identical work and driving Cloudflare D1
-- "rows read" usage far higher than necessary. This mirrors the weekly
-- finalizer drain that was already fixed by skipping already-finalized weeks.
--
-- Fix: record a fingerprint of the day's results once it is finalized. On the
-- next finalizeDay() call (non-force), if the day already has a marker whose
-- fingerprint matches the current results, skip the heavy recompute entirely.
-- A manual result correction changes the fingerprint, so corrections still
-- re-finalize the day (manual correction stays first-class). force=true always
-- bypasses the marker and refreshes it.
--
-- `fingerprint` is a canonical string of "match_id:home-away" pairs (sorted by
-- match_id, joined by '|') for the day's results — see
-- computeDayResultsFingerprint() in api-worker/src/index.ts.
--
-- SAFETY: additive only — a new table, no changes to existing schema or data,
-- no change to the scoring computation itself (which stays absolute and
-- idempotent). No backfill needed: a day without a marker simply finalizes once
-- more and then writes its marker. Fully reversible via DROP TABLE day_finalized.

CREATE TABLE IF NOT EXISTS day_finalized (
  day          TEXT PRIMARY KEY,
  fingerprint  TEXT NOT NULL,
  finalized_at INTEGER NOT NULL
);
