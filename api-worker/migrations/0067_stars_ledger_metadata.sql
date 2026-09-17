-- Migration 0067: Add metadata_json to stars_ledger for bonus question audit trail
-- Safe: ADD COLUMN only, existing rows get NULL
ALTER TABLE stars_ledger ADD COLUMN metadata_json TEXT;
