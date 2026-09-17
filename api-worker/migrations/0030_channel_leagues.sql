-- Migration 0030: Channel Leagues Support
-- =========================================

-- 1. Add type column to leagues (private | channel)
ALTER TABLE leagues ADD COLUMN type TEXT NOT NULL DEFAULT 'private';

-- 2. Add channel-specific fields to leagues
ALTER TABLE leagues ADD COLUMN telegram_chat_id INTEGER DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN telegram_chat_title TEXT DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN telegram_chat_username TEXT DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN telegram_chat_photo_url TEXT DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN bind_verified_at INTEGER DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN bind_method TEXT DEFAULT NULL;

-- 3. Unique constraint: one active channel league per telegram_chat_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_leagues_telegram_chat_unique
  ON leagues(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- 4. Pending channel bind sessions
CREATE TABLE IF NOT EXISTS pending_channel_binds (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  -- 'used' added 2026-08-05: the bind flow writes it (index.ts, complete-bind), and
  -- production's CHECK already allows it — the migration had drifted behind, so a
  -- from-scratch database would have rejected the write.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled', 'used')),
  league_name TEXT DEFAULT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  selected_chat_id INTEGER DEFAULT NULL,
  selected_chat_title TEXT DEFAULT NULL,
  selected_chat_username TEXT DEFAULT NULL,
  completed_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_binds_token ON pending_channel_binds(token);
CREATE INDEX IF NOT EXISTS idx_pending_binds_user ON pending_channel_binds(user_id, status);
