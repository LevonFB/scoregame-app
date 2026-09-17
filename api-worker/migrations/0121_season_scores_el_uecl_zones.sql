-- 0121: per-team zone-correct counters for the Europa League (ЛЕ) and Conference
-- League (ЛК) zones in top-5 league scoring — mirrors the existing ucl_zone_* /
-- relegation_zone_* columns. Used by the "Угадать зону ЛЕ/ЛК" tasks. Purely additive
-- reporting metrics; scoring POINTS are unchanged. Existing rows default to 0 until
-- the next top-5 recalc repopulates them.

ALTER TABLE season_prediction_user_scores ADD COLUMN europa_zone_correct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_prediction_user_scores ADD COLUMN europa_zone_full INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_prediction_user_scores ADD COLUMN conference_zone_correct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE season_prediction_user_scores ADD COLUMN conference_zone_full INTEGER NOT NULL DEFAULT 0;
