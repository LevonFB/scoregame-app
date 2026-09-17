-- Migration 0116: retire the Weekly Challenge V1 task schema.
--
-- Stage B of "remove V1". Converts only PURE-EMPTY V1 challenges to V2 so that no
-- historical activity is ever re-evaluated. A challenge is considered pure-empty when:
--   * task_schema_version = 1
--   * status = 'draft'                         (never published to users)
--   * 0 rows in season_prediction_weekly_challenge_entries  (no answers/drafts)
--   * 0 rows in weekly_challenge_task_claims                (no rewards claimed)
--
-- For these, switching to V2 cannot double-emit (nobody claimed anything) and cannot
-- break the bonus task (we assign the default bonus_question_key = 'upset'; the admin
-- still completes setup before activation, and activation re-validates the bonus).
--
-- Any V1 challenge that is NOT pure-empty (published, or has entries/claims) is LEFT
-- UNTOUCHED on purpose — those must keep the V1 read-path. The diagnostic query at the
-- bottom of this file reports how many such challenges remain: if it returns 0, the V1
-- catalog + V1 builder branch can be safely deleted from the code (Stage B code removal).
--
-- Additive/idempotent: re-running is a no-op (WHERE clause excludes already-V2 rows).
-- Does NOT change reward amounts, task catalog values, scoring, or any reward_ledger row.

UPDATE season_prediction_weekly_challenges
SET task_schema_version = 2,
    bonus_question_key = COALESCE(bonus_question_key, 'upset'),
    updated_at = strftime('%s', 'now')
WHERE task_schema_version = 1
  AND status = 'draft'
  AND id NOT IN (
    SELECT DISTINCT weekly_challenge_id FROM season_prediction_weekly_challenge_entries
  )
  AND id NOT IN (
    SELECT DISTINCT weekly_challenge_id FROM weekly_challenge_task_claims
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNOSTIC (run manually, does NOT execute as part of the migration DML above).
-- Reports V1 challenges that were intentionally left untouched (have activity or are
-- published). If total = 0, V1 code can be removed.
--
--   wrangler d1 execute scoregame_db --command "
--     SELECT
--       COUNT(*) AS v1_remaining,
--       SUM(CASE WHEN status <> 'draft' THEN 1 ELSE 0 END) AS v1_published,
--       SUM(CASE WHEN id IN (SELECT weekly_challenge_id FROM season_prediction_weekly_challenge_entries) THEN 1 ELSE 0 END) AS v1_with_entries,
--       SUM(CASE WHEN id IN (SELECT weekly_challenge_id FROM weekly_challenge_task_claims) THEN 1 ELSE 0 END) AS v1_with_claims
--     FROM season_prediction_weekly_challenges
--     WHERE task_schema_version = 1;"
-- ─────────────────────────────────────────────────────────────────────────────
