-- Migration: 0004_leagues.sql
-- League System: leagues, members, invites, scores aggregation

-- Leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  privacy TEXT DEFAULT 'private' CHECK (privacy IN ('public', 'private')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- League members
CREATE TABLE IF NOT EXISTS league_members (
  league_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (league_id, user_id),
  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- League invites
CREATE TABLE IF NOT EXISTS league_invites (
  code TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  created_by INTEGER NOT NULL,
  expires_at TEXT,
  max_uses INTEGER,
  uses INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE
);

-- Scores aggregation (for fast leaderboards)
CREATE TABLE IF NOT EXISTS scores_agg (
  user_id INTEGER NOT NULL,
  period TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

-- League scores cache (for LB3 - top leagues)
CREATE TABLE IF NOT EXISTS league_scores (
  league_id TEXT NOT NULL,
  period TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  members_count INTEGER DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (league_id, period)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scores_agg_period ON scores_agg(period, points DESC);
CREATE INDEX IF NOT EXISTS idx_scores_agg_user ON scores_agg(user_id, period);
CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_league_scores_period ON league_scores(period, score DESC);
CREATE INDEX IF NOT EXISTS idx_league_invites_league ON league_invites(league_id);
