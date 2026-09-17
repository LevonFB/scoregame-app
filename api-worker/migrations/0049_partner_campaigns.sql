CREATE TABLE IF NOT EXISTS partner_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sponsor_name TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'telegram',
  telegram_chat_id TEXT,
  telegram_username TEXT,
  bot_username TEXT,
  deep_link TEXT,
  verification_secret TEXT,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_payload_json TEXT,
  hold_hours INTEGER NOT NULL DEFAULT 24,
  starts_at INTEGER,
  ends_at INTEGER,
  max_total_claims INTEGER,
  max_claims_per_user INTEGER NOT NULL DEFAULT 1,
  completed_claims_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  is_visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  last_validation_error TEXT,
  validation_payload_json TEXT,
  last_validated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_campaigns_status_visible_sort
  ON partner_campaigns(status, is_visible, sort_order, id);

CREATE TABLE IF NOT EXISTS partner_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  verify_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started',
  started_at INTEGER,
  verified_at INTEGER,
  hold_until INTEGER,
  completed_at INTEGER,
  reward_granted_at INTEGER,
  failed_reason TEXT,
  verification_payload_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(campaign_id, user_id),
  UNIQUE(verify_token),
  FOREIGN KEY (campaign_id) REFERENCES partner_campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_partner_claims_status_hold
  ON partner_claims(status, hold_until, campaign_id);

CREATE INDEX IF NOT EXISTS idx_partner_claims_user_status
  ON partner_claims(user_id, status, campaign_id);

CREATE TABLE IF NOT EXISTS partner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  claim_id INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES partner_campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES partner_claims(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_events_campaign_user
  ON partner_events(campaign_id, user_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_partner_events_claim
  ON partner_events(claim_id, created_at);

CREATE TABLE IF NOT EXISTS partner_reward_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_amount INTEGER NOT NULL DEFAULT 0,
  reward_payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  UNIQUE(claim_id),
  FOREIGN KEY (claim_id) REFERENCES partner_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES partner_campaigns(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_partner_reward_logs_user
  ON partner_reward_logs(user_id, status, created_at);

CREATE TABLE IF NOT EXISTS user_partner_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reward_type TEXT NOT NULL,
  reward_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(claim_id),
  FOREIGN KEY (claim_id) REFERENCES partner_claims(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_partner_rewards_user
  ON user_partner_rewards(user_id, reward_type, reward_key, created_at);
