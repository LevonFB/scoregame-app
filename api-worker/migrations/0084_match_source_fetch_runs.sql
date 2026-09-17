-- 0084_match_source_fetch_runs.sql
-- History of source-fetch operations for the manual source-based flow (M7).
--
-- Purely diagnostic/observability. Each row records ONE provider-fetch run from the
-- admin source tooling (M3 single-source test or M4 aggregate preview). It NEVER
-- influences match publication: no is_pick, no top3_overrides, no AUTO, no scoring.
-- Secrets (tokens, auth headers, raw URLs, raw provider bodies) are never stored.
--
-- parent_run_id models the aggregate → per-source relationship:
--   aggregate summary : source_id = NULL, parent_run_id = NULL
--   aggregate child   : source_id = N,    parent_run_id = <summary id>
--   single source test: source_id = N,    parent_run_id = NULL

CREATE TABLE IF NOT EXISTS match_source_fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  source_id INTEGER,
  parent_run_id INTEGER,
  run_type TEXT NOT NULL
    CHECK (run_type IN ('source_test', 'aggregate_preview')),

  requested_by TEXT,
  requested_at TEXT NOT NULL,

  requested_date TEXT NOT NULL,
  match_mode TEXT,
  provider TEXT NOT NULL,
  fetch_scope TEXT,

  success INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  duration_ms INTEGER,

  matches_received INTEGER NOT NULL DEFAULT 0,
  matches_normalized INTEGER NOT NULL DEFAULT 0,
  matches_accepted INTEGER NOT NULL DEFAULT 0,
  matches_rejected INTEGER NOT NULL DEFAULT 0,
  matches_deduped INTEGER NOT NULL DEFAULT 0,

  from_cache INTEGER NOT NULL DEFAULT 0,
  cache_key TEXT,

  error_code TEXT,
  error_message TEXT,
  warnings_json TEXT,

  created_at TEXT NOT NULL,

  FOREIGN KEY (source_id)
    REFERENCES match_source_rules(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_match_source_fetch_runs_requested_at
  ON match_source_fetch_runs(requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_source_fetch_runs_source
  ON match_source_fetch_runs(source_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_source_fetch_runs_type
  ON match_source_fetch_runs(run_type, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_source_fetch_runs_date
  ON match_source_fetch_runs(requested_date, match_mode);

CREATE INDEX IF NOT EXISTS idx_match_source_fetch_runs_parent
  ON match_source_fetch_runs(parent_run_id);
