-- 0119: minimal user ban support.
-- Data impact: adds three nullable/default columns to `users`; no rows are
-- modified. Banned users are rejected at auth level (requireTelegramUser).
ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN banned_at TEXT;
ALTER TABLE users ADD COLUMN ban_reason TEXT;
