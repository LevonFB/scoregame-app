ALTER TABLE users ADD COLUMN first_seen_at TEXT;

UPDATE users
SET first_seen_at = (
  SELECT MIN(event_at)
  FROM (
    SELECT datetime(MIN(p.updated_at) / 1000, 'unixepoch') AS event_at
    FROM picks p
    WHERE p.user_id = users.id

    UNION ALL

    SELECT MIN(lm.joined_at) AS event_at
    FROM league_members lm
    WHERE lm.user_id = users.id

    UNION ALL

    SELECT datetime(MIN(co.created_at) / 1000, 'unixepoch') AS event_at
    FROM case_opens co
    WHERE co.user_id = users.id

    UNION ALL

    SELECT MIN(bt.created_at) AS event_at
    FROM ball_transactions bt
    WHERE bt.user_id = users.id

    UNION ALL

    SELECT MIN(ct.created_at) AS event_at
    FROM case_transactions ct
    WHERE ct.user_id = users.id
  ) user_events
  WHERE event_at IS NOT NULL
)
WHERE first_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_first_seen_at
ON users(first_seen_at);
