-- 0095_purchase_idempotency.sql
-- Stage 5: add an idempotency key to /shop/buy so duplicate / concurrent / timeout-retried
-- purchases charge balls and grant the item exactly once.
--
-- ROOT CAUSE: POST /shop/buy had NO operation/idempotency key — deduct, ball_transactions,
-- purchase_history and the item grant were four separate statements. A double-click, a client
-- retry after a timeout, or two concurrent requests each deducted balls AND granted the item
-- again (double-spend + double-item). This adds a per-purchase operation_id anchor.
--
-- SAFE / ADDITIVE: only a nullable column + a PARTIAL UNIQUE index (operation_id IS NOT NULL),
-- so every pre-existing purchase_history row (operation_id = NULL) is untouched and never
-- collides. No data is migrated, recalculated, or back-credited. fail-closed: the column add and
-- the index creation are independent statements; on a dirty/partial state the migrator stops
-- before leaving an inconsistent schema (no destructive step here).

ALTER TABLE purchase_history ADD COLUMN operation_id TEXT;

-- One purchase per operation_id. Partial index leaves legacy NULL rows unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_history_operation_id
  ON purchase_history(operation_id)
  WHERE operation_id IS NOT NULL;
