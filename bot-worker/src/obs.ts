// Stage 1 — safe optimization groundwork (bot-worker copy).
//
// Lightweight structured observability for bot-worker. Mirrors
// api-worker/src/obs.ts. Emits one JSON line per completed job; never logs
// secrets / tokens / Telegram update text; never runs extra DB queries.

const SENSITIVE_KEYS = new Set<string>([
  "initdata",
  "init_data",
  "token",
  "bot_token",
  "webhook_secret",
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
  "text",
  "update",
  "message",
  "payment",
]);

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
  status?: string;
  duration_ms?: number;
  reason_code?: string;
  error_code?: string;
  [k: string]: unknown;
}

export function logEvent(payload: LogEventPayload): void {
  try {
    const base = { event: "op", service: "bot-worker", ...payload };
    console.log(JSON.stringify(redact(base as Record<string, unknown>)));
  } catch {
    /* logging must never throw into the job path */
  }
}

export class OpCounters {
  logical_db_reads = 0;
  logical_db_writes = 0;
  processed_users = 0;
  flag_skips = 0;

  read(n = 1): void {
    this.logical_db_reads += n;
  }
  write(n = 1): void {
    this.logical_db_writes += n;
  }

  snapshot(): Record<string, number> {
    return {
      logical_db_reads: this.logical_db_reads,
      logical_db_writes: this.logical_db_writes,
      processed_users: this.processed_users,
      flag_skips: this.flag_skips,
    };
  }
}
