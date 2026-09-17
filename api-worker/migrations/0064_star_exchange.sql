-- Star-to-balls exchange system
-- economy_star_exchange_config: global on/off + weekly limit
-- economy_star_exchange_tiers: configurable exchange tiers (admin-managed)
-- star_exchange_ledger: audit trail + idempotency + weekly limit tracking

CREATE TABLE IF NOT EXISTS economy_star_exchange_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  -- weekly_limit stores max STARS (not exchanges) user can spend per week
  weekly_limit INTEGER NOT NULL DEFAULT 200,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS economy_star_exchange_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  stars_cost INTEGER NOT NULL,
  balls_reward INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS star_exchange_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tier_id INTEGER NOT NULL,
  stars_spent INTEGER NOT NULL,
  balls_received INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  week_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  config_snapshot_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_star_exchange_user_week ON star_exchange_ledger (user_id, week_key);
CREATE INDEX IF NOT EXISTS idx_star_exchange_user_created ON star_exchange_ledger (user_id, created_at DESC);

-- Seed: default config (disabled until admin enables)
-- weekly_limit = max stars per week (not number of exchanges)
INSERT OR IGNORE INTO economy_star_exchange_config (id, enabled, weekly_limit)
VALUES (1, 0, 200);

-- Seed: default exchange tiers
INSERT OR IGNORE INTO economy_star_exchange_tiers (tier_key, label, stars_cost, balls_reward, is_active, sort_order)
VALUES
  ('small',  '10 ⭐ → 1 ⚽',  10, 1, 1, 1),
  ('medium', '30 ⭐ → 4 ⚽',  30, 4, 1, 2),
  ('large',  '60 ⭐ → 10 ⚽', 60, 10, 1, 3);
