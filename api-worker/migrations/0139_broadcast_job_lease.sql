-- 0139_broadcast_job_lease.sql
-- Fix duplicate broadcast deliveries (job 7: 28 recipients, 52 sends).
--
-- The bot-worker drainer picked the active job with a plain
-- `WHERE status IN ('pending','sending')` — no atomic claim. Since 'sending' is
-- itself part of that predicate, marking the job as sending never excluded it
-- from the next cron tick. With cron */2 and a drain that ran ~5 minutes, ticks
-- 16:18 and 16:20 grabbed the same job and re-sent to everyone not yet written
-- to broadcast_deliveries (batches of 28 → 16 → 8).
--
-- lease_until (unix MILLISECONDS, matching broadcast_jobs.created_at) turns the
-- pick into an atomic claim: a tick only takes a job whose lease has expired,
-- so overlapping invocations find nothing and exit. A crashed tick releases the
-- job automatically once the lease lapses — no manual unsticking.
--
-- Data impact: additive column, NULL for existing rows = immediately claimable.
-- No backfill needed; finished jobs are never re-picked (status is 'done').

ALTER TABLE broadcast_jobs ADD COLUMN lease_until INTEGER;
