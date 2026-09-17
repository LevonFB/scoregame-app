// luckyToken.ts
// Pure, I/O-free helpers for the "Жетон" (lucky_token) consumable item.
//
// The token BALANCE lives in the existing `fortune_spins` table (single source of
// truth); this module only holds the canonical identifiers, payment-method parsing,
// fixed spin cost, and reward-amount validation so they can be unit-tested.

// Canonical item / reward type used everywhere. The legacy `fortune_spin` reward
// type is an alias that grants the same item.
export const LUCKY_TOKEN_ITEM_TYPE = "lucky_token";
export const LUCKY_TOKEN_LEGACY_REWARD_TYPE = "fortune_spin";

// One token always pays for exactly one spin.
export const LUCKY_TOKEN_SPIN_COST = 1;
export function luckyTokenSpinCost(): number {
  return LUCKY_TOKEN_SPIN_COST;
}

// Ledger operation types (history only; never the balance source of truth).
export const LUCKY_TOKEN_OPS = {
  taskReward: "task_reward_lucky_token",
  caseDrop: "case_drop_lucky_token",
  referral: "referral_reward_lucky_token",
  spin: "lucky_ball_spin_token",
  adminGrant: "admin_grant_lucky_token",
  adminRevoke: "admin_revoke_lucky_token",
} as const;
export type LuckyTokenOp = (typeof LUCKY_TOKEN_OPS)[keyof typeof LUCKY_TOKEN_OPS];

export type FortunePaymentMethod = "lucky_token" | "balls";

// Strict parse of the spin payment method. There is NO implicit fallback: an empty
// or unknown value throws so the spin endpoint rejects it (per product decision —
// the user must pick one of two explicit buttons).
export function resolvePaymentMethod(raw: unknown): FortunePaymentMethod {
  const v = String(raw ?? "").trim();
  if (v === "lucky_token" || v === "balls") return v;
  throw new Error("FORTUNE_PAYMENT_METHOD_REQUIRED");
}

// Reasonable upper bound for a single configurable reward amount (admin forms).
export const LUCKY_TOKEN_REWARD_MAX = 50;

// Validate an admin-configured token reward quantity used in task / case editors.
// Returns a safe integer; throws coded errors on invalid input.
//   allowZero=true  → 0 means "disabled" (task reward components).
//   allowZero=false → must be >= 1 (a case/sector drop that grants tokens).
export function validateLuckyTokenAmount(raw: unknown, opts: { allowZero?: boolean; where?: string } = {}): number {
  const where = opts.where || "lucky_tokens";
  if (raw == null || raw === "") return opts.allowZero ? 0 : raise(`LUCKY_TOKEN_AMOUNT_REQUIRED:${where}`);
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`LUCKY_TOKEN_AMOUNT_NOT_INTEGER:${where}`);
  if (n < 0) throw new Error(`LUCKY_TOKEN_AMOUNT_NEGATIVE:${where}`);
  if (n === 0 && !opts.allowZero) throw new Error(`LUCKY_TOKEN_AMOUNT_TOO_SMALL:${where}`);
  if (n > LUCKY_TOKEN_REWARD_MAX) throw new Error(`LUCKY_TOKEN_AMOUNT_OVER_MAX:${where}`);
  return n;
}

function raise(code: string): never {
  throw new Error(code);
}

// Lenient read-path coercion (never throws): clamps to [0, MAX] integer.
export function normalizeLuckyTokenAmount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(LUCKY_TOKEN_REWARD_MAX, n);
}

// Canonicalize a reward type, mapping the legacy fortune_spin alias to lucky_token.
export function canonicalRewardType(type: unknown): string {
  const t = String(type ?? "").trim().toLowerCase();
  return t === LUCKY_TOKEN_LEGACY_REWARD_TYPE ? LUCKY_TOKEN_ITEM_TYPE : t;
}

export function isLuckyTokenRewardType(type: unknown): boolean {
  return canonicalRewardType(type) === LUCKY_TOKEN_ITEM_TYPE;
}
