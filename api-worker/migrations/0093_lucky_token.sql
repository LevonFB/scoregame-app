-- Lucky token ("Жетон") — a consumable item spent on one Фартовый мяч spin.
--
-- IMPORTANT (architecture): the token BALANCE reuses the existing per-user
-- `fortune_spins` table (the project's pre-existing "spin inventory"); we do NOT
-- create a second balance source of truth. `lucky_token` is the canonical item /
-- reward type; the legacy `fortune_spin` reward type is an alias for it.
--
-- Existing users with no `fortune_spins` row are treated as 0 tokens (COALESCE in
-- code). `fortune_spins.quantity` is already NOT NULL DEFAULT 0 and can never go
-- below zero because all debits use conditional updates (... WHERE quantity >= ?).
-- This migration does not touch existing balls / stars / cases / boosts balances.

-- History-only ledger for token grants/spends (NOT the balance source of truth).
-- Idempotent inserts via the UNIQUE ref_id (INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS lucky_token_transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    amount         INTEGER NOT NULL,            -- +grant / -spend
    balance_before INTEGER NOT NULL,
    balance_after  INTEGER NOT NULL,
    operation_type TEXT    NOT NULL,            -- task_reward_lucky_token | case_drop_lucky_token | lucky_ball_spin_token | admin_grant_lucky_token | admin_revoke_lucky_token
    comment        TEXT,
    admin_user_id  INTEGER,                     -- set for manual admin operations
    ref_id         TEXT    UNIQUE,              -- idempotency anchor (spin_id / open_id+type / claim key)
    created_at     INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lucky_token_transactions_user
    ON lucky_token_transactions(user_id, created_at DESC);

-- Per-wheel payment toggles. Defaults keep current behaviour (both methods on).
-- 1 жетон = 1 прокрутка (token cost is fixed in code, not stored).
ALTER TABLE fortune_wheel ADD COLUMN allow_token_payment INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fortune_wheel ADD COLUMN allow_balls_payment INTEGER NOT NULL DEFAULT 1;

-- Season-prediction task rewards can now also grant Жетоны (admin-configured).
-- Additive column; existing rows keep 0 (no change to existing reward values).
ALTER TABLE season_prediction_task_reward_config ADD COLUMN lucky_tokens INTEGER NOT NULL DEFAULT 0;
