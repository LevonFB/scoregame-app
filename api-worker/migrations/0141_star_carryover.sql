-- Звёзды перестают сгорать: остаток переносится в новый сезон.
--
-- Баланс по-прежнему живёт в user_season_progress(user_id, season_number, stars) —
-- сезонная разбивка не ломается, потому что season_number остаётся ключом
-- идемпотентности в stars_ledger: обнули его, и повтор того же задания в новом
-- сезоне перестал бы начислять звёзды. Вместо этого при активации сезона остаток
-- предыдущего переезжает в новый (carryOverSeasonStars).
--
-- Эта таблица — и журнал переноса, и его защита от повтора: PRIMARY KEY
-- (user_id, to_season) не даёт перенести дважды, applied отделяет
-- зафиксированное намерение от применённого к балансу.
--
-- Переноса задним числом НЕТ: остатки сезонов, сгоревших по старым правилам,
-- так и остаются списанными (решение владельца 08.09.2026). Первым переедет
-- баланс текущего сезона — в момент, когда активируют следующий.
CREATE TABLE IF NOT EXISTS star_carryover (
    user_id     INTEGER NOT NULL,
    to_season   INTEGER NOT NULL,
    from_season INTEGER NOT NULL,
    amount      INTEGER NOT NULL,
    applied     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, to_season)
);

CREATE INDEX IF NOT EXISTS idx_star_carryover_to_season
    ON star_carryover(to_season, applied);
