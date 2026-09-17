-- 0125: Referral program v1 (docs/referral-v1.md).
-- Data impact: three nullable columns on users (no backfill — all existing users
-- stay unattributed) + one index for activation-time counts. No data is modified.
--
-- referred_by            — inviter's telegram id; written ONCE at registration via
--                          POST /referral/claim (server-side start_param from signed
--                          initData), never updated afterwards.
-- referral_activated_at  — ms timestamp of the invitee's first saved pick (set once).
-- referral_rewarded_at   — ms timestamp when the INVITER's per-friend reward was
--                          granted (may lag activated_at when the daily cap defers it).
-- acquired_via           — channel attribution code from startapp=src_<code>
--                          (write-once at registration; analytics only).

ALTER TABLE users ADD COLUMN referred_by INTEGER;
ALTER TABLE users ADD COLUMN referral_activated_at INTEGER;
ALTER TABLE users ADD COLUMN referral_rewarded_at INTEGER;
ALTER TABLE users ADD COLUMN acquired_via TEXT;

-- Activation-time lookups: pending sweep + milestone counts + daily-cap count all
-- filter on referred_by first; partial index keeps it tiny (most rows have NULL).
CREATE INDEX IF NOT EXISTS idx_users_referred_by
  ON users (referred_by)
  WHERE referred_by IS NOT NULL;
