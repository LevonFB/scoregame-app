-- Migration: Create banned_words table for dynamic moderation word management
-- Words are checked during nickname and league name validation

CREATE TABLE IF NOT EXISTS banned_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'ru',  -- 'ru', 'en', 'allowlist'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(word, lang)
);

-- Seed Russian roots (from MODERATION_RU_ROOTS / MODERATION_RU_ROOTS_CANONICAL)
INSERT OR IGNORE INTO banned_words (word, lang) VALUES
  ('хуй', 'ru'), ('хуе', 'ru'), ('хуйн', 'ru'), ('пизд', 'ru'),
  ('еб', 'ru'), ('ёб', 'ru'), ('бля', 'ru'), ('бляд', 'ru'),
  ('сука', 'ru'), ('сучк', 'ru'), ('мраз', 'ru'), ('гандон', 'ru'),
  ('пидор', 'ru'), ('пидар', 'ru'), ('пидр', 'ru'), ('педик', 'ru'),
  ('мудак', 'ru'), ('шлюх', 'ru'), ('далбаеб', 'ru'), ('долбоеб', 'ru'),
  ('чмо', 'ru'), ('лох', 'ru'), ('наци', 'ru'), ('гитлер', 'ru'),
  ('путин', 'ru'), ('зеленский', 'ru'), ('байден', 'ru'), ('трамп', 'ru'),
  ('макрон', 'ru'), ('шольц', 'ru'), ('сталин', 'ru'), ('ленин', 'ru'),
  ('лукашенко', 'ru'), ('кремль', 'ru'), ('вагнер', 'ru'), ('сво', 'ru'),
  ('война', 'ru'), ('зсу', 'ru'), ('фсб', 'ru'), ('кгб', 'ru'),
  ('лгбт', 'ru'), ('антифа', 'ru'), ('игил', 'ru'), ('талибан', 'ru'),
  ('хохол', 'ru'), ('кацап', 'ru'), ('москаль', 'ru'), ('чурка', 'ru'),
  ('хач', 'ru'), ('жид', 'ru'), ('вата', 'ru'), ('узкоглазый', 'ru'),
  ('черножопый', 'ru');

-- Seed English roots (from MODERATION_EN_ROOTS)
INSERT OR IGNORE INTO banned_words (word, lang) VALUES
  ('fuck', 'en'), ('shit', 'en'), ('bitch', 'en'), ('cunt', 'en'),
  ('whore', 'en'), ('slut', 'en'), ('nigg', 'en'), ('fag', 'en'),
  ('retard', 'en'), ('rape', 'en'), ('nazi', 'en'), ('hitler', 'en'),
  ('putin', 'en'), ('zelensky', 'en'), ('biden', 'en'), ('trump', 'en'),
  ('obama', 'en'), ('macron', 'en'), ('scholz', 'en'), ('stalin', 'en'),
  ('lenin', 'en'), ('mao', 'en'), ('kimjong', 'en'), ('kremlin', 'en'),
  ('wagner', 'en'), ('nato', 'en'), ('fsb', 'en'), ('kgb', 'en'),
  ('cia', 'en'), ('mossad', 'en'), ('isis', 'en'), ('daesh', 'en'),
  ('taliban', 'en'), ('hamas', 'en'), ('hezbollah', 'en'), ('blm', 'en'),
  ('maga', 'en'), ('antifa', 'en'), ('woke', 'en'), ('kike', 'en'),
  ('spic', 'en'), ('chink', 'en'), ('wetback', 'en'), ('paki', 'en'),
  ('gook', 'en'), ('coon', 'en');

-- Seed allowlist (from MODERATION_SAFE_ALLOWLIST)
INSERT OR IGNORE INTO banned_words (word, lang) VALUES
  ('arsenal', 'allowlist'), ('chelsea', 'allowlist'), ('liverpool', 'allowlist'),
  ('real madrid', 'allowlist'), ('barcelona', 'allowlist'),
  ('manchester united', 'allowlist'), ('manchester city', 'allowlist');
