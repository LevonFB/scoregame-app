-- Wipe ALL user activity, keep accounts/content/config. Backup: backup_scoregame_20260626_200043.sql
-- Generated 2026-06-26. Keeps users (balances reset), matches, leagues, configs, catalogs.

DELETE FROM ball_transactions;
DELETE FROM balls_ledger;
DELETE FROM boost_usage;
DELETE FROM case_opens;
DELETE FROM case_transactions;
DELETE FROM daily_cases;
DELETE FROM daily_quest_progress;
DELETE FROM fortune_spin_opens;
DELETE FROM fortune_spins;
DELETE FROM league_day_stats;
DELETE FROM lucky_token_transactions;
DELETE FROM partner_claims;
DELETE FROM partner_events;
DELETE FROM partner_reward_logs;
DELETE FROM pick_bonus_answers;
DELETE FROM pick_goalscorers;
DELETE FROM picks;
DELETE FROM purchase_history;
DELETE FROM reminder_log;
DELETE FROM reward_ledger;
DELETE FROM scores_agg;
DELETE FROM season_awards;
DELETE FROM season_league_standings_snapshot;
DELETE FROM season_prediction_eurocup_knockout_brackets;
DELETE FROM season_prediction_user_entries;
DELETE FROM season_prediction_user_scores;
DELETE FROM season_prediction_weekly_challenge_entries;
DELETE FROM season_prediction_weekly_challenge_scores;
DELETE FROM season_standings_snapshot;
DELETE FROM star_exchange_ledger;
DELETE FROM stars_ledger;
DELETE FROM telegram_star_order_events;
DELETE FROM telegram_star_orders;
DELETE FROM user_achievements;
DELETE FROM user_boosts;
DELETE FROM user_cases;
DELETE FROM user_day_stats;
DELETE FROM user_season_progress;
DELETE FROM user_stats;
DELETE FROM user_task_progress;
DELETE FROM weekly_challenge_task_claims;
DELETE FROM weekly_finalizations;
DELETE FROM weekly_league_standings_snapshot;

-- Reset balance/progress columns on kept user accounts:
UPDATE users SET balls = 0, extra_league_slots = 0;
