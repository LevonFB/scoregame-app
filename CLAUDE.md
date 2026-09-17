# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**ScoreGame** — Telegram Mini App for football score predictions. Users pick daily match scores, use jokers and paid boosts, compete in leagues, earn stars/balls/cases/achievements, and progress through seasonal tasks.

## Architecture

Four independently deployable Cloudflare Workers + a Next.js frontend:

| Package | Role |
|---|---|
| `web/` | Next.js 16 + React 19, static export (`output: "export"`), Mini App UI + admin panel |
| `front-worker/` | Cloudflare Worker — serves `../web/out`, proxies `/api/*` to `api-worker` |
| `api-worker/` | Main backend Worker — all business logic, D1 access, cron, admin endpoints |
| `bot-worker/` | Telegram bot Worker — webhook, reminders, daily summaries, channel-league bind |

Shared database: Cloudflare D1 (`scoregame_db`) bound as `DB` in both `api-worker` and `bot-worker`.

## Commands

**`web/`** (uses `pnpm`)
```bash
pnpm dev        # local dev server
pnpm build      # static export → web/out/
pnpm lint       # ESLint
```

**`api-worker/`** (uses `pnpm`)
```bash
pnpm wrangler deploy   # deploy to Cloudflare
# D1 migration apply:
pnpm wrangler d1 migrations apply scoregame_db
```

**`bot-worker/`** (uses `npm`)
```bash
npm run dev     # local wrangler dev
npm run deploy  # deploy to Cloudflare
npm run check   # tsc --noEmit
```

**`front-worker/`** (uses `pnpm`)
```bash
pnpm wrangler deploy
```

> `bot-worker` uses `npm`; all other packages use `pnpm`. No cross-package test runner exists, but `api-worker` has its own suites: `pnpm test` (vitest units in `src/__tests__/`), `pnpm test:int` (local D1 via getPlatformProxy), `pnpm test:e2e*` (node:test, hit live endpoints — do not run during exploration).

## Key Entry Points

- **Frontend shell**: `web/app/page.tsx` — Telegram init, tab routing, maintenance gate, initial data fetches
- **Frontend transport**: `web/lib/api.ts` — central fetch helper, attaches `x-telegram-init-data`
- **Backend**: `api-worker/src/index.ts` — single large file containing all routes, helpers, cron (`scheduled()`), scoring, quests, economy, admin
- **Bot**: `bot-worker/src/index.ts` — webhook handler + cron (`scheduled()`)
- **Front proxy**: `front-worker/src/index.ts` — static asset delivery + `/api` proxy
- **DB schema**: `api-worker/migrations/*.sql` (0001–0115; applied in order)

## Auth Model

- User/admin auth: Telegram WebApp `initData` HMAC verification
- Admin rights: `ADMIN_IDS` env var
- Bot webhook: `WEBHOOK_SECRET`
- Internal bot → api calls: `X-Telegram-Bot-Token`
- Maintenance bypass: `x-maintenance-bypass` header

## Cron Schedules

- `api-worker`: `*/10 * * * *` (refresh/sync), `1 0 * * *` (daily reset, Moscow time matters), `5 * * * *` (shared V2 dispatcher — fans out to weekly/partner hourly + daily backfill; every branch is feature-flagged and default OFF, so it does no D1 work until enabled)
- `bot-worker`: `*/2 * * * *` (reminder delivery)
- Total 4 triggers (3 api + 1 bot) — Cloudflare's free tier allows 5.

## Environment Variables

**`web/.env.local`**: `NEXT_PUBLIC_API_BASE`, `TELEGRAM_BOT_TOKEN`, `ADMIN_USER_ID`, `WEBAPP_URL`

**`api-worker/wrangler.toml` (vars + secrets)**: `TELEGRAM_BOT_TOKEN`, `ADMIN_IDS`, `ALLOWED_ORIGIN`, `FOOTBALL_DATA_TOKEN`, `RAPIDAPI_KEY`, `MAINTENANCE_FORCE_OFF`, `MAINTENANCE_BYPASS_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

**`bot-worker/wrangler.toml` (vars + secrets)**: `BOT_TOKEN`, `WEBHOOK_SECRET`, `MINIAPP_URL`, `ADMIN_IDS`

**`front-worker`**: `API_ORIGIN`

## Important Backend Functions

- `refreshToday()` — ingests matches from football-data.org + AllSports, deduplicates, selects top-3 via `pickTop3()`
- `calculateMatchPoints()` — authoritative scoring: `5 / 3 / 2 / 0`
- `recalcDayScores()` — recomputes day/week/month/season/all aggregates
- `checkAchievements()` / `checkDailyQuests()` — triggered after pick saves and result finalization
- `awardStarsViaLedger()` / `awardBalls()` — economy writes (case-open rewards are applied inline in the case-open handler via ledger + `case_opens`, not a standalone `grantCaseReward()`)

## Schema Notes

- Live D1 schema was audited against `api-worker/migrations/` on 2026-06-28: no drift, all migrations applied. Historical gaps (columns added outside committed migrations, e.g. in `0006_unlock_time.sql`) were reconciled by later migrations.
- For any schema change: add a new numbered migration and describe the data impact.
- **Timestamp convention (audit 2026-07-19):** the schema mixes four formats — TEXT `datetime('now')` (`leagues`, `seasons`), unix seconds (`reward_ledger`), unix milliseconds (`matches.updated_at`, `shop_star_packs`), and `TIMESTAMP CURRENT_TIMESTAMP` columns that actually hold unix ms written by code (`ball_transactions`, `case_transactions` — the declared type lies). Rules: **new tables use unix seconds INTEGER**; never rely on the `created_at` DEFAULT in `ball_transactions`/`case_transactions` (a defaulted row would mix TEXT into an integer-ms column and break ordering); never compare timestamps across tables without checking each side's unit.
- **User deletion:** ~40 user-data tables have no FK to `users` (only 5 cascade). Never delete a user with bare SQL — use `node scripts/delete-user/delete-user.mjs <user_id>` (dry-run by default, `--execute` to delete; handles `reminder_settings`→`bot_users` FK order, nulls `referred_by`, verifies zero leftovers).

## Critical Constraints

- **Do not trigger live external API calls** during exploration — `refreshToday()`, cron handlers, debug endpoints (`/debug-api`, `/debug-af`, `/test_fd.js`, `trigger_cron.js`), and any admin action with `refresh=true` will call football-data.org, AllSports, Telegram, or Cloudinary.
- **Manual score correction is first-class** — manual overrides must always take priority over provider data; keep that logic idempotent.
- **Moscow time matters** for daily reset and cron logic — date arithmetic bugs can silently shift daily outcomes.
- **Do not change scoring, boost, case, or reward business rules** unless explicitly asked.
- **Preserve existing API contracts** — frontend, bot, and admin panel depend on stable response shapes.

## Known Technical Debt

- `api-worker/src/index.ts`, `bot-worker/src/index.ts`, and `web/app/page.tsx` are very large monolithic files.
- Mixed package managers: `pnpm` everywhere except `bot-worker` (uses `npm`).
