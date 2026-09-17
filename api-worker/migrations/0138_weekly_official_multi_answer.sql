-- 0138_weekly_official_multi_answer.sql
-- "Вызов недели": allow several correct answers for one question.
--
-- Why: upset-family templates (underdog_not_lose / favorite_drops_points) have no
-- auto-calculation and can legitimately have more than one right answer — e.g. two
-- favourites drop points in the same round. Until now the admin could store only a
-- single official_answer_option_id, so every other correct pick was scored wrong.
--
-- Data impact: additive column only. NULL means "legacy single-answer question" and
-- scoring falls back to official_answer_option_id, so already completed challenges
-- (week_1 and earlier) keep their exact previous results. When set, it holds a JSON
-- array of option ids, e.g. '["upset_1","upset_3"]'.

ALTER TABLE season_prediction_weekly_challenge_questions
ADD COLUMN official_answer_option_ids TEXT NULL;
