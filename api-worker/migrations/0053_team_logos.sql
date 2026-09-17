-- matches.api_provider — which provider a row came from (Football-Data / AllSports).
-- Production got the column outside migrations; added here 2026-08-05 so a from-scratch
-- build matches. 0053 is recorded as applied in production, so this ALTER only runs on
-- a fresh database.
ALTER TABLE matches ADD COLUMN api_provider TEXT DEFAULT 'Football-Data';

-- Persistent team logo cache: stores Cloudinary URL per AllSports team ID
-- Eliminates repeated AllSports API requests for logos (counts toward 100/day limit)
CREATE TABLE IF NOT EXISTS team_logos (
  team_id   TEXT PRIMARY KEY,
  url       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
