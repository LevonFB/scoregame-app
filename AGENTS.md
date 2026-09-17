# AGENTS.md

## Project context
- ScoreGame is a Telegram Mini App for football predictions.
- Core product areas include daily match picks, leagues, boosts, cases, quests, achievements, leaderboards, admin workflows, daily summaries, and Telegram bot notifications.
- Treat the codebase as the source of truth. If documentation and code disagree, trust code and call out the mismatch.

## Stack
- Frontend: Next.js, React, TypeScript, Telegram WebApp APIs.
- Backend: Cloudflare Workers in TypeScript (`api-worker`, `bot-worker`, `front-worker`).
- Data: Cloudflare D1 / SQLite with SQL migrations under `api-worker/migrations`.
- Integrations: Telegram Bot API, football-data.org, AllSports via RapidAPI, Cloudinary.
- Tooling: `pnpm` for `web` and most workers, `npm` in `bot-worker`, Wrangler for local worker workflows and deploys.

## Working style
- Study the existing code path and architecture before changing anything.
- Reuse current helpers, query patterns, response shapes, and UI conventions.
- Keep scope tight and patches localized to the layers required by the task.
- Identify root cause before editing files.
- Preserve existing API contracts unless the task explicitly requires a change.
- Avoid introducing new frameworks, libraries, or architectural patterns unless there is a clear, task-driven need.
- Prefer RTK wrappers for noisy terminal commands in this repository.

## Project-specific constraints
- Do not change business rules for scoring, boosts, cases, leagues, rewards, or summaries unless the task explicitly asks for it.
- Treat manual score correction as a first-class workflow. Preserve its priority over provider data and keep the flow idempotent.
- Be careful with cron, reset, and Moscow time logic. Small date mistakes can change daily outcomes.
- Avoid unnecessary live calls to football-data.org and AllSports while exploring or testing. Prefer local code, migrations, fixtures, saved outputs, and existing DB state first.
- Do not add provider calls when the problem can be solved in current backend logic, admin flows, or persisted data.
- For schema changes, add a migration and describe the data impact.

## File routing hints
- Frontend user experience: inspect `web/app` and shared UI helpers first.
- Admin panel behavior: inspect `web/app/admin` and any admin-specific client hooks/components first.
- Main backend/API logic: inspect `api-worker/src/index.ts` first, then related migrations.
- Bot notifications, webhook handling, and daily summaries: inspect `bot-worker/src/index.ts`.
- Front routing/static delivery: inspect `front-worker/src/index.ts` and `web/next.config.mjs`.
- Data model questions: inspect `api-worker/migrations` and the SQL used by the affected endpoints.

## Required checks after changes
- Run the narrowest useful verification for the touched area, such as targeted typecheck, lint, or focused tests.
- If the task touches cron, summaries, results, or daily reset logic, explicitly review the affected day/time assumptions.
- If the task touches admin/manual correction flows, verify that manual overrides still dominate provider data.
- Summarize the changed files at the end.
- Call out residual risks, skipped checks, and any unverified assumptions.

## Review guidelines
- Reject duplicated logic when an existing helper or server-side source of truth should be reused.
- Reject hidden breaking changes to API contracts, bot side effects, scoring, or reset timing.
- Reject changes that silently increase external API usage or make provider coupling tighter without need.
- Watch for brittle conditionals around match status, finished/live transitions, and manual overrides.
- Watch for mobile regressions in Telegram WebApp and admin screens.
- Prefer concrete findings with file references and explain why each issue matters.
