// web/lib/api.ts
export const API_BASE = "/api";

// --- Global initData for auto-attaching auth to ALL requests ---
let _globalInitData = '';
export function setApiInitData(data: string) { _globalInitData = data; }
export function getApiInitData(): string { return _globalInitData; }

// --- Startup latency instrumentation (diagnostic, 2026-08-15) ---
// How long the client waited for Telegram to hand over initData, measured from
// navigation start. Nothing is requested during that wait, so it is invisible in
// Worker logs — it rides along on the request headers instead, which lands it in
// the same log line as the server-side phases. Remove with the server timers.
let _clientTiming = '';
export function setApiClientTiming(parts: Record<string, number>) {
  _clientTiming = Object.entries(parts)
    .map(([k, v]) => `${k}=${Math.round(v)}`)
    .join(',');
}

function joinUrl(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE === "/api" && (p === "/api" || p.startsWith("/api/"))) {
    return p;
  }
  return API_BASE ? `${API_BASE}${p}` : p;
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = joinUrl(path);

  // Auto-attach initData header if available (ensures maintenance guard can identify admin)
  const autoHeaders: Record<string, string> = {};
  if (_globalInitData) {
    autoHeaders['x-telegram-init-data'] = _globalInitData;
  }
  if (_clientTiming) {
    autoHeaders['x-sg-client-timing'] = _clientTiming;
  }

  const headers: Record<string, string> = {
    ...autoHeaders,
    ...(init.headers as Record<string, string> || {}),
  };

  // Robust check for FormData
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  // Only default to application/json if Content-Type is not explicitly overridden 
  // AND the body is not FormData (browser needs to set boundary itself)
  if (!headers["Content-Type"] && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  // Ensure it's fully deleted if someone passed undefined or "undefined"
  if (headers["Content-Type"] === undefined || headers["Content-Type"] === "undefined") {
    delete headers["Content-Type"];
  }

  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;

    // Maintenance mode interceptor: 503 + code=MAINTENANCE
    // Don't dispatch for whitelisted paths (auth, admin, maintenance check) so admin can still log in
    if (res.status === 503 && json?.code === 'MAINTENANCE') {
      const whitelisted = ['/me', '/maintenance/', '/admin/', '/achievements'].some(w => path.startsWith(w));
      if (!whitelisted && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('maintenance', { detail: json }));
      }
    }

    // Keep the raw server code as the message (callers match on codes like
    // LEAGUE_FULL / FREE_LIMIT_CHANNEL); debug details go to console only —
    // never render internal error text + URL to the end user.
    console.error(`[api] ${msg} | url=${url} | status=${res.status}`);
    const error = new Error(msg) as Error & { url?: string; status?: number };
    error.url = url;
    error.status = res.status;
    throw error;
  }

  return json as T;
}
