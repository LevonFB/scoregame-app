-- Economy V1 (Этап A) — цены магазина бустов (economy-v1.md §3).
-- Приводит цены к целевой схеме:
--   Double Chance  5⚽ → 3⚽
--   Extra Joker    3⚽ → 4⚽
--   Доп. лига     12⚽ → 20⚽
-- Premium case (7⚽) и Фартовый мяч (3⚽) по мячам уже совпадают — не трогаем.
-- Значения читаются рантаймом из shop_boosts; миграция идемпотентна (UPDATE по code).

UPDATE shop_boosts SET price_balls = 3,  updated_at = CURRENT_TIMESTAMP WHERE code = 'double_chance';
UPDATE shop_boosts SET price_balls = 4,  updated_at = CURRENT_TIMESTAMP WHERE code = 'extra_joker';
UPDATE shop_boosts SET price_balls = 20, updated_at = CURRENT_TIMESTAMP WHERE code = 'extra_league';
