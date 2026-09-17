-- 0140: перенос дедлайна индивидуальных наград топ-5 лиг на 4 сентября 2026, 00:00 МСК.
--
-- Раньше окно наград закрывалось 08.09.2026 00:00 МСК (1788814800). Новый дедлайн —
-- 04.09.2026 00:00 МСК = 03.09.2026 21:00 UTC = 1788469200 (unix seconds).
--
-- Затрагивает только турниры типа top_league (PL, PD, SA, BL1, FL1) — 5 строк.
-- Окно наград независимо от deadline_at таблицы (см. 0105), поэтому меняем только awards_deadline_at.
-- Уже отправленные заявки (awards_status='submitted') не трогаются: сокращение окна лишь
-- закрывает приём новых правок раньше.

UPDATE season_prediction_tournaments
SET awards_deadline_at = 1788469200,
    updated_at = CAST(strftime('%s','now') AS INTEGER)
WHERE tournament_type = 'top_league'
  AND awards_deadline_at = 1788814800;
