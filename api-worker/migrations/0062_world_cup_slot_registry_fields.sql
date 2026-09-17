ALTER TABLE world_cup_knockout_matches ADD COLUMN bracket_visual_order INTEGER;
ALTER TABLE world_cup_knockout_matches ADD COLUMN chronological_order INTEGER;
ALTER TABLE world_cup_knockout_matches ADD COLUMN scheduled_at TEXT;
ALTER TABLE world_cup_knockout_matches ADD COLUMN venue TEXT;
ALTER TABLE world_cup_knockout_matches ADD COLUMN team_a_source TEXT;
ALTER TABLE world_cup_knockout_matches ADD COLUMN team_b_source TEXT;
ALTER TABLE world_cup_knockout_matches ADD COLUMN next_match_slot TEXT;
ALTER TABLE world_cup_knockout_matches ADD COLUMN next_match_side TEXT;

UPDATE world_cup_knockout_matches
SET
  bracket_visual_order = COALESCE(bracket_visual_order, display_order),
  chronological_order = COALESCE(chronological_order, display_order)
WHERE bracket_visual_order IS NULL OR chronological_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_world_cup_knockout_bracket_order
  ON world_cup_knockout_matches(bracket_visual_order);

CREATE INDEX IF NOT EXISTS idx_world_cup_knockout_chrono_order
  ON world_cup_knockout_matches(chronological_order);
