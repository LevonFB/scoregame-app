-- Economy V1 (Этап A) — обмен звёзд на мячи (economy-v1.md §2).
-- Приводит прод к антиинфляционному каркасу: единый курс 20⭐ = 1⚽,
-- недельный потолок 120⭐ (макс 6⚽/нед). Ранее в проде был курс 10⭐=1⚽
-- с щедрыми тирами и лимитом 200⭐.
--
-- Значения читаются рантаймом из БД (economy_star_exchange_config +
-- economy_star_exchange_tiers), seed-функций-перезаписи нет — миграция
-- идемпотентна (UPDATE по фиксированным ключам).

-- 1) Недельный потолок: 200⭐ → 120⭐.
UPDATE economy_star_exchange_config
SET weekly_limit = 120,
    updated_at = datetime('now')
WHERE id = 1;

-- 2) Тиры — единый курс 20⭐/⚽ (кратные): 20→1, 40→2, 120→6.
--    Сохраняем существующие tier_key (small/medium/large), меняем только числа/подписи.
UPDATE economy_star_exchange_tiers
SET stars_cost = 20, balls_reward = 1, label = '20 ⭐ → 1 ⚽', is_active = 1, sort_order = 1, updated_at = datetime('now')
WHERE tier_key = 'small';

UPDATE economy_star_exchange_tiers
SET stars_cost = 40, balls_reward = 2, label = '40 ⭐ → 2 ⚽', is_active = 1, sort_order = 2, updated_at = datetime('now')
WHERE tier_key = 'medium';

UPDATE economy_star_exchange_tiers
SET stars_cost = 120, balls_reward = 6, label = '120 ⭐ → 6 ⚽', is_active = 1, sort_order = 3, updated_at = datetime('now')
WHERE tier_key = 'large';