-- Stage 1 E2E seed. Test-only data. No production users/matches.

-- One always-active season covering any plausible test day.
INSERT OR REPLACE INTO seasons
  (id, name, slug, status, starts_at, ends_at, display_order, is_visible, created_at, updated_at)
VALUES
  (1, 'E2E Season', 'e2e', 'active', '2020-01-01T00:00:00Z', '2099-12-31T23:59:59Z', 1, 1,
   '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z');

-- One pickable match whose lock is far in the future (so savePick is allowed)
-- and whose unlock_time is NULL (prediction already open).
INSERT OR REPLACE INTO matches
  (match_id, day, matchday_key, start_time, lock_time, unlock_time, is_pick, status, home, away)
VALUES
  ('e2e-m1', '2026-06-20', '2026-06-20', '2099-01-01T18:00:00Z', '2099-01-01T17:55:00Z', NULL, 1, 'TIMED', 'Alpha FC', 'Beta FC');

-- Pre-seeded saved prediction for the READ round-trip (E2E3 backbone):
-- user 777777 predicted 2:1 on the match above.
INSERT OR REPLACE INTO picks
  (day, match_id, user_id, home, away, joker, updated_at)
VALUES
  ('2026-06-20', 'e2e-m1', 777777, 2, 1, 0, 1750000000000);
