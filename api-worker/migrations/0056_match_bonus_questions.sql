CREATE TABLE IF NOT EXISTS match_bonus_questions (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'advances_team',
  is_enabled INTEGER NOT NULL DEFAULT 0,
  points_award INTEGER NOT NULL DEFAULT 1,
  correct_answer TEXT,
  resolved_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER,
  PRIMARY KEY (day, match_id, question_type)
);

CREATE INDEX IF NOT EXISTS idx_match_bonus_questions_day_enabled
  ON match_bonus_questions(day, is_enabled);

CREATE TABLE IF NOT EXISTS pick_bonus_answers (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'advances_team',
  answer TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, match_id, user_id, question_type)
);

CREATE INDEX IF NOT EXISTS idx_pick_bonus_answers_user_day
  ON pick_bonus_answers(user_id, day);
