-- 0120: boosts as a season-prediction task reward.
-- Adds a configurable boost component (extra_joker / double_chance) to the
-- per-task reward config. Delivered as user_boosts rows via the shared idempotent
-- reward_ledger (reward_type='boost'), mirroring the Weekly Challenge task rewards.
-- Existing rows default to no boost (NULL / 0), so no behavior change until an
-- admin explicitly configures a boost reward.

ALTER TABLE season_prediction_task_reward_config ADD COLUMN boost_type TEXT;
ALTER TABLE season_prediction_task_reward_config ADD COLUMN boost_count INTEGER NOT NULL DEFAULT 0;
