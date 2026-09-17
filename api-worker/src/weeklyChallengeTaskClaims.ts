import {
  WEEKLY_CHALLENGE_TASK_SOURCE_TYPE,
  weeklyRewardComponentKeys,
  type WeeklyTaskReward,
} from "./seasonPredictionWeeklyTasks";
import { LUCKY_TOKEN_OPS } from "./luckyToken";

export const WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS = 300;

export type WeeklyTaskRewardGrant = {
  stars: number;
  balls: number;
  case_type: string | null;
  case_count: number;
  lucky_tokens: number;
  boost_type: string | null;
  boost_count: number;
};

export type WeeklyTaskClaimRewardParams = {
  db: D1Database;
  userId: number;
  seasonId: number;
  taskKey: string;
  base: string;
  reward: WeeklyTaskReward;
  challengeId: number | null;
  nowSeconds?: number;
  nowMs?: number;
  lockToken?: string;
  snapshot?: Record<string, unknown>;
};

export type WeeklyTaskClaimRewardResult = WeeklyTaskRewardGrant;

function rewardResult(reward: WeeklyTaskReward): WeeklyTaskClaimRewardResult {
  return {
    stars: reward.stars,
    balls: reward.balls,
    case_type: reward.case_type,
    case_count: reward.case_count,
    lucky_tokens: reward.lucky_tokens || 0,
    boost_type: reward.boost_type || null,
    boost_count: reward.boost_count || 0,
  };
}

function buildLockToken(nowMs: number): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${nowMs}:${Math.random().toString(16).slice(2)}`;
}

async function listExistingRewardKeys(db: D1Database, userId: number, required: string[]): Promise<Set<string>> {
  if (required.length === 0) return new Set();
  const placeholders = required.map(() => "?").join(", ");
  const res = await db.prepare(`
    SELECT unique_key FROM reward_ledger
    WHERE user_id = ?
      AND status = 'granted'
      AND unique_key IN (${placeholders})
  `).bind(userId, ...required).all();
  return new Set(((res.results || []) as Array<{ unique_key: string }>).map((row) => String(row.unique_key)));
}

async function completeClaimIfComponentsExist(
  db: D1Database,
  params: { challengeId: number; userId: number; taskKey: string; required: string[]; nowSeconds: number },
): Promise<boolean> {
  const keys = await listExistingRewardKeys(db, params.userId, params.required);
  const complete = params.required.length > 0 && params.required.every((key) => keys.has(key));
  if (!complete) return false;
  await db.prepare(`
    UPDATE weekly_challenge_task_claims
    SET status = 'completed', completed_at = ?, updated_at = ?, lock_token = NULL
    WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
  `).bind(params.nowSeconds, params.nowSeconds, params.challengeId, params.userId, params.taskKey).run();
  return true;
}

async function readClaimRow(db: D1Database, challengeId: number, userId: number, taskKey: string): Promise<any | null> {
  return await db.prepare(`
    SELECT status, lock_token, updated_at, reward_snapshot_json
    FROM weekly_challenge_task_claims
    WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
    LIMIT 1
  `).bind(challengeId, userId, taskKey).first() as any;
}

function rewardFromSnapshot(row: any, fallback: WeeklyTaskReward): WeeklyTaskReward {
  try {
    const parsed = JSON.parse(String(row?.reward_snapshot_json || "{}"));
    const raw = parsed?.reward && typeof parsed.reward === "object" ? parsed.reward : parsed;
    const boostCount = Math.max(0, Math.floor(Number(raw?.boost_count || 0)));
    const normalized = {
      stars: Math.max(0, Math.floor(Number(raw?.stars || 0))),
      balls: Math.max(0, Math.floor(Number(raw?.balls || 0))),
      case_type: raw?.case_type == null || raw?.case_type === "" ? null : String(raw.case_type),
      case_count: Math.max(0, Math.floor(Number(raw?.case_count || 0))),
      lucky_tokens: Math.max(0, Math.floor(Number(raw?.lucky_tokens || 0))),
      boost_type: raw?.boost_type == null || raw?.boost_type === "" ? null : String(raw.boost_type),
      boost_count: boostCount,
    };
    if (normalized.stars <= 0 && normalized.balls <= 0 && normalized.case_count <= 0 && normalized.lucky_tokens <= 0 && normalized.boost_count <= 0) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
}

export async function claimWeeklyChallengeTaskReward(params: WeeklyTaskClaimRewardParams): Promise<WeeklyTaskClaimRewardResult> {
  const { db, userId, seasonId, taskKey, base, reward } = params;
  if (params.challengeId == null) throw new Error("WEEKLY_CHALLENGE_REQUIRED_FOR_CLAIM");
  const challengeId = params.challengeId;
  const required = weeklyRewardComponentKeys(base, reward);
  const existing = await listExistingRewardKeys(db, userId, required);
  const missing = required.filter((key) => !existing.has(key));
  if (missing.length === 0) {
    await completeClaimIfComponentsExist(db, { challengeId, userId, taskKey, required, nowSeconds: params.nowSeconds ?? Math.floor(Date.now() / 1000) });
    return rewardResult(reward);
  }

  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const nowMs = params.nowMs ?? Date.now();
  const metadataJson = JSON.stringify({ challenge_id: challengeId, task_key: taskKey, user_id: userId, ...(params.snapshot || {}), reward, component_keys: required });
  const lockToken = params.lockToken || buildLockToken(nowMs);
  const staleBefore = nowSeconds - WEEKLY_TASK_CLAIM_LOCK_TTL_SECONDS;

  await db.prepare(`
    INSERT OR IGNORE INTO weekly_challenge_task_claims (
      weekly_challenge_id, user_id, task_key, status, lock_token, reward_snapshot_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
  `).bind(challengeId, userId, taskKey, lockToken, metadataJson, nowSeconds, nowSeconds).run();

  let claimRow = await readClaimRow(db, challengeId, userId, taskKey);
  if (claimRow && String(claimRow.status) === "completed") return rewardResult(reward);

  if (claimRow && String(claimRow.lock_token) !== lockToken) {
    const status = String(claimRow.status);
    const updatedAt = Number(claimRow.updated_at || 0);
    const staleOrFailed = status === "failed" || (status === "running" && updatedAt > 0 && updatedAt < staleBefore);
    const snapshotReward = rewardFromSnapshot(claimRow, reward);
    const snapshotRequired = weeklyRewardComponentKeys(base, snapshotReward);

    if (!staleOrFailed) throw new Error("WEEKLY_TASK_CLAIM_IN_PROGRESS");

    if (await completeClaimIfComponentsExist(db, { challengeId, userId, taskKey, required: snapshotRequired, nowSeconds })) {
      return rewardResult(snapshotReward);
    }

    const previousToken = String(claimRow.lock_token || "");
    await db.prepare(`
      UPDATE weekly_challenge_task_claims
      SET status = 'running', lock_token = ?, updated_at = ?
      WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
        AND COALESCE(lock_token, '') = ?
        AND (status = 'failed' OR (status = 'running' AND updated_at < ?))
    `).bind(lockToken, nowSeconds, challengeId, userId, taskKey, previousToken, staleBefore).run();
    claimRow = await readClaimRow(db, challengeId, userId, taskKey);
  }

  if (!claimRow || String(claimRow.lock_token) !== lockToken || String(claimRow.status) !== "running") {
    throw new Error("WEEKLY_TASK_CLAIM_IN_PROGRESS");
  }

  const grantReward = rewardFromSnapshot(claimRow, reward);
  const grantRequired = weeklyRewardComponentKeys(base, grantReward);
  const grantExisting = await listExistingRewardKeys(db, userId, grantRequired);
  const grantMissing = grantRequired.filter((key) => !grantExisting.has(key));

  const statements: D1PreparedStatement[] = [];
  const rewardLedgerInsert = (uniqueKey: string, rewardType: "stars" | "balls" | "case" | "lucky_token" | "boost", amount: number, caseType?: string | null) => db.prepare(`
    INSERT INTO reward_ledger
      (user_id, source_type, source_id, unique_key, reward_type, amount, case_type, status, granted_at, granted_by, metadata_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'granted', ?, NULL, ?
    WHERE EXISTS (
      SELECT 1 FROM weekly_challenge_task_claims
      WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
        AND status = 'running' AND lock_token = ?
    )
      AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
  `).bind(
    userId, WEEKLY_CHALLENGE_TASK_SOURCE_TYPE, taskKey, uniqueKey, rewardType, amount, caseType || null, nowSeconds, metadataJson,
    challengeId, userId, taskKey, lockToken, uniqueKey,
  );

  const starsKey = `${base}:stars`;
  if (grantReward.stars > 0 && grantMissing.includes(starsKey)) {
    statements.push(
      db.prepare(`
        INSERT INTO user_season_progress (user_id, season_number, stars)
        VALUES (?, ?, 0)
        ON CONFLICT(user_id, season_number) DO NOTHING
      `).bind(userId, seasonId),
      db.prepare(`
        UPDATE user_season_progress
        SET stars = stars + ?
        WHERE user_id = ? AND season_number = ?
          AND EXISTS (
            SELECT 1 FROM weekly_challenge_task_claims
            WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
              AND status = 'running' AND lock_token = ?
          )
          AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
      `).bind(grantReward.stars, userId, seasonId, challengeId, userId, taskKey, lockToken, starsKey),
      db.prepare(`
        INSERT OR IGNORE INTO stars_ledger (user_id, season_id, source, task_key, instance_key, stars, created_at, metadata_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM weekly_challenge_task_claims
          WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
            AND status = 'running' AND lock_token = ?
        )
          AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
      `).bind(userId, seasonId, WEEKLY_CHALLENGE_TASK_SOURCE_TYPE, taskKey, starsKey, grantReward.stars, nowMs, metadataJson, challengeId, userId, taskKey, lockToken, starsKey),
      rewardLedgerInsert(starsKey, "stars", grantReward.stars, null),
    );
  }

  const ballsKey = `${base}:balls`;
  if (grantReward.balls > 0 && grantMissing.includes(ballsKey)) {
    statements.push(
      db.prepare(`
        UPDATE users
        SET balls = balls + ?
        WHERE id = ?
          AND EXISTS (
            SELECT 1 FROM weekly_challenge_task_claims
            WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
              AND status = 'running' AND lock_token = ?
          )
          AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
      `).bind(grantReward.balls, userId, challengeId, userId, taskKey, lockToken, ballsKey),
      db.prepare(`
        INSERT OR IGNORE INTO balls_ledger (user_id, season_id, task_key, instance_key, balls, source, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM weekly_challenge_task_claims
          WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
            AND status = 'running' AND lock_token = ?
        )
          AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
      `).bind(userId, seasonId, taskKey, ballsKey, grantReward.balls, WEEKLY_CHALLENGE_TASK_SOURCE_TYPE, nowMs, challengeId, userId, taskKey, lockToken, ballsKey),
      rewardLedgerInsert(ballsKey, "balls", grantReward.balls, null),
    );
  }

  if (grantReward.case_count > 0 && grantReward.case_type) {
    const caseKey = `${base}:case:${grantReward.case_type}`;
    if (grantMissing.includes(caseKey)) {
      statements.push(
        db.prepare(`
          INSERT OR IGNORE INTO user_cases (user_id, case_type, quantity)
          VALUES (?, ?, 0)
        `).bind(userId, grantReward.case_type),
        db.prepare(`
          UPDATE user_cases
          SET quantity = quantity + ?
          WHERE user_id = ? AND case_type = ?
            AND EXISTS (
              SELECT 1 FROM weekly_challenge_task_claims
              WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
                AND status = 'running' AND lock_token = ?
            )
            AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
        `).bind(grantReward.case_count, userId, grantReward.case_type, challengeId, userId, taskKey, lockToken, caseKey),
        rewardLedgerInsert(caseKey, "case", grantReward.case_count, grantReward.case_type),
      );
    }
  }

  if ((grantReward.lucky_tokens || 0) > 0) {
    const tokenKey = `${base}:lucky_token`;
    if (grantMissing.includes(tokenKey)) {
      const tokenAmount = grantReward.lucky_tokens || 0;
      statements.push(
        // History row first — captures the balance BEFORE the increment.
        // fortune_spins is the canonical lucky_token balance (single source of truth).
        db.prepare(`
          INSERT OR IGNORE INTO lucky_token_transactions
            (user_id, amount, balance_before, balance_after, operation_type, comment, admin_user_id, ref_id, created_at)
          SELECT ?, ?, COALESCE((SELECT quantity FROM fortune_spins WHERE user_id = ?), 0),
                 COALESCE((SELECT quantity FROM fortune_spins WHERE user_id = ?), 0) + ?,
                 ?, ?, NULL, ?, ?
          WHERE EXISTS (
            SELECT 1 FROM weekly_challenge_task_claims
            WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
              AND status = 'running' AND lock_token = ?
          )
            AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
        `).bind(userId, tokenAmount, userId, userId, tokenAmount, LUCKY_TOKEN_OPS.taskReward, 'Награда задания', tokenKey, nowMs,
                challengeId, userId, taskKey, lockToken, tokenKey),
        db.prepare(`
          INSERT OR IGNORE INTO fortune_spins (user_id, quantity) VALUES (?, 0)
        `).bind(userId),
        db.prepare(`
          UPDATE fortune_spins
          SET quantity = quantity + ?
          WHERE user_id = ?
            AND EXISTS (
              SELECT 1 FROM weekly_challenge_task_claims
              WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
                AND status = 'running' AND lock_token = ?
            )
            AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
        `).bind(tokenAmount, userId, challengeId, userId, taskKey, lockToken, tokenKey),
        rewardLedgerInsert(tokenKey, "lucky_token", tokenAmount, null),
      );
    }
  }

  if ((grantReward.boost_count || 0) > 0 && grantReward.boost_type) {
    const boostKey = `${base}:boost:${grantReward.boost_type}`;
    if (grantMissing.includes(boostKey)) {
      const boostAmount = grantReward.boost_count || 0;
      const boostType = grantReward.boost_type;
      // user_boosts stores ONE row per boost unit (status='available'); insert boostAmount
      // rows. Every insert is guarded by the running-claim lock + the reward_ledger idempotency
      // key, so a replay (ledger row already granted) inserts nothing. The single ledger row is
      // the idempotency anchor for the whole boost component (reward_type='boost', case_type
      // reused as the boost subtype, amount = unit count).
      for (let i = 0; i < boostAmount; i++) {
        statements.push(
          db.prepare(`
            INSERT INTO user_boosts (user_id, boost_type, status, purchased_at)
            SELECT ?, ?, 'available', ?
            WHERE EXISTS (
              SELECT 1 FROM weekly_challenge_task_claims
              WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ?
                AND status = 'running' AND lock_token = ?
            )
              AND NOT EXISTS (SELECT 1 FROM reward_ledger WHERE unique_key = ? AND status = 'granted')
          `).bind(userId, boostType, nowMs, challengeId, userId, taskKey, lockToken, boostKey),
        );
      }
      statements.push(rewardLedgerInsert(boostKey, "boost", boostAmount, boostType));
    }
  }

  if (statements.length > 0) await db.batch(statements);

  if (!(await completeClaimIfComponentsExist(db, { challengeId, userId, taskKey, required: grantRequired, nowSeconds }))) {
    await db.prepare(`
      UPDATE weekly_challenge_task_claims
      SET status = 'failed', updated_at = ?
      WHERE weekly_challenge_id = ? AND user_id = ? AND task_key = ? AND lock_token = ?
    `).bind(nowSeconds, challengeId, userId, taskKey, lockToken).run();
    throw new Error("WEEKLY_TASK_CLAIM_INCOMPLETE");
  }

  return rewardResult(grantReward);
}
