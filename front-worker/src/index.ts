export type AssetFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

export type WorkerFetcher = {
  fetch: (request: Request) => Promise<Response>;
};

export interface Env {
  ASSETS: AssetFetcher;
  API?: WorkerFetcher;
  INTERNAL_API_SECRET?: string;
}

function shouldPreserveUpstreamCache(pathname: string, headers: Headers): boolean {
  const contentType = String(headers.get("Content-Type") || headers.get("content-type") || "").toLowerCase();
  return /^\/api\/proxy\/team\/\d+\/image$/.test(pathname)
    || /^\/api\/proxy\/image$/.test(pathname)
    || /^\/api\/leagues\/[^/]+\/avatar$/.test(pathname)
    || contentType.startsWith("image/");
}

function finalizeApiResponse(pathname: string, res: Response) {
  const h = new Headers(res.headers);
  if (!shouldPreserveUpstreamCache(pathname, h)) {
    h.set("Cache-Control", "no-store");
  }
  return new Response(res.body, { status: res.status, headers: h });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!env.API) {
        return jsonError(503, "API service binding is not configured");
      }
      if (!env.INTERNAL_API_SECRET) {
        return jsonError(503, "INTERNAL_API_SECRET is not configured");
      }

      const headers = new Headers(req.headers);
      headers.set("x-internal-secret", env.INTERNAL_API_SECRET);
      headers.set("x-scoregame-internal-source", "front-worker");
      headers.delete("x-telegram-bot-token");

      try {
        return finalizeApiResponse(url.pathname, await env.API.fetch(new Request(req, { headers })));
      } catch (err) {
        console.error("Service binding proxy failed", err);
        return jsonError(502, "Upstream API proxy failed");
      }
    }

    return env.ASSETS.fetch(req);
  }
};
