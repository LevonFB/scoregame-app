-- Stage 1 E2E (bot-worker) — minimal local schema. Test-only.
-- Only the tables the scheduled() control flow touches at default flags with
-- USER_NOTIFICATIONS_ENABLED=false. Other queries are wrapped in try/catch.

CREATE TABLE IF NOT EXISTS maintenance_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT,
  message         TEXT,
  dispatched_at   INTEGER,
  dispatched_count INTEGER,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS bot_users (
  user_id INTEGER PRIMARY KEY,
  chat_id INTEGER,
  active  INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reminder_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT,
  user_id INTEGER,
  kind    TEXT,
  sent_at INTEGER
);
