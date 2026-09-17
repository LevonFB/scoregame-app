-- Referral E2E fixture — mirrors migration 0125 + the bits of the live schema the
-- referral flow touches that the minimal schema.sql fixture lacks. TEST ONLY.

-- Live users columns the claim route's inviter lookup reads (0043/0044/0119),
-- absent from the minimal schema fixture.
ALTER TABLE users ADD COLUMN nickname TEXT;
ALTER TABLE users ADD COLUMN nickname_normalized TEXT;
ALTER TABLE users ADD COLUMN telegram_username_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0;

-- Migration 0125: referral columns + partial index.
ALTER TABLE users ADD COLUMN referred_by INTEGER;
ALTER TABLE users ADD COLUMN referral_activated_at INTEGER;
ALTER TABLE users ADD COLUMN referral_rewarded_at INTEGER;
ALTER TABLE users ADD COLUMN acquired_via TEXT;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users (referred_by) WHERE referred_by IS NOT NULL;

-- Live column from case-open-reliability work: the idempotent grant path writes it.
ALTER TABLE case_transactions ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_tx_idem ON case_transactions (idempotency_key);

-- Referral config storage (migration 0017 shape).
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER
);
