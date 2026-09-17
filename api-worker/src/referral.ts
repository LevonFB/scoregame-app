// referral.ts
// Pure, I/O-free helpers for the referral program (docs/referral-v1.md).
//
// Codes are stateless: ref code = base36 of the inviter's telegram id (bijective,
// same idea as generatedProfileKey). Channel attribution uses `src_<slug>`.
// The admin-editable reward config lives in app_config under REFERRAL_CONFIG_KEY;
// everything here only parses/validates — all D1 access stays in index.ts.

export const REFERRAL_CONFIG_KEY = "referral_config";

// Reward vocabulary is a closed set: economy items only, never stars/balls
// directly (economy-v1 §21). "none" lets the admin switch a slot off.
export const REFERRAL_REWARD_TYPES = ["daily_case", "premium_case", "lucky_token", "none"] as const;
export type ReferralRewardType = (typeof REFERRAL_REWARD_TYPES)[number];

export type ReferralReward = { type: ReferralRewardType; amount: number };
export type ReferralMilestone = { count: number; reward: ReferralReward };

export type ReferralConfig = {
  enabled: boolean;
  invitee_reward: ReferralReward;
  per_friend_reward: ReferralReward;
  milestones: ReferralMilestone[];
  daily_cap: number;
};

// Approved ladder (2026-07-14): invitee gets a guaranteed-value lucky token,
// inviter gets a daily case per activated friend + premium milestones.
export const REFERRAL_CONFIG_DEFAULTS: ReferralConfig = {
  enabled: true,
  invitee_reward: { type: "lucky_token", amount: 1 },
  per_friend_reward: { type: "daily_case", amount: 1 },
  milestones: [
    { count: 3, reward: { type: "premium_case", amount: 1 } },
    { count: 5, reward: { type: "lucky_token", amount: 1 } },
    { count: 10, reward: { type: "premium_case", amount: 1 } },
  ],
  daily_cap: 10,
};

export const REFERRAL_REWARD_AMOUNT_MAX = 3;
export const REFERRAL_MILESTONES_MAX = 10;
export const REFERRAL_MILESTONE_COUNT_MAX = 10_000;
export const REFERRAL_DAILY_CAP_MAX = 100;

// users.id is a Telegram id (observed up to ~8.5e9 in prod) — cap parsing at
// Number.MAX_SAFE_INTEGER, reject zero/negative and non-canonical spellings.
export function buildReferralCode(userId: number): string | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return userId.toString(36);
}

export function parseReferralStartParam(startParam: string): { kind: "ref"; userId: number } | { kind: "src"; code: string } | null {
  const s = String(startParam || "").trim().toLowerCase();
  const ref = /^ref_([0-9a-z]+)$/.exec(s);
  if (ref) {
    const candidate = parseInt(ref[1], 36);
    if (!Number.isSafeInteger(candidate) || candidate <= 0) return null;
    // Canonical round-trip rejects "ref_007"-style aliases of the same id.
    if (candidate.toString(36) !== ref[1]) return null;
    return { kind: "ref", userId: candidate };
  }
  const src = /^src_([0-9a-z][0-9a-z_-]{0,31})$/.exec(s);
  if (src) return { kind: "src", code: src[1] };
  // Paid-ads deep links (`ig_kz_feed_1`): same attribution slot as `src_`, but
  // the prefix is kept in the stored code so ad traffic stays distinguishable
  // from channel/manual sources in the admin breakdown.
  const ad = /^ig_([0-9a-z][0-9a-z_-]{0,31})$/.exec(s);
  if (ad) return { kind: "src", code: `ig_${ad[1]}` };
  return null;
}

function parseReward(raw: unknown): ReferralReward | null {
  if (!raw || typeof raw !== "object") return null;
  const type = String((raw as any).type || "");
  if (!REFERRAL_REWARD_TYPES.includes(type as ReferralRewardType)) return null;
  const amount = Math.floor(Number((raw as any).amount));
  if (type === "none") return { type: "none", amount: 0 };
  if (!Number.isInteger(amount) || amount < 1 || amount > REFERRAL_REWARD_AMOUNT_MAX) return null;
  return { type: type as ReferralRewardType, amount };
}

// Strict parse of admin-supplied (or stored) config. Returns null on ANY
// malformed field — callers fall back to REFERRAL_CONFIG_DEFAULTS, so a
// corrupted app_config row can never disable validation or inflate rewards.
export function parseReferralConfig(raw: unknown): ReferralConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as any;

  if (typeof o.enabled !== "boolean") return null;

  const invitee = parseReward(o.invitee_reward);
  const perFriend = parseReward(o.per_friend_reward);
  if (!invitee || !perFriend) return null;

  const dailyCap = Math.floor(Number(o.daily_cap));
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > REFERRAL_DAILY_CAP_MAX) return null;

  if (!Array.isArray(o.milestones) || o.milestones.length > REFERRAL_MILESTONES_MAX) return null;
  const seen = new Set<number>();
  const milestones: ReferralMilestone[] = [];
  for (const m of o.milestones) {
    if (!m || typeof m !== "object") return null;
    const count = Math.floor(Number(m.count));
    if (!Number.isInteger(count) || count < 1 || count > REFERRAL_MILESTONE_COUNT_MAX) return null;
    if (seen.has(count)) return null;
    seen.add(count);
    const reward = parseReward(m.reward);
    if (!reward) return null;
    milestones.push({ count, reward });
  }
  milestones.sort((a, b) => a.count - b.count);

  return { enabled: o.enabled, invitee_reward: invitee, per_friend_reward: perFriend, milestones, daily_cap: dailyCap };
}

// Human labels for toasts / the referral screen (single source for web + bot copy).
export function referralRewardLabel(reward: ReferralReward): string {
  const qty = reward.amount > 1 ? ` ×${reward.amount}` : "";
  if (reward.type === "daily_case") return `Ежедневный кейс${qty}`;
  if (reward.type === "premium_case") return `Премиум-кейс${qty}`;
  if (reward.type === "lucky_token") return `Фартовый жетон${qty}`;
  return "—";
}
