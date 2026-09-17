-- 0105_season_prediction_awards_window.sql
-- Individual-awards (top scorer / assister / golden glove) get their OWN prediction
-- window, independent from the league-table deadline. This lets awards open later
-- and/or stay open after the table has already locked.
--
-- Both columns are nullable: when NULL the awards window falls back to the tournament's
-- table deadline (deadline_at) / season deadline — i.e. existing behaviour is unchanged
-- until an admin sets a dedicated awards window.
--
-- Data impact: additive only. Existing rows get NULL for both columns (fallback path).
-- No backfill required. Only meaningful for tournament_type='top_league' (eurocups have
-- no individual awards), but the columns exist on the shared table for simplicity.

ALTER TABLE season_prediction_tournaments ADD COLUMN awards_open_at INTEGER;
ALTER TABLE season_prediction_tournaments ADD COLUMN awards_deadline_at INTEGER;
