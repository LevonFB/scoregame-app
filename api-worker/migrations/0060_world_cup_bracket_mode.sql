-- 0060_world_cup_bracket_mode.sql
-- Full FIFA World Cup 2026 bracket challenge.
-- Old prototype bracket drafts are intentionally reset; they were test-only.

DROP TABLE IF EXISTS user_brackets;
DROP TABLE IF EXISTS brackets;

CREATE TABLE IF NOT EXISTS bracket_tasks_catalog (
  task_key TEXT PRIMARY KEY,
  mode TEXT CHECK (mode IN ('full_tournament','second_chance')),
  condition_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  reward_balls INTEGER NOT NULL DEFAULT 0,
  reward_case_type TEXT,
  reward_case_count INTEGER NOT NULL DEFAULT 0,
  progress_target INTEGER NOT NULL DEFAULT 1,
  claim_mode TEXT NOT NULL DEFAULT 'auto' CHECK (claim_mode IN ('auto','manual')),
  is_enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  available_from INTEGER,
  available_until INTEGER,
  limit_per_user INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS world_cup_tournament_state (
  id TEXT PRIMARY KEY DEFAULT 'wc2026',
  season_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pre_tournament'
    CHECK (status IN (
      'pre_tournament',
      'full_bracket_locked',
      'group_stage_in_progress',
      'group_stage_finalized',
      'second_chance_open',
      'second_chance_locked',
      'knockout_in_progress',
      'tournament_completed',
      'rewards_distributed'
    )),
  full_bracket_open_at INTEGER,
  full_bracket_deadline_at INTEGER,
  second_chance_open_at INTEGER,
  second_chance_deadline_at INTEGER,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

INSERT OR IGNORE INTO world_cup_tournament_state (id, status, settings_json)
VALUES ('wc2026', 'pre_tournament', '{"full_enabled":true,"second_chance_enabled":false,"allow_edit_until_deadline":true}');

CREATE TABLE IF NOT EXISTS world_cup_provider_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('football_data','allsports')),
  data_type TEXT NOT NULL CHECK (data_type IN ('groups','match','standings','knockout')),
  external_id TEXT,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  used_for_confirmation INTEGER NOT NULL DEFAULT 0,
  confirmed_by INTEGER,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wc_snapshots_type ON world_cup_provider_snapshots(provider, data_type, fetched_at DESC);

CREATE TABLE IF NOT EXISTS world_cup_group_standings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_code TEXT NOT NULL CHECK (group_code IN ('A','B','C','D','E','F','G','H','I','J','K','L')),
  team_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
  points INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  drawn INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  goals_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  goal_difference INTEGER NOT NULL DEFAULT 0,
  qualified_to_r32 INTEGER NOT NULL DEFAULT 0,
  is_third_place_qualified INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  source_snapshot_id INTEGER,
  is_manual INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  confirmed_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(group_code, team_id),
  UNIQUE(group_code, position)
);
CREATE INDEX IF NOT EXISTS idx_wc_group_standings_confirmed ON world_cup_group_standings(group_code, confirmed_at);

CREATE TABLE IF NOT EXISTS world_cup_third_places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL,
  group_code TEXT NOT NULL CHECK (group_code IN ('A','B','C','D','E','F','G','H','I','J','K','L')),
  third_place_rank INTEGER NOT NULL CHECK (third_place_rank BETWEEN 1 AND 12),
  qualified_to_r32 INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  is_manual INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  confirmed_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(team_id),
  UNIQUE(group_code)
);
CREATE INDEX IF NOT EXISTS idx_wc_third_places_qualified ON world_cup_third_places(qualified_to_r32, third_place_rank);

CREATE TABLE IF NOT EXISTS world_cup_knockout_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round TEXT NOT NULL CHECK (round IN ('r32','r16','qf','sf','final')),
  match_slot TEXT NOT NULL,
  football_data_match_id TEXT,
  allsports_match_id TEXT,
  team_a_id TEXT,
  team_b_id TEXT,
  score_a INTEGER,
  score_b INTEGER,
  penalties_a INTEGER,
  penalties_b INTEGER,
  winner_team_id TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_play','finished','confirmed')),
  source TEXT NOT NULL DEFAULT 'manual',
  is_manual INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  confirmed_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(round, match_slot)
);
CREATE INDEX IF NOT EXISTS idx_wc_knockout_status ON world_cup_knockout_matches(round, status, confirmed_at);

CREATE TABLE IF NOT EXISTS world_cup_team_stage_reached (
  team_id TEXT PRIMARY KEY,
  reached_r32 INTEGER NOT NULL DEFAULT 0,
  reached_r16 INTEGER NOT NULL DEFAULT 0,
  reached_qf INTEGER NOT NULL DEFAULT 0,
  reached_sf INTEGER NOT NULL DEFAULT 0,
  reached_final INTEGER NOT NULL DEFAULT 0,
  is_champion INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS user_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  season_id INTEGER,
  mode TEXT NOT NULL CHECK (mode IN ('full_tournament','second_chance')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','locked','scoring','completed')),
  bracket_data_json TEXT NOT NULL DEFAULT '{}',
  score_total INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER,
  last_submitted_at INTEGER,
  locked_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_user_brackets_mode_status ON user_brackets(mode, status, score_total DESC);
CREATE INDEX IF NOT EXISTS idx_user_brackets_user ON user_brackets(user_id, mode);

CREATE TABLE IF NOT EXISTS user_bracket_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  bracket_id INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('full_tournament','second_chance')),
  qualified_teams_points INTEGER NOT NULL DEFAULT 0,
  group_positions_points INTEGER NOT NULL DEFAULT 0,
  perfect_groups_bonus INTEGER NOT NULL DEFAULT 0,
  third_places_points INTEGER NOT NULL DEFAULT 0,
  knockout_points INTEGER NOT NULL DEFAULT 0,
  bonus_points INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  qualified_teams_correct INTEGER NOT NULL DEFAULT 0,
  group_positions_correct INTEGER NOT NULL DEFAULT 0,
  perfect_groups_correct INTEGER NOT NULL DEFAULT 0,
  third_places_correct INTEGER NOT NULL DEFAULT 0,
  r16_correct INTEGER NOT NULL DEFAULT 0,
  qf_correct INTEGER NOT NULL DEFAULT 0,
  sf_correct INTEGER NOT NULL DEFAULT 0,
  finalists_correct INTEGER NOT NULL DEFAULT 0,
  champion_correct INTEGER NOT NULL DEFAULT 0,
  calculated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  calculation_version TEXT NOT NULL,
  UNIQUE(bracket_id, calculation_version)
);
CREATE INDEX IF NOT EXISTS idx_user_bracket_scores_mode_total ON user_bracket_scores(mode, total_points DESC);

CREATE TABLE IF NOT EXISTS bracket_leaderboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('full_tournament','second_chance')),
  scope TEXT NOT NULL CHECK (scope IN ('global','private_league','channel_league')),
  league_id TEXT,
  user_id INTEGER NOT NULL,
  bracket_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  tiebreaker_json TEXT NOT NULL DEFAULT '{}',
  calculated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(mode, scope, league_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bracket_leaderboards_lookup ON bracket_leaderboards(mode, scope, league_id, rank);

CREATE TABLE IF NOT EXISTS bracket_reward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('full_tournament','second_chance')),
  scope TEXT NOT NULL CHECK (scope IN ('global','private_league','channel_league')),
  rank_from INTEGER NOT NULL,
  rank_to INTEGER NOT NULL,
  reward_stars INTEGER NOT NULL DEFAULT 0,
  reward_balls INTEGER NOT NULL DEFAULT 0,
  reward_case_type TEXT,
  reward_case_count INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_manual_approval INTEGER NOT NULL DEFAULT 1,
  auto_distribution INTEGER NOT NULL DEFAULT 0,
  eligibility_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS reward_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bracket_quest','bracket_final_reward','manual_admin')),
  source_id TEXT,
  unique_key TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('stars','balls','case')),
  amount INTEGER NOT NULL DEFAULT 0,
  case_type TEXT,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  granted_by INTEGER,
  revoked_at INTEGER,
  revoked_by INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_user ON reward_ledger(user_id, granted_at DESC);

INSERT OR IGNORE INTO bracket_reward_rules
  (mode, scope, rank_from, rank_to, reward_stars, reward_balls, reward_case_type, reward_case_count, requires_manual_approval)
VALUES
  ('full_tournament', 'global', 1, 1, 0, 300, 'premium', 3, 1),
  ('full_tournament', 'global', 2, 2, 0, 200, 'premium', 2, 1),
  ('full_tournament', 'global', 3, 3, 0, 150, 'premium', 1, 1),
  ('full_tournament', 'global', 4, 10, 0, 75, 'daily_free', 1, 1),
  ('full_tournament', 'global', 11, 50, 0, 25, NULL, 0, 1),
  ('full_tournament', 'global', 1, 999999, 25, 0, NULL, 0, 1),
  ('second_chance', 'global', 1, 1, 0, 100, 'premium', 1, 1),
  ('second_chance', 'global', 2, 3, 0, 75, NULL, 0, 1),
  ('second_chance', 'global', 4, 10, 0, 30, NULL, 0, 1),
  ('second_chance', 'global', 1, 999999, 10, 0, NULL, 0, 1);

INSERT OR IGNORE INTO bracket_tasks_catalog
  (task_key, mode, condition_key, title, description, reward_stars, reward_balls, reward_case_type, reward_case_count, progress_target, claim_mode, is_enabled, sort_order)
VALUES
  ('bracket_first_step', 'full_tournament', 'full_bracket_started', 'Первый шаг', 'Начать заполнение полной сетки ЧМ-2026', 10, 0, NULL, 0, 1, 'auto', 1, 501),
  ('bracket_groups_completed', 'full_tournament', 'full_groups_completed', 'Группы собраны', 'Расставить все 12 групп', 25, 0, NULL, 0, 12, 'auto', 1, 502),
  ('bracket_thirds_selected', 'full_tournament', 'third_places_selected', 'Третьи места выбраны', 'Выбрать 8 лучших третьих мест', 15, 0, NULL, 0, 8, 'auto', 1, 503),
  ('bracket_full_knockout_completed', 'full_tournament', 'full_knockout_completed', 'Путь к финалу', 'Заполнить весь плей-офф в полной сетке', 25, 0, NULL, 0, 1, 'auto', 1, 504),
  ('bracket_full_champion_selected', 'full_tournament', 'full_champion_selected', 'Мой чемпион', 'Выбрать чемпиона мира', 20, 0, NULL, 0, 1, 'auto', 1, 505),
  ('bracket_full_submitted', 'full_tournament', 'full_bracket_submitted', 'Сетка подтверждена', 'Подтвердить полную сетку до дедлайна', 0, 0, 'daily_free', 1, 1, 'auto', 1, 506),
  ('bracket_second_started', 'second_chance', 'second_chance_started', 'Второй шанс', 'Начать сетку плей-офф после групп', 10, 0, NULL, 0, 1, 'auto', 1, 507),
  ('bracket_second_completed', 'second_chance', 'second_chance_completed', 'Плей-офф собран', 'Заполнить второй шанс до чемпиона', 25, 0, NULL, 0, 1, 'auto', 1, 508),
  ('bracket_second_submitted', 'second_chance', 'second_chance_submitted', 'Последняя ставка', 'Подтвердить второй шанс до дедлайна', 0, 0, 'daily_free', 1, 1, 'auto', 1, 509),
  ('bracket_qualified_24', 'full_tournament', 'qualified_teams_correct_at_least', 'Участники плей-офф', 'Угадать минимум 24 из 32 команд плей-офф', 40, 0, NULL, 0, 24, 'auto', 1, 510),
  ('bracket_qualified_28', 'full_tournament', 'qualified_teams_correct_at_least', 'Почти идеальный отбор', 'Угадать минимум 28 из 32 команд плей-офф', 75, 0, NULL, 0, 28, 'auto', 1, 511),
  ('bracket_perfect_groups_3', 'full_tournament', 'perfect_groups_at_least', 'Король групп', 'Полностью угадать минимум 3 группы', 60, 0, NULL, 0, 3, 'auto', 1, 512),
  ('bracket_thirds_all_correct', 'full_tournament', 'third_places_all_correct', 'Мастер третьих мест', 'Угадать все 8 лучших третьих мест', 75, 10, NULL, 0, 8, 'auto', 1, 513),
  ('bracket_finalists_all_correct', 'full_tournament', 'finalists_all_correct', 'Финалист', 'Угадать обе команды финала в полной сетке', 100, 15, NULL, 0, 2, 'auto', 1, 514),
  ('bracket_champion_correct', 'full_tournament', 'champion_correct', 'Пророк чемпионата', 'Угадать чемпиона мира в полной сетке', 150, 25, NULL, 0, 1, 'auto', 1, 515);
