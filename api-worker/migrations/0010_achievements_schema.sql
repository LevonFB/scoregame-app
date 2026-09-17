-- 0005_achievements_schema.sql

-- 1. Table: achievements (Definitions)
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,           -- 'global' | 'league'
  rarity TEXT NOT NULL,          -- 'common' | 'rare' | 'epic'
  emoji TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  condition_type TEXT NOT NULL,  -- Logic identifier
  threshold INTEGER DEFAULT 1,
  version INTEGER DEFAULT 1,     -- To track condition updates
  meta_json TEXT                 -- Extra params
);
CREATE INDEX IF NOT EXISTS idx_achievements_scope ON achievements(scope);

-- 2. Table: user_achievements (Progress & Unlocks)
-- Using DEFAULT '' instead of NULL for PK compatibility in SQLite/D1
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  scope_target_id TEXT NOT NULL DEFAULT '', -- '' for global, leagueId for league
  period_key TEXT NOT NULL DEFAULT 'all',   -- 'all', 'day:YYYY-MM-DD', 'week:YYYY-Wnn'
  progress INTEGER DEFAULT 0,
  unlocked_at INTEGER,           -- NULL if in progress, timestamp if unlocked
  meta_json TEXT,                -- { "version": 1 }
  PRIMARY KEY (user_id, achievement_id, scope_target_id, period_key)
);
-- Index for fetching "Recent Achievements" (Toasts)
CREATE INDEX IF NOT EXISTS idx_ua_recent ON user_achievements(user_id, unlocked_at DESC);

-- 3. Table: user_stats (Global Aggregates)
-- Speeds up checks for streaks, totals, etc.
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

-- 4. Table: user_day_stats (Daily Aggregates)
-- Speeds up checks for "Full Day", "Big Day", "3of3"
CREATE TABLE IF NOT EXISTS user_day_stats (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  picks_count INTEGER DEFAULT 0,
  picks_before_lock INTEGER DEFAULT 0, -- Crucial for "Early Start" / "Discipline"
  points INTEGER DEFAULT 0,
  exact_count INTEGER DEFAULT 0,
  diff_count INTEGER DEFAULT 0,
  outcome_count INTEGER DEFAULT 0,
  had_joker INTEGER DEFAULT 0,
  joker_points INTEGER DEFAULT 0,
  joker_exact INTEGER DEFAULT 0,
  earliest_pick_time INTEGER, -- Tie-breaker logic
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_uds_user ON user_day_stats(user_id);

-- 5. Table: league_day_stats (League Aggregates)
-- Speeds up League Leaderboard & Rank calculations
CREATE TABLE IF NOT EXISTS league_day_stats (
  league_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  exact_count INTEGER DEFAULT 0,
  joker_points INTEGER DEFAULT 0,
  earliest_pick_time INTEGER,
  PRIMARY KEY (league_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_lds_league_day ON league_day_stats(league_id, day);
