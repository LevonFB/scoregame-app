ALTER TABLE match_bonus_questions ADD COLUMN question_text TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN answer_options_json TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN target_player_id TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN target_player_name TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN auto_resolve INTEGER NOT NULL DEFAULT 1;
ALTER TABLE match_bonus_questions ADD COLUMN metadata_json TEXT;
