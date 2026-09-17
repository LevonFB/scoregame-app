#!/usr/bin/env node
// Полное удаление пользователя из прод-D1 (или локальной) со всеми данными.
//
// Схема не гарантирует каскад: FOREIGN KEY -> users(id) ON DELETE CASCADE есть
// только у 5 таблиц (ball_transactions, case_transactions, league_members,
// lucky_token_transactions, telegram_star_orders); остальные ~40 таблиц при
// голом DELETE FROM users остаются с сиротами, а bot_users без предварительного
// удаления reminder_settings падает с FK-ошибкой. Этот скрипт проходит по
// полному списку и удаляет в правильном порядке.
//
// Использование (из корня репозитория):
//   node scripts/delete-user/delete-user.mjs <user_id>            # dry-run: только счётчики
//   node scripts/delete-user/delete-user.mjs <user_id> --execute  # удалить
//   ... --local   # локальная D1 вместо прода
//
// Скрипт откажется удалять, если пользователь владеет неудалённой лигой —
// сначала передайте владение или удалите лигу через админку.

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_WORKER_DIR = path.resolve(__dirname, "../../api-worker");
const DB_NAME = "scoregame_db";

// Таблицы с user_id INTEGER. Порядок важен только там, где отмечено.
// telegram_star_order_events чистится каскадом от telegram_star_orders.
const USER_ID_TABLES = [
  "ball_transactions",
  "balls_ledger",
  "boost_usage",
  "broadcast_deliveries",
  "case_opens",
  "case_transactions",
  "daily_cases",
  "daily_quest_progress",
  "fortune_spin_opens",
  "fortune_spins",
  "league_day_stats",
  "league_members",
  "league_members_history",
  "lucky_token_transactions",
  "partner_events",        // до partner_claims (FK claim_id -> SET NULL)
  "partner_reward_logs",   // до partner_claims (FK claim_id -> CASCADE)
  "partner_claims",
  "pending_channel_binds",
  "pick_bonus_answers",
  "pick_goalscorers",
  "picks",
  "purchase_history",
  "reminder_log",
  "reminder_settings",     // строго до bot_users (FK без каскада)
  "bot_users",
  "reward_ledger",
  "scores_agg",
  "season_awards",
  "season_league_standings_snapshot",
  "season_prediction_eurocup_knockout_brackets",
  "season_prediction_user_entries",
  "season_prediction_user_scores",
  "season_prediction_weekly_challenge_entries",
  "season_prediction_weekly_challenge_scores",
  "season_standings_snapshot",
  "star_exchange_ledger",
  "star_purchase_ledger",
  "stars_ledger",
  "telegram_star_orders",
  "user_achievements",
  "user_boosts",
  "user_cases",
  "user_day_stats",
  "user_season_progress",
  "user_stats",
  "user_task_progress",
  "weekly_challenge_task_claims",
  "weekly_league_standings_snapshot",
];

// user_id здесь TEXT — сравниваем со строкой.
const TEXT_USER_ID_TABLES = ["maintenance_event_log"];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runWrangler(extraArgs, remote) {
  const args = ["wrangler", "d1", "execute", DB_NAME, "--json", ...extraArgs];
  if (remote) args.push("--remote");
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = spawnSync("pnpm", args, {
      cwd: API_WORKER_DIR,
      shell: true,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const out = `${res.stdout}\n${res.stderr}`;
    if (res.status === 0) {
      const start = res.stdout.indexOf("[");
      if (start === -1) throw new Error(`no JSON in wrangler output:\n${res.stdout}`);
      return JSON.parse(res.stdout.slice(start));
    }
    lastErr = new Error(`wrangler exited ${res.status}\n${out}`);
    if (!/fetch failed|ETIMEDOUT|ECONNRESET/i.test(out)) break; // не сетевая ошибка — не ретраим
    if (attempt < 3) {
      console.log(`  (сетевая ошибка wrangler, ретрай ${attempt + 1}/3...)`);
      sleepSync(2000 * attempt);
    }
  }
  throw lastErr;
}

// SELECT-запросы: только через --command (--file возвращает сводку без строк).
// SQL не должен содержать двойных кавычек и переводов строк.
function runD1Select(sql, remote) {
  return runWrangler(["--command", `"${sql}"`], remote);
}

// DML-пакет: через --file (строки ответа не нужны, обходим лимит длины команды).
function runD1File(sql, remote) {
  const tmpFile = path.join(__dirname, `.tmp-delete-user-${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, "utf8");
  try {
    return runWrangler(["--file", `"${tmpFile}"`], remote);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// Счётчики батчами: командная строка Windows ограничена ~8К символов.
function fetchCounts(userId, remote) {
  const parts = [
    ...USER_ID_TABLES.map(
      (t) => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM ${t} WHERE user_id = ${userId}`
    ),
    ...TEXT_USER_ID_TABLES.map(
      (t) => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM ${t} WHERE user_id = '${userId}'`
    ),
    `SELECT 'users (referred_by -> NULL)' AS tbl, COUNT(*) AS cnt FROM users WHERE referred_by = ${userId}`,
    `SELECT 'users' AS tbl, COUNT(*) AS cnt FROM users WHERE id = ${userId}`,
  ];
  const BATCH = 5; // D1: "too many terms in compound SELECT" при больших UNION ALL
  const rows = [];
  for (let i = 0; i < parts.length; i += BATCH) {
    const sql = parts.slice(i, i + BATCH).join(" UNION ALL ") + ";";
    const out = runD1Select(sql, remote);
    rows.push(...(out[0]?.results ?? []));
  }
  return rows;
}

function deleteSql(userId) {
  const stmts = [
    ...USER_ID_TABLES.map((t) => `DELETE FROM ${t} WHERE user_id = ${userId};`),
    ...TEXT_USER_ID_TABLES.map((t) => `DELETE FROM ${t} WHERE user_id = '${userId}';`),
    `UPDATE users SET referred_by = NULL WHERE referred_by = ${userId};`,
    `DELETE FROM users WHERE id = ${userId};`,
  ];
  return stmts.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const remote = !args.includes("--local");
  const userId = Number(args.find((a) => /^\d+$/.test(a)));
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    console.error("Использование: node delete-user.mjs <user_id> [--execute] [--local]");
    process.exit(1);
  }
  const target = remote ? "ПРОД (--remote)" : "локальная D1";
  console.log(`Пользователь ${userId}, база: ${target}, режим: ${execute ? "УДАЛЕНИЕ" : "dry-run"}\n`);

  // Гард: владение лигами
  const guard = runD1Select(
    `SELECT id, name FROM leagues WHERE owner_id = ${userId} AND deleted_at IS NULL;`,
    remote
  );
  const ownedLeagues = guard[0]?.results ?? [];
  if (ownedLeagues.length > 0) {
    console.error("СТОП: пользователь владеет активными лигами — сначала передайте владение или удалите лигу:");
    for (const l of ownedLeagues) console.error(`  - ${l.id} "${l.name}"`);
    process.exit(2);
  }

  const counts = fetchCounts(userId, remote).filter((r) => r.cnt > 0);
  if (counts.length === 0) {
    console.log("Данных не найдено — пользователя нет в базе.");
    return;
  }
  console.log("Найдены данные:");
  for (const r of counts) console.log(`  ${String(r.cnt).padStart(6)}  ${r.tbl}`);

  if (!execute) {
    console.log("\nDry-run. Для удаления добавьте --execute");
    return;
  }

  console.log("\nУдаляю...");
  runD1File(deleteSql(userId), remote);

  const leftovers = fetchCounts(userId, remote).filter((r) => r.cnt > 0);
  if (leftovers.length === 0) {
    console.log("Готово: все данные пользователя удалены, остатков нет.");
  } else {
    console.error("ВНИМАНИЕ: после удаления остались строки:");
    for (const r of leftovers) console.error(`  ${r.cnt}  ${r.tbl}`);
    process.exit(3);
  }
}

main();
