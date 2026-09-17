-- Migration: 0005_leagues_soft_delete.sql
-- Add soft delete support and fix GET /leagues/:id/members

-- Add deleted_at column for soft delete.
-- Was commented out because production already had the column (added by hand outside
-- migrations); the comment then made a from-scratch run fail on the index below.
-- Restored 2026-08-05 — production has this migration recorded in d1_migrations, so it
-- never re-runs there; only fresh databases execute the ALTER.
ALTER TABLE leagues ADD COLUMN deleted_at TEXT DEFAULT NULL;

-- Create index for filtering active leagues
CREATE INDEX IF NOT EXISTS idx_leagues_active ON leagues(deleted_at);
