-- 0021_stars_levels_quests.sql
-- Stars, Levels & Quests system

-- 1. User season progress (stars + level per season)
CREATE TABLE IF NOT EXISTS user_season_progress (
  user_id INTEGER NOT NULL,
  season_number INTEGER NOT NULL,
  stars INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, season_number)
);

-- 2. Daily quest progress (6 quests per day per user)
CREATE TABLE IF NOT EXISTS daily_quest_progress (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  stars_awarded INTEGER DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, day, quest_id)
);

-- 3. Daily cases (1 case per day if 4/6 quests completed)
CREATE TABLE IF NOT EXISTS daily_cases (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  earned INTEGER DEFAULT 0,
  earned_at INTEGER,
  PRIMARY KEY (user_id, day)
);

-- 4. Add stars_reward column to achievements (seasonal quest rewards)
ALTER TABLE achievements ADD COLUMN stars_reward INTEGER DEFAULT 0;

-- 5. Set star rewards for each seasonal achievement
-- Global Common
UPDATE achievements SET stars_reward = 4 WHERE id = 'global_debut';
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_full_day';       -- daily quest, not seasonal
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_read_game';      -- daily quest
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_goal_diff';      -- daily quest
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_first_joker';    -- daily quest
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_joker_points';   -- daily quest
UPDATE achievements SET stars_reward = 0 WHERE id = 'global_early_start';    -- daily quest

-- Global Rare
UPDATE achievements SET stars_reward = 16 WHERE id = 'global_scoreboard';
UPDATE achievements SET stars_reward = 12 WHERE id = 'global_streak_3';
UPDATE achievements SET stars_reward = 0  WHERE id = 'global_3of3_points';   -- not in seasonal list
UPDATE achievements SET stars_reward = 0  WHERE id = 'global_big_day';       -- not in seasonal list
UPDATE achievements SET stars_reward = 0  WHERE id = 'global_joker_doublehit'; -- not in seasonal list
UPDATE achievements SET stars_reward = 16 WHERE id = 'global_joker_streak_3';
UPDATE achievements SET stars_reward = 12 WHERE id = 'global_new_peak';
UPDATE achievements SET stars_reward = 16 WHERE id = 'global_steady';

-- Global Epic
UPDATE achievements SET stars_reward = 20 WHERE id = 'global_streak_7';
UPDATE achievements SET stars_reward = 35 WHERE id = 'global_streak_30';
UPDATE achievements SET stars_reward = 28 WHERE id = 'global_perfect_week';
UPDATE achievements SET stars_reward = 24 WHERE id = 'global_double_exact_week';
UPDATE achievements SET stars_reward = 32 WHERE id = 'global_exact_5';
UPDATE achievements SET stars_reward = 42 WHERE id = 'global_exact_10';
UPDATE achievements SET stars_reward = 34 WHERE id = 'global_golden_joker';
UPDATE achievements SET stars_reward = 25 WHERE id = 'global_lock_discipline_7';

-- League Common
UPDATE achievements SET stars_reward = 4  WHERE id = 'league_member';
UPDATE achievements SET stars_reward = 4  WHERE id = 'league_first_round';
UPDATE achievements SET stars_reward = 4  WHERE id = 'league_no_late_5';
UPDATE achievements SET stars_reward = 0  WHERE id = 'league_day_points';    -- not in seasonal list
UPDATE achievements SET stars_reward = 4  WHERE id = 'league_first_joker';

-- League Rare
UPDATE achievements SET stars_reward = 10 WHERE id = 'league_top3_day';
UPDATE achievements SET stars_reward = 12 WHERE id = 'league_top3_week';
UPDATE achievements SET stars_reward = 12 WHERE id = 'league_win_day';
UPDATE achievements SET stars_reward = 0  WHERE id = 'league_exact';         -- not in seasonal list
UPDATE achievements SET stars_reward = 14 WHERE id = 'league_streak_7';

-- League Epic
UPDATE achievements SET stars_reward = 18 WHERE id = 'league_champion_week';
UPDATE achievements SET stars_reward = 24 WHERE id = 'league_champion_month';
UPDATE achievements SET stars_reward = 32 WHERE id = 'league_season_leader';
UPDATE achievements SET stars_reward = 20 WHERE id = 'league_win_streak_3in14';
UPDATE achievements SET stars_reward = 22 WHERE id = 'league_perfect_day_win';
UPDATE achievements SET stars_reward = 24 WHERE id = 'league_golden_joker_win';
