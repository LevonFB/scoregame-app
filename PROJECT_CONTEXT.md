# ScoreGame Project Context

Last updated: 2026-03-18
Analysis mode: static code review only. No live external API calls, no app run, no tests, no cron/manual sync execution.

## Brand Identity

- Official product name: `ScoreGame`.
- Official social handle/link slug: `@scoregameee`.
- The canonical logo is the original blue-gradient `SG` mark with a light outline and curved underline on a black square background, supplied by the project owner on 2026-07-21.
- Orange logo variants are non-canonical campaign drafts.
- Full brand usage rules and the expected master-asset path are documented in `docs/brand-assets.md`.

## 1. Product Summary

ScoreGame is a Telegram Mini App for football score predictions.

Primary user value:
- pick scores for a curated daily set of football matches,
- assign a joker and optional paid boosts,
- compare results in private and channel-based leagues,
- earn points, stars, balls, cases, achievements, and seasonal progress.

Primary user groups:
- regular players inside Telegram Mini App,
- league owners/admins,
- project admins operating match selection, maintenance, economy, and season settings.

Main user scenarios:
- open the Mini App from Telegram,
- review today's 3 featured matches,
- submit or update picks before lock time,
- set joker and optional paid boosts,
- review results and leaderboards,
- join/create leagues,
- complete daily quests and seasonal tasks,
- open free/premium cases,
- manage profile and reminder preferences.

## 2. Runtime Topology

The system is split into four deployable parts:

1. `web`
- Next.js frontend.
- Built as static export (`next.config.mjs` sets `output: "export"`).
- Main Mini App UI and admin UI.

2. `front-worker`
- Cloudflare Worker in front of the static export.
- Serves assets from `web/out`.
- Proxies `/api/*` to the backend API origin.

3. `api-worker`
- Main Cloudflare Worker backend.
- Owns business logic, D1 access, scoring, leagues, economy, admin endpoints, maintenance mode, and external football integrations.

4. `bot-worker`
- Telegram bot worker.
- Handles webhook, reminders, daily summaries, maintenance broadcasts, and channel-league bind flow.

Shared state:
- Cloudflare D1 database bound as `DB` in `api-worker` and `bot-worker`.

## 3. Repository Map

Core application folders:
- `web/`: frontend Mini App and admin panel.
- `front-worker/`: static asset worker + API proxy.
- `api-worker/`: backend worker, migrations, local debug artifacts.
- `bot-worker/`: Telegram bot worker.

Support / secondary folders:

Important root files:
- `AGENTS.md`: repo-specific terminal policy, including RTK-first command preference.
- `seasonal_tasks.md`: human-readable seasonal task catalog; useful reference, but code/migrations are the source of truth.

Notable non-runtime artifacts in `api-worker/`:
- `cf_logs.json`
- `fd_response.json`
- `correct_picks.json`
- `temp_results.json`
- `test_*.js`
- `trigger_cron.js`

These are useful for offline inspection, but they are not the production entrypoints.

## 4. Real Entry Points

Frontend:
- `web/app/layout.tsx`: root layout, loads Telegram WebApp SDK script.
- `web/app/page.tsx`: main user-facing Mini App entry.
- `web/app/admin/page.tsx`: admin panel entry.

Frontend transport layer:
- `web/lib/api.ts`: central fetch helper, attaches `x-telegram-init-data`.

Front proxy:
- `front-worker/src/index.ts`: Worker `fetch()` entry, proxies `/api` and serves static assets.

Backend:
- `api-worker/src/index.ts`: Worker `fetch()` entry and `scheduled()` cron entry.

Bot:
- `bot-worker/src/index.ts`: Worker `fetch()` entry and `scheduled()` cron entry.

Database schema:
- `api-worker/migrations/*.sql`

Deploy/runtime configs:
- `api-worker/wrangler.toml`
- `bot-worker/wrangler.toml`
- `front-worker/wrangler.toml`
- `front-worker/wrangler.jsonc`
- `web/next.config.mjs`
- `web/tsconfig.json`
- `api-worker/tsconfig.json`
- `bot-worker/tsconfig.json`
- `front-worker/tsconfig.json`

## 5. Frontend Structure

Main frontend modules:
- `web/app/page.tsx`: app shell, Telegram init, tab routing, maintenance handling, initial data loads.
- `web/app/components/MatchesList.tsx`: picks, joker UI, double-chance UI, friend/league picks per match.
- `web/app/components/LeaguesSection.tsx`: list/create/join leagues, start channel bind flow.
- `web/app/components/LeagueScreen.tsx`: league details, members, leaderboard, invite links, avatar management.
- `web/app/components/RatingTab.tsx`: global/private/channel leaderboards.
- `web/app/components/QuestsScreen.tsx`: daily/seasonal quests and case opening entry.
- `web/app/components/ShopScreen.tsx`: boosts, premium case, economy UI.
- `web/app/components/ProfileScreen.tsx`: profile/streak/level/ball display.
- `web/app/components/UserProfileScreen.tsx`: public profile view.
- `web/app/components/AchievementToast.tsx`: toast queue and mark-shown API call.

Admin frontend modules:
- `web/app/admin/page.tsx`: admin shell and tabs.
- `web/app/admin/UsersTab.tsx`: user lookup, balances, case inventory, transaction history.
- `web/app/admin/EconomyTab.tsx`: boosts/cases config editor.

Legacy prototype frontend code based on a local JSON store has been removed.

## 6. Backend Architecture

Backend style:
- one large Cloudflare Worker file (`api-worker/src/index.ts`) containing helpers, routes, cron logic, scoring, quests, leagues, economy, and admin functions.

Core backend responsibilities:
- Telegram initData verification,
- user upsert,
- featured match ingestion and selection,
- pick save/update logic,
- scoring and aggregate recalculation,
- achievements and daily quests,
- league membership/invites/channel bind,
- shop/boost/case economy,
- admin configuration and maintenance,
- scheduled refresh/finalization routines.

Important helper domains:
- `refreshToday()`: fetch football data, dedupe, select top matches, persist results.
- `calculateMatchPoints()`: authoritative scoring logic.
- `recalcDayScores()`: recompute day/week/month/season/all aggregates.
- `updateUserStats()` / `updateUserDayStats()` / `updateLeagueDayStats()`
- `checkAchievements()` / `checkDailyQuests()`
- `awardStarsViaLedger()` / `awardBalls()`
- `grantCaseReward()`

## 7. Main Data Flows

### 7.1 Match ingestion and featured match selection

1. `refreshToday()` fetches data from football-data.org competitions.
2. If `RAPIDAPI_KEY` is present, it also fetches AllSports data.
3. Data is normalized, youth/reserve/women/lower-tier noise is filtered, and candidate matches are deduplicated.
4. `pickTop3()` scores matches using league weight, team tier, derby bonus, balance bonus, and stage bonus.
5. `matches` is updated in D1.
6. `is_pick` marks the featured matches of the day unless manual/admin override exists.

### 7.2 User pick flow

1. Frontend sends `/pick` with Telegram initData and score.
2. Backend verifies Telegram user via HMAC.
3. Backend resolves the authoritative match day from `matches`.
4. Backend validates lock time and boost/joker constraints.
5. Pick is upserted into `picks`.
6. User/day stats, quests, achievements, stars, balls, and case eligibility may update immediately.

### 7.3 Result and score flow

1. Results come from refresh sync or manual admin result entry.
2. `results` is upserted.
3. `recalcDayScores()` recalculates user totals across periods.
4. User stats and league day stats are recomputed.
5. `finalizeDay()` is called when enough results are present.
6. Bot summaries may be resent after manual result correction.

### 7.4 League flow

1. User creates private or channel league through `/leagues`.
2. Channel leagues require a pending bind session started by `/leagues/channel/start-bind`.
3. Bot completes Telegram channel selection and writes back to `pending_channel_binds`.
4. Membership lives in `league_members`.
5. League leaderboards use `scores_agg` or `league_day_stats`.

### 7.5 Economy flow

1. `shop_boosts`, `shop_cases`, and `shop_case_rewards` define inventory and loot tables.
2. Balls are the spendable currency.
3. Purchases create `purchase_history` and `ball_transactions`.
4. Boost inventory is stored in `user_boosts`; usage is tracked in `boost_usage`.
5. Cases are stored in `user_cases`; openings are logged in `case_opens`.
6. Rewards can grant stars, balls, boosts, or extra league slots.

## 8. Main User Scenarios

User-facing:
- open app via Telegram WebApp SDK,
- fetch `/day/today`, `/results`, `/picks`, `/leaderboard`,
- submit `/pick` and `/joker`,
- view `/leaderboards/*`,
- join `/leagues/join`,
- create `/leagues`,
- manage league via `/leagues/:id/*`,
- fetch `/quests/daily`, `/quests/seasonal`,
- fetch `/me/level`, `/me/streak`, `/users/:id/profile`,
- use `/shop/config`, `/shop/buy`, `/boosts/apply`, `/boosts/remove`, `/cases/open`.

Telegram bot:
- `/start`
- `/settings`
- reminder mode changes via callback buttons,
- channel bind via `/start bind_channel_<token>` and `chat_shared`,
- admin maintenance commands,
- daily reminders and summary pushes.

## 9. Admin Scenarios

Admin capabilities confirmed in code:
- inspect candidate matches and refresh a day,
- set top-3 mode: `AUTO`, `MANUAL`, `REST`,
- edit top-3 rules,
- set manual results,
- finalize a match/day,
- force refresh or debug external providers,
- toggle maintenance and queue maintenance broadcasts,
- edit season dates and number,
- inspect aggregate stats,
- inspect user picks,
- run global score recalc and daily backfill jobs,
- edit economy config for boosts/cases and case reward tables,
- search users, inspect details, grant/revoke balls and cases,
- trigger resend of bot daily summaries.

## 10. Database and Migrations

Core entities:
- `users`
- `matches`
- `picks`
- `results`
- `leagues`
- `league_members`
- `league_invites`
- `scores_agg`
- `user_stats`
- `user_day_stats`
- `league_day_stats`
- `achievements`
- `user_achievements`
- `tasks_catalog`
- `user_task_progress`
- `user_season_progress`
- `daily_quest_progress`
- `daily_cases`
- `stars_ledger`
- `balls_ledger`
- `shop_boosts`
- `shop_cases`
- `shop_case_rewards`
- `purchase_history`
- `user_boosts`
- `boost_usage`
- `user_cases`
- `case_opens`
- `ball_transactions`
- `case_transactions`
- `bot_users`
- `reminder_settings`
- `reminder_log`
- `featured_matches`
- `maintenance_state`
- `maintenance_log`
- `maintenance_events`
- `maintenance_event_log`
- `pending_channel_binds`

Important relationships:
- `picks` -> user + match/day
- `results` -> match/day
- `league_members` -> user + league
- `league_invites` -> league
- `user_day_stats` -> user + day
- `league_day_stats` -> league + user + day
- `user_achievements` / `user_task_progress` -> user progress records
- `user_season_progress` -> per-user per-season progression
- `user_boosts` / `user_cases` -> user inventory
- `case_opens`, `purchase_history`, `ball_transactions`, `case_transactions` -> economy audit/history
- `bot_users` and `reminder_settings` -> Telegram delivery layer

Important migration observations:
- Migration history is incomplete relative to current code expectations.
- Code uses columns not clearly introduced by migrations, including:
  - `users.photo_url`
  - `users.balls`
  - `matches.unlock_time`
  - `matches.api_provider`
  - `results.is_manual`
- `0006_unlock_time.sql` has the `ALTER TABLE` statements commented out.

This means schema bootstrap from migrations alone may not recreate the exact live schema.

## 11. Important API Surface

High-value public/user endpoints:
- `GET /day/today`
- `POST /picks`
- `POST /pick`
- `POST /joker`
- `GET /results`
- `POST /leaderboard`
- `GET /leaderboards/global`
- `GET /leaderboards/leagues`
- `GET /leaderboards/channels`
- `GET /me`
- `GET /me/streak`
- `GET /me/level`
- `GET /quests/daily`
- `GET /quests/seasonal`
- `GET /maintenance/status`
- `POST /leagues`
- `POST /leagues/my`
- `POST /leagues/join`
- `POST /leagues/:id`
- `POST /leagues/:id/invites`
- `POST /leagues/:id/leaderboard`
- `POST /leagues/:id/picks`
- `POST /matches/:id/league-picks`
- `GET /users/:id/profile`
- `GET /shop/config`
- `POST /shop/buy`
- `POST /me/boosts`
- `POST /boosts/apply`
- `POST /boosts/remove`
- `POST /me/cases`
- `POST /cases/open`

Admin endpoints are all inside `api-worker/src/index.ts` under `/admin/*`.

Auth model:
- user/admin auth is based on Telegram WebApp `initData`,
- admin rights come from `ADMIN_IDS`,
- bot webhook uses `WEBHOOK_SECRET`,
- some internal/system routes also allow `X-Telegram-Bot-Token`,
- maintenance bypass can use `x-maintenance-bypass`.

## 12. External Integrations

Confirmed integrations:
- Telegram WebApp JS SDK
- Telegram Bot API
- football-data.org
- AllSports API via RapidAPI (`allsportsapi2.p.rapidapi.com`)
- LiveScore via RapidAPI (`livescore6.p.rapidapi.com`) for some cup logic/debug paths
- Cloudinary for private league avatar upload/delete
- Cloudflare Workers + D1 + Wrangler

### football-data.org dependency map

Directly used in `api-worker/src/index.ts` for:
- daily match ingestion by competition,
- stale match recovery by match id,
- debug endpoints,
- refresh sync logic.

### AllSports dependency map

Directly used in `api-worker/src/index.ts` for:
- full match ingestion from `allsportsapi2.p.rapidapi.com`,
- score cross-reference and rescue logic,
- team crest image proxy,
- debug/test endpoints.

Indirectly affects:
- featured match selection,
- final score accuracy,
- crest URLs for matches and channel-like visuals.

## 13. Parts Tied to football-data.org and AllSports

Strongly tied:
- `refreshToday()`
- `fetchFD()`
- `fetchAllSportsMatches()`
- stale featured match rescue inside `refreshToday()`
- cross-reference of finished scores
- `/proxy/team/:id/image`
- `/debug-api`
- `/debug-af`
- `/debug/fd`
- `/admin/test-fd`
- `/admin/test-rapid`

Operationally tied:
- daily cron in `api-worker.scheduled()`
- 15-minute sync in `api-worker.scheduled()`
- admin candidate refresh flow when `refresh=true`
- any frontend action that calls `/day/today?force=true`

## 14. Places That Can Accidentally Trigger External Requests

Potentially dangerous to run during analysis:
- `api-worker` worker `fetch()` for:
  - `GET /day/today` when DB is empty or `force=true`
  - debug/test endpoints
  - `GET /proxy/team/:id/image`
- `api-worker` cron handler `scheduled()`
- `bot-worker` webhook and cron handlers
- admin actions that refresh day data or resend summaries
- any dev server session where the frontend is opened and starts calling the backend
- scripts in `api-worker/` such as `test_fd.js`, `test_rapid.js`, `test_refresh.js`, `trigger_cron.js`

Potentially dangerous but non-football:
- private league avatar upload/delete to Cloudinary,
- bot maintenance broadcasts and reminders to Telegram.

## 15. Config and Env

Observed env/config names:

Frontend (`web/.env.local`):
- `NEXT_PUBLIC_API_BASE`
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_USER_ID`
- `WEBAPP_URL`

API worker (`api-worker/wrangler.toml` / code):
- `TELEGRAM_BOT_TOKEN`
- `ADMIN_IDS`
- `ALLOWED_ORIGIN`
- `FOOTBALL_DATA_TOKEN`
- `RAPIDAPI_KEY`
- `MAINTENANCE_FORCE_OFF`
- `MAINTENANCE_BYPASS_SECRET`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

Bot worker:
- `BOT_TOKEN`
- `WEBHOOK_SECRET`
- `MINIAPP_URL`
- `ADMIN_IDS`

Front worker:
- `API_ORIGIN`

Important config facts:
- `web` uses Next 16 and React 19.
- `web` is exported statically.
- `front-worker` serves `../web/out`.
- `api-worker` cron schedule:
  - `*/15 * * * *`
  - `1 0 * * *`
- `bot-worker` cron schedule:
  - `*/2 * * * *`

## 16. Local Development Workflow

Confirmed scripted commands:

`web`
- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`

`api-worker`
- `pnpm wrangler deploy`
- no real test script

`bot-worker`
- `npm run dev`
- `npm run deploy`
- `npm run check`

`front-worker`
- `pnpm wrangler deploy`

Likely but not scripted in package manifests:
- D1 migration apply via Wrangler commands.

Safe analysis guidance:
- static file inspection is safe,
- reading saved JSON/log files is safe,
- starting the frontend alone may be locally safe, but opening the UI can trigger backend calls,
- starting workers or invoking routes/cron is unsafe for analysis because it can hit Telegram, football-data.org, AllSports, or Cloudinary.

## 17. Confirmed vs Inferred vs Unknown

Confirmed by code:
- product is a Telegram Mini App football prediction game,
- backend/frontend/bot/front-worker split is real,
- D1 is the main shared database,
- daily/seasonal tasks, stars, balls, boosts, and cases are active features,
- channel leagues exist and use a Telegram-assisted bind flow,
- admin panel controls top-3 selection, maintenance, season, users, and economy.

Reasonable inference:
- production deployment is Cloudflare Workers + D1 behind custom domains,
- live schema has evolved beyond committed migrations,
- saved logs and debug scripts are remnants of earlier investigation work,
- `seasonal_tasks.md` is a product artifact kept roughly aligned with task seeds.

Unknown / needs future validation:
- exact live production schema drift from committed migrations,
- whether all debug/test endpoints are still reachable in production,
- whether LiveScore paths are still actively used or now mostly legacy,
- the intended source of truth between `achievements` and `tasks_catalog` long-term,
- exact deployment order and secret management process.

## 18. Key Risks and Technical Debt

High risk:
- `api-worker/wrangler.toml` contains a hardcoded `RAPIDAPI_KEY`.
- bot internal endpoint `/internal/resend-summary` authenticates using `BOT_TOKEN`, coupling bot control and internal worker auth.
- schema drift: migrations do not fully describe the columns current code expects.

Medium risk:
- very large monolithic files:
  - `api-worker/src/index.ts`
  - `bot-worker/src/index.ts`
  - `web/app/page.tsx`
- logic duplication between achievements/tasks systems and between frontend docs and backend rules.
- mixed package managers (`pnpm` and `npm`) inside one repo.
- default/incorrect docs: `web/README.md` is still create-next-app boilerplate.
- repo hygiene: `.next`, `out`, `.wrangler`, `node_modules`, saved logs, and debug scripts live inside the working tree.
- many strings/comments show mojibake, indicating encoding problems.

Concrete doc/code mismatches confirmed:
- `web/app/rules/page.tsx` describes scoring as `5 / 2 / 0`, but backend scoring is `5 / 3 / 2 / 0`.
- the same rules page says a user can be in only one league at a time, but backend membership model allows multiple league memberships.

## 19. Open Questions For Future Tasks

- What is the exact authoritative live schema, and can migrations be repaired to reproduce it from scratch?
- Which external provider is the long-term primary source: football-data.org, AllSports, or both?
- Should LiveScore integration remain, or be removed?
- Which remaining debug scripts and saved artifacts can be deleted safely?
- Should admin/internal endpoints be split out of the main public API worker?
- Should the economy/task/achievement systems be decomposed into dedicated modules?
- What is the intended secret management process for Wrangler env/secrets across environments?

## 20. Recommended Reading Order For New Engineers

1. `front-worker/src/index.ts`
2. `web/app/page.tsx`
3. `web/app/components/MatchesList.tsx`
4. `web/app/components/LeaguesSection.tsx`
5. `web/app/components/LeagueScreen.tsx`
6. `web/app/admin/page.tsx`
7. `api-worker/src/index.ts`
8. `api-worker/migrations/0001_init.sql`
9. `api-worker/migrations/0004_leagues.sql`
10. `api-worker/migrations/0010_achievements_schema.sql`
11. `api-worker/migrations/0023_tasks_catalog.sql`
12. `api-worker/migrations/0026_balls_backfill_shop.sql`
13. `api-worker/migrations/0028_0028_store_admin_economy.sql`
14. `bot-worker/src/index.ts`
