-- 0074_app_section_visibility.sql
-- Admin-controlled visibility for app menu sections / routes.
-- Pure UI/access gating — does NOT touch any feature data.

CREATE TABLE IF NOT EXISTS app_section_visibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'visible_to_all'
    CHECK (visibility IN ('visible_to_all','admin_only','hidden')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  updated_by_admin_id INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_asv_section ON app_section_visibility(section_key);

-- Seed defaults. All existing sections default to visible_to_all so the current
-- menu is unchanged after deploy. weekly_challenge (newly extracted) is also
-- visible_to_all to preserve the continuity it had as a season-predictions tab.
INSERT OR IGNORE INTO app_section_visibility (section_key, title, visibility, sort_order) VALUES
  ('home',               'Главная',          'visible_to_all', 10),
  ('predictions',        'Прогнозы',         'visible_to_all', 20),
  ('season_predictions', 'Прогнозы сезона',  'visible_to_all', 30),
  ('weekly_challenge',   'Вызов недели',     'visible_to_all', 35),
  ('wc2026_bracket',     'Сетка ЧМ-2026',    'visible_to_all', 40),
  ('leagues',            'Лиги',             'visible_to_all', 50),
  ('leaderboard',        'Рейтинг',          'visible_to_all', 60),
  ('tasks',              'Задания',          'visible_to_all', 70),
  ('shop',               'Магазин',          'visible_to_all', 80),
  ('profile',            'Профиль',          'visible_to_all', 90),
  ('info',               'Информация',       'visible_to_all', 100);
