-- Fix weekly_limit semantics: column now stores max STARS per week (not number of exchanges).
-- The seed in 0064 originally set weekly_limit = 3 (3 exchanges).
-- This migration corrects it to 200 (stars) only if the value was never changed from the old default.
-- Safe to apply: only updates WHERE weekly_limit = 3 (old default), leaves custom values untouched.
UPDATE economy_star_exchange_config
SET weekly_limit = 200, updated_at = datetime('now')
WHERE id = 1 AND weekly_limit = 3;
