CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT
);

CREATE TABLE IF NOT EXISTS picks (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  joker INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, match_id, user_id)
);

CREATE TABLE IF NOT EXISTS results (
  day TEXT NOT NULL,
  match_id TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  finalized_at INTEGER NOT NULL,
  PRIMARY KEY (day, match_id)
);
