-- 0015_achievements_state_machine.sql
-- Deterministic lifecycle for achievements:
-- pending -> confirmed -> revoked

ALTER TABLE user_achievements ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'
  CHECK (state IN ('pending', 'confirmed', 'revoked'));

ALTER TABLE user_achievements ADD COLUMN earned_at INTEGER;
ALTER TABLE user_achievements ADD COLUMN shown_at INTEGER;
ALTER TABLE user_achievements ADD COLUMN context_day TEXT;
ALTER TABLE user_achievements ADD COLUMN context_match_id TEXT;

-- Backfill existing unlocked achievements
UPDATE user_achievements
SET state = CASE
  WHEN unlocked_at IS NOT NULL THEN 'confirmed'
  ELSE 'pending'
END
WHERE state IS NULL OR state NOT IN ('pending', 'confirmed', 'revoked');

UPDATE user_achievements
SET earned_at = COALESCE(earned_at, unlocked_at)
WHERE unlocked_at IS NOT NULL;

-- Preserve toast history from legacy seen_at
UPDATE user_achievements
SET shown_at = COALESCE(shown_at, seen_at)
WHERE seen_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ua_state_shown
  ON user_achievements(user_id, state, shown_at, earned_at DESC);

CREATE INDEX IF NOT EXISTS idx_ua_context_day
  ON user_achievements(user_id, context_day);

CREATE INDEX IF NOT EXISTS idx_ua_context_match
  ON user_achievements(user_id, context_match_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ua_unique_context
  ON user_achievements(
    user_id,
    achievement_id,
    scope_target_id,
    period_key,
    COALESCE(context_day, ''),
    COALESCE(context_match_id, '')
  );
