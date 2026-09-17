-- Tables for Store Admin Economy

CREATE TABLE IF NOT EXISTS shop_boosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    emoji TEXT,
    price_balls INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    emoji TEXT,
    price_balls INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shop_case_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    reward_type TEXT NOT NULL,          -- 'stars', 'balls', 'extra_joker', 'double_chance', 'extra_league', 'cosmetic_reward'
    reward_code TEXT,                   -- specific id for cosmetic or unique items
    chance_percent REAL NOT NULL,       -- e.g., 40.0 for 40%
    min_amount INTEGER,
    max_amount INTEGER,
    fixed_amount INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1,
    meta_json TEXT,                     -- flexible configuration (must be valid JSON if used)
    FOREIGN KEY (case_id) REFERENCES shop_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ball_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,            -- Positive for credit, negative for debit
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    operation_type TEXT NOT NULL,       -- 'manual_add', 'manual_subtract', 'purchase', 'case_open', 'reward', etc.
    comment TEXT,
    admin_user_id INTEGER,              -- if manual operation
    open_id TEXT UNIQUE,                -- used for idempotency linking if transaction comes from a case open/purchase
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shop_case_rewards_case_id ON shop_case_rewards(case_id);
CREATE INDEX IF NOT EXISTS idx_ball_transactions_user_id ON ball_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ball_transactions_created_at ON ball_transactions(created_at);

-- ==========================================
-- SEED DATA (Maintain Existing Hardcoded Logic)
-- ==========================================

-- Seed Boosts
INSERT INTO shop_boosts (code, title, description, emoji, price_balls, is_active) VALUES
('extra_joker', 'Доп. Джокер', 'Даёт второй джокер на игровой день. Удваивает очки за ещё один матч.', '🃏', 3, 1),
('double_chance', 'Двойной шанс', 'Страховка 1X / X2 / 12 на один матч. Если обычные очки = 0, получите 2 очка.', '🛡️', 5, 1),
('extra_league', 'Доп. Лига', 'Даёт право создать ещё одну лигу поверх базового лимита.', '🏟️', 12, 1)
ON CONFLICT(code) DO UPDATE SET price_balls=excluded.price_balls, is_active=excluded.is_active;

-- Seed Cases
INSERT INTO shop_cases (code, title, description, emoji, price_balls, is_active) VALUES
('daily_free', 'Ежедневный кейс', 'Награда за 4 выполненных ежедневных задания.', '📦', 0, 1),
('premium', 'Премиум-кейс', 'Случайная награда: звёзды, мячики, бусты', '💎', 7, 1)
ON CONFLICT(code) DO UPDATE SET price_balls=excluded.price_balls, is_active=excluded.is_active;

-- Seed Case Rewards
-- We must ensure the hardcoded percentages match exactly 100% total per case.

-- 1. Free Daily Case Rewards (Total 100%)
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'stars', 86.0, 3, 10, NULL, 1 FROM shop_cases WHERE code = 'daily_free'; 
-- (Note: Originally hardcoded as sub-rolls 3(45%), 5(30%), 7(18%), 10(7%). For simplicity in DB, we'll map this to min=3, max=10, 
-- or we can encode the exact distribution in meta_json if strictly necessary, but for now we'll use min/max for DB-driven logic. 
-- Wait, the requirement asks for min/max for stars. The original logic was discrete amounts. 
-- Let's define the meta_json to support picking discrete items if provided, otherwise fallback to min/max random.)

UPDATE shop_case_rewards SET meta_json = '{"discrete_amounts": [{"amount": 3, "weight": 45}, {"amount": 5, "weight": 30}, {"amount": 7, "weight": 18}, {"amount": 10, "weight": 7}]}' 
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'daily_free') AND reward_type = 'stars';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker', 7.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'balls', 5.9, 1, 1, NULL, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'double_chance', 1.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_league', 0.1, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';


-- 2. Premium Case Rewards (Total 100%)
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'stars', 47.0, 8, 20, NULL, 1 FROM shop_cases WHERE code = 'premium';
UPDATE shop_case_rewards SET meta_json = '{"discrete_amounts": [{"amount": 8, "weight": 40}, {"amount": 12, "weight": 30}, {"amount": 16, "weight": 20}, {"amount": 20, "weight": 10}]}' 
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium') AND reward_type = 'stars';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'balls', 26.0, 1, 3, NULL, 1 FROM shop_cases WHERE code = 'premium';
UPDATE shop_case_rewards SET meta_json = '{"discrete_amounts": [{"amount": 1, "weight": 30}, {"amount": 2, "weight": 60}, {"amount": 3, "weight": 10}]}' 
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium') AND reward_type = 'balls';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker', 18.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'double_chance', 9.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
