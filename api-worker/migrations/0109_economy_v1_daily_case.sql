-- Economy V1 (Этап A) — Daily case (economy-v1.md §9).
-- Полная замена наградного пула бесплатного кейса под целевую схему.
-- Ранее: stars 86% + 4 награды. Цель: 10 наград, включая жетон (lucky_token).
--
-- Активные chance_percent суммируются в 100:
--   stars (2/4/6/10/20)  77.0  (30+24+14+7+2 внутри discrete)
--   balls 1               8.0
--   extra_joker           4.0
--   double_chance         4.0
--   lucky_token (жетон)   6.8
--   extra_league          0.2
-- rollCase уже умеет lucky_token/extra_league (api-worker/src/index.ts caseRewardStmts).
-- Идемпотентно: DELETE всех наград кейса + INSERT.

DELETE FROM shop_case_rewards
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'daily_free');

-- Звёзды: дискретные номиналы 2/4/6/10/20 (веса пропорциональны итоговым %).
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'stars', 77.0, 2, 20, NULL, 1 FROM shop_cases WHERE code = 'daily_free';
UPDATE shop_case_rewards
SET meta_json = '{"discrete_amounts": [{"amount": 2, "weight": 30}, {"amount": 4, "weight": 24}, {"amount": 6, "weight": 14}, {"amount": 10, "weight": 7}, {"amount": 20, "weight": 2}]}'
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'daily_free') AND reward_type = 'stars';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'balls', 8.0, 1, 1, NULL, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker', 4.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'double_chance', 4.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';

-- Жетон «Фартового мяча».
INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'lucky_token', 6.8, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_league', 0.2, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'daily_free';
