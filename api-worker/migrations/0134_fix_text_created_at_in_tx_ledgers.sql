-- 0134: normalize TEXT created_at rows in the ball/case transaction ledgers.
--
-- Background: both tables declare `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
-- but every writer stores unix MILLISECONDS there — the declared type lies (see the
-- timestamp convention in CLAUDE.md). The admin TRANSFER_BALLS / TRANSFER_CASES routes
-- used to INSERT without created_at, so the DEFAULT fired and wrote a UTC TEXT stamp
-- ('YYYY-MM-DD HH:MM:SS') into that column.
--
-- Impact of such a row: SQLite orders types NULL < INTEGER < TEXT, so the row sorts
-- above every real transaction in the admin history (`ORDER BY created_at DESC LIMIT 100`),
-- and the frontend parses the bare TEXT as local time, shifting it by the UTC offset.
--
-- The INSERTs now pass Date.now() explicitly; this migration repairs the rows already
-- written. Data impact: 1 row in ball_transactions on prod (id=574,
-- '2026-07-22 17:33:27' UTC -> 1784741607000), 0 rows in case_transactions. Amounts,
-- balances and ordering by id are untouched — only the timestamp representation changes.
--
-- Idempotent: the WHERE clause matches TEXT values only, so re-running is a no-op.

UPDATE ball_transactions
SET created_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000
WHERE typeof(created_at) = 'text'
  AND strftime('%s', created_at) IS NOT NULL;

UPDATE case_transactions
SET created_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000
WHERE typeof(created_at) = 'text'
  AND strftime('%s', created_at) IS NOT NULL;
