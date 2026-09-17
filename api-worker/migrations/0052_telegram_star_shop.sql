CREATE TABLE IF NOT EXISTS shop_star_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    emoji TEXT,
    balls_amount INTEGER NOT NULL DEFAULT 0,
    bonus_balls INTEGER NOT NULL DEFAULT 0,
    price_xtr INTEGER NOT NULL DEFAULT 1,
    badge_text TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
);

CREATE INDEX IF NOT EXISTS idx_shop_star_packs_active_sort
    ON shop_star_packs(is_active, sort_order, id);

CREATE TABLE IF NOT EXISTS telegram_star_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    pack_code TEXT NOT NULL,
    pack_title TEXT NOT NULL,
    invoice_payload TEXT NOT NULL UNIQUE,
    invoice_link TEXT,
    price_xtr INTEGER NOT NULL,
    balls_amount INTEGER NOT NULL DEFAULT 0,
    bonus_balls INTEGER NOT NULL DEFAULT 0,
    total_balls INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    telegram_payment_charge_id TEXT UNIQUE,
    provider_payment_charge_id TEXT UNIQUE,
    last_error TEXT,
    meta_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    paid_at INTEGER,
    credited_at INTEGER,
    refunded_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_star_orders_user_created
    ON telegram_star_orders(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_telegram_star_orders_status_created
    ON telegram_star_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS telegram_star_order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES telegram_star_orders(order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_star_order_events_order
    ON telegram_star_order_events(order_id, created_at DESC);

INSERT INTO shop_star_packs (
    code, title, description, emoji, balls_amount, bonus_balls, price_xtr, badge_text, is_active, sort_order, created_at, updated_at
) VALUES
    (
        'starter_20',
        'Стартовый набор',
        '20 мячиков для первых покупок в магазине.',
        '⚽',
        20,
        0,
        49,
        'Telegram Stars',
        0,
        10,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    ),
    (
        'plus_55',
        'Набор Плюс',
        '50 мячиков + 5 бонусных.',
        '🎯',
        50,
        5,
        119,
        'Бонус +5',
        0,
        20,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    ),
    (
        'pro_140',
        'Набор Про',
        '120 мячиков + 20 бонусных.',
        '🚀',
        120,
        20,
        249,
        'Бонус +20',
        0,
        30,
        CAST(strftime('%s','now') AS INTEGER) * 1000,
        CAST(strftime('%s','now') AS INTEGER) * 1000
    )
ON CONFLICT(code) DO NOTHING;
