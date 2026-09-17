-- Add case_transactions table for logging manual case grants/revokes and other case economy actions

CREATE TABLE IF NOT EXISTS case_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,            -- Positive for credit, negative for debit
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    case_type TEXT NOT NULL,
    operation_type TEXT NOT NULL,       -- 'manual_add', 'manual_subtract', 'purchase', etc.
    comment TEXT,
    admin_user_id INTEGER,              -- if manual operation
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_transactions_user_id ON case_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_case_transactions_created_at ON case_transactions(created_at);
