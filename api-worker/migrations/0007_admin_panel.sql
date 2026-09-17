-- 0007_admin_panel.sql

-- 0) results.is_manual: marks a score written by an admin correction, which always
-- outranks provider data. Added here on 2026-08-05 — production got the column outside
-- migrations, so a from-scratch build was missing it. Production has 0007 recorded as
-- applied, so this ALTER only ever runs on a fresh database.
ALTER TABLE results ADD COLUMN is_manual INTEGER DEFAULT 0;

-- A) app_settings: Global configuration (JSON)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER NOT NULL
);

-- B) top3_overrides: Manual locks for Top-3 matches per day
CREATE TABLE IF NOT EXISTS top3_overrides (
  day TEXT PRIMARY KEY,        -- YYYY-MM-DD
  mode TEXT NOT NULL CHECK(mode IN ('AUTO','MANUAL')),
  match_ids_json TEXT,         -- JSON array of 3 match IDs (required if MANUAL)
  updated_at TEXT NOT NULL,
  updated_by INTEGER NOT NULL
);

-- C) admin_audit: Audit log for all admin actions
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_id INTEGER NOT NULL
);
