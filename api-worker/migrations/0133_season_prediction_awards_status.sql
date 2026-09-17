-- Split the individual-awards confirmation from the league-table confirmation.
--
-- Until now `season_prediction_user_entries.status` covered BOTH sides of an entry:
-- confirming awards forced the table to be confirmed too (and the client silently
-- submitted an alphabetical default table as if it were the user's prediction).
-- Awards already have their own window (awards_open_at / awards_deadline_at), so they
-- now get their own confirmation state as well.
--
-- Data impact:
--   * every existing row gets awards_status = 'draft' by default;
--   * rows whose table was already confirmed AND that carry at least one award pick are
--     backfilled to awards_status = 'submitted', reusing the table submit timestamps —
--     this preserves today's behaviour (a submitted entry scored its awards).
-- No rows are deleted and no table_json/awards_json payload is touched.

ALTER TABLE season_prediction_user_entries ADD COLUMN awards_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE season_prediction_user_entries ADD COLUMN awards_submitted_at INTEGER;
ALTER TABLE season_prediction_user_entries ADD COLUMN awards_last_submitted_at INTEGER;

UPDATE season_prediction_user_entries
SET awards_status = 'submitted',
    awards_submitted_at = submitted_at,
    awards_last_submitted_at = last_submitted_at
WHERE status IN ('submitted', 'locked', 'scoring', 'completed')
  AND awards_json IS NOT NULL
  AND (
    json_extract(awards_json, '$.top_scorer') IS NOT NULL
    OR json_extract(awards_json, '$.top_assister') IS NOT NULL
    OR json_extract(awards_json, '$.top_assistant') IS NOT NULL
    OR json_extract(awards_json, '$.golden_glove') IS NOT NULL
  );
