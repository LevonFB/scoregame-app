-- 0128: boost refund sweep for postponed/cancelled matches queries boost_usage
-- by day alone (refundBoostsForPostponedMatches). The table's PK is
-- (user_id, day), so a day-only filter would full-scan; this index keeps the
-- per-cron sweep at a handful of rows read. No data impact.
CREATE INDEX IF NOT EXISTS idx_boost_usage_day ON boost_usage (day);
