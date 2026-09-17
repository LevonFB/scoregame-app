-- 0115_user_boosts_index.sql
-- user_boosts не имел ни одного индекса по user_id: каждый запрос вида
-- `WHERE user_id = ? AND status = 'available'` (getCaseUserState после каждого
-- открытия кейса/спина/покупки, /me/boosts при каждом входе и смене даты,
-- применение бустов) делал полный скан таблицы, которая растёт с каждой
-- покупкой/дропом. Основной источник лишних D1 rows read на горячем пути
-- магазина (см. loadtest: ~2.4k rows/открытие).
--
-- SAFE / ADDITIVE: только CREATE INDEX IF NOT EXISTS, план запросов меняется,
-- результаты — нет. Данные не затрагиваются. Откат: DROP INDEX.

CREATE INDEX IF NOT EXISTS idx_user_boosts_user ON user_boosts(user_id, status);
