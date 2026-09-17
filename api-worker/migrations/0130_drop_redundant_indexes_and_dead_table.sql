-- 0130: schema hygiene — drop redundant indexes and a dead table.
-- Data impact: none. Every dropped index is an exact copy or a leading-column
-- prefix of the table's PRIMARY KEY / UNIQUE constraint, so uniqueness and
-- index coverage are preserved by the implicit constraint indexes.
-- maintenance_log (migration 0018) was superseded by maintenance_event_log
-- (0019) and has zero references in code.

-- Dead table (superseded by maintenance_event_log)
DROP TABLE IF EXISTS maintenance_log;

-- Exact duplicate of idx_leagues_deleted_at (both on leagues(deleted_at))
DROP INDEX IF EXISTS idx_leagues_active;

-- Exact copies of the table PRIMARY KEY
DROP INDEX IF EXISTS idx_league_members_unique;        -- PK (league_id, user_id)
DROP INDEX IF EXISTS idx_scores_agg_user;              -- PK (user_id, period)
DROP INDEX IF EXISTS idx_featured_matches_day_match_id; -- PK (day, match_id)

-- Leading-column prefixes of the table PRIMARY KEY
DROP INDEX IF EXISTS idx_uds_user;                     -- PK (user_id, day)
DROP INDEX IF EXISTS idx_matches_day;                  -- PK (day, match_id)

-- Duplicates of table-level UNIQUE constraints
DROP INDEX IF EXISTS idx_featured_matches_day_pos;     -- UNIQUE (day, pos)
DROP INDEX IF EXISTS idx_asv_section;                  -- section_key UNIQUE
DROP INDEX IF EXISTS idx_pending_binds_token;          -- token UNIQUE
DROP INDEX IF EXISTS idx_sps_code;                     -- code UNIQUE
DROP INDEX IF EXISTS idx_spor_tournament;              -- season_prediction_tournament_id UNIQUE
DROP INDEX IF EXISTS idx_spwce_user_challenge;         -- UNIQUE (user_id, weekly_challenge_id)

-- Prefix of idx_spue_user_season / UNIQUE (user_id, season, tournament_code)
DROP INDEX IF EXISTS idx_spue_user;

-- Can never fire: PK (user_id, achievement_id, scope_target_id, period_key)
-- is already unique on a subset of these columns; the only upsert targets the PK.
DROP INDEX IF EXISTS idx_ua_unique_context;
