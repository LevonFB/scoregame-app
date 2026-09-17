import { test, expect, Page } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";

test.use({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});

const outputDir = path.resolve(process.cwd(), "../social-media/video-references");
const nowSeconds = Math.floor(Date.now() / 1000);
const seasonDeadline = nowSeconds + 18 * 24 * 60 * 60;
const challengeDeadline = nowSeconds + 4 * 24 * 60 * 60;

const telegramScript = `
(() => {
  const noop = () => {};
  const initData = "user=%7B%22id%22%3A900000001%2C%22first_name%22%3A%22Player%22%7D&auth_date=1750000000&hash=marketing";
  window.Telegram = {
    WebApp: {
      initData,
      initDataUnsafe: { user: { id: 900000001, first_name: "Player", username: "scoregame_demo" }, start_param: "" },
      colorScheme: "dark",
      themeParams: {
        bg_color: "#000000",
        text_color: "#ffffff",
        hint_color: "#8e8e93",
        link_color: "#2f80ff",
        button_color: "#1478ff",
        button_text_color: "#ffffff",
        secondary_bg_color: "#1c1c1e",
        header_bg_color: "#000000"
      },
      viewportHeight: 932,
      viewportStableHeight: 932,
      ready: noop,
      expand: noop,
      disableVerticalSwipes: noop,
      enableVerticalSwipes: noop,
      onEvent: noop,
      offEvent: noop,
      setHeaderColor: noop,
      setBackgroundColor: noop,
      openTelegramLink: noop,
      openLink: noop,
      requestWriteAccess: (cb) => cb && cb(true),
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      MainButton: { show: noop, hide: noop, setText: noop, onClick: noop, offClick: noop },
      BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
      close: noop
    }
  };
})();
`;

const season = {
  id: 26,
  code: "season_2026_27",
  title: "Сезон 2026/27",
  status: "active",
  app_season_id: 3,
  open_at: nowSeconds - 24 * 60 * 60,
  deadline_at: seasonDeadline,
  settings: {},
};

function tournament(code: string, title: string, country: string, sortOrder: number, type = "top_league") {
  return {
    id: sortOrder,
    season_prediction_season_id: 26,
    tournament_code: code,
    tournament_type: type,
    title,
    country,
    team_count: type === "top_league" ? 20 : 36,
    configured_team_count: type === "top_league" ? 20 : 36,
    status: "open",
    open_at: nowSeconds - 24 * 60 * 60,
    deadline_at: seasonDeadline,
    sort_order: sortOrder,
    settings: {},
    rules: { zones: {}, playoff: {} },
    entry: null,
  };
}

const topLeagues = [
  tournament("PL", "Премьер-лига", "Англия", 1),
  tournament("PD", "Ла Лига", "Испания", 2),
  tournament("SA", "Серия А", "Италия", 3),
  tournament("BL1", "Бундеслига", "Германия", 4),
  tournament("FL1", "Лига 1", "Франция", 5),
];

const premierLeagueTeams = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton",
  "Burnley",
  "Chelsea",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Leeds United",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Newcastle United",
  "Nottingham Forest",
  "Sunderland",
  "Tottenham",
  "West Ham",
  "Wolverhampton",
].map((teamName, index) => ({
  id: index + 1,
  team_id: `pl-${index + 1}`,
  team_name: teamName,
  short_name: teamName,
  crest_url: null,
  provider: "marketing-fixture",
  provider_team_id: String(index + 1),
  sort_order: index + 1,
  metadata: {},
}));

const europeanCups = [
  tournament("UCL", "Лига чемпионов", "Европа", 11, "european"),
  tournament("UEL", "Лига Европы", "Европа", 12, "european"),
  tournament("UECL", "Лига конференций", "Европа", 13, "european"),
];

const challenge = {
  id: 50,
  season_prediction_season_id: 26,
  code: "weekend_01",
  title: "Главный вызов футбольного уикенда",
  description: "Пять вопросов по главным матчам недели",
  status: "active",
  open_at: nowSeconds - 24 * 60 * 60,
  deadline_at: challengeDeadline,
  close_at: challengeDeadline + 60 * 60,
  sort_order: 1,
  task_schema_version: 2,
  bonus_question_key: "match_of_week",
  settings: { competition_mode: "club" },
  competition_mode: "club",
  match_count: 5,
  question_count: 5,
};

const weeklyQuestions = [
  ["match_of_week", "Кто победит в главном матче недели?", ["Арсенал", "Ничья", "Манчестер Сити"]],
  ["goals", "Будет ли в матче больше 2,5 голов?", ["Да", "Нет"]],
  ["scorer", "Кто забьёт первым?", ["Хозяева", "Гости", "Никто"]],
  ["clean_sheet", "Сохранит ли лидер сухие ворота?", ["Да", "Нет"]],
  ["league_of_week", "В какой лиге будет больше голов?", ["АПЛ", "Ла Лига", "Серия А"]],
].map(([key, title, labels], index) => ({
  id: index + 1,
  weekly_challenge_id: 50,
  question_key: key,
  title,
  description: null,
  question_type: "single_select",
  status: "active",
  sort_order: (index + 1) * 10,
  template_key: key,
  display_category: index === 0 ? "Матч недели" : "Футбольный уикенд",
  options: (labels as string[]).map((label, optionIndex) => ({ id: `o_${index}_${optionIndex}`, label })),
  config: {},
}));

function visibilityBody() {
  return {
    ok: true,
    is_admin: false,
    sections: {
      home: { visible: true, visibility: "visible_to_all" },
      predictions: { visible: true, visibility: "visible_to_all" },
      season_predictions: { visible: true, visibility: "visible_to_all" },
      weekly_challenge: { visible: true, visibility: "visible_to_all" },
      tasks: { visible: true, visibility: "visible_to_all" },
      leagues: { visible: true, visibility: "visible_to_all" },
      leaderboard: { visible: true, visibility: "visible_to_all" },
      shop: { visible: true, visibility: "visible_to_all" },
      profile: { visible: true, visibility: "visible_to_all" },
      info: { visible: true, visibility: "visible_to_all" },
    },
    flags: { useScopedLeaderboardOnStartup: false, homeRatingDedupeV2: true, homeLeaguesLazyLoadV2: true },
  };
}

function matchesBody() {
  return {
    ok: true,
    matchMode: "club",
    matches: [
      {
        id: "match-ars-city",
        competition: "PL",
        competitionLabel: "Премьер-лига",
        competitionType: "league",
        matchType: "club",
        home: "Арсенал",
        away: "Манчестер Сити",
        startTime: "2026-08-12T17:30:00.000Z",
        lockTime: "2026-08-12T17:30:00.000Z",
        unlockTime: "2026-08-11T17:30:00.000Z",
        status: "SCHEDULED",
        bonusQuestions: [
          {
            questionType: "first_goal_team",
            enabled: true,
            title: "Кто забьёт первым?",
            pointsAward: 1,
            answerOptions: [
              { key: "home", label: "Арсенал", reward_enabled: true, reward_stars: 2, sort_order: 1 },
              { key: "away", label: "Манчестер Сити", reward_enabled: true, reward_stars: 2, sort_order: 2 },
              { key: "none", label: "Никто", reward_enabled: true, reward_stars: 3, sort_order: 3 },
            ],
          },
        ],
      },
      {
        id: "match-barca-atleti",
        competition: "PD",
        competitionLabel: "Ла Лига",
        competitionType: "league",
        matchType: "club",
        home: "Барселона",
        away: "Атлетико",
        startTime: "2026-08-12T19:45:00.000Z",
        lockTime: "2026-08-12T19:45:00.000Z",
        unlockTime: "2026-08-11T19:45:00.000Z",
        status: "SCHEDULED",
      },
      {
        id: "match-inter-juve",
        competition: "SA",
        competitionLabel: "Серия А",
        competitionType: "league",
        matchType: "club",
        home: "Интер",
        away: "Ювентус",
        startTime: "2026-08-12T21:00:00.000Z",
        lockTime: "2026-08-12T21:00:00.000Z",
        unlockTime: "2026-08-11T21:00:00.000Z",
        status: "SCHEDULED",
      },
    ],
  };
}

function bootstrapBody() {
  return {
    ok: true,
    isAdmin: false,
    permissions: [],
    maintenance: { enabled: false },
    results: [],
    picks: [
      {
        matchId: "match-ars-city",
        home: 2,
        away: 1,
        isJoker: true,
        bonusAnswers: { first_goal_team: "home" },
        updatedAt: "2026-07-25T10:00:00.000Z",
      },
      {
        matchId: "match-barca-atleti",
        home: 1,
        away: 1,
        isJoker: false,
        updatedAt: "2026-07-25T10:00:00.000Z",
      },
    ],
    me: { userId: "900000001", points: 286, rank: 7 },
    boosts: {
      ok: true,
      available: [
        { id: 1, type: "extra_joker" },
        { id: 2, type: "double_chance" },
      ],
      dayUsage: null,
      balls: 850,
      cases: [{ case_type: "daily_free", quantity: 1 }, { case_type: "premium", quantity: 1 }],
    },
    seasonProgress: {
      ok: true,
      balls: 850,
      seasonName: "Сезон 2026/27",
      seasonStatus: "open",
      predictionsOpen: true,
      matchMode: "club",
      displaySeason: { current: { id: 3, title: "Сезон 2026/27" }, nextUpcoming: null },
    },
    profile: {
      id: 900000001,
      first_name: "Игрок",
      displayName: "Игрок ScoreGame",
      balls: 850,
      stars: 126,
      botPmEnabled: true,
    },
  };
}

function profileBody() {
  return {
    ok: true,
    user: {
      id: 900000001,
      first_name: "Игрок",
      displayName: "Игрок ScoreGame",
      balls: 850,
      stars: 126,
      seasonPoints: 286,
      points: 286,
      streak: 12,
      seasonEnd: "2027-05-31T21:00:00.000Z",
      botPmEnabled: true,
      primaryLeague: { type: "private", title: "Футбольные стратеги" },
      leagues: [
        { id: "league-1", type: "private", title: "Футбольные стратеги", user_rank: 2 },
        { id: "league-2", type: "channel", title: "ScoreGame Community", user_rank: 8 },
      ],
    },
  };
}

function leaguesBody() {
  return {
    ok: true,
    leagues: [
      {
        id: "league-1",
        name: "Футбольные стратеги",
        owner_id: 900000001,
        privacy: "private",
        type: "private",
        role: "owner",
        members_count: 18,
      },
      {
        id: "league-2",
        name: "Друзья со двора",
        owner_id: 101,
        privacy: "private",
        type: "private",
        role: "member",
        members_count: 12,
      },
      {
        id: "league-3",
        name: "ScoreGame Community",
        owner_id: 202,
        privacy: "public",
        type: "channel",
        telegram_chat_title: "ScoreGame Community",
        telegram_chat_username: "scoregameee",
        role: "member",
        members_count: 1248,
      },
    ],
    limits: {
      ownedPrivate: 1,
      ownedChannel: 0,
      freePrivateLimit: 5,
      freeChannelLimit: 1,
      extraSlots: 0,
    },
  };
}

function leaderboardBody(pathname: string) {
  if (pathname.includes("/leaderboards/seasons")) {
    return {
      ok: true,
      defaultSeasonId: 3,
      seasons: [{ id: 3, name: "Сезон 2026/27", title: "Сезон 2026/27", status: "active" }],
    };
  }
  if (pathname.includes("/leaderboards/channels")) {
    return {
      ok: true,
      leaderboard: [
        { id: "c1", name: "Футбол каждый день", type: "channel", score: 4820, members_count: 2370 },
        { id: "c2", name: "ScoreGame Community", type: "channel", score: 4412, members_count: 1248 },
        { id: "c3", name: "Трибуна друзей", type: "channel", score: 3988, members_count: 906 },
      ],
      resolvedPeriod: "season",
    };
  }
  if (pathname.includes("/leaderboards/leagues")) {
    return {
      ok: true,
      leaderboard: [
        { id: "l1", name: "Футбольные стратеги", type: "private", score: 2180, members_count: 18 },
        { id: "l2", name: "Друзья со двора", type: "private", score: 1970, members_count: 12 },
        { id: "l3", name: "Точный счёт", type: "private", score: 1815, members_count: 23 },
      ],
      resolvedPeriod: "season",
    };
  }
  return {
    ok: true,
    leaderboard: [
      { id: 101, display_name: "Максим", points: 422 },
      { id: 102, display_name: "Александр", points: 398 },
      { id: 103, display_name: "Давид", points: 361 },
      { id: 900000001, display_name: "Игрок ScoreGame", points: 286 },
      { id: 105, display_name: "Никита", points: 274 },
    ],
    me: { rank: 7, points: 286, totalPlayers: 1842 },
    resolvedPeriod: "season",
  };
}

function dailyQuestsBody() {
  return {
    ok: true,
    totalCompleted: 3,
    totalQuests: 7,
    caseEligibleQuests: 7,
    caseEarned: false,
    caseAlreadyOpened: false,
    unopenedCases: 1,
    quests: [
      { id: "daily_pick", emoji: "⚽", title: "Первый прогноз", description: "Сделай прогноз на матч дня", stars: 2, scope: "global", completed: true, completedAt: 1 },
      { id: "daily_three", emoji: "🎯", title: "Тройной выбор", description: "Заполни прогнозы на три матча", stars: 3, scope: "global", completed: true, completedAt: 1 },
      { id: "daily_joker", emoji: "🃏", title: "Риск оправдан", description: "Используй джокер", stars: 3, scope: "global", completed: true, completedAt: 1 },
      { id: "daily_bonus", emoji: "⭐", title: "Знаток деталей", description: "Ответь на бонус-вопрос", stars: 2, scope: "global", completed: false, completedAt: null },
      { id: "daily_league", emoji: "🏆", title: "Борьба в лиге", description: "Сделай прогноз в составе лиги", stars: 3, scope: "league", completed: false, completedAt: null },
    ],
  };
}

function weeklyQuestsBody() {
  return {
    ok: true,
    week: {
      key: "2026-W30",
      seasonId: 3,
      startsAt: "2026-07-20T00:00:00.000Z",
      endsAt: "2026-07-26T23:59:59.000Z",
      resetAt: "2026-07-27T00:00:00.000Z",
      cutoffAt: "2026-07-27T12:00:00.000Z",
      resetLabel: "Сброс в понедельник",
      activeDays: 4,
      finalized: false,
    },
    bonusCase: {
      caseType: "premium",
      totalRequired: 3,
      completedCount: 2,
      earned: false,
      available: false,
      quantity: 0,
    },
    global: [
      {
        id: "weekly_active_days",
        scope: "global",
        rarity: "rare",
        emoji: "📅",
        title: "На дистанции",
        description: "Сделай прогнозы в пяти игровых днях",
        threshold: 5,
        stars_reward: 8,
        reward_balls: 20,
        unlocked: false,
        progress: 4,
        finalized: false,
        ranking_based: false,
      },
      {
        id: "weekly_exact",
        scope: "global",
        rarity: "epic",
        emoji: "🎯",
        title: "Точный дубль",
        description: "Угадай два точных счёта",
        threshold: 2,
        stars_reward: 12,
        reward_balls: 35,
        unlocked: true,
        progress: 2,
        finalized: false,
        ranking_based: false,
      },
    ],
    league: [],
  };
}

function shopConfigBody() {
  return {
    ok: true,
    boosts: [
      {
        code: "extra_joker",
        emoji: "🃏",
        title: "Дополнительный джокер",
        description: "Открывает второй джокер на игровой день",
        price_balls: 120,
      },
      {
        code: "double_chance",
        emoji: "🛡️",
        title: "Двойной шанс",
        description: "Подстрахует исход выбранного матча",
        price_balls: 90,
      },
      {
        code: "extra_private_league",
        emoji: "🏆",
        title: "Дополнительная лига",
        description: "Ещё один слот для собственной приватной лиги",
        price_balls: 300,
      },
    ],
    cases: [
      {
        code: "premium",
        title: "Премиум-кейс",
        price_balls: 250,
        price_stars: 40,
        rewards: [
          { reward_type: "balls", label: "Мячи", chance_percent: 45, min_amount: 40, max_amount: 120 },
          { reward_type: "extra_joker", label: "Джокер", chance_percent: 25, fixed_amount: 1 },
          { reward_type: "double_chance", label: "Двойной шанс", chance_percent: 20, fixed_amount: 1 },
          { reward_type: "lucky_token", label: "Жетон", chance_percent: 10, fixed_amount: 1 },
        ],
      },
    ],
    star_packs: [],
  };
}

function fortuneBody() {
  return {
    ok: true,
    enabled: true,
    title: "Фартовый мяч",
    description: "Испытай футбольную удачу",
    price_balls: 50,
    price_stars: 10,
    free_spins: 2,
    lucky_tokens: 2,
    balance: 850,
    allow_token_payment: true,
    allow_balls_payment: true,
    allow_stars_payment: true,
    token_cost: 1,
    sectors: [
      { id: 1, reward_type: "balls", label: "50 мячей", color: "#4ECCA3", chance_percent: 35, fixed_amount: 50, sort_order: 1 },
      { id: 2, reward_type: "extra_joker", label: "Джокер", color: "#A855F7", chance_percent: 20, fixed_amount: 1, sort_order: 2 },
      { id: 3, reward_type: "double_chance", label: "Двойной шанс", color: "#F59E0B", chance_percent: 20, fixed_amount: 1, sort_order: 3 },
      { id: 4, reward_type: "lucky_token", label: "Жетон", color: "#F97316", chance_percent: 15, fixed_amount: 1, sort_order: 4 },
      { id: 5, reward_type: "premium_case", label: "Премиум-кейс", color: "#38BDF8", chance_percent: 10, fixed_amount: 1, sort_order: 5 },
    ],
  };
}

function activeChallengeBody() {
  return {
    ok: true,
    season,
    challenge,
    match_pool: [
      {
        id: 1,
        weekly_challenge_id: 50,
        match_id: "match-ars-city",
        tournament_code: "PL",
        home_team_name: "Арсенал",
        away_team_name: "Манчестер Сити",
        kickoff_at: challengeDeadline - 2 * 60 * 60,
        status: null,
        score_home: null,
        score_away: null,
        sort_order: 1,
        metadata: {},
      },
    ],
    questions: weeklyQuestions,
    entry: null,
    status: "not_started",
  };
}

async function setup(page: Page) {
  await page.route(/telegram-web-app\.js/, (route) => route.abort());
  await page.addInitScript(telegramScript);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    let body: unknown = { ok: true, items: [], matches: [], results: [], picks: [], leaderboard: [], rows: [], list: [], data: [] };

    if (pathname.includes("/app-sections/visibility")) body = visibilityBody();
    else if (pathname.endsWith("/day/today")) body = matchesBody();
    else if (pathname.endsWith("/bootstrap")) body = bootstrapBody();
    else if (pathname.endsWith("/me/profile")) body = profileBody();
    else if (pathname.endsWith("/me/boosts")) body = { ...bootstrapBody().boosts, ok: true };
    else if (pathname.endsWith("/me/season-progress")) body = bootstrapBody().seasonProgress;
    else if (pathname.endsWith("/me")) body = { ok: true, data: { user: { id: 900000001, first_name: "Игрок" }, isAdmin: false, permissions: [] } };
    else if (pathname.includes("/leaderboards/")) body = leaderboardBody(pathname);
    else if (pathname.endsWith("/leaderboard")) body = { ok: true, leaderboard: [], me: { userId: "900000001", points: 286, rank: 7 }, isAdmin: false };
    else if (pathname.endsWith("/leagues/my")) body = leaguesBody();
    else if (/\/leagues\/[^/]+\/leaderboard$/.test(pathname)) body = {
      ok: true,
      period: "season",
      leaderboard: [
        { id: 101, display_name: "Максим", score: 312 },
        { id: 900000001, display_name: "Игрок ScoreGame", score: 286 },
        { id: 103, display_name: "Давид", score: 274 },
      ],
    };
    else if (pathname.endsWith("/quests/daily")) body = dailyQuestsBody();
    else if (pathname.endsWith("/quests/weekly")) body = weeklyQuestsBody();
    else if (pathname.endsWith("/shop/config")) body = shopConfigBody();
    else if (pathname.endsWith("/fortune/config")) body = fortuneBody();
    else if (pathname.endsWith("/economy/star-exchange")) body = {
      ok: true,
      enabled: true,
      weekly_star_limit: 100,
      stars_used_this_week: 20,
      stars_remaining: 80,
      current_stars: 126,
      tiers: [
        { id: 1, tier_key: "small", label: "Малый обмен", stars_cost: 10, balls_reward: 50 },
        { id: 2, tier_key: "medium", label: "Большой обмен", stars_cost: 25, balls_reward: 150 },
      ],
    };
    else if (pathname.endsWith("/referrals")) body = {
      ok: true,
      enabled: true,
      link: "https://t.me/scoregameee_Bot?startapp=ref_marketing",
      pending: 2,
      activated: 3,
      invitee_reward_label: "1 фартовый жетон",
      per_friend_reward_label: "50 мячей",
      milestones: [
        { count: 1, reward_label: "50 мячей", achieved: true },
        { count: 3, reward_label: "Премиум-кейс", achieved: true },
        { count: 5, reward_label: "Джокер", achieved: false },
        { count: 10, reward_label: "Особая награда", achieved: false },
      ],
    };
    else if (pathname.endsWith("/season-predictions/config")) body = {
      ok: true,
      season,
      tournaments: topLeagues,
      top_leagues: topLeagues,
      european_tournaments: europeanCups,
    };
    else if (pathname.endsWith("/season-predictions/my-scores")) body = {
      ok: true,
      total_points: 74,
      max_possible_points: 150,
      scored_leagues_count: 3,
    };
    else if (/\/season-predictions\/top-leagues\/[A-Z0-9]+$/.test(pathname)) {
      const code = pathname.split("/").pop() || "PL";
      const selectedTournament = topLeagues.find((item) => item.tournament_code === code) || topLeagues[0];
      body = {
        ok: true,
        season,
        tournament: selectedTournament,
        teams: premierLeagueTeams,
        award_options: [],
        players_catalog: { version: "marketing", count: 0 },
        entry: null,
        locks: {
          table_locked: false,
          awards_locked: false,
          awards_status: "open",
        },
      };
    }
    else if (pathname.endsWith("/season-predictions/weekly-challenges/active")) body = activeChallengeBody();
    else if (/\/season-predictions\/weekly-challenges\/\d+$/.test(pathname)) body = activeChallengeBody();
    else if (pathname.endsWith("/my-score")) body = {
      ok: true,
      challenge,
      entry: null,
      score: null,
      has_score: false,
      results_stale: false,
      official_status: "active",
    };
    else if (pathname.endsWith("/season-predictions/tasks")) body = { ok: true, tasks: [], claimable_count: 0 };
    else if (pathname.includes("/weekly-challenge/tasks/unclaimed")) body = { ok: true, items: [], claimable_count: 0 };
    else if (pathname.endsWith("/weekly-challenge/tasks")) body = { ok: true, tasks: [], claimable_count: 0 };
    else if (pathname.endsWith("/results")) body = { ok: true, results: [] };
    else if (pathname.endsWith("/picks")) body = { ok: true, picks: bootstrapBody().picks };

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1400);
}

async function capture(page: Page, filename: string) {
  await page.locator("nextjs-portal").evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await page.screenshot({
    path: path.join(outputDir, filename),
    fullPage: false,
    animations: "disabled",
  });
}

test("capture populated marketing references", async ({ page }) => {
  mkdirSync(outputDir, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (!error.message.includes("Hydration failed")) {
      pageErrors.push(error.stack || String(error));
    }
  });
  await setup(page);

  await open(page, "/");
  await expect(page.locator("body")).not.toBeEmpty();
  await capture(page, "01-home.png");

  await open(page, "/?tab=matches");
  await capture(page, "02-daily-predictions.png");

  await open(page, "/?tab=season-predictions");
  await capture(page, "03-season-predictions.png");

  await open(page, "/");
  const weeklyHomeCard = page.getByTestId("weekly-home-card");
  if (await weeklyHomeCard.isVisible().catch(() => false)) {
    await weeklyHomeCard.click();
    await page.waitForTimeout(1200);
    await capture(page, "04-weekly-challenge.png");
  }

  await open(page, "/?tab=leagues");
  await capture(page, "05-leagues.png");

  await open(page, "/?tab=rating");
  await capture(page, "06-rating.png");

  await open(page, "/?tab=quests");
  await capture(page, "07-quests.png");

  await open(page, "/?tab=shop");
  await capture(page, "08-shop.png");

  await open(page, "/?tab=profile");
  await capture(page, "09-profile.png");

  expect(pageErrors, pageErrors.join("\n\n")).toEqual([]);
});
