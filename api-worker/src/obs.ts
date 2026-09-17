// Stage 1 — safe optimization groundwork.
//
// Lightweight, structured diagnostic observability for api-worker.
//
// Design rules (see SAFE_OPTIMIZATION_STAGE_1_REPORT.md):
//  - Emit ONE structured JSON line per completed operation / request / job.
//  - NEVER run an extra D1 query (or any I/O) just to produce a metric.
//  - NEVER log secrets / initData / tokens / payment payloads / full user objects.
//  - Counters are approximate application-level counters, deliberately named
//    `logical_db_reads` / `logical_db_writes` — NOT Cloudflare `d1_rows_*` metrics.

/** Keys that must never appear in a diagnostic log line. Stripped defensively. */
const SENSITIVE_KEYS = new Set<string>([
  "initdata",
  "init_data",
  "x-telegram-init-data",
  "token",
  "bot_token",
  "telegram_bot_token",
  "internal_api_secret",
  "webhook_secret",
  "maintenance_bypass_secret",
  "secret",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "cookies",
  "headers",
  "password",
  "phone",
  "email",
  "first_name",
  "last_name",
  "username",
  "payment",
  "invoice_payload",
]);

/** Generate a short, collision-resistant run id without external deps. */
export function makeRunId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Defensive redaction: drop any sensitive key (case-insensitive) at any depth. */
export function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface LogEventPayload {
  event?: string;
  operation: string;
  service?: string;
  trigger?: string;
  run_id?: string;
  request_id?: string;
  status?: "ok" | "error" | "skipped" | string;
  duration_ms?: number;
  reason_code?: string;
  error_code?: string;
  [k: string]: unknown;
}

/**
 * Emit one structured diagnostic line. Safe to call once per completed op.
 * Redacts sensitive keys defensively; failures here must never break the request.
 */
export function logEvent(payload: LogEventPayload): void {
  try {
    const base = { event: "op", service: "api-worker", ...payload };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(redact(base as Record<string, unknown>)));
  } catch {
    /* logging must never throw into the request path */
  }
}

/**
 * Per-request / per-job application-level counters.
 * Incremented next to existing DB calls — adds no new queries of its own.
 */
export class OpCounters {
  logical_db_reads = 0;
  logical_db_writes = 0;
  quest_reconcile_calls = 0;
  leaderboard_calls = 0;
  backfill_calls = 0;
  weekly_finalize_calls = 0;
  flag_skips = 0;
  lock_skips = 0;
  processed_users = 0;
  processed_matches = 0;
  processed_periods = 0;

  read(n = 1): void {
    this.logical_db_reads += n;
  }
  write(n = 1): void {
    this.logical_db_writes += n;
  }

  /** Snapshot as a plain object for inclusion in a final log line. */
  snapshot(): Record<string, number> {
    return {
      logical_db_reads: this.logical_db_reads,
      logical_db_writes: this.logical_db_writes,
      quest_reconcile_calls: this.quest_reconcile_calls,
      leaderboard_calls: this.leaderboard_calls,
      backfill_calls: this.backfill_calls,
      weekly_finalize_calls: this.weekly_finalize_calls,
      flag_skips: this.flag_skips,
      lock_skips: this.lock_skips,
      processed_users: this.processed_users,
      processed_matches: this.processed_matches,
      processed_periods: this.processed_periods,
    };
  }
}

/** Convenience: wall-clock millisecond timer. */
export function now(): number {
  return Date.now();
}
