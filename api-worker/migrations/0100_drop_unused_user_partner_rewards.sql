-- Remove unused partner custom/cosmetic reward inventory.
-- Runtime support for custom/cosmetic partner rewards was removed first.
-- Active balls/case partner rewards use partner_claims and partner_reward_logs.

DROP TABLE IF EXISTS user_partner_rewards;
