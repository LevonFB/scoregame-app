-- 0144_app_task_season_subsections.sql
-- Third visibility level: the task groups inside «Задания» → «Прогнозы сезона».
-- Their parent_key is itself a subsection (tasks.season), which the resolver
-- handles by walking parents depth-first. Ids mirror the section ids the
-- season-tasks endpoint returns (start / top5 / europe).
-- Pure UI/access gating — does NOT touch any task, progress or reward data.
-- Seeded as visible_to_all, so nothing changes until an admin toggles one.

INSERT OR IGNORE INTO app_section_visibility (section_key, parent_key, title, visibility, sort_order) VALUES
  ('tasks.season.start',  'tasks.season', 'Старт сезона', 'visible_to_all', 731),
  ('tasks.season.top5',   'tasks.season', 'Топ-5 лиг',    'visible_to_all', 732),
  ('tasks.season.europe', 'tasks.season', 'Еврокубки',    'visible_to_all', 733);
