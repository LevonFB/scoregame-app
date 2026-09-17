-- Economy V1 (Этап B) — продажа кейса/спина за звёзды (economy-v1.md §0.4/§3).
-- Premium case = 160⭐, «Фартовый мяч» = 80⭐. Daily case за звёзды НЕ продаётся.
-- Курс намеренно хуже 20⭐/⚽ (Premium 7⚽↔160⭐, спин 3⚽↔80⭐), чтобы покупка за
-- звёзды не обходила недельный потолок обмена.

-- Цена в звёздах на кейсах (0 = не продаётся за звёзды).
ALTER TABLE shop_cases ADD COLUMN price_stars INTEGER NOT NULL DEFAULT 0;
UPDATE shop_cases SET price_stars = 160 WHERE code = 'premium';
UPDATE shop_cases SET price_stars = 0   WHERE code = 'daily_free';

-- Цена спина в звёздах на колесе.
ALTER TABLE fortune_wheel ADD COLUMN price_stars INTEGER NOT NULL DEFAULT 0;
UPDATE fortune_wheel SET price_stars = 80 WHERE code = 'default';

-- Идемпотентный аудит трат звёзд на покупки (§22). idempotency_key = openId/spinId.
CREATE TABLE IF NOT EXISTS star_purchase_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  season_number   INTEGER NOT NULL,
  item_type       TEXT    NOT NULL,          -- 'case_premium' | 'fortune_spin'
  stars_spent     INTEGER NOT NULL,
  idempotency_key TEXT    NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_star_purchase_user ON star_purchase_ledger (user_id, created_at DESC);
