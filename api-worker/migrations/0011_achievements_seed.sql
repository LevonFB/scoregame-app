-- 0006_achievements_seed.sql

-- Clear existing to allow re-seeding (optional, but safe for dev)
DELETE FROM achievements;

-- GLOBAL: Common
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('global_debut', 'global', 'common', '🏟️', 'Выход на поле', 'Сделайте свой первый прогноз', 'picks_total', 1),
('global_full_day', 'global', 'common', '⏱️', 'Полные девяносто', 'Сделайте прогнозы на все 3 матча дня до начала игр', 'day_full_before_lock', 1),
('global_read_game', 'global', 'common', '👀', 'Чтение игры', 'Впервые угадайте исход матча', 'outcome_total', 1),
('global_goal_diff', 'global', 'common', '📊', 'Чувство счёта', 'Впервые угадайте разницу мячей', 'diff_total', 1),
('global_first_joker', 'global', 'common', '🃏', 'Капитанский выбор', 'Впервые используйте джокер', 'joker_use_total', 1),
('global_joker_points', 'global', 'common', '🃏✅', 'Джокер сыграл', 'Заработайте очки на джокер-матче', 'joker_points_event', 1),
('global_early_start', 'global', 'common', '⏰', 'Ранний старт', 'Сделайте прогноз за 3 часа до начала матча', 'early_pick_event', 1);

-- GLOBAL: Rare
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('global_scoreboard', 'global', 'rare', '🎯', 'На табло', 'Угадайте точный счёт матча', 'exact_total', 1),
('global_streak_3', 'global', 'rare', '🔁', 'На серии', 'Делайте прогнозы 3 дня подряд', 'streak_days', 3),
('global_3of3_points', 'global', 'rare', '✅', 'Три из трёх', 'Наберите очки во всех 3 матчах дня', 'day_all_points', 1),
('global_big_day', 'global', 'rare', '🔥', 'Большой день', 'Наберите 10 или более очков за день', 'day_points', 10),
('global_joker_doublehit', 'global', 'rare', '🃏⚡', 'Удар на удвоение', 'Получите 6+ очков на джокере (x2)', 'joker_points_single', 6),
('global_joker_streak_3', 'global', 'rare', '🃏🔁', 'Джокер-стрик', 'Джокер приносит очки 3 дня подряд', 'joker_streak', 3),
('global_new_peak', 'global', 'rare', '📈', 'Новая планка', 'Обновите свой рекорд очков за день', 'new_record_day', 1),
('global_steady', 'global', 'rare', '🧱', 'Ровный темп', 'Набирайте очки 5 дней подряд', 'points_streak', 5);

-- GLOBAL: Epic
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('global_streak_7', 'global', 'epic', '💪', 'Неделя в форме', 'Делайте прогнозы 7 дней подряд', 'streak_days', 7),
('global_streak_30', 'global', 'epic', '🗓️', 'Режим сезона', 'Делайте прогнозы 30 дней подряд', 'streak_days', 30),
('global_perfect_week', 'global', 'epic', '✅🗓️', 'Идеальная неделя', 'Делайте прогнозы каждый день календарной недели', 'full_week_activity', 1),
('global_double_exact_week', 'global', 'epic', '🎯🎯', 'Дубль точности', 'Угадайте 2 точных счёта за неделю', 'exact_week', 2),
('global_exact_5', 'global', 'epic', '🧠🎯', 'Мастер точного счёта', 'Угадайте 5 точных счетов за всё время', 'exact_total', 5),
('global_exact_10', 'global', 'epic', '♟️', 'Гроссмейстер', 'Угадайте 10 точных счетов за всё время', 'exact_total', 10),
('global_golden_joker', 'global', 'epic', '🃏🏅', 'Золотой джокер', 'Угадайте точный счёт в джокер-матче', 'joker_exact_total', 1),
('global_lock_discipline_7', 'global', 'epic', '🔒', 'Железная дисциплина', '7 дней подряд все прогнозы сделаны до начала матчей', 'lock_discipline_streak', 7);

-- LEAGUE: Common
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('league_member', 'league', 'common', '🤝', 'В составе', 'Вступите в лигу', 'league_join', 1),
('league_first_round', 'league', 'common', '📝', 'Первый тур', 'Сделайте первый прогноз, состоя в лиге', 'league_pick', 1),
('league_no_late_5', 'league', 'common', '⏰', 'Без опозданий', '5 раз успейте сделать прогноз до начала матча в лиге', 'league_ontime_total', 5),
('league_day_points', 'league', 'common', '✅', 'День с очками', 'Наберите хотя бы 1 очко за день в лиге', 'league_day_points', 1),
('league_first_joker', 'league', 'common', '🃏', 'Лиговый джокер', 'Впервые используйте джокер в лиге', 'league_joker_use', 1);

-- LEAGUE: Rare
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('league_top3_day', 'league', 'rare', '🥉', 'Топ-3 дня', 'Займите топ-3 в лиге по итогам дня', 'league_rank_day', 3),
('league_top3_week', 'league', 'rare', '🥈', 'Топ-3 недели', 'Займите топ-3 в лиге по итогам недели', 'league_rank_week', 3),
('league_win_day', 'league', 'rare', '🔥', 'Победа дня', 'Займите 1 место в лиге по итогам дня', 'league_rank_day', 1),
('league_exact', 'league', 'rare', '🎯', 'Точный в лиге', 'Угадайте точный счёт, состоя в лиге', 'league_exact_total', 1),
('league_streak_7', 'league', 'rare', '🔁', 'Серия в лиге', 'Делайте прогнозы 7 дней подряд в лиге', 'league_streak', 7);

-- LEAGUE: Epic
INSERT INTO achievements (id, scope, rarity, emoji, title, description, condition_type, threshold) VALUES
('league_champion_week', 'league', 'epic', '🏆', 'Чемпион недели', 'Займите 1 место в лиге по итогам недели', 'league_rank_week', 1),
('league_champion_month', 'league', 'epic', '🥇', 'Чемпион месяца', 'Займите 1 место в лиге по итогам месяца', 'league_rank_month', 1),
('league_season_leader', 'league', 'epic', '👑', 'Лидер сезона', 'Займите 1 место в лиге по итогам сезона', 'league_rank_season', 1),
('league_win_streak_3in14', 'league', 'epic', '🔥🔁', 'Серия побед', 'Займите 1 место за день 3 раза за 2 недели', 'league_win_density', 3),
('league_perfect_day_win', 'league', 'epic', '✅✅✅', 'Идеальный день', 'Очки во всех 3 матчах + 1 место в лиге за день', 'league_perfect_win', 1),
('league_golden_joker_win', 'league', 'epic', '🃏🏅', 'Золотой джокер лиги', 'Точный счёт на джокере + 1 место в лиге за день', 'league_golden_win', 1);

