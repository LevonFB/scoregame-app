-- 0135: перебалансировка колеса фортуны (wheel_id = 1, code = 'default').
--
-- ПРИЧИНА. Один сектор мячей (id 18) с min=2/max=20 и meta_json.discrete_amounts
-- весами 50/14/3/0.7/0.3 давал ровно 2⚽ в 50% всех спинов; эффективное число
-- исходов барабана — 4.8 из 10. Дополнительно ломалась визуальная редкость:
-- фронтовый tierForSector берёт тир от fixed_amount ?? max_amount, поэтому весь
-- сектор с max_amount=20 всегда показывался «Серебряным мячом» независимо от
-- выпавшего номинала, а витрина шансов группировала по тому же признаку.
--
-- ЧТО ДЕЛАЕМ. Разбиваем сектор мячей на отдельные сектора по номиналам
-- (fixed_amount), что заодно чинит тиры без спец-логики, и пересобираем веса.
--
-- ЭКОНОМИКА (EV-модель, docs/economy-recheck-2026-07-22.md):
--   ценность спина 2.72⚽ → 2.69⚽ (ценностный RTP 90.7% → 89.8%)
--   мячей на спин    1.84⚽ → 1.84⚽ (эмиссия не меняется)
--   курс за 80⭐     29.4  → 29.7 ⭐/⚽ (§0.4 соблюдён: хуже обмена 20 ⭐/⚽)
--   EV кейсов не меняется: Daily 0.76⚽, Premium 6.15⚽
--   топ-исход 50.0% → 30.0%, эффективных исходов 4.8 → 6.6
--
-- ДАННЫЕ. Сектор 18 НЕ удаляется, а деактивируется: на него ссылается
-- fortune_spin_opens.sector_id (без FK), и удаление осиротило бы историю спинов
-- и сломало бы indexOf(sector_id) в идемпотентном повторе выдачи.

-- 1. Старый общий сектор мячей уходит из ротации (история спинов остаётся целой).
UPDATE fortune_wheel_sectors
SET is_active = 0
WHERE wheel_id = 1 AND id = 18;

-- 2. Новые веса у переживших секторов.
UPDATE fortune_wheel_sectors SET chance_percent = 9.0  WHERE wheel_id = 1 AND id = 19; -- Джокер       10 → 9
UPDATE fortune_wheel_sectors SET chance_percent = 9.0  WHERE wheel_id = 1 AND id = 20; -- Двойной шанс 10 → 9
UPDATE fortune_wheel_sectors SET chance_percent = 25.0 WHERE wheel_id = 1 AND id = 21; -- Кейс daily    9 → 25
UPDATE fortune_wheel_sectors SET chance_percent = 2.5  WHERE wheel_id = 1 AND id = 22; -- Премиум-кейс  без изменений
UPDATE fortune_wheel_sectors SET chance_percent = 0.4  WHERE wheel_id = 1 AND id = 23; -- Слот лиги   0.5 → 0.4

-- 3. Мячи отдельными секторами. fixed_amount задаёт и номинал, и визуальный тир.
--    Цвет идёт за редкостью: жёлтый обычные, серебро 4–5⚽, золото 10⚽, оранжевый джекпот.
--    label остаётся «Мячики» — витрина сама дописывает «×N» из fixed_amount.
INSERT INTO fortune_wheel_sectors
  (wheel_id, reward_type, reward_code, chance_percent, min_amount, max_amount, fixed_amount, label, color, sort_order, is_active, meta_json)
VALUES
  (1, 'balls', NULL, 30.0, NULL, NULL,  2, 'Мячики', '#ffcc00', 10, 1, NULL),
  (1, 'balls', NULL, 13.5, NULL, NULL,  3, 'Мячики', '#ffcc00', 11, 1, NULL),
  (1, 'balls', NULL,  5.0, NULL, NULL,  4, 'Мячики', '#cfd8e8', 12, 1, NULL),
  (1, 'balls', NULL,  3.5, NULL, NULL,  5, 'Мячики', '#cfd8e8', 13, 1, NULL),
  (1, 'balls', NULL,  1.6, NULL, NULL, 10, 'Мячики', '#FFD700', 14, 1, NULL),
  (1, 'balls', NULL,  0.5, NULL, NULL, 20, 'Мячики', '#FFAA3C', 15, 1, NULL);

-- Итоговая сумма активных секторов: 30 + 13.5 + 5 + 3.5 + 1.6 + 0.5 + 9 + 9 + 25 + 2.5 + 0.4 = 100.0
