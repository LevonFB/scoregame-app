-- 0143_ballon_dor.sql
-- «Золотой мяч» — новый подраздел «Прогнозов сезона»: предиктор порядка
-- номинантов с 30-го по 1-е место.
--
-- Модель: обычный season_prediction_tournaments с новым tournament_type
-- 'ballon_dor' (колонка без CHECK, расширять схему не требуется). Номинанты
-- живут в season_prediction_tournament_players — та же таблица, что и составы
-- топ-5 лиг, поэтому админские экраны и хелперы игроков работают без правок.
--
-- Видимость: подраздел заводится сразу как admin_only (см. 0142) — раздел
-- виден игрокам, вкладка «Золотой мяч» только админам, пока фича не готова.
-- Поэтому турнир сразу 'open': редактировать его всё равно может только тот,
-- кто видит вкладку, а в 'draft' предиктор был бы нередактируемым и у админа.

INSERT OR IGNORE INTO app_section_visibility (section_key, parent_key, title, visibility, sort_order) VALUES
  ('season_predictions.ballon_dor', 'season_predictions', 'Золотой мяч', 'admin_only', 33);

-- Турнир привязывается к активному сезону прогнозов (club_2026_27).
-- deadline_at = 2026-10-26 17:00 UTC (20:00 МСК) — церемония в Лондоне.
INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country,
  team_count, status, open_at, deadline_at, sort_order, settings_json
)
SELECT s.id, 'BALLON_DOR', 'ballon_dor', 'Золотой мяч 2026', NULL,
       30, 'open', NULL, 1793034000, 40,
       '{"nominee_count":30,"ceremony_at":"2026-10-26T20:00:00+03:00"}'
FROM season_prediction_seasons s
WHERE s.code = 'club_2026_27';

-- 30 номинантов France Football (объявлены 08.09.2026). Официальный список
-- алфавитный; его индекс кладём в metadata_json.shortlist_order — отдельной
-- колонки sort_order у таблицы игроков нет, а shirt_number занимать нельзя.
-- provider_player_id/photo_url заполняет админский enrich из провайдера.
--
-- Состав идёт через json_each, а НЕ через «SELECT ... UNION ALL ...»: D1
-- ограничивает число термов в compound SELECT, и на 30 ветках миграция падает
-- с «too many terms in compound SELECT» (SQLITE_ERROR 7500).
INSERT INTO season_prediction_tournament_players (
  season_prediction_tournament_id, tournament_code, team_name, player_name,
  player_name_normalized, nationality, position_group, metadata_json, is_active
)
SELECT t.id,
       'BALLON_DOR',
       json_extract(v.value, '$.club'),
       json_extract(v.value, '$.name'),
       json_extract(v.value, '$.norm'),
       json_extract(v.value, '$.nat'),
       'unknown',
       json_object('source', 'ballon_dor_2026_shortlist', 'shortlist_order', json_extract(v.value, '$.o')),
       1
FROM season_prediction_tournaments t
JOIN season_prediction_seasons s ON s.id = t.season_prediction_season_id
JOIN json_each('[
  {"o":1,  "name":"Jude Bellingham",       "norm":"jude bellingham",       "club":"Real Madrid",          "nat":"England"},
  {"o":2,  "name":"Pau Cubarsí",           "norm":"pau cubarsi",           "club":"Barcelona",            "nat":"Spain"},
  {"o":3,  "name":"Marc Cucurella",        "norm":"marc cucurella",        "club":"Chelsea",              "nat":"Spain"},
  {"o":4,  "name":"Ousmane Dembélé",       "norm":"ousmane dembele",       "club":"Paris Saint-Germain",  "nat":"France"},
  {"o":5,  "name":"Luis Díaz",             "norm":"luis diaz",             "club":"Bayern München",       "nat":"Colombia"},
  {"o":6,  "name":"Bruno Fernandes",       "norm":"bruno fernandes",       "club":"Manchester United",    "nat":"Portugal"},
  {"o":7,  "name":"Gabriel",               "norm":"gabriel",               "club":"Arsenal",              "nat":"Brazil"},
  {"o":8,  "name":"Erling Haaland",        "norm":"erling haaland",        "club":"Manchester City",      "nat":"Norway"},
  {"o":9,  "name":"Achraf Hakimi",         "norm":"achraf hakimi",         "club":"Paris Saint-Germain",  "nat":"Morocco"},
  {"o":10, "name":"Harry Kane",            "norm":"harry kane",            "club":"Bayern München",       "nat":"England"},
  {"o":11, "name":"Khvicha Kvaratskhelia", "norm":"khvicha kvaratskhelia", "club":"Paris Saint-Germain",  "nat":"Georgia"},
  {"o":12, "name":"Lamine Yamal",          "norm":"lamine yamal",          "club":"Barcelona",            "nat":"Spain"},
  {"o":13, "name":"Sadio Mané",            "norm":"sadio mane",            "club":"Al Nassr",             "nat":"Senegal"},
  {"o":14, "name":"Marquinhos",            "norm":"marquinhos",            "club":"Paris Saint-Germain",  "nat":"Brazil"},
  {"o":15, "name":"Lautaro Martínez",      "norm":"lautaro martinez",      "club":"Inter",                "nat":"Argentina"},
  {"o":16, "name":"Kylian Mbappé",         "norm":"kylian mbappe",         "club":"Real Madrid",          "nat":"France"},
  {"o":17, "name":"Nuno Mendes",           "norm":"nuno mendes",           "club":"Paris Saint-Germain",  "nat":"Portugal"},
  {"o":18, "name":"Lionel Messi",          "norm":"lionel messi",          "club":"Inter Miami",          "nat":"Argentina"},
  {"o":19, "name":"João Neves",            "norm":"joao neves",            "club":"Paris Saint-Germain",  "nat":"Portugal"},
  {"o":20, "name":"Michael Olise",         "norm":"michael olise",         "club":"Bayern München",       "nat":"France"},
  {"o":21, "name":"Willian Pacho",         "norm":"willian pacho",         "club":"Paris Saint-Germain",  "nat":"Ecuador"},
  {"o":22, "name":"Julián Quiñones",       "norm":"julian quinones",       "club":"Al Qadsiah",           "nat":"Mexico"},
  {"o":23, "name":"Declan Rice",           "norm":"declan rice",           "club":"Arsenal",              "nat":"England"},
  {"o":24, "name":"Rodri",                 "norm":"rodri",                 "club":"Manchester City",      "nat":"Spain"},
  {"o":25, "name":"Fabián Ruiz",           "norm":"fabian ruiz",           "club":"Paris Saint-Germain",  "nat":"Spain"},
  {"o":26, "name":"William Saliba",        "norm":"william saliba",        "club":"Arsenal",              "nat":"France"},
  {"o":27, "name":"Ferran Torres",         "norm":"ferran torres",         "club":"Barcelona",            "nat":"Spain"},
  {"o":28, "name":"Dayot Upamecano",       "norm":"dayot upamecano",       "club":"Bayern München",       "nat":"France"},
  {"o":29, "name":"Vinícius Júnior",       "norm":"vinicius junior",       "club":"Real Madrid",          "nat":"Brazil"},
  {"o":30, "name":"Vitinha",               "norm":"vitinha",               "club":"Paris Saint-Germain",  "nat":"Portugal"}
]') v
WHERE t.tournament_code = 'BALLON_DOR' AND s.code = 'club_2026_27'
  -- У таблицы игроков нет UNIQUE по имени, поэтому OR IGNORE от повторного
  -- прогона не спасает: без этого гварда второй запуск удвоил бы состав.
  AND NOT EXISTS (
    SELECT 1 FROM season_prediction_tournament_players p
    WHERE p.season_prediction_tournament_id = t.id
  );
