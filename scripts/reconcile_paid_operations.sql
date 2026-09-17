-- reconcile_paid_operations.sql
-- READ-ONLY reconciliation for Stage 5 (paid / consumable operations: cases, fortune spin, shop,
-- Telegram Stars). Finds rows where the charge and the result disagree — candidates for manual
-- review of historically-lost or inconsistent paid operations.
--
-- SAFETY: SELECT-only. No mutations. Run against a read replica / D1 export. No PII emitted
-- (only ids, types, amounts, timestamps). Nothing is auto-credited or compensated.

-- ── CASES ─────────────────────────────────────────────────────────────────────
-- Paid premium open recorded a ball charge (ball_transactions.open_id = case open_id) but the
-- case_opens result row is missing → balls spent without a recorded reward.
SELECT 'case' AS area, 'paid_charge_without_result' AS issue, 'HIGH' AS confidence,
       bt.user_id, bt.open_id AS operation_id, bt.amount, bt.created_at,
       'ball_transactions(case_open) exists but no case_opens row' AS reason
FROM ball_transactions bt
LEFT JOIN case_opens co ON co.open_id = bt.open_id
WHERE bt.operation_type = 'case_open' AND co.open_id IS NULL

UNION ALL
-- A case_opens result that paid balls (balls_spent > 0) but has no matching ball charge.
SELECT 'case', 'result_without_charge', 'MEDIUM',
       co.user_id, co.open_id, co.balls_spent, co.created_at,
       'case_opens.balls_spent>0 but no ball_transactions(open_id)'
FROM case_opens co
LEFT JOIN ball_transactions bt ON bt.open_id = co.open_id
WHERE COALESCE(co.balls_spent, 0) > 0 AND bt.open_id IS NULL

UNION ALL
-- ── FORTUNE SPIN ──────────────────────────────────────────────────────────────
-- A spin marked paid by balls (balls_spent>0) but no ball charge recorded.
SELECT 'fortune', 'ball_spin_without_charge', 'HIGH',
       fso.user_id, fso.spin_id, fso.balls_spent, fso.created_at,
       'fortune_spin_opens.balls_spent>0 but no ball_transactions(open_id=spin_id)'
FROM fortune_spin_opens fso
LEFT JOIN ball_transactions bt ON bt.open_id = fso.spin_id
WHERE COALESCE(fso.balls_spent, 0) > 0 AND bt.open_id IS NULL

UNION ALL
-- A spin marked paid by a token (free_spin=1) but no lucky_token spend recorded.
SELECT 'fortune', 'token_spin_without_spend', 'HIGH',
       fso.user_id, fso.spin_id, 1, fso.created_at,
       'fortune_spin_opens.free_spin=1 but no lucky_token_transactions(ref_id=spin_id)'
FROM fortune_spin_opens fso
LEFT JOIN lucky_token_transactions lt ON lt.ref_id = fso.spin_id
WHERE COALESCE(fso.free_spin, 0) = 1 AND lt.ref_id IS NULL

UNION ALL
-- A completed spin (paid by balls or token) with a STARS reward but no stars_ledger receipt.
SELECT 'fortune', 'stars_reward_without_ledger', 'MEDIUM',
       fso.user_id, fso.spin_id, fso.reward_amount, fso.created_at,
       'fortune_spin_opens(stars) but no stars_ledger(instance_key=spin_id)'
FROM fortune_spin_opens fso
LEFT JOIN stars_ledger sl ON sl.user_id = fso.user_id AND sl.instance_key = fso.spin_id
WHERE fso.reward_type = 'stars' AND (COALESCE(fso.balls_spent,0) > 0 OR COALESCE(fso.free_spin,0) = 1) AND sl.user_id IS NULL

UNION ALL
-- A completed spin with a LUCKY_TOKEN reward but no token-reward receipt.
SELECT 'fortune', 'token_reward_without_ledger', 'MEDIUM',
       fso.user_id, fso.spin_id, fso.reward_amount, fso.created_at,
       'fortune_spin_opens(lucky_token reward) but no lucky_token_transactions(ref_id=spin_id:lucky_token)'
FROM fortune_spin_opens fso
LEFT JOIN lucky_token_transactions lt ON lt.user_id = fso.user_id AND lt.ref_id = (fso.spin_id || ':lucky_token')
WHERE fso.reward_type IN ('lucky_token', 'fortune_spin') AND lt.ref_id IS NULL

UNION ALL
-- ── SHOP ──────────────────────────────────────────────────────────────────────
-- Post-0095: a completed purchase (operation_id set) without a matching ball charge.
SELECT 'shop', 'purchase_without_charge', 'HIGH',
       ph.user_id, ph.operation_id, ph.balls_cost, ph.created_at,
       'purchase_history(operation_id) exists but no ball_transactions(open_id=operation_id)'
FROM purchase_history ph
LEFT JOIN ball_transactions bt ON bt.open_id = ph.operation_id
WHERE ph.operation_id IS NOT NULL AND bt.open_id IS NULL

UNION ALL
-- A shop ball charge (open_id like 'shop:%') without a purchase_history row.
SELECT 'shop', 'charge_without_purchase', 'MEDIUM',
       bt.user_id, bt.open_id, bt.amount, bt.created_at,
       'ball_transactions(open_id shop:*) exists but no purchase_history(operation_id)'
FROM ball_transactions bt
LEFT JOIN purchase_history ph ON ph.operation_id = bt.open_id
WHERE bt.open_id LIKE 'shop:%' AND ph.operation_id IS NULL

UNION ALL
-- ── TELEGRAM STARS ────────────────────────────────────────────────────────────
-- Order marked credited but no balls credit transaction.
SELECT 'xtr', 'credited_without_transaction', 'HIGH',
       o.user_id, o.order_id, o.total_balls, o.credited_at,
       "telegram_star_orders.status='credited' but no ball_transactions(open_id='stars_order:'||order_id)"
FROM telegram_star_orders o
LEFT JOIN ball_transactions bt ON bt.open_id = ('stars_order:' || o.order_id)
WHERE o.status = 'credited' AND bt.open_id IS NULL

UNION ALL
-- A stars purchase credit transaction without a credited order.
SELECT 'xtr', 'credit_transaction_without_order', 'MEDIUM',
       bt.user_id, bt.open_id, bt.amount, bt.created_at,
       'ball_transactions(telegram_star_purchase) exists but order not in credited state'
FROM ball_transactions bt
LEFT JOIN telegram_star_orders o ON ('stars_order:' || o.order_id) = bt.open_id
WHERE bt.operation_type = 'telegram_star_purchase' AND (o.order_id IS NULL OR o.status <> 'credited')

UNION ALL
-- Order marked refunded but no refund transaction recorded.
SELECT 'xtr', 'refunded_without_transaction', 'MEDIUM',
       o.user_id, o.order_id, o.total_balls, o.refunded_at,
       "telegram_star_orders.status='refunded' but no ball_transactions(open_id='stars_refund:'||order_id)"
FROM telegram_star_orders o
LEFT JOIN ball_transactions bt ON bt.open_id = ('stars_refund:' || o.order_id)
WHERE o.status = 'refunded' AND bt.open_id IS NULL

UNION ALL
-- Credited order whose purchase transaction amount != snapshot total_balls (Stage 5.4).
SELECT 'xtr', 'credited_amount_mismatch', 'HIGH',
       o.user_id, o.order_id, o.total_balls, o.credited_at,
       'ball_transactions(stars_order).amount != telegram_star_orders.total_balls'
FROM telegram_star_orders o
JOIN ball_transactions bt ON bt.open_id = ('stars_order:' || o.order_id)
WHERE o.status = 'credited' AND bt.amount <> o.total_balls

UNION ALL
-- The same Telegram charge id bound to more than one order (Stage 5.4).
SELECT 'xtr', 'charge_id_on_multiple_orders', 'HIGH',
       o.user_id, o.order_id, NULL, o.credited_at,
       'telegram_payment_charge_id appears on more than one order'
FROM telegram_star_orders o
WHERE o.telegram_payment_charge_id IS NOT NULL
  AND (SELECT COUNT(*) FROM telegram_star_orders o2 WHERE o2.telegram_payment_charge_id = o.telegram_payment_charge_id) > 1

UNION ALL
-- A refund whose recovered amount exceeds the purchased total — should be impossible (Stage 5.4).
SELECT 'xtr', 'refund_exceeds_total', 'HIGH',
       o.user_id, o.order_id, o.total_balls, o.refunded_at,
       'abs(refund tx amount) > total_balls'
FROM telegram_star_orders o
JOIN ball_transactions bt ON bt.open_id = ('stars_refund:' || o.order_id)
WHERE ABS(bt.amount) > o.total_balls

UNION ALL
-- Refunded-before-credit that nonetheless recovered balls (must be 0) — X5-3 regression (Stage 5.4.1).
SELECT 'xtr', 'refunded_before_credit_recovered', 'HIGH',
       o.user_id, o.order_id, o.total_balls, o.refunded_at,
       'order refunded with REFUNDED_BEFORE_CREDIT but refund tx recovered > 0'
FROM telegram_star_orders o
JOIN ball_transactions bt ON bt.open_id = ('stars_refund:' || o.order_id)
WHERE o.last_error = 'REFUNDED_BEFORE_CREDIT' AND ABS(bt.amount) > 0

UNION ALL
-- A credited purchase receipt for an order that was refunded-before-credit (must never happen).
SELECT 'xtr', 'credited_after_refunded_before_credit', 'HIGH',
       o.user_id, o.order_id, o.total_balls, o.credited_at,
       'order has both stars_order receipt and REFUNDED_BEFORE_CREDIT refund'
FROM telegram_star_orders o
WHERE o.last_error = 'REFUNDED_BEFORE_CREDIT'
  AND EXISTS (SELECT 1 FROM ball_transactions bt WHERE bt.open_id = ('stars_order:' || o.order_id))

UNION ALL
-- ── CASES (Stage 5.2 additions) ───────────────────────────────────────────────
-- A daily case marked opened (opened_at set) without a matching case_opens receipt.
SELECT 'case', 'daily_opened_without_receipt', 'HIGH',
       dc.user_id, NULL AS operation_id, NULL AS amount, dc.opened_at,
       'daily_cases.opened_at set but no case_opens row for that user/day' AS reason
FROM daily_cases dc
WHERE dc.opened_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM case_opens co
    WHERE co.user_id = dc.user_id AND co.case_type = 'daily_free'
      AND co.created_at BETWEEN dc.opened_at - 5000 AND dc.opened_at + 5000
  )

UNION ALL
-- A stars case reward (case_opens.reward_type='stars') without its stars_ledger receipt.
SELECT 'case', 'stars_reward_without_ledger', 'MEDIUM',
       co.user_id, co.open_id, co.reward_amount, co.created_at,
       'case_opens(stars) but no stars_ledger(instance_key=open_id)'
FROM case_opens co
LEFT JOIN stars_ledger sl ON sl.user_id = co.user_id AND sl.instance_key = co.open_id
WHERE co.reward_type = 'stars' AND sl.user_id IS NULL

UNION ALL
-- A lucky_token case reward without its lucky_token_transactions receipt.
SELECT 'case', 'token_reward_without_ledger', 'MEDIUM',
       co.user_id, co.open_id, co.reward_amount, co.created_at,
       'case_opens(lucky_token) but no lucky_token_transactions(ref_id=open_id:lucky_token)'
FROM case_opens co
LEFT JOIN lucky_token_transactions lt ON lt.user_id = co.user_id AND lt.ref_id = (co.open_id || ':lucky_token')
WHERE co.reward_type IN ('lucky_token', 'fortune_spin') AND lt.ref_id IS NULL

ORDER BY area, issue, created_at;

-- NOTE on cases without a paid charge (free daily/premium inventory opens): the reward itself has
-- no separate per-open receipt beyond case_opens.reward_type/reward_amount, so a "case_opens row
-- exists but reward not delivered" condition is NOT verifiable from schema alone (LOW/UNVERIFIABLE)
-- and is intentionally omitted to avoid false positives.
