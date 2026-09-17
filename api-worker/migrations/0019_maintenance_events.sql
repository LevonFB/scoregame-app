-- Maintenance events queue (admin creates events, cron dispatches them)
CREATE TABLE IF NOT EXISTS maintenance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- 'START' or 'END'
  message TEXT,                   -- maintenance message (for START)
  created_at INTEGER NOT NULL,
  dispatched_at INTEGER,          -- NULL until fully processed
  dispatched_count INTEGER DEFAULT 0,
  error TEXT
);

-- Per-user delivery log for dedup
CREATE TABLE IF NOT EXISTS maintenance_event_log (
  event_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_maint_events_pending ON maintenance_events(dispatched_at) WHERE dispatched_at IS NULL;
