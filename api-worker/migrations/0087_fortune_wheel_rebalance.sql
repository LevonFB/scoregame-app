-- Rebalance the fortune wheel sector pool (active chances sum to 100).
-- Calibration anchors (ball value): joker=3, double_chance=5, extra_league=12,
-- premium case=7; star liquidity ≈ 1⭐ ≈ 0.125⚽ (best exchange tier 60⭐→10⚽).
-- Paid-spin EV ≈ 2.0⚽ liquid (below the 3⚽ price → mildly ball-deflationary),
-- while perceived value is higher thanks to stars/cases. Tunable in admin.
--
-- Full replace of sectors for the 'default' wheel (idempotent re-run safe).
DELETE FROM fortune_wheel_sectors
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

-- 1. Small balls — frequent consolation prize (keeps the reel lively). 32%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'balls', NULL, 32.0, 1, 3, NULL, 'Мячики', '#ffcc00', 10, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 1, "weight": 50}, {"amount": 2, "weight": 35}, {"amount": 3, "weight": 15}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND label = 'Мячики';

-- 2. Small stars — the staple reward (like the daily case). 26%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'stars', NULL, 26.0, 3, 5, NULL, 'Звёзды', '#34c759', 20, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 3, "weight": 50}, {"amount": 4, "weight": 30}, {"amount": 5, "weight": 20}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND label = 'Звёзды';

-- 3. Bigger balls — a satisfying mid win. 12%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'balls', NULL, 12.0, 4, 7, NULL, 'Мячики ×4+', '#ff9500', 30, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 4, "weight": 50}, {"amount": 5, "weight": 30}, {"amount": 7, "weight": 20}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND label = 'Мячики ×4+';

-- 4. Bigger stars — exciting mid win. 12%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'stars', NULL, 12.0, 8, 15, NULL, 'Звёзды ×8+', '#FFD700', 40, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 8, "weight": 50}, {"amount": 10, "weight": 30}, {"amount": 12, "weight": 15}, {"amount": 15, "weight": 5}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND label = 'Звёзды ×8+';

-- 5. Joker boost. 9%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_joker', NULL, 9.0, NULL, NULL, 1, 'Джокер', '#A855F7', 50, 1 FROM fortune_wheel WHERE code = 'default';

-- 6. Double chance boost. 5%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'double_chance', NULL, 5.0, NULL, NULL, 1, 'Двойной шанс', '#5ac8fa', 60, 1 FROM fortune_wheel WHERE code = 'default';

-- 7. Daily case. 3%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'daily_free', 3.0, NULL, NULL, 1, 'Кейс', '#38bdf8', 70, 1 FROM fortune_wheel WHERE code = 'default';

-- 8. Premium case — jackpot. 0.7%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'premium', 0.7, NULL, NULL, 1, 'Премиум-кейс', '#c084fc', 80, 1 FROM fortune_wheel WHERE code = 'default';

-- 9. Extra league slot — ultra-rare jackpot. 0.3%
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_league', NULL, 0.3, NULL, NULL, 1, 'Слот лиги', '#ff2d55', 90, 1 FROM fortune_wheel WHERE code = 'default';
