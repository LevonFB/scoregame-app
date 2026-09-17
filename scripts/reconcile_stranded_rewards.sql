-- reconcile_stranded_rewards.sql
-- READ-ONLY reconciliation report for audit finding R-4 (Season Predictions reward delivery).
-- Finds reward_ledger rows marked status='granted' that have NO matching delivered resource —
-- i.e. potential historically-stranded rewards from the pre-Stage-4 (ledger-first) code path.
--
-- SAFETY: SELECT-only. No INSERT/UPDATE/DELETE/ALTER. Run against a read replica or a D1 export.
-- Does NOT emit usernames, initData, or any PII — only user_id, unique_key, reward_type, amount.
-- Nothing is auto-credited; this is a candidate list for manual review.
--
-- Idempotency keys used by the delivery code (so a granted row WITH a matching receipt is fine):
--   stars       -> stars_ledger.instance_key            = reward_ledger.unique_key
--   balls       -> balls_ledger.instance_key            = reward_ledger.unique_key
--   lucky_token -> lucky_token_transactions.ref_id      = reward_ledger.unique_key
--   case        -> NO per-grant receipt exists -> NOT directly verifiable (see §case below).

-- ── stars: granted in reward_ledger but missing from stars_ledger ──────────────
SELECT 'stars' AS reward_type, 'HIGH' AS confidence,
       rl.user_id, rl.source_type, rl.source_id, rl.unique_key, rl.amount, rl.granted_at,
       'granted stars row has no matching stars_ledger.instance_key' AS reason
FROM reward_ledger rl
LEFT JOIN stars_ledger sl
  ON sl.user_id = rl.user_id AND sl.instance_key = rl.unique_key
WHERE rl.status = 'granted' AND rl.reward_type = 'stars' AND sl.user_id IS NULL

UNION ALL

-- ── balls: granted in reward_ledger but missing from balls_ledger ──────────────
SELECT 'balls', 'HIGH',
       rl.user_id, rl.source_type, rl.source_id, rl.unique_key, rl.amount, rl.granted_at,
       'granted balls row has no matching balls_ledger.instance_key'
FROM reward_ledger rl
LEFT JOIN balls_ledger bl
  ON bl.user_id = rl.user_id AND bl.instance_key = rl.unique_key
WHERE rl.status = 'granted' AND rl.reward_type = 'balls' AND bl.user_id IS NULL

UNION ALL

-- ── lucky_token: granted in reward_ledger but missing from lucky_token_transactions ──
SELECT 'lucky_token', 'HIGH',
       rl.user_id, rl.source_type, rl.source_id, rl.unique_key, rl.amount, rl.granted_at,
       'granted lucky_token row has no matching lucky_token_transactions.ref_id'
FROM reward_ledger rl
LEFT JOIN lucky_token_transactions lt
  ON lt.user_id = rl.user_id AND lt.ref_id = rl.unique_key
WHERE rl.status = 'granted' AND rl.reward_type = 'lucky_token' AND lt.user_id IS NULL

UNION ALL

-- ── case: NO per-grant receipt table -> delivery cannot be verified row-by-row ──
-- We can only flag the population for MANUAL review (compare against user_cases totals
-- and case_opens/known consumption out-of-band). Confidence LOW by construction.
SELECT 'case', 'LOW',
       rl.user_id, rl.source_type, rl.source_id, rl.unique_key, rl.amount, rl.granted_at,
       'case grants have no per-grant receipt; cannot prove delivery from schema alone'
FROM reward_ledger rl
WHERE rl.status = 'granted' AND rl.reward_type = 'case'

ORDER BY reward_type, granted_at;

-- The query above is NOT filtered by source_type, so it already spans EVERY source:
--   season_prediction_task, bracket_quest, bracket_final_reward, manual_admin, weekly_challenge_task.
-- The emitted source_type column lets you slice candidates per source.
--
-- Optional summaries (run separately if your client shows only the last statement):
-- 1) Overall granted population by reward_type:
--    SELECT reward_type, COUNT(*) AS granted_total FROM reward_ledger WHERE status='granted' GROUP BY reward_type;
-- 2) Suspected-stranded breakdown by source_type × reward_type (stars/balls/lucky_token only —
--    case is unverifiable from schema):
--    SELECT rl.source_type, rl.reward_type, COUNT(*) AS suspected
--    FROM reward_ledger rl
--    LEFT JOIN stars_ledger sl ON rl.reward_type='stars' AND sl.user_id=rl.user_id AND sl.instance_key=rl.unique_key
--    LEFT JOIN balls_ledger bl ON rl.reward_type='balls' AND bl.user_id=rl.user_id AND bl.instance_key=rl.unique_key
--    LEFT JOIN lucky_token_transactions lt ON rl.reward_type='lucky_token' AND lt.user_id=rl.user_id AND lt.ref_id=rl.unique_key
--    WHERE rl.status='granted' AND rl.reward_type IN ('stars','balls','lucky_token')
--      AND sl.user_id IS NULL AND bl.user_id IS NULL AND lt.user_id IS NULL
--    GROUP BY rl.source_type, rl.reward_type;
