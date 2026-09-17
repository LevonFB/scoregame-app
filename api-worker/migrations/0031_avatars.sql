-- Migration 0031: Avatar support for leagues and channel photos
-- ===============================================================

-- 1. Add avatar fields to leagues
ALTER TABLE leagues ADD COLUMN avatar_url TEXT DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN avatar_type TEXT DEFAULT NULL;
ALTER TABLE leagues ADD COLUMN avatar_updated_at INTEGER DEFAULT NULL;

-- 1b. users.photo_url — Telegram avatar. Production got it outside migrations; added
-- here 2026-08-05 so a from-scratch build matches. 0031 is recorded as applied in
-- production, so this ALTER only runs on a fresh database.
ALTER TABLE users ADD COLUMN photo_url TEXT;

-- 2. Add photo_url to pending_channel_binds
ALTER TABLE pending_channel_binds ADD COLUMN selected_chat_photo_url TEXT DEFAULT NULL;
