-- 0041_league_membership_history.sql
-- Historical league membership intervals for season-aware standings

-- ALTER TABLE leagues ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_leagues_deleted_at
  ON leagues(deleted_at);

CREATE TABLE IF NOT EXISTS league_members_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_league_members_history_league_user
  ON league_members_history(league_id, user_id, joined_at);

CREATE INDEX IF NOT EXISTS idx_league_members_history_user
  ON league_members_history(user_id, joined_at);

CREATE INDEX IF NOT EXISTS idx_league_members_history_open
  ON league_members_history(league_id, left_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_league_members_history_open_unique
  ON league_members_history(league_id, user_id)
  WHERE left_at IS NULL;

INSERT INTO league_members_history (
  league_id,
  user_id,
  role,
  joined_at,
  left_at,
  created_at,
  updated_at
)
SELECT
  lm.league_id,
  lm.user_id,
  COALESCE(lm.role, 'member'),
  COALESCE(lm.joined_at, l.created_at, datetime('now')),
  NULL,
  COALESCE(lm.joined_at, l.created_at, datetime('now')),
  datetime('now')
FROM league_members lm
LEFT JOIN leagues l ON l.id = lm.league_id
WHERE NOT EXISTS (
  SELECT 1
  FROM league_members_history h
  WHERE h.league_id = lm.league_id
    AND h.user_id = lm.user_id
    AND h.left_at IS NULL
);
