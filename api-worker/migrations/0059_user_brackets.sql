CREATE TABLE IF NOT EXISTS brackets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  deadline_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS user_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bracket_id TEXT NOT NULL,
  predictions_json TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, bracket_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (bracket_id) REFERENCES brackets(id) ON DELETE CASCADE
);

-- Insert the demo bracket
INSERT OR IGNORE INTO brackets (id, name) VALUES ('wc2026', 'FIFA World Cup 2026');
