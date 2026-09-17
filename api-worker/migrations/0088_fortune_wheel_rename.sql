-- Rename the fortune wheel attraction to "Фартовый мяч" (footballs spin, not a wheel).
UPDATE fortune_wheel
SET title = 'Фартовый мяч',
    description = 'Крути и выигрывай награды',
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'default';
