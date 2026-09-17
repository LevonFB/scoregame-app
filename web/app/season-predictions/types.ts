export type SeasonPredictionStatus = "draft" | "submitted" | "locked" | "scoring" | "completed";

export type TopLeagueCode = "PL" | "PD" | "SA" | "BL1" | "FL1";
export type EuropeanCupCode = "UCL" | "UEL" | "UECL";
export type SeasonPredictionTournamentCode = TopLeagueCode | EuropeanCupCode;

export type SeasonPredictionTournamentType = "top_league" | "european";

export type SeasonPredictionEuropeanStage =
  | "league_stage"
  | "playoff_knockout"
  | "round_of_16"
  | "quarter_final"
  | "semi_final"
  | "final";

export type SeasonPredictionSeason = {
  id: number;
  code: string;
  title: string;
  status: string;
  app_season_id: number | null;
  open_at: number | null;
  deadline_at: number | null;
  settings: Record<string, unknown>;
};

export type SeasonPredictionEntry = {
  id: number;
  season_prediction_season_id: number;
  tournament_code: SeasonPredictionTournamentCode;
  status: SeasonPredictionStatus;
  // Awards are confirmed independently from the table and carry their own status.
  awards_status?: SeasonPredictionStatus;
  table: unknown;
  awards: unknown;
  submitted_at: number | null;
  last_submitted_at: number | null;
  awards_submitted_at?: number | null;
  awards_last_submitted_at?: number | null;
  locked_at: number | null;
};

export type SeasonPredictionTableJson = {
  ordered_team_ids: string[];
  ordered_teams: Array<{
    team_ref: string;
    team_name: string;
    position: number;
  }>;
  updated_at: string;
};

export type SeasonPredictionAwardSelection = {
  award_option_id?: number | null;
  award_type: SeasonPredictionAwardOption["award_type"];
  player_id: string | null;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  position?: string | null;
  position_group?: string | null;
  photo_url?: string | null;
  source?: "players_catalog" | "award_options";
};

export type SeasonPredictionAwardsJson = {
  top_scorer?: SeasonPredictionAwardSelection;
  top_assister?: SeasonPredictionAwardSelection;
  top_assistant?: SeasonPredictionAwardSelection;
  golden_glove?: SeasonPredictionAwardSelection;
};

export type SeasonPredictionLeagueStageJson = {
  stage: "league_stage";
  league_stage: {
    top8_team_ids: string[];
    zone_9_24_team_ids: string[];
    winner_team_id: string | null;
  };
  updated_at?: string;
};

export type SeasonPredictionTournament = {
  id: number;
  season_prediction_season_id: number;
  tournament_code: SeasonPredictionTournamentCode;
  tournament_type: SeasonPredictionTournamentType;
  title: string;
  country: string | null;
  team_count: number;
  configured_team_count: number;
  status: string;
  open_at: number | null;
  deadline_at: number | null;
  // Independent prediction window for individual awards. NULL → follows deadline_at.
  awards_open_at?: number | null;
  awards_deadline_at?: number | null;
  sort_order: number;
  settings: Record<string, unknown>;
  rules: {
    zones: Record<string, [number, number] | number[] | unknown>;
    playoff: Record<string, unknown>;
  };
  entry?: SeasonPredictionEntry | null;
};

// Independent lock state returned by GET /season-predictions/top-leagues/:code so the
// client never re-derives deadline/status business rules.
export type SeasonPredictionAwardsWindowStatus = "not_open" | "open" | "closed";
export type SeasonPredictionLocks = {
  table_locked: boolean;
  awards_locked: boolean;
  awards_status: SeasonPredictionAwardsWindowStatus;
};

export type SeasonPredictionTeam = {
  id: number;
  team_id: string | null;
  team_name: string;
  short_name: string | null;
  crest_url: string | null;
  provider: string | null;
  provider_team_id: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type SeasonPredictionAwardOption = {
  id: number;
  award_type: "top_scorer" | "top_assistant" | "top_assister" | "golden_glove";
  player_id: string | null;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  sort_order: number;
  metadata?: Record<string, unknown>;
};

export type SeasonPredictionTournamentPlayer = {
  id: number;
  player_id: string | null;
  provider: string | null;
  provider_player_id: string | null;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  position: string | null;
  position_group: "goalkeeper" | "defender" | "midfielder" | "forward" | "unknown";
  shirt_number: number | null;
  nationality: string | null;
  birth_date: string | null;
  photo_url: string | null;
  is_active: boolean;
};

// Compact catalog row served by /players-catalog (edge-cached, filtered client-side).
export type SeasonPredictionCatalogPlayer = {
  id: number;
  player_id: string | null;
  player_name: string;
  player_name_normalized: string | null;
  team_id: string | null;
  team_name: string | null;
  position: string | null;
  position_group: "goalkeeper" | "defender" | "midfielder" | "forward" | "unknown";
};

export type SeasonPredictionPlayersCatalogResponse = {
  ok: boolean;
  tournament_code: string;
  catalog_version: string;
  count: number;
  players: SeasonPredictionCatalogPlayer[];
};

export type SeasonPredictionAwardCandidate = {
  id?: number;
  award_option_id?: number | null;
  player_id: string | null;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  position: string | null;
  position_group: "goalkeeper" | "defender" | "midfielder" | "forward" | "unknown";
  photo_url: string | null;
  source?: "players_catalog" | "award_options";
};

export type SeasonPredictionsConfigResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  // Back-compat: top leagues only — older clients keep working.
  tournaments: SeasonPredictionTournament[];
  // New explicit groupings — preferred by current frontend.
  top_leagues?: SeasonPredictionTournament[];
  european_tournaments?: SeasonPredictionTournament[];
};

export type SeasonPredictionTaskNavigation =
  | { type: "switch_tab"; tab: "top-leagues" | "european-cups" | "ballon-dor" | "weekly-challenge" | "tasks" }
  | { type: "open_top_league"; code: TopLeagueCode }
  | { type: "open_europe"; code: EuropeanCupCode }
  | { type: "open_weekly_challenge" }
  | { type: "open_weekly_or_top5" };

export type SeasonPredictionTournamentResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  tournament: SeasonPredictionTournament;
  teams: SeasonPredictionTeam[];
  award_options: SeasonPredictionAwardOption[];
  players_catalog?: { version: string; count: number };
  entry: SeasonPredictionEntry | null;
  locks?: SeasonPredictionLocks;
};

export type SeasonPredictionEuropeanResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  tournament: SeasonPredictionTournament;
  teams: SeasonPredictionTeam[];
  stages: SeasonPredictionEuropeanStage[];
  entry: SeasonPredictionEntry | null;
};

export type WeeklyChallengeQuestionKey =
  | "match_of_week"
  | "league_of_week"
  | "duel_of_week"
  | "upset_of_week"
  | "event_of_week";

export type WeeklyChallengeStatus = "draft" | "active" | "locked" | "scoring" | "completed" | "archived";
export type WeeklyChallengeEntryStatus = "draft" | "submitted" | "locked" | "scoring" | "completed";
export type WeeklyChallengeQuestionStatus = "active" | "disabled" | "void";

export type WeeklyChallengeOption = {
  id: string;
  label: string;
  [key: string]: unknown;
};

export type WeeklyChallengeQuestion = {
  id: number;
  weekly_challenge_id: number;
  question_key: WeeklyChallengeQuestionKey;
  title: string;
  description: string | null;
  question_type: string;
  options: WeeklyChallengeOption[];
  config: Record<string, unknown>;
  status: WeeklyChallengeQuestionStatus;
  sort_order: number;
  // W-Builder: additive — template key (null = legacy/custom) + user-facing category label.
  template_key?: string | null;
  display_category?: string;
  // Post-deadline self-check: the confirmed official answer, revealed by the API only
  // once intake is closed and this question is confirmed ("pending" otherwise, "void"
  // if annulled). Lets the user see whether they answered correctly before the final recalc.
  official_status?: "pending" | "confirmed" | "void";
  official_answer_option_id?: string | null;
  // Every accepted option when the question was confirmed with several correct
  // answers (a tie). Single-answer questions repeat the one id here, so readers
  // should prefer this over official_answer_option_id.
  official_answer_option_ids?: string[];
};

export type WeeklyCompetitionMode = "club" | "national_team";
export type WeeklyResolvedCompetitionMode = WeeklyCompetitionMode | "unspecified";

export type WeeklyChallengeMatch = {
  id: number;
  weekly_challenge_id: number;
  match_id: string | null;
  provider: string | null;
  provider_match_id: string | null;
  tournament_code: string | null;
  home_team_name: string;
  away_team_name: string;
  kickoff_at: number | null;
  status: string | null;
  score_home: number | null;
  score_away: number | null;
  sort_order: number;
  metadata: Record<string, unknown>;
};

export type WeeklyChallenge = {
  id: number;
  season_prediction_season_id: number;
  code: string;
  title: string;
  description: string | null;
  status: WeeklyChallengeStatus;
  open_at: number | null;
  deadline_at: number | null;
  close_at: number | null;
  sort_order: number;
  task_schema_version: number;
  bonus_question_key: "match" | "league" | "duel" | "upset" | "event" | null;
  settings: Record<string, unknown>;
  // W-Builder: additive — resolved competition mode (legacy/missing → "unspecified").
  competition_mode?: WeeklyResolvedCompetitionMode;
  match_count: number | null;
  question_count: number | null;
  created_at: number | null;
  updated_at: number | null;
};

export type WeeklyChallengeEntry = {
  id: number;
  user_id: number;
  weekly_challenge_id: number;
  status: WeeklyChallengeEntryStatus;
  answers: Record<string, string>;
  submitted_at: number | null;
  last_submitted_at: number | null;
  locked_at: number | null;
};

export type WeeklyChallengeActiveResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  challenge: WeeklyChallenge | null;
  match_pool: WeeklyChallengeMatch[];
  questions: WeeklyChallengeQuestion[];
  entry: WeeklyChallengeEntry | null;
  status: "not_started" | "draft" | "submitted" | "locked" | "unavailable";
  // A previous week closed but not yet scored/archived while a new one is 'active'.
  // Read-only companion so the user keeps sight of their pending result. See
  // getPendingResultWeeklyChallenge (api-worker).
  pending_result?: WeeklyChallengePendingResult | null;
};

export type WeeklyChallengePendingResult = {
  challenge: WeeklyChallenge;
  entry: WeeklyChallengeEntry | null;
  status: string; // "locked" | "scoring" | "completed"
  score: WeeklyChallengeScore | null;
  has_score: boolean;
  results_stale: boolean;
};

export type WeeklyChallengeDetailResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  challenge: WeeklyChallenge;
  match_pool: WeeklyChallengeMatch[];
  questions: WeeklyChallengeQuestion[];
  entry: WeeklyChallengeEntry | null;
};

// ─── Weekly challenge result (Stage W1 — weekly_challenge_v1) ────────────────

export type WeeklyChallengeScoreQuestion = {
  question_id: number;
  question_key: string;
  title: string;
  user_answer_option_id: string | null;
  user_answer_label: string | null;
  official_answer_option_id: string | null;
  official_answer_label: string | null;
  // Multi-answer questions list every accepted option; official_answer_label
  // already joins them for display.
  official_answer_option_ids?: string[];
  official_answer_labels?: string[];
  status: "correct" | "wrong" | "void" | "unanswered" | "pending_official";
  points: number;
  note?: string | null;
};

export type WeeklyChallengeScoreBreakdownJson = {
  formula_version?: string;
  summary?: { correct: number; wrong: number; void: number; total_points: number; max_possible_points: number };
  questions?: WeeklyChallengeScoreQuestion[];
};

export type WeeklyChallengeScore = {
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  correct_answers: number;
  wrong_answers: number;
  void_questions: number;
  unanswered_questions: number;
  formula_version: string;
  breakdown_json: WeeklyChallengeScoreBreakdownJson;
  scored_at: number | null;
};

// W5: public weekly leaderboard. Rows are identified by profile_key (public
// nickname key) — raw telegram user ids are never exposed by the API.
export type WeeklyLeaderboardEntry = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  avatar_url: string | null;
  total_points: number;
  max_points: number;
  points_pct: number;
  submitted_at: number | null;
  scored_at: number | null;
};

export type WeeklyLeaderboardResponse = {
  ok: boolean;
  challenge: { id: number; title: string; status: string; results_stale: boolean };
  leaderboard: WeeklyLeaderboardEntry[];
  me: { profile_key: string | null; rank: number; total_points: number; max_points: number; points_pct: number } | null;
  pagination: { page: number; limit: number; total: number; pages: number };
};

export type WeeklyChallengeMyScoreResponse = {
  ok: boolean;
  challenge: WeeklyChallenge | null;
  entry: WeeklyChallengeEntry | null;
  score: WeeklyChallengeScore | null;
  has_score: boolean;
  // W4: true if official answers changed after the last recalc → score is not final.
  results_stale?: boolean;
  official_status: string;
};

// W2: Weekly Challenge tasks + rewards (claim flow).
export type WeeklyTaskReward = {
  stars: number;
  balls: number;
  case_type: string | null;
  case_count: number;
  lucky_tokens?: number;
  // Бусты (extra_joker / double_chance) — выдаются только уровнями «Итог недели».
  boost_type?: string | null;
  boost_count?: number;
};

export type WeeklyTaskStatus = "future" | "waiting_results" | "void" | "in_progress" | "failed" | "completed" | "claimable" | "claimed";

export type WeeklyChallengeTask = {
  key: string;
  title: string;
  description: string;
  scope: "current_weekly_challenge" | "season_weekly_challenge";
  group: "activity" | "result" | "series";
  status: WeeklyTaskStatus;
  progress: { current: number; target: number };
  reward: WeeklyTaskReward | null;
  claimable: boolean;
  claimed: boolean;
  // W5: deferred (series, no reward yet) — hidden from the user UI.
  deferred?: boolean;
  future_reason?: string;
  steps?: Array<{ key: string; title: string; completed: boolean }>;
  meta?: Record<string, unknown>;
};

export type WeeklyChallengeTasksResponse = {
  ok: boolean;
  active_challenge: { id: number; title: string; status: string } | null;
  tasks: WeeklyChallengeTask[];
  progress: { current: number; target: number };
};

export type WeeklyChallengeTaskClaimResponse = {
  ok: boolean;
  claimed?: boolean;
  already_claimed?: boolean;
  reward?: WeeklyTaskReward;
  task?: WeeklyChallengeTask;
  balance?: { balls?: number; stars?: number };
  error?: string;
};

export type WeeklyChallengeUnclaimedRewardItem = {
  challenge: {
    id: number;
    code?: string | null;
    title: string;
    status: string;
    deadline_at?: number | null;
  };
  tasks: WeeklyChallengeTask[];
  claimable_count: number;
  reward_summary?: {
    stars: number;
    balls: number;
    cases: Array<{ case_type: string; count: number }>;
  };
};

export type WeeklyChallengeUnclaimedRewardsResponse = {
  ok: boolean;
  items: WeeklyChallengeUnclaimedRewardItem[];
  total_claimable: number;
  next_cursor?: string | null;
};

export type SeasonPredictionTaskStatus = "available" | "in_progress" | "completed" | "future" | "failed";

// E10.2: claim lifecycle for reward-bearing season tasks.
export type SeasonPredictionTaskClaimStatus = "not_claimable" | "claimable" | "claimed";

export type SeasonPredictionTaskReward = {
  stars: number;
  balls: number;
  case_type: string | null;
  case_count: number;
  lucky_tokens?: number;
};

export type SeasonPredictionTask = {
  id: string;
  section: string;
  subsection: string;
  title: string;
  description: string;
  status: SeasonPredictionTaskStatus;
  progress: {
    current: number;
    target: number;
  };
  // E10.2: reward is null for progress-only tasks; claim_status drives the CTA.
  reward: SeasonPredictionTaskReward | null;
  claim_status?: SeasonPredictionTaskClaimStatus;
  future_reason?: string;
  badge?: string;
  phase?: string;
};

export type SeasonPredictionTaskClaimResponse = {
  ok: boolean;
  claimed?: boolean;
  already_claimed?: boolean;
  reward?: SeasonPredictionTaskReward;
  task?: SeasonPredictionTask;
  balance?: { balls: number; stars: number };
  claimable_count?: number;
  summaries?: SeasonPredictionTaskClaimableSummary;
  error?: string;
};

// ─── Official results (Stage S1 — admin only) ────────────────────────────────

export type OfficialResultStatus = "draft" | "confirmed" | "published" | "superseded";

export type OfficialResult = {
  id: number;
  season_prediction_tournament_id: number;
  status: OfficialResultStatus;
  table: SeasonPredictionTableJson | Record<string, unknown>;
  zones_snapshot: Record<string, [number, number] | number[] | unknown>;
  team_ids_snapshot: string[];
  source: "admin_manual" | "football_data_import" | "allsports_import";
  confirmed_at: number | null;
  confirmed_by_admin_id: number | null;
  notes: string | null;
  created_at: number | null;
  updated_at: number | null;
};

export type OfficialAwardType = "top_scorer" | "top_assistant" | "golden_glove";

export type OfficialAward = {
  id: number;
  season_prediction_tournament_id: number;
  award_type: OfficialAwardType;
  award_option_id: number | null;
  player_id: string | null;
  player_name: string;
  team_id: string | null;
  team_name: string | null;
  status: OfficialResultStatus;
  source: string;
  confirmed_at: number | null;
  confirmed_by_admin_id: number | null;
  notes: string | null;
};

export type OfficialResultsResponse = {
  ok: boolean;
  tournament: SeasonPredictionTournament;
  official_result: OfficialResult | null;
  official_awards: OfficialAward[];
  teams: SeasonPredictionTeam[];
  players?: SeasonPredictionTournamentPlayer[];
  award_options: SeasonPredictionAwardOption[];
  rules_zones: Record<string, [number, number] | number[] | unknown>;
};

// ─── Scoring recalc (Stage S2 — admin only) ──────────────────────────────────

export type RecalcStatus = "running" | "completed" | "failed" | "rolled_back";

export type RecalcLogEntry = {
  id: number;
  status: RecalcStatus;
  trigger_reason: string | null;
  formula_version: string;
  entries_processed: number;
  entries_skipped: number;
  entries_failed: number;
  avg_points: number | null;
  max_points: number | null;
  error_message: string | null;
  started_at: number | null;
  finished_at: number | null;
};

export type RecalcRunResult = {
  ok: boolean;
  recalc_id: number;
  formula_version: string;
  entries_processed: number;
  entries_skipped: number;
  entries_failed: number;
  avg_points: number;
  max_points: number;
  rewards_triggered: boolean;
};

export type ScoresSummaryTop10Row = {
  rank: number;
  user_id: number;
  display_name: string;
  total_points: number;
  points_pct: number;
  exact_positions: number;
  champion_correct: number;
};

export type ScoresSummary = {
  recalc_id: number;
  formula_version: string;
  entries_processed: number;
  entries_skipped: number;
  entries_failed: number;
  avg_points: number | null;
  max_points: number | null;
  scored_at: number | null;
  distribution: Record<string, number>;
  top10: ScoresSummaryTop10Row[];
};

export type ScoresSummaryResponse = {
  ok: boolean;
  summary: ScoresSummary | null;
};

// ─── User-facing scores (Stage S3) ───────────────────────────────────────────

export type UserScoreReason =
  | "official_results_not_confirmed"
  | "recalc_not_run"
  | "no_submitted_entry"
  | "not_available_yet";

export type UserScoreTeamBreakdown = {
  team_id: string;
  team_name?: string;
  pos_official: number | null;
  pos_user: number | null;
  error: number | null;
  position_points: number;
  zone_official: string | null;
  zone_match: boolean;
  zone_points: number;
  missing?: boolean;
};

export type UserScoreBonus = {
  key: string;
  points: number;
  matched?: number;
  total?: number;
};

export type UserScoreAward = {
  award_type: string;
  label: string;
  user_player_id: string | null;
  user_player_name: string | null;
  user_team_name: string | null;
  official_player_id: string | null;
  official_player_name: string | null;
  official_team_name: string | null;
  official_confirmed: boolean;
  correct: boolean;
};

export type UserScoreBreakdownJson = {
  formula_version?: string;
  teams?: UserScoreTeamBreakdown[];
  bonuses?: UserScoreBonus[];
  awards?: UserScoreAward[];
  champion?: { team_id: string | null; correct: boolean; points: number };
  warnings?: string[];
  reason?: string;
};

export type UserScore = {
  table_points: number;
  zone_points: number;
  champion_points: number;
  bonus_points: number;
  awards_points: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  exact_positions: number;
  errors_le_1: number;
  errors_le_2: number;
  champion_correct: number;
  ucl_zone_correct: number;
  ucl_zone_full: number;
  relegation_zone_correct: number;
  relegation_zone_full: number;
  awards_correct: number;
  breakdown_json: UserScoreBreakdownJson;
  scored_at: number | null;
  formula_version: string;
};

export type MyScoreResponse = {
  ok: boolean;
  tournament: SeasonPredictionTournament;
  entry: SeasonPredictionEntry | null;
  score: UserScore | null;
  official_results_status: string | null;
  has_score: boolean;
  reason: UserScoreReason | null;
};

export type MyScoresLeague = {
  tournament_code: TopLeagueCode;
  title: string;
  has_score: boolean;
  total_points: number | null;
  max_possible_points: number | null;
  points_pct: number | null;
  official_results_status: string | null;
  reason: UserScoreReason | null;
};

// ─── Eurocup score (Stage E3 — league stage, eurocups_v2) ────────────────────

export type EurocupScoreZone = {
  user_team_ids: string[];
  official_team_ids: string[];
  correct_team_ids: string[];
  qualified_credit_team_ids?: string[];
  points: number;
  max_points?: number;
};

export type EurocupScoreBonus = {
  key: string;
  label: string;
  earned: boolean;
  points: number;
};

export type EurocupScoreTeam = {
  team_id: string;
  team_name: string | null;
  user_zone: "top8" | "playoff_9_24";
  official_zone: "top8" | "playoff_9_24" | "eliminated" | "not_in_table";
  points: number;
  status: "exact_top8" | "exact_9_24" | "qualified_wrong_zone" | "eliminated" | "unknown_team";
};

export type EurocupScoreWinner = {
  user_team_id: string | null;
  user_team_name: string | null;
  status: string;
  points: number;
};

// E8 — play-off ties section.
export type EurocupPlayoffTieRow = {
  match_key: string;
  user_winner_team_id: string | null;
  official_winner_team_id: string;
  points: number;
  status: "correct" | "wrong" | "no_pick";
};
export type EurocupPlayoffSection = {
  points: number;
  max: number;
  correct: number;
  total: number;
  predicted: boolean;
  matches: EurocupPlayoffTieRow[];
};

// E8 — knockout bracket section (stage-based).
export type EurocupBracketStageSection = {
  points: number;
  max: number;
  correct: number;
  total: number;
  correct_team_ids: string[];
  resolved: boolean;
};
export type EurocupBracketBonusItem = { earned: boolean; points: number; max: number; resolved: boolean };
export type EurocupBracketSection = {
  points: number;
  max: number;
  predicted: boolean;
  quarterfinalists: EurocupBracketStageSection;
  semifinalists: EurocupBracketStageSection;
  finalists: EurocupBracketStageSection;
  champion: {
    points: number; max: number; user_team_id: string | null; official_team_id: string | null;
    correct: boolean; resolved: boolean;
  };
  bonuses: {
    all_quarterfinalists: EurocupBracketBonusItem;
    all_semifinalists: EurocupBracketBonusItem;
    all_finalists: EurocupBracketBonusItem;
    champion_bonus: EurocupBracketBonusItem;
  };
};

export type EurocupScoreBreakdownJson = {
  stage?: string;
  formula_version?: string;
  summary?: {
    top8_correct: number;
    playoff_9_24_correct: number;
    top24_correct: number;
    total_points: number;
    max_possible_points: number;
  };
  zones?: {
    top8: EurocupScoreZone;
    playoff_9_24: EurocupScoreZone;
    top24: EurocupScoreZone;
  };
  bonuses?: EurocupScoreBonus[];
  winner?: EurocupScoreWinner;
  teams?: EurocupScoreTeam[];
  // E8 (eurocups_full_v1) additions — present only after a full recalc.
  league_stage?: { points: number; max: number };
  playoffs?: EurocupPlayoffSection;
  bracket?: EurocupBracketSection;
  total?: { league_stage: number; playoffs: number; bracket: number; points: number; max: number };
};

export type EurocupScore = {
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  scored_at: number | null;
  formula_version: string;
  breakdown_json: EurocupScoreBreakdownJson;
};

export type EurocupMyScoreResponse = {
  ok: boolean;
  tournament: SeasonPredictionTournament;
  entry: SeasonPredictionEntry | null;
  score: EurocupScore | null;
  official_results_status: string | null;
  has_score: boolean;
  reason: UserScoreReason | null;
};

export type MyScoresResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  scored_leagues_count: number;
  total_leagues: number;
  leagues: MyScoresLeague[];
};

export type SeasonPredictionTaskSubsection = {
  id: string;
  title: string;
  tasks: SeasonPredictionTask[];
  progress: {
    current: number;
    target: number;
  };
};

export type SeasonPredictionTaskSection = {
  id: "start" | "top5" | "weekly" | "europe";
  title: string;
  subsections: SeasonPredictionTaskSubsection[];
  progress: {
    current: number;
    target: number;
  };
};

// E10.2b: per-level claimable breakdown for granular badges.
// Keys: sections[sectionId], subsections[`${sectionId}:${subId}`], phases[`${sectionId}:${subId}:${phase}`].
export type SeasonPredictionTaskClaimableSummary = {
  total: number;
  sections: Record<string, number>;
  subsections: Record<string, number>;
  phases: Record<string, number>;
};

export type SeasonPredictionTasksResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  sections: SeasonPredictionTaskSection[];
  progress: {
    current: number;
    target: number;
  };
  claimable_count?: number;
  summaries?: SeasonPredictionTaskClaimableSummary;
};

// ── Stage S4: read-only top-5 league leaderboards ────────────────────────────

export type SeasonLeaderboardMyRank = {
  rank: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  gap_to_leader: number;
};

export type SeasonLeaderboardPagination = {
  limit: number;
  offset: number;
  has_more: boolean;
};

export type SeasonLeaderboardOverallItem = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  scored_leagues_count: number;
  champion_correct: number;
  exact_positions: number;
  errors_le_2: number;
  ucl_zone_correct: number;
  relegation_zone_correct: number;
  is_current_user: boolean;
};

export type SeasonLeaderboardEmptyReason = "OFFICIAL_RESULTS_REQUIRED" | "SCORE_RECALC_REQUIRED";

export type SeasonLeaderboardOverallResponse = {
  ok: boolean;
  formula_version: string;
  scored_tournaments_count: number;
  max_tournaments_count: number;
  updated_at: number | null;
  items: SeasonLeaderboardOverallItem[];
  my_rank: SeasonLeaderboardMyRank | null;
  empty_reason: SeasonLeaderboardEmptyReason | null;
  pagination: SeasonLeaderboardPagination;
};

export type SeasonLeaderboardLeagueItem = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  exact_positions: number;
  champion_correct: number;
  ucl_zone_correct: number;
  relegation_zone_correct: number;
  last_submitted_at: number | null;
  is_current_user: boolean;
};

export type SeasonLeaderboardLeagueResponse = {
  ok: boolean;
  tournament: { code: string; name: string; country: string | null; team_count: number };
  formula_version: string;
  official_results_status: string | null;
  updated_at: number | null;
  items: SeasonLeaderboardLeagueItem[];
  my_rank: SeasonLeaderboardMyRank | null;
  empty_reason: SeasonLeaderboardEmptyReason | null;
  pagination: SeasonLeaderboardPagination;
};

// ─── Eurocup leaderboards (Stage E4 — league stage, eurocups_v2) ─────────────

export type EurocupLeaderboardCupItem = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  top8_correct: number;
  playoff_9_24_correct: number;
  top24_correct: number;
  bonus_points: number;
  last_submitted_at: number | null;
  is_current_user: boolean;
};

export type EurocupLeaderboardCupResponse = {
  ok: boolean;
  tournament: { code: string; name: string; team_count: number; stage: string };
  formula_version: string;
  official_results_status: string | null;
  updated_at: number | null;
  items: EurocupLeaderboardCupItem[];
  my_rank: SeasonLeaderboardMyRank | null;
  empty_reason: SeasonLeaderboardEmptyReason | null;
  pagination: SeasonLeaderboardPagination;
};

export type EurocupLeaderboardOverallItem = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  scored_cups_count: number;
  top8_correct: number;
  playoff_9_24_correct: number;
  top24_correct: number;
  bonus_points: number;
  is_current_user: boolean;
};

export type EurocupLeaderboardOverallResponse = {
  ok: boolean;
  formula_version: string;
  scored_cups_count: number;
  max_cups_count: number;
  updated_at: number | null;
  items: EurocupLeaderboardOverallItem[];
  my_rank: SeasonLeaderboardMyRank | null;
  empty_reason: SeasonLeaderboardEmptyReason | null;
  pagination: SeasonLeaderboardPagination;
};

// ─── Combined season leaderboard (Stage E5 — top-5 + eurocups) ───────────────

export type SeasonOverallComponent = {
  scored_count: number;
  max_count: number;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
};

export type SeasonOverallLeaderboardItem = {
  rank: number;
  profile_key: string | null;
  display_name: string;
  total_points: number;
  max_possible_points: number;
  points_pct: number;
  top5_points: number;
  top5_max_points: number;
  top5_scored_count: number;
  eurocups_points: number;
  eurocups_max_points: number;
  eurocups_scored_count: number;
  scored_total_count: number;
  max_total_count: number;
  is_current_user: boolean;
};

export type SeasonOverallLeaderboardResponse = {
  ok: boolean;
  formula_version: string;
  components: { top5: SeasonOverallComponent; eurocups: SeasonOverallComponent };
  updated_at: number | null;
  items: SeasonOverallLeaderboardItem[];
  my_rank: SeasonLeaderboardMyRank | null;
  empty_reason: SeasonLeaderboardEmptyReason | null;
  pagination: SeasonLeaderboardPagination;
};

// ─── «Золотой мяч» ───────────────────────────────────────────────────────────
// Номинант — строка из общей таблицы игроков прогнозов сезона, поэтому форма
// совпадает с игроками наград; в ранжировании используется только id.
export type BallonDorNominee = {
  id: number;
  player_name: string;
  player_name_normalized: string | null;
  team_name: string | null;
  nationality: string | null;
  photo_url: string | null;
  position: string | null;
  position_group: string;
};

export type BallonDorResponse = {
  ok: boolean;
  season: SeasonPredictionSeason;
  tournament: SeasonPredictionTournament;
  nominees: BallonDorNominee[];
  nominee_count: number;
  entry: SeasonPredictionEntry | null;
};

/** Ранжирование хранится победителем вперёд: ranking[0] — 1-е место. */
export type BallonDorTableJson = {
  ranking: string[];
  updated_at: string;
};
