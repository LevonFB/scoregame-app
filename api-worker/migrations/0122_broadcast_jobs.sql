-- 0122_broadcast_jobs.sql
-- Admin-panel broadcast: queued mass messages delivered by the bot-worker cron
-- in batches (resumable, idempotent per recipient). Mirrors the maintenance_events
-- pattern but adds segmentation and cross-tick batching so large audiences drain
-- safely across cron ticks instead of one long synchronous loop.

CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message          TEXT    NOT NULL,
  segment          TEXT    NOT NULL DEFAULT 'all',    -- 'all' | 'active_7d' | 'active_30d'
  status           TEXT    NOT NULL DEFAULT 'pending' -- 'pending' | 'sending' | 'done' | 'canceled'
    CHECK (status IN ('pending','sending','done','canceled')),
  created_by       INTEGER,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  finished_at      INTEGER,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count       INTEGER NOT NULL DEFAULT 0,
  blocked_count    INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);

-- Partial index so the cron's "next active job" lookup stays a cheap scan.
CREATE INDEX IF NOT EXISTS idx_broadcast_jobs_active
  ON broadcast_jobs(id) WHERE status IN ('pending','sending');

-- Per-recipient delivery log = idempotency + resume cursor across cron ticks.
CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  job_id  INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, user_id)
);
