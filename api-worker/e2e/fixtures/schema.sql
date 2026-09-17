-- Stage 1 E2E — hand-built MINIMAL local schema.
--
-- WHY hand-built: the committed migrations under api-worker/migrations DO NOT
-- cleanly reproduce the live D1 schema (e.g. `wrangler d1 migrations apply --local`
-- fails on 0005 `no such column: deleted_at`, and several live columns such as
-- matches.unlock_time / users.balls were added out-of-band — see CLAUDE.md).
-- So for E2E we declare only the tables/columns the targeted endpoints touch.
-- This is a TEST fixture, never applied to production.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT,
  first_name   TEXT,
  last_name    TEXT,
  photo_url    TEXT,
  first_seen_at TEXT,
  balls        INTEGER DEFAULT 0,
  extra_league_slots INTEGER DEFAULT 0
);

-- Stage 4.1 — tables read by /me/boosts (legacy reconcile must keep working).
CREATE TABLE IF NOT EXISTS user_boosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  boost_type  TEXT,
  status      TEXT,
  purchased_at INTEGER
);
CREATE TABLE IF NOT EXISTS boost_usage (
  user_id    INTEGER,
  day        TEXT,
  boost_type TEXT,
  boost_id   INTEGER,
  match_id   TEXT,
  dc_variant TEXT
);

-- No season_id column => savePick()/getSeasonSchemaSupport use the legacy branch.
CREATE TABLE IF NOT EXISTS picks (
  day           TEXT NOT NULL,
  match_id      TEXT NOT NULL,
  user_id       INTEGER NOT NULL,
  home          INTEGER NOT NULL,
  away          INTEGER NOT NULL,
  joker         INTEGER NOT NULL DEFAULT 0,
  double_chance TEXT,
  updated_at    INTEGER,
  PRIMARY KEY (day, match_id, user_id)
);

CREATE TABLE IF NOT EXISTS pick_bonus_answers (
  day           TEXT NOT NULL,
  match_id      TEXT NOT NULL,
  user_id       INTEGER NOT NULL,
  question_type TEXT NOT NULL,
  answer        TEXT,
  updated_at    INTEGER,
  PRIMARY KEY (day, match_id, user_id, question_type)
);

CREATE TABLE IF NOT EXISTS pick_goalscorers (
  day         TEXT NOT NULL,
  user_id     INTEGER NOT NULL,
  match_id    TEXT NOT NULL,
  player_id   TEXT,
  player_name TEXT,
  updated_at  INTEGER,
  PRIMARY KEY (day, match_id, user_id)
);

-- No season_id column => matchesSeasonId=false (legacy savePick SELECT).
CREATE TABLE IF NOT EXISTS matches (
  match_id     TEXT PRIMARY KEY,
  day          TEXT,
  matchday_key TEXT,
  start_time   TEXT,
  lock_time    TEXT,
  unlock_time  TEXT,
  is_pick      INTEGER DEFAULT 1,
  status       TEXT,
  home         TEXT,
  away         TEXT,
  updated_at   INTEGER
);

CREATE TABLE IF NOT EXISTS seasons (
  id           INTEGER PRIMARY KEY,
  name         TEXT,
  slug         TEXT,
  status       TEXT,
  starts_at    TEXT,
  ends_at      TEXT,
  activated_at TEXT,
  finalized_at TEXT,
  archived_at  TEXT,
  display_order INTEGER,
  is_visible   INTEGER DEFAULT 1,
  notes        TEXT,
  created_at   TEXT,
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS league_members (
  league_id TEXT NOT NULL,
  user_id   INTEGER NOT NULL,
  role      TEXT,
  joined_at TEXT,
  left_at   TEXT,
  PRIMARY KEY (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS league_members_history (
  league_id  TEXT,
  user_id    INTEGER,
  role       TEXT,
  joined_at  TEXT,
  left_at    TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS balls_ledger (
  user_id      INTEGER,
  season_id    INTEGER,
  source       TEXT,
  task_key     TEXT,
  instance_key TEXT,
  balls        INTEGER,
  created_at   INTEGER
);

-- Tables needed by POST /leaderboard (buildLeaderboard) for Stage-2 E2E.
CREATE TABLE IF NOT EXISTS leagues (
  id         TEXT PRIMARY KEY,
  owner_id   INTEGER,
  type       TEXT,
  name       TEXT,
  created_at TEXT,
  deleted_at TEXT,
  avatar_url TEXT,
  avatar_type TEXT,
  telegram_chat_id INTEGER,
  telegram_chat_title TEXT,
  telegram_chat_username TEXT
);

CREATE TABLE IF NOT EXISTS results (
  day          TEXT,
  match_id     TEXT,
  home         INTEGER,
  away         INTEGER,
  finalized_at INTEGER,
  is_manual    INTEGER DEFAULT 0,
  season_id    INTEGER,
  PRIMARY KEY (day, match_id)
);

CREATE TABLE IF NOT EXISTS match_bonus_questions (
  day           TEXT NOT NULL,
  match_id      TEXT NOT NULL,
  question_type TEXT NOT NULL,
  is_enabled    INTEGER DEFAULT 0,
  points_award  INTEGER DEFAULT 1,
  correct_answer TEXT,
  resolved_at   INTEGER,
  resolved_source TEXT,
  player_config_json TEXT,
  updated_at    INTEGER,
  PRIMARY KEY (day, match_id, question_type)
);

-- Stage 15 — match_goalscorer_settings (touched by the scoring/recalc resolve path).
CREATE TABLE IF NOT EXISTS match_goalscorer_settings (
  day          TEXT NOT NULL,
  match_id     TEXT NOT NULL,
  enabled      INTEGER DEFAULT 0,
  correct_answer TEXT,
  player_config_json TEXT,
  scorers_json TEXT,
  resolved_at  INTEGER,
  resolved_source TEXT,
  updated_at   INTEGER,
  PRIMARY KEY (day, match_id)
);

CREATE TABLE IF NOT EXISTS user_season_progress (
  user_id          INTEGER NOT NULL,
  season_number    INTEGER NOT NULL,
  stars            INTEGER DEFAULT 0,
  level            INTEGER DEFAULT 1,
  gold_avatar_frame INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, season_number)
);

-- Stage 4.1 — daily-quest legacy reward cascade tables (lets legacy fully apply).
CREATE TABLE IF NOT EXISTS user_task_progress (
  user_id      INTEGER NOT NULL,
  season_id    INTEGER NOT NULL,
  task_key     TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  progress     INTEGER DEFAULT 0,
  completed_at INTEGER,
  reward_granted INTEGER DEFAULT 0,
  shown_at     INTEGER,
  PRIMARY KEY (user_id, season_id, task_key, instance_key)
);

CREATE TABLE IF NOT EXISTS stars_ledger (
  user_id      INTEGER NOT NULL,
  season_id    INTEGER NOT NULL,
  source       TEXT,
  task_key     TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  stars        INTEGER,
  created_at   INTEGER,
  metadata_json TEXT,
  UNIQUE (user_id, season_id, task_key, instance_key)
);

CREATE TABLE IF NOT EXISTS scores_agg (
  user_id INTEGER NOT NULL,
  period  TEXT NOT NULL,
  points  INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- Stage 3 — daily case backfill V2 tables.
CREATE TABLE IF NOT EXISTS tasks_catalog (
  task_key     TEXT PRIMARY KEY,
  task_type    TEXT,
  sort_order   INTEGER DEFAULT 100,
  is_enabled   INTEGER DEFAULT 1,
  league_only  INTEGER DEFAULT 0,
  reward_stars INTEGER DEFAULT 0,
  reward_balls INTEGER DEFAULT 0,
  emoji        TEXT,
  phase        TEXT,
  rarity       TEXT
);

CREATE TABLE IF NOT EXISTS daily_quest_progress (
  day          TEXT NOT NULL,
  user_id      INTEGER NOT NULL,
  quest_id     TEXT NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  stars_awarded INTEGER DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (day, user_id, quest_id)
);

CREATE TABLE IF NOT EXISTS user_day_stats (
  user_id           INTEGER NOT NULL,
  day               TEXT NOT NULL,
  picks_count       INTEGER DEFAULT 0,
  picks_before_lock INTEGER DEFAULT 0,
  points            INTEGER DEFAULT 0,
  exact_count       INTEGER DEFAULT 0,
  diff_count        INTEGER DEFAULT 0,
  outcome_count     INTEGER DEFAULT 0,
  had_joker         INTEGER DEFAULT 0,
  joker_points      INTEGER DEFAULT 0,
  joker_exact       INTEGER DEFAULT 0,
  earliest_pick_time INTEGER,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS daily_cases (
  user_id   INTEGER NOT NULL,
  day       TEXT NOT NULL,
  earned    INTEGER NOT NULL DEFAULT 0,
  earned_at INTEGER,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS user_cases (
  user_id   INTEGER NOT NULL,
  case_type TEXT NOT NULL,
  quantity  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, case_type)
);

CREATE TABLE IF NOT EXISTS case_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  case_type       TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  quantity_before INTEGER,
  quantity_after  INTEGER,
  operation_type  TEXT,
  comment         TEXT,
  created_at      INTEGER
);

CREATE TABLE IF NOT EXISTS case_opens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  case_type     TEXT NOT NULL,
  open_id       TEXT,
  reward_type   TEXT,
  reward_amount INTEGER,
  balls_spent   INTEGER DEFAULT 0,
  created_at    INTEGER
);

CREATE TABLE IF NOT EXISTS shop_cases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT,
  is_active   INTEGER DEFAULT 1,
  price_balls INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shop_case_rewards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id       INTEGER,
  is_active     INTEGER DEFAULT 1,
  chance_percent REAL,
  reward_type   TEXT,
  reward_amount INTEGER
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  action       TEXT,
  payload_json TEXT,
  created_at   TEXT,
  actor_id     INTEGER
);

-- Mirrors migrations/0089_daily_case_backfill_jobs.sql (E2E fixture).
CREATE TABLE IF NOT EXISTS daily_case_backfill_jobs (
  job_key                TEXT PRIMARY KEY,
  matchday_key           TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  run_id                 TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  started_at             INTEGER,
  heartbeat_at           INTEGER,
  completed_at           INTEGER,
  failed_at              INTEGER,
  last_error_code        TEXT,
  processed_eligible_users INTEGER NOT NULL DEFAULT 0,
  eligible_users         INTEGER NOT NULL DEFAULT 0,
  restored_cases         INTEGER NOT NULL DEFAULT 0,
  skipped_existing_cases INTEGER NOT NULL DEFAULT 0,
  failed_items           INTEGER NOT NULL DEFAULT 0,
  cursor_user_id         INTEGER NOT NULL DEFAULT 0,
  dry_run                INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER,
  updated_at             INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dcbj_status ON daily_case_backfill_jobs(status);
CREATE INDEX IF NOT EXISTS idx_dcbj_matchday ON daily_case_backfill_jobs(matchday_key);

-- Stage 6 — weekly finalizer V2 tables (mirrors migrations/0090_*.sql).
CREATE TABLE IF NOT EXISTS weekly_finalizer_jobs (
  job_key           TEXT PRIMARY KEY,
  season_id         INTEGER,
  week_key          TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  run_id            TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  started_at        INTEGER,
  heartbeat_at      INTEGER,
  completed_at      INTEGER,
  failed_at         INTEGER,
  last_error_code   TEXT,
  finalized_periods INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER,
  updated_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wfj_status ON weekly_finalizer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_wfj_season_week ON weekly_finalizer_jobs(season_id, week_key);

-- Weekly finalization output tables (so finalizeWeeklyPeriod can fully apply).
CREATE TABLE IF NOT EXISTS weekly_finalizations (
  season_id    INTEGER NOT NULL,
  week_key     TEXT NOT NULL,
  week_start   TEXT,
  week_end     TEXT,
  cutoff_at    INTEGER,
  finalized_at INTEGER,
  reason       TEXT,
  PRIMARY KEY (season_id, week_key)
);
CREATE TABLE IF NOT EXISTS weekly_league_standings_snapshot (
  season_id  INTEGER,
  week_key   TEXT,
  league_id  TEXT,
  user_id    INTEGER,
  rank       INTEGER,
  points     INTEGER,
  created_at INTEGER
);

-- Stage 8 — partner campaigns / claims / events / reward logs (additive; other
-- suites do not touch partner endpoints, so this is inert for them).
CREATE TABLE IF NOT EXISTS partner_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 't',
  description TEXT NOT NULL DEFAULT '',
  sponsor_name TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,
  telegram_username TEXT,
  bot_username TEXT,
  deep_link TEXT,
  verification_secret TEXT,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_payload_json TEXT,
  hold_hours INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER,
  ends_at INTEGER,
  max_total_claims INTEGER,
  max_claims_per_user INTEGER NOT NULL DEFAULT 1,
  completed_claims_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  is_visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS partner_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  verify_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at INTEGER,
  verified_at INTEGER,
  hold_until INTEGER,
  completed_at INTEGER,
  reward_granted_at INTEGER,
  failed_reason TEXT,
  verification_payload_json TEXT,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(campaign_id, user_id),
  UNIQUE(verify_token)
);
CREATE INDEX IF NOT EXISTS idx_partner_claims_status_hold ON partner_claims(status, hold_until, campaign_id);

CREATE TABLE IF NOT EXISTS partner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  claim_id INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS partner_reward_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(claim_id)
);


-- Stage 10 — league_day_stats + the existing (migration 0010) index, so the SQL V2
-- period predicate can be EXPLAIN-verified to use idx_lds_league_day.
CREATE TABLE IF NOT EXISTS league_day_stats (
  league_id          TEXT NOT NULL,
  user_id            INTEGER NOT NULL,
  day                TEXT NOT NULL,
  points             INTEGER DEFAULT 0,
  exact_count        INTEGER DEFAULT 0,
  joker_points       INTEGER DEFAULT 0,
  earliest_pick_time INTEGER DEFAULT 0,
  PRIMARY KEY (league_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_lds_league_day ON league_day_stats(league_id, day);

-- Stage 13 — seasonal shadow: achievements + user_achievements + user_stats.
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'common',
  emoji TEXT NOT NULL DEFAULT '*',
  title TEXT NOT NULL DEFAULT 't',
  description TEXT NOT NULL DEFAULT '',
  condition_type TEXT NOT NULL,
  threshold INTEGER DEFAULT 1,
  stars_reward INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  meta_json TEXT
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  scope_target_id TEXT NOT NULL DEFAULT '',
  period_key TEXT NOT NULL DEFAULT 'all',
  progress INTEGER DEFAULT 0,
  unlocked_at INTEGER,
  earned_at INTEGER,
  state TEXT,
  shown_at INTEGER,
  context_day TEXT,
  context_match_id TEXT,
  meta_json TEXT,
  PRIMARY KEY (user_id, achievement_id, scope_target_id, period_key)
);
CREATE TABLE IF NOT EXISTS user_stats (
  user_id INTEGER PRIMARY KEY,
  total_picks INTEGER DEFAULT 0,
  total_exact INTEGER DEFAULT 0,
  total_diff INTEGER DEFAULT 0,
  total_outcome INTEGER DEFAULT 0,
  best_day_points INTEGER DEFAULT 0,
  streak_current INTEGER DEFAULT 0,
  streak_best INTEGER DEFAULT 0,
  last_active_day TEXT,
  joker_exact_count INTEGER DEFAULT 0,
  updated_at INTEGER
);
