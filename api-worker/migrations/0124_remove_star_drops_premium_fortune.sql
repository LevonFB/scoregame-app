-- Economy: удаление звёзд из дропа Premium-кейса и «Фартового мяча» (daily case не трогаем).
-- Premium: звёзды 34% убраны, остаток растянут пропорционально (×100/66).
--   balls 33.5→50.8 · joker ×1 8→12.1 / ×2 2.5→3.8 · dc ×1 8→12.1 / ×2 3.5→5.3
--   · combo 2→3.0 · жетон ×1 5.5→8.3 / ×2 2.5→3.8 · слот лиги 0.5→0.8 (сумма 100).
--   RTP ~64% → ~84% при 7⚽; звёздная цена 160⭐ → EV 5.87⚽ ≈ 27⭐/⚽ — инвариант §0.4 держится.
-- Фартовый мяч: звёзды 41% убраны. Чистая пропорция дала бы RTP 116% при цене 3⚽
--   (спин становится +EV — принтер мячей), поэтому веса мячей подогнаны вручную:
--   balls 36→68 (2⚽ w50, 3⚽ w14, 5⚽ w3, 10⚽ w0.7, 20⚽ w0.3) · joker 8→10 · dc 8→10
--   · daily case 5→9 · premium case 1.5→2.5 · слот лиги 0.5 (сумма 100).
--   RTP ~82% → ~90% при 3⚽; 80⭐ → EV 2.71⚽ ≈ 29.5⭐/⚽ — инвариант §0.4 держится.
-- UPDATE по фиксированным ключам + DELETE звёздных строк: идемпотентно, id/label/color секторов сохраняются.

-- ===== Premium case =====
DELETE FROM shop_case_rewards
WHERE reward_type = 'stars'
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 50.8
WHERE reward_type = 'balls' AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 12.1
WHERE reward_type = 'extra_joker' AND fixed_amount = 1 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 3.8
WHERE reward_type = 'extra_joker' AND fixed_amount = 2 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 12.1
WHERE reward_type = 'double_chance' AND fixed_amount = 1 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 5.3
WHERE reward_type = 'double_chance' AND fixed_amount = 2 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 3.0
WHERE reward_type = 'extra_joker_double_chance' AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 8.3
WHERE reward_type = 'lucky_token' AND fixed_amount = 1 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 3.8
WHERE reward_type = 'lucky_token' AND fixed_amount = 2 AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

UPDATE shop_case_rewards SET chance_percent = 0.8
WHERE reward_type = 'extra_league' AND is_active = 1
  AND case_id = (SELECT id FROM shop_cases WHERE code = 'premium');

-- ===== Фартовый мяч (fortune wheel 'default') =====
DELETE FROM fortune_wheel_sectors
WHERE reward_type = 'stars'
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors
SET chance_percent = 68.0,
    meta_json = '{"discrete_amounts": [{"amount": 2, "weight": 50}, {"amount": 3, "weight": 14}, {"amount": 5, "weight": 3}, {"amount": 10, "weight": 0.7}, {"amount": 20, "weight": 0.3}]}'
WHERE reward_type = 'balls' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors SET chance_percent = 10.0
WHERE reward_type = 'extra_joker' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors SET chance_percent = 10.0
WHERE reward_type = 'double_chance' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors SET chance_percent = 9.0
WHERE reward_type = 'case' AND reward_code = 'daily_free' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors SET chance_percent = 2.5
WHERE reward_type = 'case' AND reward_code = 'premium' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');

UPDATE fortune_wheel_sectors SET chance_percent = 0.5
WHERE reward_type = 'extra_league' AND is_active = 1
  AND wheel_id = (SELECT id FROM fortune_wheel WHERE code = 'default');
