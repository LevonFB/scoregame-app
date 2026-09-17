-- 0096_case_opens_reward_code.sql
-- Stage 5.2: persist the reward_code (e.g. nested case type 'premium'/'daily_free') in the
-- case_opens receipt so a replay returns the FULL fixed result and reconciliation can verify it.
--
-- SAFE / ADDITIVE: a single nullable column. Legacy case_opens rows keep reward_code = NULL
-- (their reward_type/reward_amount are unchanged). No data migrated, recalculated or re-granted.
-- case_opens.open_id is already UNIQUE (idempotency anchor) — no new index needed. fail-closed:
-- one additive statement, no destructive step.

ALTER TABLE case_opens ADD COLUMN reward_code TEXT;
