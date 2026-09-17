-- 0129_reminder_predictions_open_optout.sql
-- Per-user opt-out for the daily "predictions open" announcement.
-- summary_enabled (0013) already gates the daily summary; this adds the matching
-- toggle for the morning announcement, which until now went to every active bot
-- user regardless of settings. DEFAULT 1 preserves current behavior for everyone;
-- the bot settings menu gains toggles for both flags.
ALTER TABLE reminder_settings ADD COLUMN predictions_open_enabled INTEGER NOT NULL DEFAULT 1;
