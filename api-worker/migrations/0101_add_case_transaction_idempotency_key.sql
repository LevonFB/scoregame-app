-- Crash-safe idempotency for partner case rewards.
--
-- Adds an OPTIONAL stable idempotency key to case_transactions so a partner case grant can be
-- replayed safely after a mid-flight crash without ever granting a second case. The key is
-- claim-derived (e.g. `partner_claim:<claim_id>:case_reward`) and authoritative via a UNIQUE
-- index. The column is nullable: historical rows and all non-partner case operations (shop,
-- tasks, daily/weekly/season rewards, admin grants) keep idempotency_key = NULL and are
-- unaffected. Multiple NULLs are allowed (partial unique index); only non-NULL keys are unique.

ALTER TABLE case_transactions ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX idx_case_transactions_idempotency_key
  ON case_transactions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
