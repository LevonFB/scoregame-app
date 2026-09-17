-- 0082_match_source_rules_last_tested.sql
-- Adds a single diagnostic timestamp updated by the manual "test source" action (M3).
--
-- This is the ONLY write the M3 test endpoint performs to match_source_rules, and it
-- touches no game data. The column is optional: the test endpoint updates it on a
-- best-effort basis and still returns a preview if this migration has not been applied.

ALTER TABLE match_source_rules ADD COLUMN last_tested_at TEXT;
