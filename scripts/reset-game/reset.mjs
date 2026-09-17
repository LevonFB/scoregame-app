#!/usr/bin/env node
// Полное обнуление игровых данных перед запуском (подготовка прода к 12/21.08.2026).
//
// Что чистится: аккаунты, прогресс, экономика, история дней (матчи/результаты),
// лиги, игровые сезоны, пользовательские записи и тестовый контент прогнозов
// сезона, тестовые выполнения партнёрских заданий, состояние бота.
//
// Что НЕ трогается (каталоги и конфигурация):
//   achievements, tasks_catalog, shop_*, fortune_wheel*, economy_star_exchange_*,
//   banned_words, team_logos, app_config, app_section_visibility, maintenance_*,
//   match_source_rules, admin_audit, partner_campaigns (боевые кампании каналов),
//   season_prediction_seasons / _tournaments / _tournament_teams / _tournament_players /
//   _tournament_rules / _award_options / _reward_rules / _task_reward_config
//   — то есть импортированный каталог команд и игроков остаётся на месте.
//
// Использование (из корня репозитория):
//   node scripts/reset-game/reset.mjs            # dry-run: счётчики до чистки
//   node scripts/reset-game/reset.mjs --execute  # выполнить
//   ... --local                                  # локальная D1 вместо прода
//
// После чистки требуются ручные шаги в админке (скрипт их НЕ делает):
//   1. Создать сезон «Сезон 2026/27» и активировать его.
//   2. Прогнать bootstrap еврокубковой сетки: UCL, UEL, UECL.
//   3. Проверить настройки реферальной программы (Экономика → Рефералы).

import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_WORKER_DIR = path.resolve(__dirname, "../../api-worker");
const DB_NAME = "scoregame_db";

// Порядок значим: FK без каскада требуют удаления детей раньше родителей.
//   reminder_settings -> bot_users
//   partner_events / partner_reward_logs -> partner_claims
//   league_members -> leagues
//   users удаляется последним (каскадом добирает ball_transactions,
//   case_transactions, league_members, lucky_token_transactions,
//   telegram_star_orders — все они и так стоят в списке явно).
const WIPE_GROUPS = [
  ["Прогнозы и прогресс", [
    "picks",
    "pick_bonus_answers",
    "pick_goalscorers",
    "boost_usage",
    "user_boosts",
    "daily_quest_progress",
    "user_task_progress",
    "weekly_challenge_task_claims",
    "user_achievements",
    "user_stats",
    "user_day_stats",
    "user_season_progress",
    "scores_agg",
  ]],
  ["Экономика", [
    "ball_transactions",
    "balls_ledger",
    "stars_ledger",
    "star_exchange_ledger",
    "star_purchase_ledger",
    "reward_ledger",
    "lucky_token_transactions",
    "case_transactions",
    "case_opens",
    "user_cases",
    "daily_cases",
    "daily_case_backfill_jobs",
    "fortune_spins",
    "fortune_spin_opens",
    "purchase_history",
    "telegram_star_order_events",  // до telegram_star_orders (FK каскад)
    "telegram_star_orders",
  ]],
  ["История дней и матчи", [
    "results",
    "day_finalized",
    "featured_matches",
    "top3_overrides",
    "match_bonus_questions",
    "match_goalscorer_settings",
    "match_squad_cache",
    "match_source_fetch_runs",
    "matches",
  ]],
  ["Лиги", [
    "league_day_stats",
    "league_invites",
    "league_members_history",
    "league_members",
    "pending_channel_binds",
    "weekly_league_standings_snapshot",
    "leagues",
  ]],
  ["Недели и игровые сезоны", [
    "weekly_finalizations",
    "weekly_finalizer_jobs",
    "season_standings_snapshot",
    "season_league_standings_snapshot",
    "season_awards",
    "seasons",
  ]],
  ["Прогнозы сезона: пользовательское и тестовый контент", [
    "season_prediction_user_scores",
    "season_prediction_user_entries",
    "season_prediction_recalc_log",
    "season_prediction_official_awards",
    "season_prediction_official_results",
    "season_prediction_eurocup_knockout_brackets",
    "season_prediction_eurocup_knockout_matches",
    "season_prediction_weekly_challenge_scores",
    "season_prediction_weekly_challenge_entries",
    "season_prediction_weekly_challenge_questions",
    "season_prediction_weekly_challenge_matches",
    "season_prediction_weekly_challenges",
  ]],
  ["Партнёрские задания (кампании остаются)", [
    "partner_events",
    "partner_reward_logs",
    "partner_claims",
  ]],
  ["Бот и аккаунты", [
    "broadcast_deliveries",
    "broadcast_jobs",
    "reminder_log",
    "reminder_settings",  // строго до bot_users (FK без каскада)
    "bot_users",
    "users",              // последним
  ]],
];

const WIPE_TABLES = WIPE_GROUPS.flatMap(([, tables]) => tables);

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
    if (!/fetch failed|ETIMEDOUT|ECONNRESET/i.test(out)) break;
    if (attempt < 3) {
      console.log(`  (сетевая ошибка wrangler, ретрай ${attempt + 1}/3...)`);
      sleepSync(2000 * attempt);
    }
  }
  throw lastErr;
}

// SELECT: только через --command (--file возвращает сводку без строк).
function runD1Select(sql, remote) {
  return runWrangler(["--command", `"${sql}"`], remote);
}

// DML: через --file — обходит лимит длины командной строки.
function runD1File(sql, remote) {
  const tmpFile = path.join(__dirname, `.tmp-reset-${Date.now()}.sql`);
  writeFileSync(tmpFile, sql, "utf8");
  try {
    return runWrangler(["--file", `"${tmpFile}"`], remote);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

// D1 роняет большие компаунд-SELECT ("too many terms in compound SELECT") —
// считаем батчами по 4 таблицы.
function fetchCounts(tables, remote) {
  const counts = new Map();
  const BATCH = 4;
  for (let i = 0; i < tables.length; i += BATCH) {
    const chunk = tables.slice(i, i + BATCH);
    const sql = chunk.map((t) => `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM ${t}`).join(" UNION ALL ");
    const out = runD1Select(sql, remote);
    for (const row of out[0]?.results ?? []) counts.set(String(row.tbl), Number(row.cnt));
  }
  return counts;
}

// Границы игрового дня — по Москве (UTC+3), как в computeMatchdayKey.
function moscowDayKey(offsetDays = 0) {
  const nowMsk = new Date(Date.now() + 3 * 3600_000 + offsetDays * 86400_000);
  return nowMsk.toISOString().slice(0, 10);
}

function buildWipeSql() {
  const lines = [];
  for (const [group, tables] of WIPE_GROUPS) {
    lines.push(`-- ${group}`);
    for (const t of tables) lines.push(`DELETE FROM ${t};`);
    lines.push("");
  }

  // Legacy-ключ app_settings.season указывает на удалённый сезон; при создании
  // нового сезона syncLegacySeasonSetting() запишет его заново.
  lines.push("-- Legacy-настройка сезона (пересоздастся при активации нового)");
  lines.push(`DELETE FROM app_settings WHERE key = 'season';`);
  lines.push("");

  // Кэш дня версионируется ключом day_cache_ver:<day> в app_settings; после
  // удаления matches/results старую версию нужно сдвинуть, иначе edge отдаст
  // закэшированный день.
  lines.push("-- Инвалидация версионированного кэша дня (сегодня и вчера по МСК)");
  for (const day of [moscowDayKey(0), moscowDayKey(-1)]) {
    lines.push(
      `INSERT INTO app_settings (key, value_json, updated_at, updated_by) ` +
      `VALUES ('day_cache_ver:${day}', json_object('v', 1), datetime('now'), 0) ` +
      `ON CONFLICT(key) DO UPDATE SET ` +
      `value_json = json_object('v', COALESCE(CAST(json_extract(app_settings.value_json, '$.v') AS INTEGER), 0) + 1), ` +
      `updated_at = datetime('now');`
    );
  }
  return lines.join("\n") + "\n";
}

function askConfirmation(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const remote = !args.includes("--local");
  const yes = args.includes("--yes");

  const target = remote ? "ПРОД (--remote)" : "локальная D1";
  console.log(`База: ${target}, режим: ${execute ? "ОЧИСТКА" : "dry-run"}\n`);

  const before = fetchCounts(WIPE_TABLES, remote);
  let total = 0;
  for (const [group, tables] of WIPE_GROUPS) {
    console.log(`${group}:`);
    for (const t of tables) {
      const n = before.get(t) ?? 0;
      total += n;
      if (n > 0) console.log(`  ${String(n).padStart(6)}  ${t}`);
    }
  }
  console.log(`\nВсего строк к удалению: ${total}`);

  if (!execute) {
    console.log("\nDry-run. Для очистки добавьте --execute");
    return;
  }

  if (remote && !yes) {
    const answer = await askConfirmation(
      `\nЭто удалит ${total} строк из ПРОДА без возможности отката.\nВведите RESET для подтверждения: `
    );
    if (String(answer).trim() !== "RESET") {
      console.log("Отменено.");
      process.exit(1);
    }
  }

  console.log("\nВыполняю очистку...");
  runD1File(buildWipeSql(), remote);

  const after = fetchCounts(WIPE_TABLES, remote);
  const leftovers = [...after.entries()].filter(([, n]) => n > 0);
  console.log("\nПроверка после очистки:");
  if (leftovers.length === 0) {
    console.log("  все целевые таблицы пусты.");
  } else {
    for (const [t, n] of leftovers) console.log(`  ОСТАЛОСЬ ${n} в ${t}`);
    process.exitCode = 3;
  }

  console.log(`
Дальше вручную в админке:
  1. Создать сезон «Сезон 2026/27» и активировать его.
  2. Bootstrap еврокубковой сетки: UCL, UEL, UECL.
  3. Проверить настройки реферальной программы (Экономика → Рефералы).`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
