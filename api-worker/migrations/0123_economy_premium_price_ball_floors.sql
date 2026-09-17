-- Economy: возврат цены Premium-кейса к 7⚽ (economy-v1.md §3/§12) + подъём пола
-- мячовых дропов, чтобы мячовый выигрыш не ощущался глубоким минусом:
--   • Premium: мячи 3⚽(10%) → вес уходит в 5⚽ (итог 5⚽ 20%, 7⚽ 8%, 12⚽ 4%, 20⚽ 1.5%)
--   • Фартовый мяч: мячи 1⚽(16%) → вес уходит в 2⚽ (итог 2⚽ 16%, 3⚽ 12%, 5⚽ 5%, 10⚽ 2.5%, 20⚽ 0.5%)
-- Суммы вероятностей строк/секторов не меняются (33.5% и 36%), меняются только номиналы.
-- RTP после правки: Premium ~63% при 7⚽ (было 47% при 9⚽), рулетка ~82% (было 76%).
-- Звёздная цена Premium 160⭐ снова хуже курса 20⭐/⚽ — инвариант §0.4 восстановлен.
-- Идемпотентна: UPDATE по фиксированным ключам.

-- 1) Цена Premium-кейса: 9⚽ → 7⚽ (price_stars 160 не трогаем — корректна при 7⚽).
UPDATE shop_cases
SET price_balls = 7, updated_at = CURRENT_TIMESTAMP
WHERE code = 'premium';

-- 2) Premium: пол мячового дропа 3⚽ → 5⚽ (вес 10% переносится в 5⚽).
UPDATE shop_case_rewards
SET min_amount = 5,
    meta_json = '{"discrete_amounts": [{"amount": 5, "weight": 20}, {"amount": 7, "weight": 8}, {"amount": 12, "weight": 4}, {"amount": 20, "weight": 1.5}]}'
WHERE reward_type = 'balls' AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

-- 3) Фартовый мяч: пол мячового дропа 1⚽ → 2⚽ (вес 16% переносится в 2⚽).
UPDATE fortune_wheel_sectors
SET min_amount = 2,
    meta_json = '{"discrete_amounts": [{"amount": 2, "weight": 16}, {"amount": 3, "weight": 12}, {"amount": 5, "weight": 5}, {"amount": 10, "weight": 2.5}, {"amount": 20, "weight": 0.5}]}'
WHERE reward_type = 'balls' AND is_active = 1;
