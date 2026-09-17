-- 0016_achievements_pending_unlock_cleanup.sql
-- Safety cleanup: pending achievements must not be treated as unlocked.

UPDATE user_achievements
SET
  state = 'revoked',
  unlocked_at = NULL,
  earned_at = NULL,
  shown_at = COALESCE(shown_at, seen_at)
WHERE state = 'pending'
  AND unlocked_at IS NOT NULL;
