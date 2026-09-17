-- Fortune wheel + lucky-token (Жетон) tables and seed for the lucky-token e2e.
-- Self-contained (IF NOT EXISTS) so it can be layered on top of schema.sql/seed.sql.

CREATE TABLE IF NOT EXISTS fortune_wheel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price_balls INTEGER NOT NULL DEFAULT 0,
  price_stars INTEGER NOT NULL DEFAULT 0, -- migration 0114 (star purchases)
  is_active INTEGER NOT NULL DEFAULT 1,
  allow_token_payment INTEGER NOT NULL DEFAULT 1,
  allow_balls_payment INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fortune_wheel_sectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wheel_id INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_code TEXT,
  chance_percent REAL NOT NULL,
  min_amount INTEGER,
  max_amount INTEGER,
  fixed_amount INTEGER,
  label TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS fortune_spins (
  user_id INTEGER NOT NULL PRIMARY KEY,
  quantity INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fortune_spin_opens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spin_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  sector_id INTEGER,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL DEFAULT 1,
  reward_code TEXT,
  balls_spent INTEGER NOT NULL DEFAULT 0,
  free_spin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lucky_token_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  comment TEXT,
  admin_user_id INTEGER,
  ref_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ball_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  comment TEXT,
  admin_user_id INTEGER,
  open_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Active wheel with a single deterministic sector that grants 1 ball (100%).
-- This keeps the token balance change equal to the PAYMENT only, so the test can
-- assert the lucky-token debit precisely.
INSERT OR IGNORE INTO fortune_wheel (code, title, description, price_balls, is_active, allow_token_payment, allow_balls_payment)
VALUES ('default', 'Фартовый мяч', 'e2e', 5, 1, 1, 1);

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, fixed_amount, label, sort_order, is_active)
SELECT id, 'balls', NULL, 100.0, 1, 'Мячик', 10, 1 FROM fortune_wheel WHERE code = 'default';
