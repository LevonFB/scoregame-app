-- Maintenance broadcast state (singleton row, id=1)
CREATE TABLE IF NOT EXISTS maintenance_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  is_active INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  started_at INTEGER,
  ended_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0
);

-- Seed the singleton row
INSERT OR IGNORE INTO maintenance_state (id, is_active, message, updated_at) VALUES (1, 0, '', 0);

-- Broadcast dedup log
CREATE TABLE IF NOT EXISTS maintenance_log (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
