-- Migration 0097: drop the World Cup 2026 bracket tables.
--
-- Mechanic removed: the entire World Cup bracket (user brackets, scoring, leaderboards,
-- tournament/provider/admin state and the bracket task/reward config).
--
-- Runtime code for this mechanic was already removed in the Stage 1 + Stage 1.5 rollout
-- (frontend, admin, API routes, cron/provider paths, modules). The Stage 2A production audit
-- confirmed: these tables have an EMPTY foreign-key graph (no incoming or outgoing FKs) and no
-- triggers/views reference them, so dropping them cannot break any other object.
--
-- PRESERVED ON PURPOSE: reward_ledger (its CHECK constraint and the historical bracket_quest /
-- bracket_final_reward rows) and all stars/balls/reward history are NOT touched here — those
-- tables hold no foreign keys to the dropped tables, so the audit history stays intact.
--
-- PRECONDITIONS (operational, NOT enforced by SQL): apply ONLY AFTER the Stage 1 + 1.5 code is
-- deployed to production AND a backup / D1 Time Travel bookmark has been taken. NOTE: a
-- multi-statement D1 migration file is NOT guaranteed to be fully atomic — verify after running.

DROP TABLE IF EXISTS bracket_leaderboards;
DROP TABLE IF EXISTS user_bracket_scores;
DROP TABLE IF EXISTS user_brackets;
DROP TABLE IF EXISTS world_cup_team_stage_reached;
DROP TABLE IF EXISTS world_cup_knockout_matches;
DROP TABLE IF EXISTS world_cup_third_places;
DROP TABLE IF EXISTS world_cup_group_standings;
DROP TABLE IF EXISTS world_cup_provider_snapshots;
DROP TABLE IF EXISTS world_cup_tournament_state;
DROP TABLE IF EXISTS bracket_reward_rules;
DROP TABLE IF EXISTS bracket_tasks_catalog;
