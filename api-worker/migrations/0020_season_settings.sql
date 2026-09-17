-- 0020_season_settings.sql
-- Seed default season config into app_settings

INSERT OR IGNORE INTO app_settings (key, value_json, updated_at, updated_by)
VALUES ('season', '{"number":2,"start":"2026-02-03T00:00:00Z","end":"2026-06-01T00:00:00Z"}', datetime('now'), 0);
