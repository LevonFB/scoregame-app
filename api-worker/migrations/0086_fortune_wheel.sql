-- Fortune wheel ("Колесо фортуны") — PES-style horizontal reel reward mechanic.
-- Mirrors the cases loot model (weighted sectors), but with its own spin source:
--   * paid spins (balls), and
--   * free spins that can drop from the daily quest case (reward_type = 'fortune_spin').

-- Wheel configuration (single logical wheel; keyed by code for forward-compat).
CREATE TABLE IF NOT EXISTS fortune_wheel (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT    UNIQUE NOT NULL,     -- 'default'
    title        TEXT    NOT NULL,
    description  TEXT,
    price_balls  INTEGER NOT NULL DEFAULT 0,  -- cost of one paid spin
    is_active    INTEGER NOT NULL DEFAULT 1,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Wheel sectors = weighted reward pool (same shape as shop_case_rewards + display fields).
CREATE TABLE IF NOT EXISTS fortune_wheel_sectors (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wheel_id       INTEGER NOT NULL,
    reward_type    TEXT    NOT NULL,          -- 'balls' | 'stars' | 'extra_joker' | 'double_chance' | 'extra_league' | 'case'
    reward_code    TEXT,                      -- for 'case': 'premium' | 'daily_free'
    chance_percent REAL    NOT NULL,          -- sector weight; active sectors must sum to 100
    min_amount     INTEGER,
    max_amount     INTEGER,
    fixed_amount   INTEGER,
    label          TEXT,                      -- display label on the reel
    color          TEXT,                      -- display accent color (hex)
    sort_order     INTEGER NOT NULL DEFAULT 100,
    is_active      INTEGER NOT NULL DEFAULT 1,
    meta_json      TEXT,                      -- flexible config (discrete_amounts, etc.); valid JSON if used
    FOREIGN KEY (wheel_id) REFERENCES fortune_wheel(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fortune_wheel_sectors_wheel_id ON fortune_wheel_sectors(wheel_id);

-- Inventory of free spins per user (earned via daily case / admin grants).
CREATE TABLE IF NOT EXISTS fortune_spins (
    user_id   INTEGER NOT NULL PRIMARY KEY,
    quantity  INTEGER NOT NULL DEFAULT 0
);

-- Spin history + idempotency via unique spin_id.
CREATE TABLE IF NOT EXISTS fortune_spin_opens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    spin_id       TEXT    NOT NULL UNIQUE,    -- UUID for idempotency
    user_id       INTEGER NOT NULL,
    sector_id     INTEGER,                    -- winning sector id (nullable if sector later deleted)
    reward_type   TEXT    NOT NULL,
    reward_amount INTEGER NOT NULL DEFAULT 1,
    reward_code   TEXT,
    balls_spent   INTEGER NOT NULL DEFAULT 0, -- 0 for free spins
    free_spin     INTEGER NOT NULL DEFAULT 0, -- 1 if a free spin was consumed
    created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fortune_spin_opens_user ON fortune_spin_opens(user_id, created_at DESC);

-- Seed the default wheel + a reasonable sector set (sums to 100).
-- NOTE: chances were rebalanced afterwards in migration 0087; this original seed
-- is kept verbatim because 0086 was already applied to production.
INSERT OR IGNORE INTO fortune_wheel (code, title, description, price_balls, is_active)
VALUES ('default', 'Колесо фортуны', 'Крути колесо и выигрывай награды', 3, 1);

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'balls', NULL, 40.0, 1, 5, NULL, 'Мячики', '#ffcc00', 10, 1 FROM fortune_wheel WHERE code = 'default';

UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 1, "weight": 45}, {"amount": 2, "weight": 30}, {"amount": 3, "weight": 18}, {"amount": 5, "weight": 7}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND reward_type = 'balls';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'stars', NULL, 35.0, 3, 10, NULL, 'Звёзды', '#34c759', 20, 1 FROM fortune_wheel WHERE code = 'default';

UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 3, "weight": 50}, {"amount": 5, "weight": 30}, {"amount": 8, "weight": 15}, {"amount": 10, "weight": 5}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND reward_type = 'stars';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_joker', NULL, 13.0, NULL, NULL, 1, 'Джокер', '#ff9500', 30, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'double_chance', NULL, 7.0, NULL, NULL, 1, 'Двойной шанс', '#5ac8fa', 40, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'daily_free', 4.0, NULL, NULL, 1, 'Кейс', '#38bdf8', 50, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'premium', 0.9, NULL, NULL, 1, 'Премиум-кейс', '#A855F7', 60, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_league', NULL, 0.1, NULL, NULL, 1, 'Слот лиги', '#ff2d55', 70, 1 FROM fortune_wheel WHERE code = 'default';
