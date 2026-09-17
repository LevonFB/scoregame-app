-- 0043_user_nicknames_privacy.sql
-- Public nickname + avatar privacy settings for in-app user identity.

ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_normalized TEXT;
ALTER TABLE users ADD COLUMN avatar_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN nickname_updated_at TEXT;

-- Backfill deterministic safe nicknames for legacy users.
UPDATE users
SET nickname = COALESCE(NULLIF(TRIM(nickname), ''), 'Player' || LOWER(HEX(id))),
    nickname_normalized = COALESCE(NULLIF(TRIM(nickname_normalized), ''), LOWER('player' || HEX(id))),
    nickname_updated_at = COALESCE(nickname_updated_at, datetime('now'))
WHERE nickname IS NULL
   OR TRIM(nickname) = ''
   OR nickname_normalized IS NULL
   OR TRIM(nickname_normalized) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_normalized_unique
  ON users(nickname_normalized)
  WHERE nickname_normalized IS NOT NULL
    AND nickname_normalized != '';
