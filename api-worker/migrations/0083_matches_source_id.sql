-- 0083_matches_source_id.sql
-- Provenance marker: which match_source_rules row imported a given match (M5.1).
--
-- Display-only: lets the admin candidate list surface matches that were manually
-- imported from the source catalog regardless of the AllSports-only provider guard,
-- while keeping the catalog + mode filters intact (no garbage leaks). Nullable, so
-- existing matches and the legacy refresh flow are completely unaffected.
-- The import endpoint sets it best-effort; nothing here touches is_pick / picks.

ALTER TABLE matches ADD COLUMN source_id INTEGER;
