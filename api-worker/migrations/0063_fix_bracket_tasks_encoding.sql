-- Fix double-encoded Cyrillic text in bracket_tasks_catalog.
-- Caused by UTF-8 bytes being misinterpreted as CP1251 when the original
-- migration was applied. This DELETE+INSERT restores the correct values.

DELETE FROM bracket_tasks_catalog;

INSERT INTO bracket_tasks_catalog
  (task_key, mode, condition_key, title, description, reward_stars, reward_balls, reward_case_type, reward_case_count, progress_target, claim_mode, is_enabled, sort_order)
VALUES
  ('bracket_first_step',           'full_tournament', 'full_bracket_started',              'Первый шаг',            'Начать заполнение полной сетки ЧМ-2026',            10,  0, NULL,        0, 1,  'auto', 1, 501),
  ('bracket_groups_completed',     'full_tournament', 'full_groups_completed',              'Группы собраны',        'Расставить все 12 групп',                           25,  0, NULL,        0, 12, 'auto', 1, 502),
  ('bracket_thirds_selected',      'full_tournament', 'third_places_selected',              'Третьи места выбраны', 'Выбрать 8 лучших третьих мест',                     15,  0, NULL,        0, 8,  'auto', 1, 503),
  ('bracket_full_knockout_completed','full_tournament','full_knockout_completed',            'Путь к финалу',        'Заполнить весь плей-офф в полной сетке',            25,  0, NULL,        0, 1,  'auto', 1, 504),
  ('bracket_full_champion_selected','full_tournament', 'full_champion_selected',            'Мой чемпион',          'Выбрать чемпиона мира',                             20,  0, NULL,        0, 1,  'auto', 1, 505),
  ('bracket_full_submitted',       'full_tournament', 'full_bracket_submitted',             'Сетка подтверждена',   'Подтвердить полную сетку до дедлайна',               0,  0, 'daily_free', 1, 1,  'auto', 1, 506),
  ('bracket_second_started',       'second_chance',   'second_chance_started',              'Второй шанс',          'Начать сетку плей-офф после групп',                 10,  0, NULL,        0, 1,  'auto', 1, 507),
  ('bracket_second_completed',     'second_chance',   'second_chance_completed',            'Плей-офф собран',      'Заполнить второй шанс до чемпиона',                 25,  0, NULL,        0, 1,  'auto', 1, 508),
  ('bracket_second_submitted',     'second_chance',   'second_chance_submitted',            'Последняя ставка',     'Подтвердить второй шанс до дедлайна',                0,  0, 'daily_free', 1, 1,  'auto', 1, 509),
  ('bracket_qualified_24',         'full_tournament', 'qualified_teams_correct_at_least',   'Участники плей-офф',   'Угадать минимум 24 из 32 команд плей-офф',          40,  0, NULL,        0, 24, 'auto', 1, 510),
  ('bracket_qualified_28',         'full_tournament', 'qualified_teams_correct_at_least',   'Почти идеальный отбор','Угадать минимум 28 из 32 команд плей-офф',          75,  0, NULL,        0, 28, 'auto', 1, 511),
  ('bracket_perfect_groups_3',     'full_tournament', 'perfect_groups_at_least',            'Король групп',         'Полностью угадать минимум 3 группы',                60,  0, NULL,        0, 3,  'auto', 1, 512),
  ('bracket_thirds_all_correct',   'full_tournament', 'third_places_all_correct',           'Мастер третьих мест',  'Угадать все 8 лучших третьих мест',                 75, 10, NULL,        0, 8,  'auto', 1, 513),
  ('bracket_finalists_all_correct','full_tournament', 'finalists_all_correct',              'Финалист',             'Угадать обе команды финала в полной сетке',        100, 15, NULL,        0, 2,  'auto', 1, 514),
  ('bracket_champion_correct',     'full_tournament', 'champion_correct',                   'Пророк чемпионата',    'Угадать чемпиона мира в полной сетке',             150, 25, NULL,        0, 1,  'auto', 1, 515);
