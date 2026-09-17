-- Migration 0066: Extend bonus questions for star-based rewards
-- Safe: ADD COLUMN only, no destructive changes. Existing picks/questions untouched.

-- New columns for match_bonus_questions:
-- rule_json        — totals config: { metric, operator, threshold }
-- player_config_json — user_goalscorer config: { player_pool, reward_enabled, reward_stars, player_source }
-- status           — draft|active|locked|resolved|rewards_granted|cancelled
-- resolved_source  — auto|manual|auto_manual_override
-- resolved_by      — admin user_id who resolved manually
-- lock_at          — optional per-question lock timestamp (ms), falls back to match lock_time
ALTER TABLE match_bonus_questions ADD COLUMN rule_json TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN player_config_json TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE match_bonus_questions ADD COLUMN resolved_source TEXT;
ALTER TABLE match_bonus_questions ADD COLUMN resolved_by INTEGER;
ALTER TABLE match_bonus_questions ADD COLUMN lock_at INTEGER;

-- New columns for pick_bonus_answers (reward tracking):
ALTER TABLE pick_bonus_answers ADD COLUMN is_correct INTEGER;
ALTER TABLE pick_bonus_answers ADD COLUMN reward_stars INTEGER DEFAULT 0;
ALTER TABLE pick_bonus_answers ADD COLUMN reward_granted_at INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mbq_status_enabled ON match_bonus_questions(status, is_enabled);
CREATE INDEX IF NOT EXISTS idx_pba_reward_at ON pick_bonus_answers(reward_granted_at);
CREATE INDEX IF NOT EXISTS idx_pba_qtype_day ON pick_bonus_answers(question_type, day);
