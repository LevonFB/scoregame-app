-- Cases system: inventory + history

-- User case inventory (how many free/paid cases user has)
CREATE TABLE IF NOT EXISTS user_cases (
  user_id   INTEGER NOT NULL,
  case_type TEXT    NOT NULL,  -- 'daily_free' | 'premium'
  quantity  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, case_type)
);

-- Case opening history (idempotency via unique open_id)
CREATE TABLE IF NOT EXISTS case_opens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  open_id      TEXT    NOT NULL UNIQUE,  -- UUID for idempotency
  user_id      INTEGER NOT NULL,
  case_type    TEXT    NOT NULL,          -- 'daily_free' | 'premium'
  reward_type  TEXT    NOT NULL,          -- 'stars' | 'balls' | 'extra_joker' | 'double_chance' | 'extra_league'
  reward_amount INTEGER NOT NULL DEFAULT 1,
  balls_spent  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_opens_user ON case_opens(user_id, created_at DESC);

-- Seed: give every existing user 1 free daily case to start
INSERT OR IGNORE INTO user_cases (user_id, case_type, quantity)
  SELECT id, 'daily_free', 1 FROM users;
