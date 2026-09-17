-- Economy V1 (Этап B) — доведение Premium-комбо (economy-v1.md §12).
-- В Этапе A комбо «Extra Joker + Double Chance» (2%) было временно влито в ×1-бусты
-- (extra_joker/double_chance ×1 = 9%). Теперь возвращаем комбо отдельной наградой:
--   extra_joker ×1  9 → 8
--   double_chance ×1 9 → 8
--   + extra_joker_double_chance 2%
-- Обрабатывается в caseRewardStmts (выдаёт 1 joker + 1 dc). Пул остаётся 100%.
-- Идемпотентно: UPDATE по ключам + DELETE combo + INSERT.

UPDATE shop_case_rewards SET chance_percent = 8.0
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium')
  AND reward_type = 'extra_joker' AND fixed_amount = 1;

UPDATE shop_case_rewards SET chance_percent = 8.0
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium')
  AND reward_type = 'double_chance' AND fixed_amount = 1;

DELETE FROM shop_case_rewards
WHERE case_id = (SELECT id FROM shop_cases WHERE code = 'premium')
  AND reward_type = 'extra_joker_double_chance';

INSERT INTO shop_case_rewards (case_id, reward_type, chance_percent, min_amount, max_amount, fixed_amount, is_active)
SELECT id, 'extra_joker_double_chance', 2.0, NULL, NULL, 1, 1 FROM shop_cases WHERE code = 'premium';
