// Stage 1 — safe optimization groundwork (bot-worker copy).
//
// Independent feature flag parsing for bot-worker. Parser logic is intentionally
// identical to api-worker/src/featureFlags.ts (separate packages, no shared dir).
// The pure parsers are unit-tested in api-worker; bot behavior is covered by the
// bot scheduled smoke E2E.
//
// Rules:
//  - Missing env variable preserves current production behavior (safe default).
//  - Invalid / unknown value falls back to the safe default.
//  - Boolean parsing is explicit (never Boolean(env.X)).

const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "off"]);

export function parseBoolFlag(value: string | undefined | null, def: boolean): boolean {
  if (value == null) return def;
  const v = value.trim().toLowerCase();
  if (v === "") return def;
  if (TRUE_TOKENS.has(v)) return true;
  if (FALSE_TOKENS.has(v)) return false;
  return def;
}

export interface IntFlagOptions {
  def: number;
  min: number;
  max: number;
}

export function parseIntFlag(value: string | undefined | null, opts: IntFlagOptions): number {
  const { def, min, max } = opts;
  if (value == null) return def;
  const v = value.trim();
  if (v === "") return def;
  if (!/^[+-]?\d+$/.test(v)) return def;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  if (n < min || n > max) return def;
  return n;
}

export interface BotFlagEnv {
  MAINTENANCE_POLL_THROTTLE_ENABLED?: string;
  MAINTENANCE_POLL_INTERVAL_MINUTES?: string;
}

export interface BotFeatureFlags {
  /** Throttle maintenance_events polling. Default false = poll every cron tick (2 min). */
  maintenancePollThrottle: boolean;
  /** Desired poll interval in minutes when throttling. Default 2 = current frequency. */
  maintenancePollIntervalMinutes: number;
}

export function resolveBotFlags(env: BotFlagEnv | undefined | null): BotFeatureFlags {
  const e: BotFlagEnv = env ?? {};
  return {
    maintenancePollThrottle: parseBoolFlag(e.MAINTENANCE_POLL_THROTTLE_ENABLED, false),
    maintenancePollIntervalMinutes: parseIntFlag(e.MAINTENANCE_POLL_INTERVAL_MINUTES, {
      def: 2,
      min: 1,
      max: 60,
    }),
  };
}
