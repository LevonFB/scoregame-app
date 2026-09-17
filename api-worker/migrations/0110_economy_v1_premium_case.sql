-- Economy V1 (Этап A) — Premium case (economy-v1.md §12).
-- Полная замена наградного пула премиум-кейса под целевую схему (16 наград).
-- Ранее: 4 награды (stars/balls/joker/dc).
--
-- ОТСТУПЛЕНИЕ (Этап A): комбо-награда «Extra Joker + Double Chance» (§12, 2%)
-- одним reward_type невыразима и отложена на Этап B. Её 2% временно добавлены
-- к extra_joker ×1 (8→9%) и double_chance ×1 (8→9%), пул остаётся 100%.
--
-- Награды ×2 работают благодаря правке caseRewardStmts (fixed_amount=2 → 2 буста).
-- Активные chance_percent суммируются в 100:
--   stars (20/40/80)       34.0  (16+13+5)
--   balls (3/5/7/12/20)    33.5  (10+10+8+4+1.5)
--   extra_joker ×1          9.0   double_chance ×1  9.0
--   extra_joker ×2          2.5   double_chance ×2  3.5
--   lucky_token ×1          5.5   lucky_token ×2    2.5
--   extra_league            0.5
-- Идемпотентно: DELETE всех наград кейса + INSERT.

DELETE FROM shop_case_rewards
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

-- Звёзды 20/40/80.
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'stars', 34.0, 20, 80, NULL, 1 FROM shop_cases WHERE code = 'premium';
UPDATE shop_case_rewards
SET meta_json = '{"discrete_amounts": [{"amount": 20, "weight": 16}, {"amount": 40, "weight": 13}, {"amount": 80, "weight": 5}]}'
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium') AND reward_type = 'stars';

-- Мячи 3/5/7/12/20.
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'balls', 33.5, 3, 20, NULL, 1 FROM shop_cases WHERE code = 'premium';
UPDATE shop_case_rewards
SET meta_json = '{"discrete_amounts": [{"amount": 3, "weight": 10}, {"amount": 5, "weight": 10}, {"amount": 7, "weight": 8}, {"amount": 12, "weight": 4}, {"amount": 20, "weight": 1.5}]}'
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium') AND reward_type = 'balls';

-- Бусты ×1 / ×2 (по fixed_amount).
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker', 9.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker', 2.5, NULL, NULL, 2, 1 FROM shop_cases WHERE code = 'premium';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'double_chance', 9.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'double_chance', 3.5, NULL, NULL, 2, 1 FROM shop_cases WHERE code = 'premium';

-- Жетоны ×1 / ×2.
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'lucky_token', 5.5, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'lucky_token', 2.5, NULL, NULL, 2, 1 FROM shop_cases WHERE code = 'premium';

-- Слот доп. лиги.
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_league', 0.5, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
