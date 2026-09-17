-- 0017_maintenance.sql
-- App-wide config for maintenance mode

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO app_config (key, value, updated_at)
  VALUES ('maintenance_enabled', '0', 0);
INSERT OR IGNORE INTO app_config (key, value, updated_at)
  VALUES ('maintenance_message', 'Ведутся технические работы. Скоро вернёмся!', 0);
INSERT OR IGNORE INTO app_config (key, value, updated_at)
  VALUES ('maintenance_image_url', '', 0);
