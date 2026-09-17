-- 0069_season_predictions_europe.sql
-- Seed scaffold for european cups inside "Прогнозы сезона" 2026/27.
-- No schema changes — reuses season_prediction_tournaments with tournament_type='european'.
-- No team rows are seeded; admins must configure teams manually (provider IDs differ for european cups).

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'UCL', 'european', 'Лига чемпионов', NULL, 36, 'draft', 60,
       '{"competition_code":"CL","active_stage":"league_stage","stages":["league_stage","playoff_knockout","round_of_16","quarter_final","semi_final","final"],"league_stage":{"top8":8,"zone_9_24":16}}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'UEL', 'european', 'Лига Европы', NULL, 36, 'draft', 70,
       '{"competition_code":"EL","active_stage":"league_stage","stages":["league_stage","playoff_knockout","round_of_16","quarter_final","semi_final","final"],"league_stage":{"top8":8,"zone_9_24":16}}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';

INSERT OR IGNORE INTO season_prediction_tournaments (
  season_prediction_season_id, tournament_code, tournament_type, title, country, team_count, status, sort_order, settings_json
)
SELECT id, 'UECL', 'european', 'Лига конференций', NULL, 36, 'draft', 80,
       '{"competition_code":"UECL","active_stage":"league_stage","stages":["league_stage","playoff_knockout","round_of_16","quarter_final","semi_final","final"],"league_stage":{"top8":8,"zone_9_24":16}}'
FROM season_prediction_seasons WHERE code = 'club_2026_27';
