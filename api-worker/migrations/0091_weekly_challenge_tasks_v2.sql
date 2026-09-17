-- Weekly Challenge Tasks V2 metadata.
-- Additive only: existing challenges remain task_schema_version=1.

ALTER TABLE season_prediction_weekly_challenges
ADD COLUMN task_schema_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE season_prediction_weekly_challenges
ADD COLUMN bonus_question_key TEXT NULL;

UPDATE season_prediction_weekly_challenges
SET task_schema_version = 1
WHERE task_schema_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_sp_weekly_challenges_task_schema
ON season_prediction_weekly_challenges(task_schema_version);
