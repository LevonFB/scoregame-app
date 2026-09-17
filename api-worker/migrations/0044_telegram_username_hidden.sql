-- Migration 0044: Add telegram_username_hidden column to users
-- Allows users to hide their Telegram @username from other users in the app.

ALTER TABLE users ADD COLUMN telegram_username_hidden INTEGER NOT NULL DEFAULT 0;
