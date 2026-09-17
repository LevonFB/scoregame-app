-- Economy V1 (Этап A) — «Фартовый мяч» / fortune wheel (economy-v1.md §13).
-- Полная замена секторов колеса под целевую схему (13 наград).
-- Паттерн повторяет 0087 (full replace для wheel 'default', idempotent re-run safe).
--
-- Активные chance_percent суммируются в 100:
--   stars (10/20/40)      41.0  (17+16+8)
--   balls (1/3/5/10/20)   36.0  (16+12+5+2.5+0.5)
--   extra_joker            8.0
--   double_chance          8.0
--   case daily_free        5.0
--   case premium           1.5
--   extra_league           0.5

DELETE FROM fortune_wheel_sectors
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

-- Звёзды 10/20/40.
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'stars', NULL, 41.0, 10, 40, NULL, 'Звёзды', '#34c759', 10, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 10, "weight": 17}, {"amount": 20, "weight": 16}, {"amount": 40, "weight": 8}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND reward_type = 'stars';

-- Мячи 1/3/5/10/20.
INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'balls', NULL, 36.0, 1, 20, NULL, 'Мячики', '#ffcc00', 20, 1 FROM fortune_wheel WHERE code = 'default';
UPDATE fortune_wheel_sectors
SET meta_json = '{"discrete_amounts": [{"amount": 1, "weight": 16}, {"amount": 3, "weight": 12}, {"amount": 5, "weight": 5}, {"amount": 10, "weight": 2.5}, {"amount": 20, "weight": 0.5}]}'
WHERE wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default') AND reward_type = 'balls';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_joker', NULL, 8.0, NULL, NULL, 1, 'Джокер', '#A855F7', 30, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'double_chance', NULL, 8.0, NULL, NULL, 1, 'Двойной шанс', '#5ac8fa', 40, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'daily_free', 5.0, NULL, NULL, 1, 'Кейс', '#38bdf8', 50, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'case', 'premium', 1.5, NULL, NULL, 1, 'Премиум-кейс', '#c084fc', 60, 1 FROM fortune_wheel WHERE code = 'default';

INSERT INTO fortune_wheel_sectors (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active)
SELECT id, 'extra_league', NULL, 0.5, NULL, NULL, 1, 'Слот лиги', '#ff2d55', 70, 1 FROM fortune_wheel WHERE code = 'default';
