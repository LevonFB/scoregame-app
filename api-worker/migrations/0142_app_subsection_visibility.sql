-- 0142_app_subsection_visibility.sql
-- Admin-controlled visibility for subsections (tabs inside a section), e.g.
-- «Еврокубки» / «Топ-5 лиг» inside «Прогнозы сезона».
-- Reuses app_section_visibility: a subsection row carries parent_key and a
-- namespaced section_key `<parent>.<subsection>`. Pure UI/access gating —
-- does NOT touch any feature data. All rows seed as visible_to_all, so the
-- app looks exactly the same right after deploy.

ALTER TABLE app_section_visibility ADD COLUMN parent_key TEXT;

INSERT OR IGNORE INTO app_section_visibility (section_key, parent_key, title, visibility, sort_order) VALUES
  ('season_predictions.top_leagues',   'season_predictions', 'Топ-5 лиг',       'visible_to_all', 31),
  ('season_predictions.european_cups', 'season_predictions', 'Еврокубки',       'visible_to_all', 32),
  ('leaderboard.players',              'leaderboard',        'Игроки',          'visible_to_all', 61),
  ('leaderboard.leagues',              'leaderboard',        'Лиги',            'visible_to_all', 62),
  ('leaderboard.channels',             'leaderboard',        'Каналы',          'visible_to_all', 63),
  ('tasks.daily',                      'tasks',              'Ежедневные',      'visible_to_all', 71),
  ('tasks.weekly',                     'tasks',              'Еженедельные',    'visible_to_all', 72),
  ('tasks.season',                     'tasks',              'Прогнозы сезона', 'visible_to_all', 73),
  ('tasks.weekly_challenge',           'tasks',              'Вызов недели',    'visible_to_all', 74),
  ('tasks.partner',                    'tasks',              'Партнёрские',     'visible_to_all', 75),
  ('shop.boosts',                      'shop',               'Бусты',           'visible_to_all', 81),
  ('shop.luck',                        'shop',               'Фортуна',         'visible_to_all', 82),
  ('shop.topup',                       'shop',               'Мячи',            'visible_to_all', 83),
  ('shop.exchange',                    'shop',               'Обмен',           'visible_to_all', 84);

CREATE INDEX IF NOT EXISTS idx_asv_parent ON app_section_visibility(parent_key);
