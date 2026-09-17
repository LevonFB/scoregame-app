-- 0081_match_source_rules.sql
-- Manual catalog of tournament sources (M2).
--
-- This table ONLY stores an admin-managed list of provider/competition rules.
-- It is intentionally NOT wired into refreshToday / refreshAdminCandidatesFast /
-- /admin/day/candidates / /admin/day/top3 / pickTop3 / AUTO selection. It performs
-- no provider calls and does not affect any existing match, pick, or scoring row.
-- Wiring into the import flow is deferred to a later milestone (M3+).

CREATE TABLE IF NOT EXISTS match_source_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('football_data','allsports')),
  provider_competition_id TEXT,
  provider_competition_code TEXT,
  match_mode TEXT NOT NULL CHECK (match_mode IN ('club','national')),
  status TEXT NOT NULL CHECK (status IN ('enabled','disabled','test_only')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  season TEXT,
  country TEXT,
  include_friendlies INTEGER NOT NULL DEFAULT 0,
  date_window_before INTEGER NOT NULL DEFAULT 0,
  date_window_after INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_source_rules_mode_status ON match_source_rules(match_mode, status);
CREATE INDEX IF NOT EXISTS idx_match_source_rules_provider ON match_source_rules(provider);
CREATE INDEX IF NOT EXISTS idx_match_source_rules_sort ON match_source_rules(sort_order, title);

-- No seed data on purpose: M2 only stores/edits the catalog. Seeding belongs to a
-- later, explicitly-scoped decision once the import flow consumes these rules.
