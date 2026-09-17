-- 0013_bot_reminders.sql
-- Tables for Telegram bot reminder system

-- bot_users: Links Telegram chat_id to our user system
CREATE TABLE IF NOT EXISTS bot_users (
  user_id INTEGER PRIMARY KEY,     -- matches users.id
  chat_id INTEGER NOT NULL UNIQUE, -- Telegram chat ID for sendMessage
  username TEXT,
  first_name TEXT,
  active INTEGER NOT NULL DEFAULT 1, -- 0 = bot blocked (403)
  tz TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at INTEGER NOT NULL
);

-- reminder_settings: Per-user notification preferences
CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id INTEGER PRIMARY KEY REFERENCES bot_users(user_id),
  mode TEXT NOT NULL DEFAULT 'T15',        -- OFF | T15 | T60_T15 | T60_T15_T3
  quiet_start INTEGER NOT NULL DEFAULT 23, -- hour (in user's TZ, Moscow default)
  quiet_end INTEGER NOT NULL DEFAULT 10,
  summary_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- reminder_log: Deduplication / idempotency
CREATE TABLE IF NOT EXISTS reminder_log (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  reminder_type TEXT NOT NULL,  -- T60 | T15 | T3 | JOKER | SUMMARY
  reminder_key TEXT NOT NULL,   -- e.g. '2026-02-15:T15'
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, reminder_type, reminder_key)
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_day ON reminder_log(day);
CREATE INDEX IF NOT EXISTS idx_bot_users_active ON bot_users(active);
