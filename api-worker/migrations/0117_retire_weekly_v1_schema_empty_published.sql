-- Migration 0117: finish retiring the Weekly Challenge V1 task schema.
--
-- Follow-up to 0116. 0116 only converted DRAFT V1 challenges, leaving published-but-empty
-- V1 challenges behind out of caution. The prod diagnostic showed the only remaining V1
-- rows are published yet have ZERO activity (0 entries, 0 claims) — so the real safety
-- signal (no one interacted, nothing to re-evaluate/double-emit) is satisfied regardless
-- of status.
--
-- This migration converts every V1 challenge that is still pure-empty — 0 entries AND
-- 0 claims — to V2, independent of status, assigning the default bonus_question_key when
-- absent. After this, no V1 challenge with activity can exist, so the V1 catalog + V1
-- builder branch can be removed from code.
--
-- Still LEFT UNTOUCHED (if any ever appear): a V1 challenge that has entries or claims.
-- The tail diagnostic re-checks that none remain.
--
-- Additive/idempotent: re-running is a no-op. Does NOT change reward amounts, task catalog
-- values, scoring, or any reward_ledger row.

UPDATE season_prediction_weekly_challenges
SET task_schema_version = 2,
    bonus_question_key = COALESCE(bonus_question_key, 'upset'),
    updated_at = strftime('%s', 'now')
WHERE task_schema_version = 1
  AND id NOT IN (
    SELECT DISTINCT weekly_challenge_id FROM season_prediction_weekly_challenge_entries
  )
  AND id NOT IN (
    SELECT DISTINCT weekly_challenge_id FROM weekly_challenge_task_claims
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC (run manually). After this migration v1_remaining MUST be 0 unless a V1
-- challenge with real activity exists (which would be a genuine blocker for code removal).
--
--   wrangler d1 execute scoregame_db --remote --command "
--     SELECT
--       COUNT(*) AS v1_remaining,
--       SUM(CASE WHEN id IN (SELECT weekly_challenge_id FROM season_prediction_weekly_challenge_entries) THEN 1 ELSE 0 END) AS v1_with_entries,
--       SUM(CASE WHEN id IN (SELECT weekly_challenge_id FROM weekly_challenge_task_claims) THEN 1 ELSE 0 END) AS v1_with_claims
--     FROM season_prediction_weekly_challenges
--     WHERE task_schema_version = 1;"
-- ─────────────────────────────────────────────────────────────────────────────
